import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { apiErrorMessage } from '../../shared/api/errors'
import { FormField } from '../../shared/components/FormField'
import { formatDurationMs, formatFps, formatResolution } from '../../shared/formatters'
import { getCameras } from '../cameras/api'
import type { Camera } from '../cameras/types'
import { VideoUpload } from '../media/VideoUpload'
import type { MediaAsset } from '../media/types'
import type { Room } from '../rooms/types'
import { createSession, importSessionRoster, updateSession } from '../sessions/api'
import { examDurationOptions, nextSessionCode, toLocalDateTimeInput } from '../sessions/sessionForm'
import type { ExamSession } from '../sessions/types'

type SourceMode = 'CAMERA' | 'VIDEO_UPLOAD'

interface Props {
  rooms: Room[]
  recentSessions: ExamSession[]
  sessionTotal: number
  onCancel(): void
  onPrepared(session: ExamSession): Promise<void> | void
}

function initialDateTime(): { date: string; time: string } {
  const value = toLocalDateTimeInput(new Date())
  return { date: value.slice(0, 10), time: value.slice(11, 16) }
}

function generatedName(date: string, time: string, room?: Room): string {
  const [year, month, day] = date.split('-')
  const roomPart = room ? ` ${room.code}` : ''
  return `Phiên thi${roomPart} - ${day}/${month}/${year} - ${time}`
}

function localEnd(date: string, time: string, minutes: number): string {
  const start = new Date(`${date}T${time}`)
  if (Number.isNaN(start.getTime()) || !Number.isFinite(minutes)) return '—'
  return new Date(start.getTime() + minutes * 60_000).toLocaleTimeString(
    'vi-VN',
    { hour: '2-digit', minute: '2-digit' },
  )
}

