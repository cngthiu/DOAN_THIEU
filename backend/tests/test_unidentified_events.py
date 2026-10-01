import uuid
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.cheating_classifier.runtime import CheatingClassifierRuntime
from app.ai.event_aggregation.types import AggregatedEvent, EventBehavior
from app.core.config import Settings
from app.core.security import create_access_token
from app.db.models.audit import AuditLog
from app.db.models.event import Event, EventActor
from app.db.models.session import ExamSession, SessionCandidate
from app.db.models.user import User
from app.features.events.service import persist_ai_event
from app.monitoring.config import CheatingClassifierConfig
from tests.test_cheating_classifier import NORMAL, PHONE, FakeModel, run, track
from tests.test_event_aggregation import _database_event_context


def finding(
    session_id: uuid.UUID, reference: str = "runtime:one:generation:0:actor:A1"
) -> AggregatedEvent:
    return AggregatedEvent(
        session_id=session_id,
        behavior=EventBehavior.USING_PHONE_CHEAT_SHEET,
        session_candidate_ids=(),
        proposal_ids=(reference,),
        start_ms=1000,
        end_ms=5000,
        peak_ms=3000,
        peak_probability=0.96,
        active_probability_sum=2.8,
        active_prediction_count=3,
    )


@pytest.mark.parametrize("ending", ["normal", "seek", "lost", "stop"])
def test_unidentified_runtime_findings_survive_alert_end(db: Session, ending: str) -> None:
    session, _ = _database_event_context(db)
    model = FakeModel()
    messages = []
    events = []
    runtime = CheatingClassifierRuntime(
        session_id=session.id,
        runtime_instance_id=uuid.uuid4(),
        config=CheatingClassifierConfig(enabled=True),
        model=model,
        publish=messages.append,
        emit_event=events.append,
    )
    try:
        model.probs = PHONE
        run(runtime, (track(None, "A1"), track(None, "A2")), 0, 8000)
        assert any(
            a["alert"] for m in messages if m["type"] == "cheat_prediction" for a in m["actors"]
        )
        if ending == "normal":
            model.probs = NORMAL
            run(runtime, (track(None, "A1"), track(None, "A2")), 8000, 14000)
        elif ending == "seek":
            runtime.reset(1)
        elif ending == "lost":
            run(runtime, (), 8000, 16000)
        else:
            assert runtime.close()
        assert len(events) == 2
        for event in events:
            stored, created = persist_ai_event(db, event)
            assert created and stored.status == "PENDING_REVIEW"
            assert not event.session_candidate_ids
            assert not persist_ai_event(db, event)[1]
        assert db.scalar(select(func.count(Event.id))) == 2
        assert db.scalar(select(func.count(EventActor.id))) == 0
        assert (
            db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "AI_EVENT_CREATED"))
            == 2
        )
    finally:
        assert runtime.close()


def test_unknown_identity_keys_do_not_merge_people_runs_or_seek_generations(db: Session) -> None:
    session, _ = _database_event_context(db)
    base = finding(session.id)
    for reference in [
        base.proposal_ids[0],
        "runtime:one:generation:0:actor:A2",
        "runtime:two:generation:0:actor:A1",
        "runtime:one:generation:1:actor:A1",
    ]:
        _, created = persist_ai_event(db, replace(base, proposal_ids=(reference,)))
        assert created
    assert db.scalar(select(func.count(Event.id))) == 4
    with pytest.raises(ValueError, match="reference"):
        persist_ai_event(db, replace(base, proposal_ids=()))
    known = replace(base, session_candidate_ids=(uuid.uuid4(),))
    assert known.fingerprint == replace(known, proposal_ids=("different-runtime",)).fingerprint


