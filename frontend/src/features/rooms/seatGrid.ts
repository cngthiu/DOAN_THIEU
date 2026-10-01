import type { Seat } from './types'

export interface Point { x: number; y: number }
export interface GridSettings { rows: number; columns: number; horizontalPadding: number; verticalPadding: number }
export const defaultGridSettings: GridSettings = { rows: 5, columns: 8, horizontalPadding: 0.15, verticalPadding: 0.15 }

export function interpolatePoint([tl, tr, br, bl]: Point[], u: number, v: number): Point {
  return {
    x: (1-u)*(1-v)*tl.x + u*(1-v)*tr.x + u*v*br.x + (1-u)*v*bl.x,
    y: (1-u)*(1-v)*tl.y + u*(1-v)*tr.y + u*v*br.y + (1-u)*v*bl.y,
  }
}

export function gridError(corners: Point[], settings: GridSettings): string | null {
  if (corners.length !== 4) return 'Chọn đủ 4 góc theo thứ tự TL → TR → BR → BL.'
  if (corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return 'Các góc phải nằm trong frame.'
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i+1)%4], c = corners[(i+2)%4]
    if ((b.x-a.x)*(c.y-b.y) - (b.y-a.y)*(c.x-b.x) <= 1e-8) return 'Vùng ghế phải là tứ giác lồi, không giao nhau; chọn TL → TR → BR → BL.'
  }
  if (![settings.rows, settings.columns].every(n => Number.isInteger(n) && n >= 1 && n <= 30)) return 'Số hàng và cột phải là số nguyên từ 1 đến 30.'
  if (settings.rows * settings.columns > 500) return 'API hỗ trợ tối đa 500 ghế mỗi phòng.'
  if (![settings.horizontalPadding, settings.verticalPadding].every(n => Number.isFinite(n) && n >= 0 && n < 0.5)) return 'Padding mỗi bên phải từ 0% đến dưới 50%.'
  return null
}

function rowCode(index: number): string {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n-1)/26)) result = String.fromCharCode(65+(n-1)%26) + result
  return result
}

export function generateSeatGrid(corners: Point[], settings: GridSettings): Seat[] {
  const error = gridError(corners, settings)
  if (error) throw new Error(error)
  const { rows, columns, horizontalPadding: px, verticalPadding: py } = settings
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index/columns), column = index%columns
    const cell = [
      interpolatePoint(corners, (column+px)/columns, (row+py)/rows),
      interpolatePoint(corners, (column+1-px)/columns, (row+py)/rows),
      interpolatePoint(corners, (column+1-px)/columns, (row+1-py)/rows),
      interpolatePoint(corners, (column+px)/columns, (row+1-py)/rows),
    ]
    const center = interpolatePoint(corners, (column+0.5)/columns, (row+0.5)/rows)
    const halfWidth = Math.max(...cell.map(p => Math.abs(p.x-center.x)))
    const halfHeight = Math.max(...cell.map(p => Math.abs(p.y-center.y)))
    // Fit an axis-aligned box inside the padded convex cell. A bounding box
    // alone protrudes outside sloping edges in strong perspective.
    let scale = 1
    for (let i = 0; i < 4; i++) {
      const a = cell[i], b = cell[(i+1)%4]
      const dx = b.x-a.x, dy = b.y-a.y
      const distance = dx*(center.y-a.y)-dy*(center.x-a.x)
      const extent = Math.abs(dx)*halfHeight + Math.abs(dy)*halfWidth
      if (extent > 0) scale = Math.min(scale, distance/extent)
    }
    const width = 2*halfWidth*scale, height = 2*halfHeight*scale
    return { code: `${rowCode(row)}${String(column+1).padStart(2, '0')}`, x: Math.max(0, center.x-width/2), y: Math.max(0, center.y-height/2), width, height, sort_order: index, is_active: true }
  })
}

export function seatLayoutError(seats: Seat[]): string | null {
  if (seats.length > 500) return 'Tối đa 500 ghế mỗi phòng.'
  const codes = new Set<string>()
  for (const seat of seats) {
    const code = seat.code.trim().toUpperCase()
    if (!code || code.length > 100) return 'Mã chỗ ngồi phải có từ 1 đến 100 ký tự.'
    if (codes.has(code)) return `Mã chỗ ngồi bị trùng: ${code}.`
    codes.add(code)
    if (![seat.x, seat.y, seat.width, seat.height].every(Number.isFinite) || seat.x < 0 || seat.y < 0 || seat.width <= 0 || seat.height <= 0 || seat.x + seat.width > 1 || seat.y + seat.height > 1) return `Ghế ${code}: tọa độ/kích thước không hợp lệ hoặc vượt ngoài frame.`
  }
  return null
}
