import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { apiErrorMessage } from '../../shared/api/errors'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { EmptyState } from '../../shared/components/EmptyState'
import { ErrorState } from '../../shared/components/ErrorState'
import { useToast } from '../../shared/components/ToastProvider'
import { useUnsavedChanges } from '../../shared/hooks/useUnsavedChanges'
import { valuesChanged } from '../../shared/validation'
import { getMediaFrame } from '../media/api'
import { saveSeats } from './api'
import type { Seat } from './types'
import { GridCalibration, GridSettingsPanel } from './GridCalibration'
import { defaultGridSettings, generateSeatGrid, seatLayoutError, type Point } from './seatGrid'

interface DragState {
  index: number
  mode: 'move' | 'resize'
  pointerX: number
  pointerY: number
  original: Seat
}

function copySeats(seats: Seat[]): Seat[] {
  return seats.map((seat) => ({ ...seat }))
}

export function SeatLayoutEditor({
  roomId,
  initialSeats,
  referenceMediaId,
  referenceTimestampMs,
  editable,
  onSaved,
}: {
  roomId: string
  initialSeats: Seat[]
  referenceMediaId: string | null
  referenceTimestampMs: number
  editable: boolean
  onSaved(seats: Seat[]): void
}) {
  const [seats, replaceSeats] = useState(() => copySeats(initialSeats))
  const history = useRef<Seat[][]>([])
  const future = useRef<Seat[][]>([])
  const setSeats = (update: Seat[] | ((current: Seat[]) => Seat[])) => {
    history.current = [...history.current.slice(-49), copySeats(seats)]
    future.current = []
    replaceSeats(typeof update === 'function' ? update(seats) : update)
  }
  const [configuring, setConfiguring] = useState(false)
  const [corners, setCorners] = useState<Point[]>([])
  const [gridSettings, setGridSettings] = useState(defaultGridSettings)
  const [resetGridPending, setResetGridPending] = useState(false)
  const [pendingGrid, setPendingGrid] = useState<Seat[] | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number | undefined>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null)
  const [referenceKind, setReferenceKind] = useState<'image' | 'video' | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const dirty = valuesChanged(seats, initialSeats)
  useUnsavedChanges(dirty)

  useEffect(() => {
    replaceSeats(copySeats(initialSeats))
    history.current = []
    future.current = []
  }, [initialSeats])

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    if (!referenceMediaId) {
      setReferenceUrl(null)
      setReferenceKind(null)
      return undefined
    }
    void getMediaFrame(referenceMediaId, referenceTimestampMs).then((blob) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setReferenceUrl(objectUrl)
      setReferenceKind('image')
    }).catch(() => {
      if (!cancelled) setReferenceUrl(null)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [referenceMediaId, referenceTimestampMs])

  useEffect(() => () => {
    if (referenceUrl) URL.revokeObjectURL(referenceUrl)
  }, [referenceUrl])

  const chooseLocalReference = (file: File | undefined) => {
    if (!file) return
    if (referenceUrl) URL.revokeObjectURL(referenceUrl)
    setReferenceUrl(URL.createObjectURL(file))
    setReferenceKind('video')
  }

  useEffect(() => {
    if (!drag) return
    const move = (event: PointerEvent) => {
      const bounds = areaRef.current?.getBoundingClientRect()
      if (!bounds) return
      const dx = (event.clientX - drag.pointerX) / bounds.width
      const dy = (event.clientY - drag.pointerY) / bounds.height
      replaceSeats((current) => current.map((seat, index) => {
        if (index !== drag.index) return seat
        if (drag.mode === 'move') {
          return {
            ...seat,
            x: Math.max(0, Math.min(1 - seat.width, drag.original.x + dx)),
            y: Math.max(0, Math.min(1 - seat.height, drag.original.y + dy)),
          }
        }
        return {
          ...seat,
          width: Math.min(1 - seat.x, Math.max(0.001, drag.original.width + dx)),
          height: Math.min(1 - seat.y, Math.max(0.001, drag.original.height + dy)),
        }
      }))
    }
    const stop = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [drag])

  const startDrag = (
    event: ReactPointerEvent,
    index: number,
    mode: DragState['mode'],
  ) => {
    if (!editable || configuring || saving) return
    event.preventDefault()
    event.stopPropagation()
    history.current = [...history.current.slice(-49), copySeats(seats)]
    future.current = []
    setDrag({
      index,
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      original: { ...seats[index] },
    })
  }

  const addSeat = () => {
    const used = new Set(seats.map((seat) => seat.code))
    let number = seats.length + 1
    while (used.has(`A${String(number).padStart(2, '0')}`)) number += 1
    setSeats((current) => [...current, {
      code: `A${String(number).padStart(2, '0')}`,
      x: 0.05,
      y: 0.05,
      width: 0.14,
      height: 0.11,
      sort_order: current.length,
      is_active: true,
    }])
  }

  const submit = async () => {
    setError(null)
    const validationError = seatLayoutError(seats)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    try {
      const saved = await saveSeats(roomId, seats.map((seat, index) => ({
        ...seat,
        code: seat.code.trim().toUpperCase(),
        sort_order: index,
      })))
      replaceSeats(copySeats(saved))
      history.current = []
      future.current = []
      onSaved(saved)
      toast.success('Đã lưu bố trí chỗ ngồi.')
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const applyGrid = (generated: Seat[]) => {
    setSeats(generated)
    setConfiguring(false)
    setPendingGrid(null)
    setError(null)
  }
  const generate = () => {
    try {
      const generated = generateSeatGrid(corners, gridSettings)
      if (seats.length || dirty) setPendingGrid(generated)
      else applyGrid(generated)
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Không thể tạo lưới.')
    }
  }

  return (
    <section className="card layout-editor">
      <div className="section-heading">
        <div>
          <h2>Bố trí chỗ ngồi</h2>
          <p>Chọn bốn góc khu vực bàn; hệ thống tự tạo lưới ghế và tự ghép người theo vị trí khi giám sát.</p>
        </div>
        {editable && <div className="button-row">
          <button className="secondary-button" type="button" disabled={!referenceUrl || saving} onClick={() => { videoRef.current?.pause(); setConfiguring(true) }}>Tự động tạo lưới ghế</button>
          <button className="secondary-button" type="button" disabled={saving || !corners.length} onClick={() => setResetGridPending(true)}>Reset grid</button>
          <button className="secondary-button" type="button" onClick={addSeat} disabled={!referenceUrl || configuring || saving || seats.length >= 500}>Thêm chỗ ngồi</button>
        </div>}
      </div>
      {error && <ErrorState message={error} />}
      <div className="calibration-toolbar">
        <span>{referenceUrl ? 'Đang hiệu chỉnh trên hình ảnh camera thực.' : 'Chọn video tham chiếu trước khi hiệu chỉnh vị trí ghế.'}</span>
        <label className="secondary-button calibration-file-button">
          Chọn video tham chiếu
          <input type="file" accept="video/mp4,video/*" onChange={(event) => chooseLocalReference(event.target.files?.[0])} />
        </label>
      </div>
      {editable && configuring && <GridSettingsPanel corners={corners} settings={gridSettings} onSettings={setGridSettings} onReset={() => setCorners([])} onGenerate={generate} onCancel={() => setConfiguring(false)} />}
      <div className="calibration-area" style={{ aspectRatio }} ref={areaRef} aria-label="Vùng hiệu chỉnh chỗ ngồi">
        {referenceUrl && referenceKind === 'image' && <img className="calibration-reference" src={referenceUrl} onLoad={event => setAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} alt="Khung hình camera dùng để hiệu chỉnh ghế" />}
        {referenceUrl && referenceKind === 'video' && <video ref={videoRef} className="calibration-reference" src={referenceUrl} onLoadedMetadata={event => setAspectRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)} controls={!configuring} muted />}
        {!referenceUrl && <span className="calibration-placeholder">Chưa có khung hình camera tham chiếu</span>}
        <span className="calibration-label">Khung hình hiệu chỉnh</span>
        {!configuring && seats.map((seat, index) => (
          <div
            className="seat-box"
            key={seat.id ?? `${seat.code}-${index}`}
            style={{
              left: `${seat.x * 100}%`,
              top: `${seat.y * 100}%`,
              width: `${seat.width * 100}%`,
              height: `${seat.height * 100}%`,
            }}
            onPointerDown={(event) => referenceUrl && startDrag(event, index, 'move')}
          >
            <strong>{seat.code}</strong>
            {editable && (
              <button
                aria-label={`Đổi kích thước chỗ ngồi ${seat.code}`}
                className="resize-handle"
                type="button"
                onPointerDown={(event) => referenceUrl && startDrag(event, index, 'resize')}
              />
            )}
          </div>
        ))}
        {editable && configuring && referenceUrl && <GridCalibration corners={corners} onChange={setCorners} />}
      </div>
      {seats.length === 0 && <EmptyState title="Chưa có chỗ ngồi trong phòng thi." description="Thêm chỗ ngồi và đặt vị trí trên khung hình hiệu chỉnh." />}
      {editable && !configuring && seats.map((seat, index) => (
        <div className="seat-row" key={seat.id ?? index}>
          <label htmlFor={`seat-${index}`}>Chỗ {index + 1}</label>
          <input
            id={`seat-${index}`}
            disabled={saving}
            value={seat.code}
            onChange={(event) => setSeats((current) => current.map((item, itemIndex) => (
              itemIndex === index ? { ...item, code: event.target.value } : item
            )))}
          />
          <button className="danger-link" disabled={saving} type="button" onClick={() => {
            if (seat.id) setRemoveIndex(index)
            else setSeats((current) => current.filter((_, itemIndex) => itemIndex !== index))
          }}>Bỏ</button>
        </div>
      ))}
      {editable && (
        <div className="button-row">
          <button className="primary-button" type="button" onClick={submit} disabled={saving || configuring || Boolean(drag)}>
            {saving ? 'Đang lưu…' : 'Lưu sơ đồ'}
          </button>
          <button className="secondary-button" type="button" disabled={saving || Boolean(drag)} onClick={() => { setSeats(copySeats(initialSeats)); setConfiguring(false); setError(null) }}>
            Hủy thay đổi
          </button>
          <button className="secondary-button" type="button" disabled={saving || configuring || Boolean(drag) || !history.current.length} onClick={() => {
            future.current.push(copySeats(seats))
            replaceSeats(history.current.pop()!)
          }}>Undo</button>
          <button className="secondary-button" type="button" disabled={saving || configuring || Boolean(drag) || !future.current.length} onClick={() => {
            history.current.push(copySeats(seats))
            replaceSeats(future.current.pop()!)
          }}>Redo</button>
          {dirty && <span className="unsaved-note">Có thay đổi chưa được lưu.</span>}
        </div>
      )}
      <ConfirmDialog open={resetGridPending} title="Reset grid?" description="Bỏ bản nháp, khôi phục layout đã lưu và chọn lại bốn góc. Có thể dùng Undo để lấy lại bản nháp trước khi lưu." confirmLabel="Reset grid" danger onCancel={() => setResetGridPending(false)} onConfirm={() => {
        setSeats(copySeats(initialSeats))
        setCorners([])
        setConfiguring(true)
        setResetGridPending(false)
        setError(null)
      }} />
      <ConfirmDialog open={pendingGrid !== null} title="Tạo lại lưới ghế?" description="Tạo lại lưới sẽ thay thế bố trí hiện tại và ghi đè các thay đổi chưa lưu. Bạn có muốn tiếp tục? Có thể dùng Undo để khôi phục trước khi lưu." confirmLabel="Tạo lại lưới" danger onCancel={() => setPendingGrid(null)} onConfirm={() => { if (pendingGrid) applyGrid(pendingGrid) }} />
      <ConfirmDialog
        open={removeIndex !== null}
        title="Bỏ chỗ ngồi khỏi bố trí?"
        description="Chỗ ngồi đã dùng trong lịch sử sẽ được vô hiệu hóa thay vì xóa dữ liệu liên quan. Thay đổi chỉ có hiệu lực sau khi lưu."
        confirmLabel="Bỏ chỗ ngồi"
        danger
        onCancel={() => setRemoveIndex(null)}
        onConfirm={() => {
          setSeats((current) => current.filter((_, index) => index !== removeIndex))
          setRemoveIndex(null)
        }}
      />
    </section>
  )
}
