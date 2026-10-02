import type { ReactNode } from 'react'

import type { ExamSession } from './types'

export function SessionReadinessPanel({ session, actions }: {
  session: ExamSession
  actions?: ReactNode
}) {
  const seatCount = session.readiness.active_seats
  return <section className="card preflight-panel">
    <div className="section-heading"><div><p className="panel-label">SẴN SÀNG GIÁM SÁT</p><h2>Kiểm tra trước khi bắt đầu</h2></div></div>
    <ul className="preflight-list">
      <li className={session.readiness.room_active ? 'ready' : 'warning'}><span>{session.readiness.room_active ? '✓' : '!'}</span><div><strong>Phòng thi</strong><small>{session.room.code} — {session.room.name}</small></div></li>
      <li className={seatCount ? 'ready' : 'warning'}><span>{seatCount ? '✓' : '!'}</span><div><strong>Sơ đồ ghế</strong><small>{seatCount ? `${seatCount} chỗ ngồi · AI tự ghép người theo vị trí` : 'Cần hiệu chỉnh sơ đồ ghế theo góc camera'}</small></div></li>
      <li className={session.candidate_count ? 'ready' : 'warning'}><span>{session.candidate_count ? '✓' : '!'}</span><div><strong>Danh sách XLSX</strong><small>{session.candidate_count ? `${session.candidate_count} thí sinh đã tự động xếp chỗ` : 'Chưa nhập — sự kiện sẽ không xác định được thí sinh'}</small></div></li>
      <li className={session.video ? 'ready' : 'warning'}><span>{session.video ? '✓' : '!'}</span><div><strong>Video nguồn</strong><small>{session.video?.original_filename ?? 'Chưa có video'}</small></div></li>
      <li><span>i</span><div><strong>Hệ thống AI</strong><small>Được kiểm tra thực tế khi bắt đầu giám sát</small></div></li>
    </ul>
    {actions && <div className="button-row">{actions}</div>}
  </section>
}
