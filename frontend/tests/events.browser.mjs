// npm run test:events (install Chromium with npx playwright install chromium first)
// Network fixtures test the UI; test_unidentified_events.py verifies the real backend contract.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const event = {
    id: 'event-1', event_code: 'AI-UNKNOWN', session_id: 'session-1', session_code: 'EXAM01', exam_name: 'Exam',
    video_asset_id: null, source: 'AI', behavior_type: 'SUSPICIOUS_LOOKING', start_ms: 1000, end_ms: 6000, peak_ms: 4000,
    ai_confidence: .96, status: 'PENDING_REVIEW', actors: [], reviews: [], actor_assignments: [],
    created_at: '2026-09-29T08:00:00Z', updated_at: '2026-09-29T08:00:00Z',
  }
  let failAssignment = true
  let assignedRequests = 0
  const filterRequests = []
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const path = requestUrl.pathname
    if (path === '/api/v1/events' || path === '/api/v1/events/counts') filterRequests.push({ path, params: Object.fromEntries(requestUrl.searchParams) })
    const matches = !requestUrl.searchParams.get('q') || requestUrl.searchParams.get('q') === 'SV001'
    if (path === '/api/v1/events/counts') return route.fulfill({ json: { total: matches ? 1 : 0, pending_review: matches ? 1 : 0, confirmed: 0, dismissed: 0, needs_review: 0 } })
    if (path === '/api/v1/events') return route.fulfill({ json: { items: matches ? [event] : [], total: matches ? 1 : 0, page: 1, page_size: 20 } })
    if (path === '/api/v1/sessions/session-1') return route.fulfill({ json: { assignments: [{ id: 'assignment-1', candidate: { candidate_code: 'SV001', full_name: 'Sinh viên 1' }, seat: { code: 'A01' } }] } })
    if (path.endsWith('/actors')) {
      assignedRequests++
      assert.equal(request.method(), 'POST')
      assert.deepEqual(request.postDataJSON(), { session_candidate_id: 'assignment-1', note: 'Đã đối chiếu bàn A01 trên video' })
      if (failAssignment) { failAssignment = false; return route.fulfill({ status: 503, json: { detail: 'Temporary failure' } }) }
      event.actors = [{ session_candidate_id: 'assignment-1', candidate_id: 'candidate-1', candidate_code: 'SV001', full_name: 'Sinh viên 1', seat_code: 'A01' }]
      event.actor_assignments = [{ id: 'audit-1', candidate_code: 'SV001', full_name: 'Sinh viên 1', note: request.postDataJSON().note, reviewer_name: 'Reviewer', created_at: event.created_at }]
      return route.fulfill({ json: event })
    }
    if (path.endsWith('/reviews')) {
      event.status = 'NEEDS_REVIEW'
      event.reviews.push({ id: 'review-1', decision: 'NEEDS_REVIEW', note: 'Cần đối chiếu', reviewer_id: 'reviewer', reviewer_name: 'Reviewer', created_at: event.created_at })
      return route.fulfill({ json: event })
    }
    if (path === '/api/v1/events/event-1') return route.fulfill({ json: event })
    throw new Error(`Unexpected request: ${path}`)
  })
  const url = `${server.resolvedUrls.local[0]}tests/events.html?event=event-1`
  await page.goto(url)
  await page.getByRole('cell', { name: 'Chưa xác định thí sinh', exact: true }).waitFor()
  const assign = page.getByRole('button', { name: 'Gắn thí sinh vào sự kiện', exact: true })
  assert.equal(await assign.isDisabled(), true)
  await page.getByLabel('Thí sinh trong ca thi', { exact: true }).selectOption('assignment-1')
  assert.equal(await assign.isDisabled(), true)
  await page.getByLabel('Căn cứ xác định thí sinh', { exact: true }).fill('Đã đối chiếu bàn A01 trên video')
  await assign.click()
  await page.locator('.event-review-form [role="alert"]').waitFor()
  assert.equal(await assign.isEnabled(), true)
  await assign.click()
  await page.getByRole('heading', { name: 'Lịch sử xác định thí sinh' }).waitFor()
  assert.equal(assignedRequests, 2)
  await page.getByRole('cell', { name: 'SV001 — Sinh viên 1 (A01)', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Lịch sử xác định thí sinh' }).waitFor()
  assert.equal(await assign.count(), 0)
  await page.getByLabel('Ghi chú xác minh', { exact: true }).fill('Cần đối chiếu')
  await page.getByRole('button', { name: 'Cần xem lại', exact: true }).click()
  await page.getByText('Cần đối chiếu', { exact: true }).waitFor()
  await page.getByLabel('Tìm sự kiện theo mã hoặc tên thí sinh').fill('SV001')
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/v1/events/counts') && response.url().includes('q=SV001')),
    page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click(),
  ])
  assert.ok(filterRequests.some(r => r.path === '/api/v1/events' && r.params.q === 'SV001'))
  await page.getByLabel('Tìm sự kiện theo mã hoặc tên thí sinh').fill('missing')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByText('Không có sự kiện khớp bộ lọc.', { exact: true }).waitFor()
  await page.reload()
  assert.equal(await page.getByLabel('Tìm sự kiện theo mã hoặc tên thí sinh').inputValue(), 'missing')
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click()
  await page.getByRole('cell', { name: 'SV001 — Sinh viên 1 (A01)', exact: true }).waitFor()
  await page.goto(url + '&candidate=candidate-1&candidate_label=SV001&room=room-1&room_label=P01')
  await page.getByRole('button', { name: 'Bỏ lọc thí sinh', exact: true }).waitFor()
  await page.getByRole('cell', { name: 'SV001 — Sinh viên 1 (A01)', exact: true }).waitFor()
  assert.ok(filterRequests.some(r => r.path === '/api/v1/events/counts' && r.params.candidate_id === 'candidate-1' && r.params.room_id === 'room-1'))
  await page.getByRole('button', { name: 'Bỏ lọc thí sinh', exact: true }).click()
  assert.equal(new URL(page.url()).searchParams.has('candidate'), false)
  event.actors = []
  await page.goto(url + '&supervisor=1')
  await page.getByRole('cell', { name: 'Chưa xác định thí sinh', exact: true }).waitFor()
  assert.equal(await assign.count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: unidentified event list/detail, assignment validation, error/retry, audited linking, reload, review and role restrictions.')
} finally {
  await browser?.close()
  await server.close()
}
