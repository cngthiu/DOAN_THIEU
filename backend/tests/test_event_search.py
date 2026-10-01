import uuid
from dataclasses import replace

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.event_aggregation.types import EventBehavior
from app.core.config import Settings
from app.core.security import create_access_token
from app.db.models.candidate import Candidate
from app.db.models.room import Room, Seat
from app.db.models.session import ExamSession, SessionCandidate
from app.features.events.service import persist_ai_event
from tests.test_event_aggregation import _database_event_context
from tests.test_unidentified_events import finding


def test_candidate_search_across_sessions_filters_counts_and_pagination(
    client: TestClient,
    db: Session,
    settings: Settings,
) -> None:
    session, assignments = _database_event_context(db)
    for candidate in db.scalars(select(Candidate)):
        candidate.full_name = "Same Name"
    other_room = Room(code="OTHER", name="Other room", is_active=False)
    db.add(other_room)
    db.flush()
    other_session = ExamSession(
        session_code="OTHER",
        exam_name="Other exam",
        room_id=other_room.id,
        status="COMPLETED",
        created_by=session.created_by,
    )
    db.add(other_session)
    db.flush()
    other_seat = Seat(
        room_id=other_room.id, code="B01", x=0.1, y=0.1, width=0.2, height=0.2, is_active=True
    )
    db.add(other_seat)
    db.flush()
    other_assignment = SessionCandidate(
        session_id=other_session.id,
        candidate_id=assignments[0].candidate_id,
        seat_id=other_seat.id,
    )
    db.add(other_assignment)
    db.commit()
    first, _ = persist_ai_event(
        db,
        replace(
            finding(session.id),
            behavior=EventBehavior.COMMUNICATING,
            session_candidate_ids=tuple(item.id for item in assignments),
        ),
    )
    second, _ = persist_ai_event(
        db,
        replace(
            finding(other_session.id),
            session_candidate_ids=(other_assignment.id,),
        ),
    )
    second.status = "DISMISSED"
    db.commit()
    persist_ai_event(db, finding(session.id))  # unknown actor must not match a candidate search
    headers = {"Authorization": f"Bearer {create_access_token(session.created_by, settings)}"}

    def search(params):
        response = client.get("/api/v1/events", params=params, headers=headers)
        assert response.status_code == 200, response.text
        return response.json()

    assert search({})["total"] == 3
    result = search({"q": " same name "})
    assert result["total"] == 2  # the two actors on first do not duplicate the event
    assert {row["id"] for row in result["items"]} == {str(first.id), str(second.id)}
    filters = {"candidate_id": str(assignments[0].candidate_id)}
    assert search(filters)["total"] == 2
    assert search({"candidate_id": str(assignments[1].candidate_id)})["total"] == 1
    assert search({**filters, "room_id": str(other_room.id)})["items"][0]["id"] == str(second.id)
    assert search({**filters, "session_id": str(session.id)})["total"] == 1
    assert search({**filters, "status": "DISMISSED"})["total"] == 1
    assert search({**filters, "behavior": "COMMUNICATING"})["total"] == 1
    assert search({"q": "p7-2"})["total"] == 1
    assert search({"q": "%"})["total"] == 0
    assert search({"q": "not found"})["total"] == 0
    assert search({"candidate_id": str(uuid.uuid4())})["total"] == 0
    one = search({**filters, "page_size": 1})
    two = search({**filters, "page_size": 1, "page": 2})
    assert one["total"] == two["total"] == 2
    assert one["items"][0]["id"] != two["items"][0]["id"]
    counts = client.get("/api/v1/events/counts", params=filters, headers=headers).json()
    assert counts["total"] == 2 and counts["dismissed"] == 1 and counts["pending_review"] == 1
    for extra in [
        {"room_id": str(other_room.id)},
        {"q": "P7-2"},
        {"behavior": "COMMUNICATING"},
        {"session_id": str(session.id)},
    ]:
        params = {**filters, **extra}
        counts = client.get("/api/v1/events/counts", params=params, headers=headers).json()
        expected = 0 if extra.get("q") == "P7-2" else 1
        assert counts["total"] == search(params)["total"] == expected
    assert client.get("/api/v1/events", params=filters).status_code == 401
    assert (
        client.get(
            "/api/v1/events", params={"candidate_id": "invalid"}, headers=headers
        ).status_code
        == 422
    )


def test_room_status_filter_and_archiving_preserve_events(
    client: TestClient,
    db: Session,
    settings: Settings,
) -> None:
    session, _ = _database_event_context(db)
    event, _ = persist_ai_event(db, finding(session.id))
    headers = {"Authorization": f"Bearer {create_access_token(session.created_by, settings)}"}
    response = client.patch(
        f"/api/v1/rooms/{session.room_id}", json={"is_active": False}, headers=headers
    )
    assert response.status_code == 200
    assert (
        client.get("/api/v1/rooms", params={"is_active": True}, headers=headers).json()["total"]
        == 0
    )
    rooms = client.get(
        "/api/v1/rooms", params={"is_active": False, "q": "P7"}, headers=headers
    ).json()
    assert rooms["total"] == 1
    result = client.get(
        "/api/v1/events", params={"room_id": str(session.room_id)}, headers=headers
    ).json()
    assert result["items"][0]["id"] == str(event.id)
    assert (
        client.patch(
            f"/api/v1/rooms/{session.room_id}", json={"is_active": True}, headers=headers
        ).status_code
        == 200
    )
    assert (
        client.get("/api/v1/rooms", params={"is_active": True}, headers=headers).json()["total"]
        == 1
    )
