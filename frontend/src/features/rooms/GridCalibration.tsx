import type { PointerEvent } from 'react'
import { gridError, type GridSettings, type Point } from './seatGrid'

export function GridSettingsPanel({ corners, settings, onSettings, onReset, onGenerate, onCancel }: {
  corners: Point[]; settings: GridSettings; onSettings(value: GridSettings): void
  onReset(): void; onGenerate(): void; onCancel(): void
}) {
  const error = gridError(corners, settings)
  return <div className="grid-settings">
    <p>Chọn 4 góc: P1 trên trái → P2 trên phải → P3 dưới phải → P4 dưới trái. Kéo marker để chỉnh góc.</p>
    {corners.length === 4 && <div className="grid-fields">
      {(['rows', 'columns', 'horizontalPadding', 'verticalPadding'] as const).map((key, index) => <label key={key}>
        {['Số hàng', 'Số cột', 'Độ co ngang mỗi bên (%)', 'Độ co dọc mỗi bên (%)'][index]}
        <input type="number" min={index < 2 ? 1 : 0} max={index < 2 ? 30 : 49} step="1" value={Number.isNaN(settings[key]) ? '' : settings[key] * (index < 2 ? 1 : 100)} onChange={event => onSettings({ ...settings, [key]: event.target.value === '' ? NaN : Number(event.target.value)/(index < 2 ? 1 : 100) })} />
      </label>)}
    </div>}
    <p role="status">{error ?? `${settings.rows * settings.columns} ghế. Nên giữ độ co 0–5% để vùng bao phủ đủ thân người; tạo bản nháp, kiểm tra rồi lưu.`}</p>
    <div className="button-row">
      <button type="button" className="primary-button" disabled={Boolean(error)} onClick={onGenerate}>Tạo / Tạo lại lưới</button>
      <button type="button" className="secondary-button" onClick={onReset}>Reset corners</button>
      <button type="button" className="secondary-button" onClick={onCancel}>Quay lại chỉnh ghế</button>
    </div>
  </div>
}

export function GridCalibration({ corners, onChange }: { corners: Point[]; onChange(corners: Point[]): void }) {
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX-bounds.left)/bounds.width)), y: Math.max(0, Math.min(1, (event.clientY-bounds.top)/bounds.height)) }
  }
  return <svg className="grid-calibration" aria-label="Chọn bốn góc vùng ghế" onPointerDown={event => {
    if (corners.length < 4) onChange([...corners, point(event)])
  }}>
    <svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none" style={{ pointerEvents: 'none' }}>
      <polygon points={corners.map(p => `${p.x},${p.y}`).join(' ')} fill="rgba(34,197,94,.12)" stroke="#4ade80" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
    {corners.map((p, index) => <g key={index}>
      <circle cx={`${p.x*100}%`} cy={`${p.y*100}%`} r="10" fill="#15803d" stroke="white" tabIndex={0} role="button" aria-label={`Góc P${index+1}`} onKeyDown={event => {
        const deltas: Record<string, Point> = { ArrowLeft: { x: -0.005, y: 0 }, ArrowRight: { x: 0.005, y: 0 }, ArrowUp: { x: 0, y: -0.005 }, ArrowDown: { x: 0, y: 0.005 } }
        const delta = deltas[event.key]
        if (!delta) return
        event.preventDefault()
        onChange(corners.map((corner, i) => i === index ? { x: Math.max(0, Math.min(1, p.x+delta.x)), y: Math.max(0, Math.min(1, p.y+delta.y)) } : corner))
      }} onPointerDown={event => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
      }} onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect()
        onChange(corners.map((corner, i) => i === index ? { x: Math.max(0, Math.min(1, (event.clientX-bounds.left)/bounds.width)), y: Math.max(0, Math.min(1, (event.clientY-bounds.top)/bounds.height)) } : corner))
      }} />
      <text x={`${p.x*100}%`} y={`${p.y*100}%`} dx={p.x > 0.9 ? -30 : 13} dy={p.y < 0.1 ? 23 : -13} fill="white" stroke="black" strokeWidth="0.4" style={{ pointerEvents: 'none' }}>P{index+1}</text>
    </g>)}
  </svg>
}
