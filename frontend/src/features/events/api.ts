import { apiClient } from '../../shared/api/client'
import type { PageResponse } from '../../shared/api/types'
import type { BehaviorType, EventCounts, EventStatus, ExamEvent, ExamEventDetail, ReviewDecision } from './types'

export interface EventQuery {
  candidateId?: string
  roomId?: string
  query?: string
  sessionId?: string
  status?: EventStatus | ''
  behavior?: BehaviorType | ''
  page?: number
  pageSize?: number
}

export async function getEvents(query: EventQuery = {}): Promise<PageResponse<ExamEvent>> {
  const params = {
    session_id: query.sessionId || undefined,
    candidate_id: query.candidateId || undefined,
    room_id: query.roomId || undefined,
    q: query.query?.trim() || undefined,
    status: query.status || undefined,
    behavior: query.behavior || undefined,
    page: query.page ?? 1,
    page_size: query.pageSize ?? 20,
  }
  return (await apiClient.get<PageResponse<ExamEvent>>('/events', { params })).data
}

export async function getEventCounts(sessionId?: string, filters: Pick<EventQuery, 'candidateId' | 'roomId' | 'query' | 'behavior'> = {}): Promise<EventCounts> {
  return (await apiClient.get<EventCounts>('/events/counts', { params: { session_id: sessionId || undefined, candidate_id: filters.candidateId || undefined, room_id: filters.roomId || undefined, q: filters.query?.trim() || undefined, behavior: filters.behavior || undefined } })).data
}

export async function getEvent(eventId: string): Promise<ExamEventDetail> {
  return (await apiClient.get<ExamEventDetail>(`/events/${eventId}`)).data
}

export async function reviewEvent(eventId: string, decision: ReviewDecision, note: string): Promise<ExamEventDetail> {
  return (await apiClient.post<ExamEventDetail>(`/events/${eventId}/reviews`, { decision, note: note.trim() || null })).data
}

export function eventMediaUrl(event: Pick<ExamEvent, 'video_asset_id'>): string | null {
  return event.video_asset_id ? `/api/v1/media/${event.video_asset_id}/content` : null
}

export async function assignEventActor(eventId: string, sessionCandidateId: string, note: string): Promise<ExamEventDetail> {
  return (await apiClient.post<ExamEventDetail>(`/events/${eventId}/actors`, { session_candidate_id: sessionCandidateId, note: note.trim() })).data
}
