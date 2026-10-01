import { useEffect, useState } from 'react'

import { apiErrorMessage } from '../../shared/api/errors'
import { getSession } from '../sessions/api'
import type { SessionAssignment } from '../sessions/types'
import { assignEventActor } from './api'
import type { ExamEventDetail } from './types'

export function EventActorAssignment({ event, disabled, onBusy, onAssigned }: {
  event: ExamEventDetail
  disabled: boolean
  onBusy(value: boolean): void
  onAssigned(event: ExamEventDetail): void
}) {
  const [assignments, setAssignments] = useState<SessionAssignment[]>([])
  const [candidateId, setCandidateId] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void getSession(event.session_id).then(session => {
      if (!cancelled) setAssignments(session.assignments)
    }).catch(error => { if (!cancelled) setError(apiErrorMessage(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [event.session_id, revision])

  const submit = async () => {
    onBusy(true)
    setError(null)
    try {
      const updated = await assignEventActor(event.id, candidateId, note)
      onAssigned(updated)
    } catch (error) { setError(apiErrorMessage(error)) }
    finally { onBusy(false) }
  }

  return <div className="event-review-form">
    <p>Sự kiện đã được lưu khi chưa xác định thí sinh. Xem lại video trước khi gắn danh tính; sự kiện sẽ trở về trạng thái chờ xác minh.</p>
    <label htmlFor="event-actor">Thí sinh trong ca thi</label>
    <select id="event-actor" disabled={disabled || loading} value={candidateId} onChange={e => setCandidateId(e.target.value)}>
      <option value="">{loading ? 'Đang tải…' : 'Chọn thí sinh'}</option>
      {assignments.map(assignment => <option key={assignment.id} value={assignment.id}>{assignment.candidate.candidate_code} — {assignment.candidate.full_name} ({assignment.seat.code})</option>)}
    </select>
    {!loading && !assignments.length && !error && <p>Ca thi chưa có thí sinh được xếp chỗ. Có thể bổ sung trong phần quản lý ca thi rồi tải lại danh sách.</p>}
    <button type="button" className="secondary-button" disabled={disabled || loading} onClick={() => setRevision(value => value + 1)}>Tải lại danh sách thí sinh</button>
    <label htmlFor="event-actor-note">Căn cứ xác định thí sinh</label>
    <textarea id="event-actor-note" maxLength={2000} rows={2} disabled={disabled} value={note} onChange={e => setNote(e.target.value)} placeholder="Vị trí bàn, thời điểm trong video và thông tin đã đối chiếu…" />
    <button type="button" className="primary-button" disabled={disabled || loading || !candidateId || !note.trim()} onClick={() => void submit()}>Gắn thí sinh vào sự kiện</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}
