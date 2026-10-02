import { useRef, useState, type ChangeEvent } from 'react'

import { apiErrorMessage } from '../../shared/api/errors'
import { useToast } from '../../shared/components/ToastProvider'
import { importSessionRoster } from './api'
import type { ExamSession } from './types'

export function RosterXlsxImport({
  sessionId,
  disabled = false,
  onImported,
}: {
  sessionId: string
  disabled?: boolean
  onImported(session: ExamSession): void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || disabled) return
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Vui lòng chọn tệp XLSX hợp lệ.')
      return
    }
    setBusy(true); setError(null)
    try {
      const session = await importSessionRoster(sessionId, file)
      onImported(session)
      toast.success(`Đã tự động xếp ${session.candidate_count} thí sinh vào ghế.`)
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <section className="card roster-import-card">
    <div>
      <p className="panel-label">TỰ ĐỘNG XẾP CHỖ</p>
      <h2>Nhập danh sách thí sinh và ghế</h2>
      <p>Hệ thống tự tạo thí sinh chưa có và ánh xạ toàn bộ mã ghế trong một lần.</p>
    </div>
    {error && <p className="inline-alert error" role="alert">{error}</p>}
    <div className="button-row">
      <button className="primary-button" type="button" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>{busy ? 'Đang xử lý…' : 'Chọn file Excel đã điền'}</button>
      <input ref={inputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void choose(event)} />
    </div>
    <small>Cột bắt buộc: Mã thí sinh, Họ tên, Mã ghế. Cột Lớp có thể để trống.</small>
  </section>
}
