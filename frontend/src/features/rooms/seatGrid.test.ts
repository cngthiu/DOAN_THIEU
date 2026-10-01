import { describe, expect, it } from 'vitest'
import { defaultGridSettings, generateSeatGrid, gridError, interpolatePoint, seatLayoutError, type Point } from './seatGrid'

const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

describe('perspective seat grid', () => {
  it('creates 40 row-major seats with existing code convention and padding', () => {
    const seats = generateSeatGrid(square, defaultGridSettings)
    expect(seats).toHaveLength(40)
    expect(seats[0]).toMatchObject({ code: 'A01', is_active: true, sort_order: 0 })
    expect(seats[39].code).toBe('E08')
    expect(seats[0].x).toBeCloseTo(0.15/8)
    expect(seats[0].width).toBeCloseTo(0.7/8)
    expect(seats[0].height).toBeCloseTo(0.7/5)
    expect(seatLayoutError(seats)).toBeNull()
  })
  it('keeps every box inside its padded perspective cell', () => {
    const corners = [{ x: .44, y: .08 }, { x: .58, y: .13 }, { x: .97, y: .94 }, { x: .04, y: .79 }]
    const seats = generateSeatGrid(corners, defaultGridSettings)
    seats.forEach((seat, index) => {
      const row = Math.floor(index/8), col = index%8
      const cell = [[col+.15,row+.15],[col+.85,row+.15],[col+.85,row+.85],[col+.15,row+.85]].map(([u,v]) => interpolatePoint(corners,u/8,v/5))
      const points: Point[] = [{ x: seat.x, y: seat.y }, { x: seat.x+seat.width, y: seat.y }, { x: seat.x+seat.width, y: seat.y+seat.height }, { x: seat.x, y: seat.y+seat.height }]
      for (const point of points) for (let i=0;i<4;i++) {
        const a=cell[i], b=cell[(i+1)%4]
        expect((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x)).toBeGreaterThanOrEqual(-1e-12)
      }
    })
    expect(seats[32].width).toBeGreaterThan(seats[0].width)
    expect(seatLayoutError(seats)).toBeNull()
  })
  it('supports AA through AD for up to 30 rows', () => {
    const seats = generateSeatGrid(square, { ...defaultGridSettings, rows: 30, columns: 1 })
    expect(seats[26].code).toBe('AA01')
    expect(seats[29].code).toBe('AD01')
  })
  it.each([{ rows: 0 }, { rows: 1.5 }, { columns: 31 }, { rows: 30, columns: 30 }, { horizontalPadding: .5 }, { verticalPadding: NaN }])('rejects invalid settings %j', overrides => {
    expect(gridError(square, { ...defaultGridSettings, ...overrides })).not.toBeNull()
  })
  it('rejects missing, crossed, concave, degenerate and nonfinite corners', () => {
    for (const corners of [square.slice(0,3), [square[0],square[2],square[1],square[3]], [square[0],square[1],{ x:.1,y:.1 },square[3]], Array(4).fill(square[0]), [{ x:NaN,y:0 },...square.slice(1)]]) expect(gridError(corners, defaultGridSettings)).not.toBeNull()
  })
  it('validates duplicate codes after trimming and normalization, blank codes and invalid geometry', () => {
    const seats = generateSeatGrid(square, defaultGridSettings)
    seats[10].code = ' b04 '
    expect(seatLayoutError(seats)).toContain('B04')
    seats[10].code = ''
    expect(seatLayoutError(seats)).not.toBeNull()
    seats[10].code = 'B03'
    for (const geometry of [{ x:NaN }, { x:-.1 }, { width:0 }, { height:-1 }, { x:1 }, { y:1 }]) expect(seatLayoutError([{ ...seats[0], ...geometry }])).not.toBeNull()
  })
})
