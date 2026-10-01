import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { WebSocketServer, WebSocket } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV !== 'production'
const PORT = 3000
const HOST = '0.0.0.0'

// --- In-Memory Database Entities ---

interface UserEntity {
  id: string
  username: string
  full_name: string | null
  role: 'SUPERVISOR' | 'REVIEWER' | 'ADMIN'
  is_active: boolean
  password_hash: string
  created_at: string
}

interface SeatEntity {
  id: string
  room_id: string
  code: string
  x: number
  y: number
  width: number
  height: number
  sort_order: number | null
  is_active: boolean
}

interface RoomEntity {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

interface CandidateEntity {
  id: string
  candidate_code: string
  full_name: string
  class_name: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

interface CameraEntity {
  id: string
  name: string
  rtsp_url: string
  room_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

interface MediaAssetEntity {
  id: string
  original_filename: string
  media_url: string
  codec: string
  width: number
  height: number
  fps: number
  duration_ms: number
  size_bytes: number
  created_at: string
}

interface SessionAssignmentEntity {
  id: string
  candidate_id: string
  seat_id: string
}

interface ExamSessionEntity {
  id: string
  session_code: string
  exam_name: string
  room_id: string
  source_type: 'CAMERA' | 'VIDEO_UPLOAD'
  camera_id: string | null
  video_asset_id: string | null
  status: 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ERROR'
  scheduled_start: string | null
  scheduled_end: string | null
  actual_start: string | null
  actual_end: string | null
  duration_minutes: number
  runtime_profile: string | null
  created_by: string
  assignments: SessionAssignmentEntity[]
  created_at: string
  updated_at: string
}

interface EventReviewEntity {
  id: string
  decision: 'CONFIRM' | 'DISMISS' | 'NEEDS_REVIEW'
  note: string | null
  reviewer_id: string
  reviewer_name: string
  created_at: string
}

interface ExamEventEntity {
  id: string
  event_code: string
  session_id: string
  session_code: string
  exam_name: string
  video_asset_id: string | null
  source: 'AI' | 'MANUAL'
  behavior_type: 'SUSPICIOUS_LOOKING' | 'COMMUNICATING' | 'EXCHANGE_OBJECT' | 'USING_PHONE_CHEAT_SHEET' | 'OTHER'
  start_ms: number
  end_ms: number
  peak_ms: number | null
  ai_confidence: number | null
  status: 'PENDING_REVIEW' | 'CONFIRMED' | 'DISMISSED' | 'NEEDS_REVIEW' | 'DISPUTED' | 'RESOLVED'
  created_at: string
  updated_at: string
  actors: Array<{
    session_candidate_id: string
    candidate_id: string
    candidate_code: string
    full_name: string
    seat_code: string | null
  }>
  reviews: EventReviewEntity[]
}

interface AuditLogEntity {
  id: string
  timestamp: string
  actor_id: string
  actor_name: string
  action: string
  target_type: string
  target_id: string
  details: string
}

// --- Initial Seed Data ---

const users: UserEntity[] = [
  {
    id: 'user-admin',
    username: 'admin',
    full_name: 'Quản trị viên hệ thống',
    role: 'ADMIN',
    is_active: true,
    password_hash: 'hashed',
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'user-supervisor',
    username: 'giamthi1',
    full_name: 'Giám thị Nguyễn Văn A',
    role: 'SUPERVISOR',
    is_active: true,
    password_hash: 'hashed',
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'user-reviewer',
    username: 'kiemduyet1',
    full_name: 'Cán bộ kiểm duyệt Trần Thị B',
    role: 'REVIEWER',
    is_active: true,
    password_hash: 'hashed',
    created_at: '2026-09-01T00:00:00Z',
  },
]

const rooms: RoomEntity[] = [
  {
    id: 'room-101',
    code: 'P101',
    name: 'Phòng thi Lý thuyết 101',
    description: 'Phòng thi tiêu chuẩn 30 chỗ, có hệ thống 2 camera giám sát AI',
    is_active: true,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
  },
  {
    id: 'room-102',
    code: 'P102',
    name: 'Phòng máy tính 102',
    description: 'Phòng thực hành máy tính 24 chỗ',
    is_active: true,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
  },
]

const seats: SeatEntity[] = [
  { id: 'seat-101-a1', room_id: 'room-101', code: 'A1', x: 0.12, y: 0.15, width: 0.15, height: 0.20, sort_order: 1, is_active: true },
  { id: 'seat-101-a2', room_id: 'room-101', code: 'A2', x: 0.42, y: 0.15, width: 0.15, height: 0.20, sort_order: 2, is_active: true },
  { id: 'seat-101-a3', room_id: 'room-101', code: 'A3', x: 0.72, y: 0.15, width: 0.15, height: 0.20, sort_order: 3, is_active: true },
  { id: 'seat-101-b1', room_id: 'room-101', code: 'B1', x: 0.12, y: 0.50, width: 0.15, height: 0.20, sort_order: 4, is_active: true },
  { id: 'seat-101-b2', room_id: 'room-101', code: 'B2', x: 0.42, y: 0.50, width: 0.15, height: 0.20, sort_order: 5, is_active: true },
  { id: 'seat-101-b3', room_id: 'room-101', code: 'B3', x: 0.72, y: 0.50, width: 0.15, height: 0.20, sort_order: 6, is_active: true },
  { id: 'seat-102-m1', room_id: 'room-102', code: 'M01', x: 0.15, y: 0.20, width: 0.18, height: 0.25, sort_order: 1, is_active: true },
  { id: 'seat-102-m2', room_id: 'room-102', code: 'M02', x: 0.50, y: 0.20, width: 0.18, height: 0.25, sort_order: 2, is_active: true },
]

const candidates: CandidateEntity[] = [
  { id: 'cand-001', candidate_code: 'SV20210001', full_name: 'Nguyễn Văn An', class_name: 'CNTT-K64', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cand-002', candidate_code: 'SV20210002', full_name: 'Trần Thị Bình', class_name: 'CNTT-K64', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cand-003', candidate_code: 'SV20210003', full_name: 'Lê Hoàng Cường', class_name: 'KTPM-K64', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cand-004', candidate_code: 'SV20210004', full_name: 'Phạm Minh Đức', class_name: 'KTPM-K64', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cand-005', candidate_code: 'SV20210005', full_name: 'Vũ Thị Hoa', class_name: 'HTTT-K64', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cand-006', candidate_code: 'SV20210006', full_name: 'Đỗ Quang Huy', class_name: 'CNTT-K65', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cand-007', candidate_code: 'SV20210007', full_name: 'Bùi Thị Mai', class_name: 'CNTT-K65', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cand-008', candidate_code: 'SV20210008', full_name: 'Hoàng Tuấn Nam', class_name: 'KTPM-K65', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
]

const cameras: CameraEntity[] = [
  { id: 'cam-001', name: 'Camera P101 - Góc chính toàn cảnh', rtsp_url: 'rtsp://192.168.1.101:554/stream1', room_id: 'room-101', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
  { id: 'cam-002', name: 'Camera P102 - Bao quát phòng máy', rtsp_url: 'rtsp://192.168.1.102:554/stream1', room_id: 'room-102', is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' },
]

const mediaAssets: MediaAssetEntity[] = [
  {
    id: 'media-001',
    original_filename: 'phong_thi_giua_ky_p101.mp4',
    media_url: '/mock-video.mp4',
    codec: 'h264',
    width: 1920,
    height: 1080,
    fps: 25,
    duration_ms: 300000,
    size_bytes: 42500000,
    created_at: '2026-09-29T07:00:00Z',
  },
]

const sessions: ExamSessionEntity[] = [
  {
    id: 'session-running-1',
    session_code: 'SESSION-2026-09-01',
    exam_name: 'Kỳ thi Cuối kỳ môn Thị giác máy tính',
    room_id: 'room-101',
    source_type: 'VIDEO_UPLOAD',
    camera_id: null,
    video_asset_id: 'media-001',
    status: 'RUNNING',
    scheduled_start: '2026-09-29T07:30:00Z',
    scheduled_end: '2026-09-29T09:30:00Z',
    actual_start: '2026-09-29T07:35:00Z',
    actual_end: null,
    duration_minutes: 120,
    runtime_profile: 'gtx1650',
    created_by: 'user-admin',
    assignments: [
      { id: 'asgn-01', candidate_id: 'cand-001', seat_id: 'seat-101-a1' },
      { id: 'asgn-02', candidate_id: 'cand-002', seat_id: 'seat-101-a2' },
      { id: 'asgn-03', candidate_id: 'cand-003', seat_id: 'seat-101-b1' },
      { id: 'asgn-04', candidate_id: 'cand-004', seat_id: 'seat-101-b2' },
    ],
    created_at: '2026-09-29T07:00:00Z',
    updated_at: '2026-09-29T07:35:00Z',
  },
  {
    id: 'session-ready-2',
    session_code: 'SESSION-2026-09-02',
    exam_name: 'Kỳ thi Giữa kỳ môn Hệ thống nhúng',
    room_id: 'room-101',
    source_type: 'CAMERA',
    camera_id: 'cam-001',
    video_asset_id: null,
    status: 'READY',
    scheduled_start: '2026-09-29T10:00:00Z',
    scheduled_end: '2026-09-29T11:30:00Z',
    actual_start: null,
    actual_end: null,
    duration_minutes: 90,
    runtime_profile: 'gtx1650',
    created_by: 'user-admin',
    assignments: [
      { id: 'asgn-05', candidate_id: 'cand-005', seat_id: 'seat-101-a1' },
      { id: 'asgn-06', candidate_id: 'cand-006', seat_id: 'seat-101-a2' },
    ],
    created_at: '2026-09-29T07:10:00Z',
    updated_at: '2026-09-29T07:15:00Z',
  },
  {
    id: 'session-draft-3',
    session_code: 'SESSION-2026-09-03',
    exam_name: 'Thi kết thúc học phần Cơ sở dữ liệu',
    room_id: 'room-102',
    source_type: 'CAMERA',
    camera_id: 'cam-002',
    video_asset_id: null,
    status: 'DRAFT',
    scheduled_start: '2026-09-30T08:00:00Z',
    scheduled_end: '2026-09-30T09:30:00Z',
    actual_start: null,
    actual_end: null,
    duration_minutes: 90,
    runtime_profile: null,
    created_by: 'user-admin',
    assignments: [],
    created_at: '2026-09-29T07:20:00Z',
    updated_at: '2026-09-29T07:20:00Z',
  },
]

const events: ExamEventEntity[] = [
  {
    id: 'event-001',
    event_code: 'EVT-20260929-001',
    session_id: 'session-running-1',
    session_code: 'SESSION-2026-09-01',
    exam_name: 'Kỳ thi Cuối kỳ môn Thị giác máy tính',
    video_asset_id: 'media-001',
    source: 'AI',
    behavior_type: 'SUSPICIOUS_LOOKING',
    start_ms: 24500,
    end_ms: 28200,
    peak_ms: 26000,
    ai_confidence: 0.88,
    status: 'PENDING_REVIEW',
    created_at: '2026-09-29T07:42:00Z',
    updated_at: '2026-09-29T07:42:00Z',
    actors: [
      {
        session_candidate_id: 'asgn-01',
        candidate_id: 'cand-001',
        candidate_code: 'SV20210001',
        full_name: 'Nguyễn Văn An',
        seat_code: 'A1',
      },
    ],
    reviews: [],
  },
  {
    id: 'event-002',
    event_code: 'EVT-20260929-002',
    session_id: 'session-running-1',
    session_code: 'SESSION-2026-09-01',
    exam_name: 'Kỳ thi Cuối kỳ môn Thị giác máy tính',
    video_asset_id: 'media-001',
    source: 'AI',
    behavior_type: 'COMMUNICATING',
    start_ms: 62000,
    end_ms: 66500,
    peak_ms: 64100,
    ai_confidence: 0.79,
    status: 'CONFIRMED',
    created_at: '2026-09-29T07:45:00Z',
    updated_at: '2026-09-29T07:48:00Z',
    actors: [
      {
        session_candidate_id: 'asgn-01',
        candidate_id: 'cand-001',
        candidate_code: 'SV20210001',
        full_name: 'Nguyễn Văn An',
        seat_code: 'A1',
      },
      {
        session_candidate_id: 'asgn-02',
        candidate_id: 'cand-002',
        candidate_code: 'SV20210002',
        full_name: 'Trần Thị Bình',
        seat_code: 'A2',
      },
    ],
    reviews: [
      {
        id: 'rev-001',
        decision: 'CONFIRM',
        note: 'Xác nhận: Thí sinh bàn A1 quay sang thì thầm trao đổi bài với bàn A2.',
        reviewer_id: 'user-admin',
        reviewer_name: 'Quản trị viên hệ thống',
        created_at: '2026-09-29T07:48:00Z',
      },
    ],
  },
  {
    id: 'event-003',
    event_code: 'EVT-20260929-003',
    session_id: 'session-running-1',
    session_code: 'SESSION-2026-09-01',
    exam_name: 'Kỳ thi Cuối kỳ môn Thị giác máy tính',
    video_asset_id: 'media-001',
    source: 'AI',
    behavior_type: 'USING_PHONE_CHEAT_SHEET',
    start_ms: 115000,
    end_ms: 119800,
    peak_ms: 117200,
    ai_confidence: 0.94,
    status: 'NEEDS_REVIEW',
    created_at: '2026-09-29T07:55:00Z',
    updated_at: '2026-09-29T08:00:00Z',
    actors: [
      {
        session_candidate_id: 'asgn-03',
        candidate_id: 'cand-003',
        candidate_code: 'SV20210003',
        full_name: 'Lê Hoàng Cường',
        seat_code: 'B1',
      },
    ],
    reviews: [
      {
        id: 'rev-002',
        decision: 'NEEDS_REVIEW',
        note: 'Cần kiểm tra kỹ hơn góc camera zoom xem có tài liệu trong ngăn bàn không.',
        reviewer_id: 'user-reviewer',
        reviewer_name: 'Cán bộ kiểm duyệt Trần Thị B',
        created_at: '2026-09-29T08:00:00Z',
      },
    ],
  },
]

const auditLogs: AuditLogEntity[] = [
  {
    id: 'audit-001',
    timestamp: '2026-09-29T07:00:00Z',
    actor_id: 'user-admin',
    actor_name: 'Quản trị viên hệ thống',
    action: 'SESSION_CREATE',
    target_type: 'ExamSession',
    target_id: 'session-running-1',
    details: 'Khởi tạo phiên thi SESSION-2026-09-01 tại phòng P101',
  },
  {
    id: 'audit-002',
    timestamp: '2026-09-29T07:35:00Z',
    actor_id: 'user-admin',
    actor_name: 'Quản trị viên hệ thống',
    action: 'MONITORING_START',
    target_type: 'ExamSession',
    target_id: 'session-running-1',
    details: 'Bắt đầu giám sát phiên thi với mô hình YOLO11n + ByteTrack + TSM',
  },
  {
    id: 'audit-003',
    timestamp: '2026-09-29T07:48:00Z',
    actor_id: 'user-admin',
    actor_name: 'Quản trị viên hệ thống',
    action: 'EVENT_CONFIRM',
    target_type: 'ExamEvent',
    target_id: 'event-002',
    details: 'Xác nhận hành vi gian lận (Trao đổi bài) cho thí sinh SV20210001 và SV20210002',
  },
]

function formatSession(session: ExamSessionEntity) {
  const room = rooms.find((r) => r.id === session.room_id) || {
    id: session.room_id,
    code: 'P000',
    name: 'Phòng không xác định',
    is_active: false,
  }
  const camera = session.camera_id ? cameras.find((c) => c.id === session.camera_id) ?? null : null
  const video = session.video_asset_id ? mediaAssets.find((m) => m.id === session.video_asset_id) ?? null : null
  const user = users.find((u) => u.id === session.created_by) || {
    id: session.created_by,
    username: 'admin',
    full_name: 'Quản trị viên',
  }
  const roomSeats = seats.filter((s) => s.room_id === session.room_id && s.is_active)
  const activeSeats = roomSeats.length

  const assignments = session.assignments.map((asgn) => {
    const cand = candidates.find((c) => c.id === asgn.candidate_id) || {
      id: asgn.candidate_id,
      candidate_code: 'SV000000',
      full_name: 'Thí sinh',
      class_name: null,
    }
    const seat = seats.find((s) => s.id === asgn.seat_id) || {
      id: asgn.seat_id,
      code: '?',
      is_active: true,
    }
    return {
      id: asgn.id,
      candidate: {
        id: cand.id,
        candidate_code: cand.candidate_code,
        full_name: cand.full_name,
        class_name: cand.class_name,
      },
      seat: {
        id: seat.id,
        code: seat.code,
        is_active: seat.is_active,
      },
    }
  })

  return {
    id: session.id,
    session_code: session.session_code,
    exam_name: session.exam_name,
    room_id: session.room_id,
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      is_active: room.is_active,
    },
    source_type: session.source_type,
    camera_id: session.camera_id,
    camera: camera ? { id: camera.id, name: camera.name, is_active: camera.is_active } : null,
    video_asset_id: session.video_asset_id,
    video: video ? {
      id: video.id,
      original_filename: video.original_filename,
      media_url: video.media_url,
      codec: video.codec,
      width: video.width,
      height: video.height,
      fps: video.fps,
      duration_ms: video.duration_ms,
      size_bytes: video.size_bytes,
    } : null,
    status: session.status,
    scheduled_start: session.scheduled_start,
    scheduled_end: session.scheduled_end,
    actual_start: session.actual_start,
    actual_end: session.actual_end,
    duration_minutes: session.duration_minutes,
    runtime_profile: session.runtime_profile,
    created_by: session.created_by,
    created_by_user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
    },
    candidate_count: assignments.length,
    assignments,
    readiness: {
      room_selected: Boolean(session.room_id),
      room_active: room.is_active,
      seat_layout_available: activeSeats > 0,
      active_seats: activeSeats,
      candidates_assigned: assignments.length,
      video_configured: session.source_type === 'CAMERA' ? Boolean(session.camera_id) : Boolean(session.video_asset_id),
      monitoring_status: (session.status === 'RUNNING' ? 'RUNNING' : session.status === 'PAUSED' ? 'PAUSED' : session.status === 'COMPLETED' ? 'COMPLETED' : 'NOT_STARTED') as any,
      can_mark_ready: room.is_active && (session.source_type === 'CAMERA' ? Boolean(session.camera_id) : Boolean(session.video_asset_id)),
    },
    created_at: session.created_at,
    updated_at: session.updated_at,
  }
}

async function startServer() {
  const app = express()
  const server = http.createServer(app)

  app.use(cors())
  app.use(express.json())

  // Serve a dummy mock video stream for <video> playback
  app.get(['/mock-video.mp4', '/api/v1/media/:id/content'], (_req: Request, res: Response) => {
    // Provide a small blank webm/mp4 header or 200 with video content-type
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Accept-Ranges', 'bytes')
    // Return empty payload or minimal MP4 buffer
    res.status(200).send(Buffer.alloc(0))
  })

  // --- API Routes ---

  // Health
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'examguard-backend', version: '1.0.0' })
  })