export function StartMonitoringModal({ rooms, recentSessions, sessionTotal, onCancel, onPrepared }: Props) {
  const initial = useMemo(initialDateTime, [])
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [name, setName] = useState(() => generatedName(initial.date, initial.time))
  const [nameTouched, setNameTouched] = useState(false)
  const [duration, setDuration] = useState('90')
  const [customDuration, setCustomDuration] = useState('90')
  const [roomId, setRoomId] = useState('')
  const [sourceMode, setSourceMode] = useState<SourceMode>('CAMERA')
  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraId, setCameraId] = useState('')
  const [cameraLoading, setCameraLoading] = useState(false)
  const [autoSelected, setAutoSelected] = useState(false)
  const [media, setMedia] = useState<MediaAsset | null>(null)
  const [useRoster, setUseRoster] = useState(false)
  const [rosterFile, setRosterFile] = useState<File | null>(null)
  const [draftSessionId, setDraftSessionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedRoom = rooms.find((room) => room.id === roomId)
  const durationMinutes = Number(duration === 'OTHER' ? customDuration : duration)
  const validDuration = Number.isInteger(durationMinutes) && durationMinutes >= 15 && durationMinutes <= 360
  const canSubmit = Boolean(
    name.trim().length >= 3
    && name.trim().length <= 100
    && roomId
    && date
    && time
    && validDuration
    && (!useRoster || rosterFile)
    && (sourceMode === 'CAMERA' ? cameraId : media),
  )

  useEffect(() => {
    if (!nameTouched) setName(generatedName(date, time, selectedRoom))
  }, [date, time, selectedRoom, nameTouched])

  useEffect(() => {
    setCameraId(''); setAutoSelected(false); setCameras([])
    if (!roomId || sourceMode !== 'CAMERA') return
    let active = true
    setCameraLoading(true)
    getCameras({ roomId, active: true, pageSize: 100 }).then((result) => {
      if (!active) return
      const usable = result.items.filter((camera) => camera.status === 'READY')
      setCameras(usable)
      if (usable.length === 1) { setCameraId(usable[0].id); setAutoSelected(true) }
    }).catch((requestError) => { if (active) setError(apiErrorMessage(requestError)) })
      .finally(() => { if (active) setCameraLoading(false) })
    return () => { active = false }
  }, [roomId, sourceMode])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      let sessionId = draftSessionId
      if (!sessionId) {
        const created = await createSession({
          session_code: nextSessionCode(recentSessions, sessionTotal),
          exam_name: name.trim(),
          room_id: roomId,
          scheduled_start: new Date(`${date}T${time}`).toISOString(),
          scheduled_end: null,
          duration_minutes: durationMinutes,
          runtime_profile: null,
        })
        sessionId = created.id
        setDraftSessionId(created.id)
      }
      if (sourceMode === 'CAMERA') {
        await updateSession(sessionId, { source_type: 'CAMERA', camera_id: cameraId })
      } else if (media) {
        await updateSession(sessionId, {
          source_type: 'VIDEO_UPLOAD', camera_id: null, video_asset_id: media.id,
        })
      }
      if (useRoster && rosterFile) await importSessionRoster(sessionId, rosterFile)
      const ready = await updateSession(sessionId, { status: 'READY' })
      setDraftSessionId(null)
      await onPrepared(ready)
    } catch (requestError) { setError(apiErrorMessage(requestError)) }
    finally { setSaving(false) }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !saving) onCancel()
  }}>
    <section className="start-monitoring-dialog" role="dialog" aria-modal="true" aria-labelledby="start-monitoring-title">
      <header><div><p className="eyebrow">PHIÊN GIÁM SÁT MỚI</p><h2 id="start-monitoring-title">Thiết lập phiên giám sát</h2><p>Tạo phiên trước; AI chỉ chạy sau khi bạn bấm Bắt đầu giám sát.</p></div><button className="dialog-close" type="button" aria-label="Đóng" disabled={saving} onClick={onCancel}>×</button></header>
      <form onSubmit={submit} noValidate>
        {error && <div className="inline-alert error" role="alert">{error}</div>}
        <div className="start-form-grid">
          <FormField label="Tên phiên" htmlFor="quick-session-name" required helper="Từ 3 đến 100 ký tự."><input id="quick-session-name" minLength={3} maxLength={100} value={name} onChange={(event) => { setName(event.target.value); setNameTouched(true) }} onBlur={() => { if (!name.trim()) { setName(generatedName(date, time, selectedRoom)); setNameTouched(false) } }} /></FormField>
          <FormField label="Phòng thi" htmlFor="quick-room" required>
            <select id="quick-room" value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Chọn phòng thi</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.code} — {room.name}</option>)}</select>
          </FormField>
          <FormField label="Ngày thi" htmlFor="quick-date" required><input id="quick-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></FormField>
          <FormField label="Giờ bắt đầu" htmlFor="quick-time" required><input id="quick-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></FormField>
          <FormField label="Thời lượng" htmlFor="quick-duration" required helper={validDuration ? `Dự kiến kết thúc: ${localEnd(date, time, durationMinutes)}` : 'Từ 15 đến 360 phút.'}>
            <select id="quick-duration" value={duration} onChange={(event) => setDuration(event.target.value)}>{examDurationOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes} phút</option>)}<option value="OTHER">Khác…</option></select>
          </FormField>
          {duration === 'OTHER' && <FormField label="Số phút" htmlFor="quick-custom-duration" required><input id="quick-custom-duration" type="number" min="15" max="360" value={customDuration} onChange={(event) => setCustomDuration(event.target.value)} /></FormField>}
        </div>

        <div className="source-segmented" role="group" aria-label="Nguồn giám sát"><button className={sourceMode === 'CAMERA' ? 'active' : ''} type="button" onClick={() => setSourceMode('CAMERA')}>Camera phòng thi</button><button className={sourceMode === 'VIDEO_UPLOAD' ? 'active' : ''} type="button" onClick={() => setSourceMode('VIDEO_UPLOAD')}>Video tải lên</button></div>
        {sourceMode === 'CAMERA' ? <div className="quick-source-panel">
          <FormField label="Camera" htmlFor="quick-camera" required helper={autoSelected ? '✓ Đã chọn tự động' : undefined}><select id="quick-camera" disabled={!roomId || cameraLoading} value={cameraId} onChange={(event) => { setCameraId(event.target.value); setAutoSelected(false) }}><option value="">{cameraLoading ? 'Đang tải camera…' : !roomId ? 'Chọn phòng trước' : cameras.length ? 'Chọn camera' : 'Không có camera sẵn sàng'}</option>{cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select></FormField>
        </div> : <div className="quick-source-panel"><VideoUpload onUploaded={setMedia} disabled={saving} />{media && <div className="source-success"><strong>✓ Video hợp lệ — {media.original_filename}</strong><span>{formatResolution(media.width, media.height)} · {formatFps(media.fps, 2)} · {formatDurationMs(media.duration_ms)}</span></div>}</div>}
        <div className="quick-roster-panel">
          <label className="check-row"><input type="checkbox" checked={useRoster} disabled={saving} onChange={(event) => { setUseRoster(event.target.checked); if (!event.target.checked) { setRosterFile(null); setError(null) } }} /> Có danh sách thí sinh và ghế</label>
          <small>Tùy chọn. Nếu không có danh sách, hệ thống vẫn nhận diện và cảnh báo nhưng chưa hiển thị tên thí sinh.</small>
          {useRoster && <div className="roster-upload-options">
            <p>Chọn XLSX có các cột: Mã thí sinh, Họ tên, Lớp, Mã ghế.</p>
            <label className="secondary-button roster-file-button">{rosterFile ? 'Đổi file Excel' : 'Chọn file Excel đã điền'}<input hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={saving} onChange={(event) => { const file = event.target.files?.[0]; setRosterFile(file?.name.toLowerCase().endsWith('.xlsx') ? file : null); if (file && !file.name.toLowerCase().endsWith('.xlsx')) setError('Vui lòng chọn tệp XLSX hợp lệ.') }} /></label>
            <small>{rosterFile ? `✓ ${rosterFile.name}` : 'Chưa chọn file Excel'}</small>
            {draftSessionId && <small>Phiên nháp đã được giữ lại; sửa file và bấm lại để tiếp tục.</small>}
          </div>}
        </div>
        <footer><button className="secondary-button" type="button" disabled={saving} onClick={onCancel}>Hủy</button><button className="primary-button" type="submit" disabled={!canSubmit || saving}>{saving ? 'Đang tạo phiên…' : 'Tạo phiên'}</button></footer>
      </form>
    </section>
  </div>
}