def test_unidentified_event_read_review_and_audited_assignment(
    client: TestClient, db: Session, settings: Settings
) -> None:
    session, assignments = _database_event_context(db)
    event = finding(session.id)
    stored, _ = persist_ai_event(db, event)
    admin = db.scalar(select(User).where(User.username == "phase7-admin"))
    headers = {"Authorization": f"Bearer {create_access_token(admin.id, settings)}"}
    path = f"/api/v1/events/{stored.id}"
    detail = client.get(path, headers=headers).json()
    assert detail["actors"] == [] and detail["status"] == "PENDING_REVIEW"
    assert detail["runtime_references"] == list(event.proposal_ids)
    assert detail["actor_assignments"] == []
    assert client.get("/api/v1/events", headers=headers).json()["total"] == 1
    assert client.get("/api/v1/events/counts", headers=headers).json()["pending_review"] == 1
    assert (
        client.post(
            path + "/reviews",
            headers=headers,
            json={"decision": "NEEDS_REVIEW", "note": "Check identity"},
        ).status_code
        == 201
    )
    data = {"session_candidate_id": str(assignments[0].id), "note": "  Matched desk and video  "}
    assert client.post(path + "/actors", json=data).status_code == 401
    assert (
        client.post(path + "/actors", headers=headers, json={**data, "note": "   "}).status_code
        == 422
    )
    assert (
        client.post(
            path + "/actors",
            headers=headers,
            json={**data, "session_candidate_id": str(uuid.uuid4())},
        ).status_code
        == 422
    )
    response = client.post(path + "/actors", headers=headers, json=data)
    assert response.status_code == 200, response.text
    linked = response.json()
    assert linked["status"] == "PENDING_REVIEW"
    assert linked["actors"][0]["session_candidate_id"] == str(assignments[0].id)
    assert linked["reviews"][0]["decision"] == "NEEDS_REVIEW"
    assert linked["actor_assignments"][0]["note"] == "Matched desk and video"
    assert linked["runtime_references"] == list(event.proposal_ids)
    assert client.post(path + "/actors", headers=headers, json=data).status_code == 200
    assert (
        client.post(
            path + "/actors",
            headers=headers,
            json={**data, "session_candidate_id": str(assignments[1].id)},
        ).status_code
        == 409
    )
    assert (
        db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "EVENT_ACTOR_ASSIGNED"))
        == 1
    )
    assert not persist_ai_event(db, event)[1]  # retry does not erase manual identity
    assert client.get(path, headers=headers).json()["actors"] == linked["actors"]


def test_assignment_rejects_other_session_dispute_and_unauthorized_role(
    client: TestClient, db: Session, settings: Settings
) -> None:
    session, assignments = _database_event_context(db)
    stored, _ = persist_ai_event(db, finding(session.id))
    other = ExamSession(
        session_code="OTHER",
        exam_name="Other",
        room_id=session.room_id,
        status="READY",
        created_by=session.created_by,
    )
    supervisor = User(
        username="supervisor-test", password_hash="unused", role="SUPERVISOR", is_active=True
    )
    db.add_all([other, supervisor])
    db.flush()
    foreign = SessionCandidate(
        session_id=other.id,
        candidate_id=assignments[0].candidate_id,
        seat_id=assignments[0].seat_id,
    )
    db.add(foreign)
    db.commit()
    headers = {"Authorization": f"Bearer {create_access_token(session.created_by, settings)}"}
    path = f"/api/v1/events/{stored.id}/actors"
    data = {"session_candidate_id": str(assignments[0].id), "note": "Checked video"}
    assert (
        client.post(
            path,
            headers={"Authorization": f"Bearer {create_access_token(supervisor.id, settings)}"},
            json=data,
        ).status_code
        == 403
    )
    assert (
        client.post(
            path, headers=headers, json={**data, "session_candidate_id": str(foreign.id)}
        ).status_code
        == 422
    )
    stored.status = "DISPUTED"
    db.commit()
    assert client.post(path, headers=headers, json=data).status_code == 409
    assert db.scalar(select(func.count(EventActor.id))) == 0
    assert (
        db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "EVENT_ACTOR_ASSIGNED"))
        == 0
    )
