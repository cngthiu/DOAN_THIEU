// Run: npx playwright install chromium && npm run test:seats
// HTTP fixtures isolate the editor; backend persistence is covered by test_phase2_business.py.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let saved = []
  let writes = 0
  await page.route('**/api/v1/media/test-frame/frame?*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#334155"/></svg>' }))
  await page.route('**/api/v1/rooms/test-room/seats', async route => {
    if (route.request().method() === 'PUT') {
      writes++
      const payload = route.request().postDataJSON()
      assert.deepEqual(Object.keys(payload), ['seats'])
      for (const seat of payload.seats) assert.deepEqual(Object.keys(seat).sort(), ['code', 'height', 'is_active', 'sort_order', 'width', 'x', 'y'])
      saved = payload.seats.map((seat, index) => ({ ...seat, id: `saved-${index}`, room_id: 'test-room' }))
    }
    await route.fulfill({ json: saved })
  })
  const url = `${server.resolvedUrls.local[0]}tests/seatLayout.html`
  const button = name => page.getByRole('button', { name, exact: true })
  const count = async n => {
    await page.waitForFunction(n => document.querySelectorAll('.seat-box').length === n, n)
  }
  const geometry = () => page.locator('.seat-box').evaluateAll(nodes => nodes.map(node => ({ code: node.querySelector('strong').textContent, x: node.style.left, y: node.style.top, width: node.style.width, height: node.style.height })))
  const box = code => page.locator('.seat-box').filter({ has: page.getByText(code, { exact: true }) })
  const drag = async (locator, dx, dy) => {
    await locator.scrollIntoViewIfNeeded()
    const bounds = await locator.boundingBox()
    await page.mouse.move(bounds.x+bounds.width/2, bounds.y+bounds.height/2)
    await page.mouse.down()
    await page.mouse.move(bounds.x+bounds.width/2+dx, bounds.y+bounds.height/2+dy, { steps: 5 })
    await page.mouse.up()
  }
  await page.goto(url)
  await button('Tạo lưới ghế').click()
  const area = page.locator('.grid-calibration')
  await area.scrollIntoViewIfNeeded()
  const bounds = await area.boundingBox()
  assert.ok(Math.abs(bounds.width/bounds.height-4/3) < .01, 'reference aspect ratio')
  for (const [x,y] of [[.3,.12],[.65,.17],[.94,.9],[.06,.8]]) await page.mouse.click(bounds.x+x*bounds.width, bounds.y+y*bounds.height)
  assert.equal(await area.locator('circle').count(), 4)
  await drag(page.getByRole('button', { name: 'Góc P2', exact: true }), 8, 3)
  await button('Tạo / Tạo lại lưới').click()
  await count(40)
  assert.equal(writes, 0)
  let before = await geometry()
  assert.equal(before[39].code, 'E08')
  await drag(box('B03'), 20, 15)
  let after = await geometry()
  assert.notDeepEqual(after[10], before[10])
  assert.deepEqual(after.filter((_,i)=>i!==10), before.filter((_,i)=>i!==10))
  await button('Undo').click()
  assert.deepEqual(await geometry(), before)
  await button('Redo').click()
  assert.deepEqual(await geometry(), after)
  before = after
  await drag(page.getByRole('button', { name: 'Đổi kích thước chỗ ngồi C02', exact: true }), 10, 8)
  after = await geometry()
  assert.ok(parseFloat(after[17].width) > parseFloat(before[17].width))
  assert.ok(parseFloat(after[17].height) > parseFloat(before[17].height))
  assert.equal(after[17].x, before[17].x)
  assert.deepEqual(after.filter((_,i)=>i!==17), before.filter((_,i)=>i!==17))
  await page.locator('.seat-row').filter({ has: page.locator('input[value="A04"]') }).getByRole('button').click()
  await count(39)
  await button('Thêm chỗ ngồi').click()
  await count(40)
  const added = (await geometry()).at(-1).code
  await drag(box(added), 12, 10)
  await page.locator('.seat-row input').nth(9).fill('B04')
  await button('Lưu sơ đồ').click()
  await page.getByText('Mã chỗ ngồi bị trùng: B04.', { exact: true }).waitFor()
  assert.equal(writes, 0)
  await page.locator('.seat-row input').nth(9).fill('B03')
  before = await geometry()
  await button('Tạo lưới ghế').click()
  await page.getByLabel('Số hàng', { exact: true }).fill('4')
  await button('Tạo / Tạo lại lưới').click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Hủy', exact: true }).click()
  await button('Quay lại chỉnh ghế').click()
  assert.deepEqual(await geometry(), before)
  await button('Tạo lưới ghế').click()
  await button('Tạo / Tạo lại lưới').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Tạo lại lưới', exact: true }).click()
  await count(32)
  await button('Undo').click()
  await count(40)
  assert.deepEqual(await geometry(), before)
  await button('Lưu sơ đồ').click()
  await page.getByText('Đã lưu bố trí chỗ ngồi.', { exact: true }).waitFor()
  assert.equal(writes, 1)
  const persisted = await geometry()
  await page.reload()
  await count(40)
  assert.deepEqual(await geometry(), persisted)
  await page.setViewportSize({ width: 540, height: 800 })
  assert.deepEqual(await geometry(), persisted)
  const seatBounds = await box('B03').boundingBox()
  const frameBounds = await page.locator('.calibration-area').boundingBox()
  assert.ok(Math.abs((seatBounds.x-frameBounds.x)/frameBounds.width-parseFloat(persisted[9].x)/100) < .005)
  // Existing manually created layouts still use the same editor.
  saved = [{ id: 'old-seat', room_id: 'test-room', code: 'LEGACY01', x: .2, y: .3, width: .1, height: .12, sort_order: 0, is_active: true }]
  await page.reload()
  await count(1)
  before = await geometry()
  await drag(box('LEGACY01'), 10, 8)
  assert.notDeepEqual(await geometry(), before)
  await button('Tạo lưới ghế').click()
  await button('Reset corners').click()
  assert.equal(await page.locator('.grid-calibration circle').count(), 0)
  assert.equal(await button('Tạo / Tạo lại lưới').isDisabled(), true)
  await button('Quay lại chỉnh ghế').click()
  // Reset corners above intentionally preserves the draft; Reset grid restores saved data.
  await button('Tạo lưới ghế').click()
  const resetBounds = await area.boundingBox()
  await page.mouse.click(resetBounds.x + resetBounds.width*.2, resetBounds.y + resetBounds.height*.2)
  await button('Reset grid').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset grid', exact: true }).click()
  assert.equal(await page.locator('.grid-calibration circle').count(), 0)
  await button('Quay lại chỉnh ghế').click()
  assert.deepEqual(await geometry(), before)
  await button('Undo').click()
  assert.notDeepEqual(await geometry(), before)
  assert.deepEqual(errors, [])
  console.log('PASS: 12 requested cases; corner drag/reset, perspective, 40 seats, isolated drag/resize, add/delete, duplicate validation, regeneration confirmation, undo/redo, explicit PUT, reload, responsive geometry, legacy layout.')
} finally {
  await browser?.close()
  await server.close()
}