  // Auth
  app.post('/api/v1/auth/login', (req: Request, res: Response) => {
    const { username } = req.body
    const user = users.find((u) => u.username === username && u.is_active) ?? users[0]
    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: user.id,
      actor_name: user.full_name ?? user.username,
      action: 'LOGIN',
      target_type: 'User',
      target_id: user.id,
      details: `Đăng nhập thành công với vai trò ${user.role}`,
    })
    res.json({
      access_token: 'mock-jwt-token-examguard',
      token_type: 'bearer',
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        is_active: user.is_active,
      },
    })
  })

  app.get('/api/v1/auth/me', (_req: Request, res: Response) => {
    const user = users[0] // Default to admin for full access in demo
    res.json({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      is_active: user.is_active,
    })
  })

  app.post('/api/v1/auth/logout', (_req: Request, res: Response) => {
    res.json({ message: 'Đăng xuất thành công' })
  })

  // Rooms
  app.get('/api/v1/rooms', (req: Request, res: Response) => {
    const { page = 1, page_size = 20, q = '', is_active } = req.query
    let filtered = [...rooms]
    if (q) {
      const query = String(q).toLowerCase()
      filtered = filtered.filter((r) => r.code.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
    }
    if (is_active !== undefined) {
      const activeBool = is_active === 'true' || is_active === true
      filtered = filtered.filter((r) => r.is_active === activeBool)
    }
    const pageNum = Number(page)
    const pageSize = Number(page_size)
    const start = (pageNum - 1) * pageSize
    res.json({
      items: filtered.slice(start, start + pageSize),
      page: pageNum,
      page_size: pageSize,
      total: filtered.length,
    })
  })

  app.post('/api/v1/rooms', (req: Request, res: Response) => {
    const { code, name, description = null, is_active = true } = req.body
    const newRoom: RoomEntity = {
      id: `room-${Date.now()}`,
      code: code || `P${rooms.length + 101}`,
      name: name || 'Phòng thi mới',
      description,
      is_active,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    rooms.unshift(newRoom)
    // Create default seats grid (3x2)
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const codeChar = String.fromCharCode(65 + r)
        seats.push({
          id: `seat-${newRoom.id}-${codeChar}${c + 1}`,
          room_id: newRoom.id,
          code: `${codeChar}${c + 1}`,
          x: 0.12 + c * 0.30,
          y: 0.15 + r * 0.35,
          width: 0.15,
          height: 0.20,
          sort_order: r * 3 + c + 1,
          is_active: true,
        })
      }
    }
    res.status(201).json(newRoom)
  })

  app.patch('/api/v1/rooms/:id', (req: Request, res: Response) => {
    const room = rooms.find((r) => r.id === req.params.id)
    if (!room) return res.status(404).json({ detail: 'Room not found' })
    Object.assign(room, req.body, { updated_at: new Date().toISOString() })
    res.json(room)
  })

  app.get('/api/v1/rooms/:id/seats', (req: Request, res: Response) => {
    const roomSeats = seats.filter((s) => s.room_id === req.params.id)
    res.json(roomSeats)
  })

  app.put('/api/v1/rooms/:id/seats', (req: Request, res: Response) => {
    const roomId = req.params.id
    const updatedSeats: SeatEntity[] = req.body.seats || []
    // Remove old seats for this room
    const otherSeats = seats.filter((s) => s.room_id !== roomId)
    const newSeatsList = updatedSeats.map((s, idx) => ({
      id: s.id || `seat-${roomId}-${idx + 1}`,
      room_id: roomId,
      code: s.code,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      sort_order: s.sort_order ?? idx + 1,
      is_active: s.is_active ?? true,
    }))
    seats.length = 0
    seats.push(...otherSeats, ...newSeatsList)
    res.json(newSeatsList)
  })

  // Candidates
  app.get('/api/v1/candidates', (req: Request, res: Response) => {
    const { page = 1, page_size = 20, q = '' } = req.query
    let filtered = [...candidates]
    if (q) {
      const query = String(q).toLowerCase()
      filtered = filtered.filter((c) => c.candidate_code.toLowerCase().includes(query) || c.full_name.toLowerCase().includes(query))
    }
    const pageNum = Number(page)
    const pageSize = Number(page_size)
    const start = (pageNum - 1) * pageSize
    res.json({
      items: filtered.slice(start, start + pageSize),
      page: pageNum,
      page_size: pageSize,
      total: filtered.length,
    })
  })

  app.post('/api/v1/candidates', (req: Request, res: Response) => {
    const { candidate_code, full_name, class_name = null } = req.body
    const newCand: CandidateEntity = {
      id: `cand-${Date.now()}`,
      candidate_code,
      full_name,
      class_name,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    candidates.unshift(newCand)
    res.status(201).json(newCand)
  })

  app.patch('/api/v1/candidates/:id', (req: Request, res: Response) => {
    const cand = candidates.find((c) => c.id === req.params.id)
    if (!cand) return res.status(404).json({ detail: 'Candidate not found' })
    Object.assign(cand, req.body, { updated_at: new Date().toISOString() })
    res.json(cand)
  })

  // Cameras
  app.get('/api/v1/cameras', (req: Request, res: Response) => {
    const { page = 1, page_size = 20, q = '', room_id, is_active } = req.query
    let filtered = [...cameras]
    if (q) {
      const query = String(q).toLowerCase()
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(query) || c.rtsp_url.toLowerCase().includes(query))
    }
    if (room_id) {
      filtered = filtered.filter((c) => c.room_id === room_id)
    }
    if (is_active !== undefined) {
      const activeBool = is_active === 'true' || is_active === true
      filtered = filtered.filter((c) => c.is_active === activeBool)
    }
    const pageNum = Number(page)
    const pageSize = Number(page_size)
    const start = (pageNum - 1) * pageSize
    res.json({
      items: filtered.slice(start, start + pageSize),
      page: pageNum,
      page_size: pageSize,
      total: filtered.length,
    })
  })

  app.post('/api/v1/cameras', (req: Request, res: Response) => {
    const { name, rtsp_url, room_id = null, is_active = true } = req.body
    const newCam: CameraEntity = {
      id: `cam-${Date.now()}`,
      name,
      rtsp_url,
      room_id,
      is_active,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    cameras.unshift(newCam)
    res.status(201).json(newCam)
  })

  app.patch('/api/v1/cameras/:id', (req: Request, res: Response) => {
    const cam = cameras.find((c) => c.id === req.params.id)
    if (!cam) return res.status(404).json({ detail: 'Camera not found' })
    Object.assign(cam, req.body, { updated_at: new Date().toISOString() })
    res.json(cam)
  })

  // RTSP check
  app.post('/api/v1/monitoring/rtsp/check', (_req: Request, res: Response) => {
    res.json({
      connected: true,
      codec: 'h264',
      width: 1920,
      height: 1080,
      fps: 25,
      message: 'Kết nối luồng RTSP thành công (25 FPS, 1080p)',
    })
  })

  // Sessions
  app.get('/api/v1/sessions', (req: Request, res: Response) => {
    const { page = 1, page_size = 20, q = '', status, room_id } = req.query
    let filtered = [...sessions]
    if (q) {
      const query = String(q).toLowerCase()
      filtered = filtered.filter((s) => s.session_code.toLowerCase().includes(query) || s.exam_name.toLowerCase().includes(query))
    }
    if (status) {
      filtered = filtered.filter((s) => s.status === status)
    }
    if (room_id) {
      filtered = filtered.filter((s) => s.room_id === room_id)
    }
    const pageNum = Number(page)
    const pageSize = Number(page_size)
    const start = (pageNum - 1) * pageSize
    const formatted = filtered.slice(start, start + pageSize).map(formatSession)
    res.json({
      items: formatted,
      page: pageNum,
      page_size: pageSize,
      total: filtered.length,
    })
  })

  app.post('/api/v1/sessions', (req: Request, res: Response) => {
    const { session_code, exam_name, room_id, scheduled_start = null, scheduled_end = null, duration_minutes = 90, runtime_profile = 'gtx1650' } = req.body
    const newSession: ExamSessionEntity = {
      id: `session-${Date.now()}`,
      session_code: session_code || `SESSION-${Date.now().toString().slice(-4)}`,
      exam_name,
      room_id,
      source_type: 'VIDEO_UPLOAD',
      camera_id: null,
      video_asset_id: mediaAssets[0]?.id ?? null,
      status: 'DRAFT',
      scheduled_start,
      scheduled_end,
      actual_start: null,
      actual_end: null,
      duration_minutes,
      runtime_profile,
      created_by: 'user-admin',
      assignments: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    sessions.unshift(newSession)
    res.status(201).json(formatSession(newSession))
  })

  app.get('/api/v1/sessions/:id', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    res.json(formatSession(session))
  })

  app.patch('/api/v1/sessions/:id', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    Object.assign(session, req.body, { updated_at: new Date().toISOString() })
    res.json(formatSession(session))
  })

  app.put('/api/v1/sessions/:id/candidates', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    const incoming: Array<{ candidate_id: string; seat_id: string }> = req.body.assignments || []
    session.assignments = incoming.map((item, idx) => ({
      id: `asgn-${Date.now()}-${idx}`,
      candidate_id: item.candidate_id,
      seat_id: item.seat_id,
    }))
    session.updated_at = new Date().toISOString()
    res.json(formatSession(session))
  })

  // Monitoring session operations
  function getMonitoringStatusForSession(session: ExamSessionEntity) {
    const isRunning = session.status === 'RUNNING'
    const isPaused = session.status === 'PAUSED'
    return {
      session_id: session.id,
      state: isRunning ? 'RUNNING' : isPaused ? 'PAUSED' : session.status === 'COMPLETED' ? 'COMPLETED' : 'INACTIVE',
      profile: session.runtime_profile ?? 'gtx1650',
      error: null,
      subscriber_count: 1,
      queue_size: 1,
      dropped_analysis_frames: 0,
      diagnostics: {
        type: 'diagnostics' as const,
        session_id: session.id,
        runtime_instance_id: `run-${session.id}`,
        runtime_generation: 1,
        worker_instance_id: 'worker-node-01',
        tracker_instance_id: 'bytetrack-main',
        tracking_seq: 120,
        latest_frame_id: 120,
        latest_timestamp_ms: Date.now(),
        raw_detection_count: 4,
        active_track_count: 4,
        source_fps: 25.0,
        target_analysis_fps: 12.5,
        analysis_fps: 12.1,
        detector_ms: 14.5,
        tracker_ms: 3.2,
        pipeline_ms: 22.0,
        seat_assignment_ms: 1.5,
        analysis_lag_ms: 18.0,
        gpu_util_pct: 34.0,
        vram_used_mb: 850,
        cpu_util_pct: 12.0,
        ram_used_mb: 420,
        dropped_analysis_frames: 0,
        queue_size: 1,
        assigned_tracks: 4,
        tentative_tracks: 0,
        unassigned_tracks: 0,
        occupied_seats: 4,
        active_logical_actors: 4,
        lost_logical_actors: 0,
        raw_track_count: 4,
        recoveries_total: 1,
        motion_recoveries: 1,
        reid_recoveries: 0,
        ambiguous_recoveries: 0,
        reid_requests_total: 0,
        reid_batches_total: 0,
        reid_dropped_stale: 0,
        logical_tracking_ms: 1.8,
        reid_latency_ms_mean: null,
        reid_latency_ms_p95: null,
        dynamic_pairs: 1,
        grace_seats: 0,
        empty_seats: 2,
        seat_switches: 0,
        identity_recoveries: 1,
        active_single_proposals: 4,
        active_pair_proposals: 1,
        ready_action_buffers: 4,
        active_action_buffers: 4,
        buffered_roi_frames: 32,
        action_predictions_total: 54,
        action_predictions_per_second: 3.5,
        tsm_preprocess_ms_mean: 4.1,
        tsm_preprocess_ms_p95: 5.2,
        tsm_inference_ms_mean: 18.3,
        tsm_inference_ms_p95: 21.0,
        action_pipeline_ms_mean: 23.5,
        action_pipeline_ms_p95: 27.0,
        action_batch_size_mean: 2.0,
        action_batch_size_p95: 4.0,
        action_queue_depth: 0,
        stale_action_requests_dropped: 0,
        action_device: 'cuda:0',
        scheduler_ready_proposals: 1,
        scheduler_in_flight_proposals: 1,
        expired_ready_requests: 0,
        replaced_ready_requests: 0,
        action_batches_total: 28,
        single_predictions_per_second: 3.0,
        pair_predictions_per_second: 0.5,
        single_prediction_interval_ms_mean: 330,
        single_prediction_interval_ms_p95: 400,
        single_prediction_interval_ms_max: 450,
        pair_prediction_interval_ms_mean: 1000,
        pair_prediction_interval_ms_p95: 1200,
        pair_prediction_interval_ms_max: 1300,
        action_prediction_age_ms_mean: 45,
        action_prediction_age_ms_p95: 60,
        tsm_forward_ms_mean: 17.5,
        tsm_forward_ms_p95: 20.0,
        profile: session.runtime_profile ?? 'gtx1650',
      },
      runtime_instance_id: `run-${session.id}`,
      runtime_generation: 1,
      worker_instance_id: 'worker-node-01',
      tracker_instance_id: 'bytetrack-main',
      tracking_seq: 120,
    }
  }

  app.get('/api/v1/sessions/:id/monitoring-status', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    res.json(getMonitoringStatusForSession(session))
  })

  app.post('/api/v1/sessions/:id/start', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    session.status = 'RUNNING'
    session.actual_start = session.actual_start || new Date().toISOString()
    session.updated_at = new Date().toISOString()
    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: 'user-admin',
      actor_name: 'Quản trị viên hệ thống',
      action: 'MONITORING_START',
      target_type: 'ExamSession',
      target_id: session.id,
      details: `Bắt đầu giám sát phiên thi ${session.session_code}`,
    })
    res.json(getMonitoringStatusForSession(session))
  })

  app.post('/api/v1/sessions/:id/pause', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    session.status = 'PAUSED'
    session.updated_at = new Date().toISOString()
    res.json(getMonitoringStatusForSession(session))
  })

  app.post('/api/v1/sessions/:id/resume', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    session.status = 'RUNNING'
    session.updated_at = new Date().toISOString()
    res.json(getMonitoringStatusForSession(session))
  })

  app.post('/api/v1/sessions/:id/seek', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    res.json(getMonitoringStatusForSession(session))
  })

  app.post('/api/v1/sessions/:id/stop', (req: Request, res: Response) => {
    const session = sessions.find((s) => s.id === req.params.id)
    if (!session) return res.status(404).json({ detail: 'Session not found' })
    session.status = 'COMPLETED'
    session.actual_end = new Date().toISOString()
    session.updated_at = new Date().toISOString()
    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: 'user-admin',
      actor_name: 'Quản trị viên hệ thống',
      action: 'MONITORING_STOP',
      target_type: 'ExamSession',
      target_id: session.id,
      details: `Dừng giám sát và hoàn tất phiên thi ${session.session_code}`,
    })
    res.json(getMonitoringStatusForSession(session))
  })

  // Events
  app.get('/api/v1/events', (req: Request, res: Response) => {
    const { session_id, candidate_id, room_id, q, status, behavior, page = 1, page_size = 20 } = req.query
    let filtered = [...events]
    if (session_id) {
      filtered = filtered.filter((e) => e.session_id === session_id)
    }
    if (status) {
      filtered = filtered.filter((e) => e.status === status)
    }
    if (behavior) {
      filtered = filtered.filter((e) => e.behavior_type === behavior)
    }
    if (candidate_id) {
      filtered = filtered.filter((e) => e.actors.some((a) => a.candidate_id === candidate_id))
    }
    if (room_id) {
      const roomSessions = sessions.filter((s) => s.room_id === room_id).map((s) => s.id)
      filtered = filtered.filter((e) => roomSessions.includes(e.session_id))
    }
    if (q) {
      const query = String(q).toLowerCase()
      filtered = filtered.filter((e) =>
        e.event_code.toLowerCase().includes(query) ||
        e.exam_name.toLowerCase().includes(query) ||
        e.actors.some((a) => a.candidate_code.toLowerCase().includes(query) || a.full_name.toLowerCase().includes(query))
      )
    }
    const pageNum = Number(page)
    const pageSize = Number(page_size)
    const start = (pageNum - 1) * pageSize
    res.json({
      items: filtered.slice(start, start + pageSize),
      page: pageNum,
      page_size: pageSize,
      total: filtered.length,
    })
  })

  app.get('/api/v1/events/counts', (req: Request, res: Response) => {
    const { session_id } = req.query
    let filtered = [...events]
    if (session_id) filtered = filtered.filter((e) => e.session_id === session_id)
    res.json({
      total: filtered.length,
      pending_review: filtered.filter((e) => e.status === 'PENDING_REVIEW').length,
      confirmed: filtered.filter((e) => e.status === 'CONFIRMED').length,
      dismissed: filtered.filter((e) => e.status === 'DISMISSED').length,
      needs_review: filtered.filter((e) => e.status === 'NEEDS_REVIEW').length,
    })
  })

  app.get('/api/v1/events/:id', (req: Request, res: Response) => {
    const event = events.find((e) => e.id === req.params.id)
    if (!event) return res.status(404).json({ detail: 'Event not found' })
    res.json(event)
  })

  app.post('/api/v1/events/:id/reviews', (req: Request, res: Response) => {
    const event = events.find((e) => e.id === req.params.id)
    if (!event) return res.status(404).json({ detail: 'Event not found' })
    const { decision, note = null } = req.body
    const newStatus = decision === 'CONFIRM' ? 'CONFIRMED' : decision === 'DISMISS' ? 'DISMISSED' : 'NEEDS_REVIEW'
    const newReview: EventReviewEntity = {
      id: `rev-${Date.now()}`,
      decision,
      note,
      reviewer_id: 'user-admin',
      reviewer_name: 'Quản trị viên hệ thống',
      created_at: new Date().toISOString(),
    }
    event.status = newStatus
    event.reviews.unshift(newReview)
    event.updated_at = new Date().toISOString()
    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: 'user-admin',
      actor_name: 'Quản trị viên hệ thống',
      action: `EVENT_${decision}`,
      target_type: 'ExamEvent',
      target_id: event.id,
      details: `Kiểm duyệt sự kiện ${event.event_code}: ${decision} - ${note || ''}`,
    })
    res.json(event)
  })

  app.post('/api/v1/events/:id/actors', (req: Request, res: Response) => {
    const event = events.find((e) => e.id === req.params.id)
    if (!event) return res.status(404).json({ detail: 'Event not found' })
    const { session_candidate_id, note } = req.body
    const cand = candidates[0]
    event.actors.push({
      session_candidate_id,
      candidate_id: cand.id,
      candidate_code: cand.candidate_code,
      full_name: cand.full_name,
      seat_code: 'A1',
    })
    event.updated_at = new Date().toISOString()
    res.json(event)
  })

  // Users
  app.get('/api/v1/users', (req: Request, res: Response) => {
    const { page = 1, page_size = 20, q = '', role = '', is_active } = req.query
    let filtered = [...users]
    if (q) {
      const query = String(q).toLowerCase()
      filtered = filtered.filter((u) => u.username.toLowerCase().includes(query) || (u.full_name && u.full_name.toLowerCase().includes(query)))
    }
    if (role) {
      filtered = filtered.filter((u) => u.role === role)
    }
    if (is_active !== undefined && is_active !== '') {
      const activeBool = is_active === 'true' || is_active === true
      filtered = filtered.filter((u) => u.is_active === activeBool)
    }
    const pageNum = Number(page)
    const pageSize = Number(page_size)
    const start = (pageNum - 1) * pageSize
    res.json({
      items: filtered.slice(start, start + pageSize),
      page: pageNum,
      page_size: pageSize,
      total: filtered.length,
    })
  })

  app.post('/api/v1/users', (req: Request, res: Response) => {
    const { username, full_name = null, role, is_active = true } = req.body
    const newUser: UserEntity = {
      id: `user-${Date.now()}`,
      username,
      full_name,
      role: role || 'SUPERVISOR',
      is_active,
      password_hash: 'hashed',
      created_at: new Date().toISOString(),
    }
    users.push(newUser)
    res.status(201).json(newUser)
  })

  app.patch('/api/v1/users/:id', (req: Request, res: Response) => {
    const user = users.find((u) => u.id === req.params.id)
    if (!user) return res.status(404).json({ detail: 'User not found' })
    Object.assign(user, req.body)
    res.json(user)
  })

  // Audit Logs
  app.get('/api/v1/audit-logs', (req: Request, res: Response) => {
    const { page = 1, page_size = 20 } = req.query
    const pageNum = Number(page)
    const pageSize = Number(page_size)
    const start = (pageNum - 1) * pageSize
    res.json({
      items: auditLogs.slice(start, start + pageSize),
      page: pageNum,
      page_size: pageSize,
      total: auditLogs.length,
    })
  })

  // Media
  app.get('/api/v1/media', (_req: Request, res: Response) => {
    res.json({ items: mediaAssets, total: mediaAssets.length, page: 1, page_size: 20 })
  })

  app.post('/api/v1/media/videos', (req: Request, res: Response) => {
    const newMedia: MediaAssetEntity = {
      id: `media-${Date.now()}`,
      original_filename: 'uploaded_exam_video.mp4',
      media_url: '/mock-video.mp4',
      codec: 'h264',
      width: 1920,
      height: 1080,
      fps: 25,
      duration_ms: 180000,
      size_bytes: 25000000,
      created_at: new Date().toISOString(),
    }
    mediaAssets.unshift(newMedia)
    res.status(201).json(newMedia)
  })

  // WebSocket Server for Realtime Monitoring
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  wss.on('connection', (ws: WebSocket, req) => {
    const url = req.url || ''
    const match = url.match(/\/ws\/monitoring\/([^/?#]+)/)
    const sessionId = match ? match[1] : (sessions[0]?.id ?? 'session-running-1')

    // Initial State message
    const initialState = {
      type: 'state',
      session_id: sessionId,
      state: 'RUNNING',
      synchronizing: false,
      error: null,
      runtime_instance_id: `run-${sessionId}`,
      runtime_generation: 1,
      worker_instance_id: 'worker-node-01',
      tracker_instance_id: 'bytetrack-main',
      tracking_seq: 1,
    }
    ws.send(JSON.stringify(initialState))

    let frameCount = 0
    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval)
        return
      }

      frameCount++
      const now = Date.now()
      // Micro-jitter to simulate live human movement
      const jitterX = Math.sin(frameCount * 0.1) * 0.008
      const jitterY = Math.cos(frameCount * 0.1) * 0.005

      // Emulate 4 seated students with normalized coordinates [x1, y1, x2, y2]
      const trackingFrame = {
        type: 'tracking',
        session_id: sessionId,
        runtime_instance_id: `run-${sessionId}`,
        runtime_generation: 1,
        tracker_instance_id: 'bytetrack-main',
        tracking_seq: frameCount,
        timestamp_ms: now,
        frame_id: frameCount,
        source_width: 1920,
        source_height: 1080,
        tracks: [
          {
            actor_id: 'actor-101',
            actor_state: 'ACTIVE',
            recovered: false,
            track_id: 1,
            bbox_norm: [0.12 + jitterX, 0.16 + jitterY, 0.28 + jitterX, 0.44 + jitterY],
            confidence: 0.94,
            identity: {
              state: 'ASSIGNED',
              seat_id: 'seat-101-a1',
              seat_code: 'A1',
              session_candidate_id: 'asgn-01',
              score: 0.96,
            },
          },
          {
            actor_id: 'actor-102',
            actor_state: 'ACTIVE',
            recovered: false,
            track_id: 2,
            bbox_norm: [0.42 + jitterX * 0.5, 0.16 + jitterY * 0.5, 0.58 + jitterX * 0.5, 0.44 + jitterY * 0.5],
            confidence: 0.92,
            identity: {
              state: 'ASSIGNED',
              seat_id: 'seat-101-a2',
              seat_code: 'A2',
              session_candidate_id: 'asgn-02',
              score: 0.93,
            },
          },
          {
            actor_id: 'actor-103',
            actor_state: 'ACTIVE',
            recovered: false,
            track_id: 3,
            bbox_norm: [0.12 - jitterX, 0.52 - jitterY, 0.28 - jitterX, 0.80 - jitterY],
            confidence: 0.91,
            identity: {
              state: 'ASSIGNED',
              seat_id: 'seat-101-b1',
              seat_code: 'B1',
              session_candidate_id: 'asgn-03',
              score: 0.91,
            },
          },
          {
            actor_id: 'actor-104',
            actor_state: 'ACTIVE',
            recovered: false,
            track_id: 4,
            bbox_norm: [0.42 - jitterX * 0.7, 0.52 - jitterY * 0.7, 0.58 - jitterX * 0.7, 0.80 - jitterY * 0.7],
            confidence: 0.93,
            identity: {
              state: 'ASSIGNED',
              seat_id: 'seat-101-b2',
              seat_code: 'B2',
              session_candidate_id: 'asgn-04',
              score: 0.95,
            },
          },
        ],
        seats: [
          { seat_id: 'seat-101-a1', seat_code: 'A1', session_candidate_id: 'asgn-01', state: 'OCCUPIED', track_id: 1 },
          { seat_id: 'seat-101-a2', seat_code: 'A2', session_candidate_id: 'asgn-02', state: 'OCCUPIED', track_id: 2 },
          { seat_id: 'seat-101-a3', seat_code: 'A3', session_candidate_id: null, state: 'EMPTY', track_id: null },
          { seat_id: 'seat-101-b1', seat_code: 'B1', session_candidate_id: 'asgn-03', state: 'OCCUPIED', track_id: 3 },
          { seat_id: 'seat-101-b2', seat_code: 'B2', session_candidate_id: 'asgn-04', state: 'OCCUPIED', track_id: 4 },
          { seat_id: 'seat-101-b3', seat_code: 'B3', session_candidate_id: null, state: 'EMPTY', track_id: null },
        ],
      }
      ws.send(JSON.stringify(trackingFrame))

      // Emit Cheat Prediction message every 4 frames (~1s)
      if (frameCount % 4 === 0) {
        const isSuspicious = frameCount % 12 === 0
        const cheatPrediction = {
          type: 'cheat_prediction',
          session_id: sessionId,
          runtime_instance_id: `run-${sessionId}`,
          runtime_generation: 1,
          timestamp_ms: now,
          model_name: 'r3_tsm_r50_k400_diff_final',
          classes: ['normal', 'looking', 'interaction', 'phone_cheatsheet', 'abnormal'],
          rule: { smooth_windows: 3, start_threshold: 0.75, keep_threshold: 0.50, min_windows: 2 },
          actors: [
            {
              actor_id: 'actor-101',
              track_id: 1,
              session_candidate_id: 'asgn-01',
              seat_code: 'A1',
              timestamp_ms: now,
              probabilities: isSuspicious ? [0.15, 0.80, 0.03, 0.01, 0.01] : [0.94, 0.04, 0.01, 0.005, 0.005],
              smoothed: isSuspicious ? [0.18, 0.78, 0.02, 0.01, 0.01] : [0.93, 0.05, 0.01, 0.005, 0.005],
              cheat_score: isSuspicious ? 0.78 : 0.05,
              alert: isSuspicious,
              label: isSuspicious ? 'looking' : 'normal',
            },
            {
              actor_id: 'actor-102',
              track_id: 2,
              session_candidate_id: 'asgn-02',
              seat_code: 'A2',
              timestamp_ms: now,
              probabilities: [0.96, 0.02, 0.01, 0.005, 0.005],
              smoothed: [0.95, 0.03, 0.01, 0.005, 0.005],
              cheat_score: 0.03,
              alert: false,
              label: 'normal',
            },
            {
              actor_id: 'actor-103',
              track_id: 3,
              session_candidate_id: 'asgn-03',
              seat_code: 'B1',
              timestamp_ms: now,
              probabilities: [0.92, 0.05, 0.01, 0.01, 0.01],
              smoothed: [0.91, 0.06, 0.01, 0.01, 0.01],
              cheat_score: 0.06,
              alert: false,
              label: 'normal',
            },
            {
              actor_id: 'actor-104',
              track_id: 4,
              session_candidate_id: 'asgn-04',
              seat_code: 'B2',
              timestamp_ms: now,
              probabilities: [0.95, 0.03, 0.01, 0.005, 0.005],
              smoothed: [0.94, 0.04, 0.01, 0.005, 0.005],
              cheat_score: 0.04,
              alert: false,
              label: 'normal',
            },
          ],
          diagnostics: {
            device: 'cuda:0 (GTX 1650 Max-Q)',
            windows_total: frameCount,
            windows_replaced: 0,
            stale_windows: 0,
            inference_ms_mean: 17.8,
            inference_ms_p95: 20.4,
            alerts_total: 1,
            alerts_without_candidate: 0,
            events_total: events.length,
            active_alerts: isSuspicious ? 1 : 0,
            inference_errors: 0,
          },
        }
        ws.send(JSON.stringify(cheatPrediction))
      }
    }, 250)

    ws.on('close', () => {
      clearInterval(interval)
    })
  })

  // Dev mode: Vite Middleware
  if (isDev) {
    const vite = await createViteServer({
      root: path.resolve(__dirname, 'frontend'),
      server: {
        middlewareMode: true,
        host: HOST,
        port: PORT,
      },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  } else {
    // Production mode: Serve frontend dist
    const distPath = path.resolve(__dirname, 'frontend/dist')
    app.use(express.static(distPath))
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'))
    })
  }

  server.listen(PORT, HOST, () => {
    console.log(`[ExamGuard] Server listening on http://${HOST}:${PORT}`)
  })
}

startServer().catch((err) => {
  console.error('[ExamGuard] Failed to start server:', err)
  process.exit(1)
})
