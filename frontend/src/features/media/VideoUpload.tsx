import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'

import { apiErrorMessage } from '../../shared/api/errors'
import { ErrorState } from '../../shared/components/ErrorState'
import { uploadVideo } from './api'
import type { MediaAsset } from './types'

export function VideoUpload({
  onUploaded,
  disabled = false,
}: {
  onUploaded(media: MediaAsset): Promise<void> | void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file || disabled) return
    setError(null)
    if (!file.name.toLowerCase().endsWith('.mp4')) {
      setError('Vui lòng sử dụng tệp MP4 hợp lệ.')
      return
    }
    setUploading(true)
    setProgress(0)
    try {
      const media = await uploadVideo(file, setProgress)
      await onUploaded(media)
    } catch (requestError) {
      setError(apiErrorMessage(requestError))
    } finally {
      setUploading(false)
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void handleFile(event.dataTransfer.files[0])
  }

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0])
  }

  return <div className="upload-stack">
    {error && <ErrorState message={error} />}
    <div
      className={`video-dropzone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <span className="upload-icon" aria-hidden="true">↑</span>
      <strong>{uploading ? 'Đang tải video…' : 'Kéo video MP4 vào đây'}</strong>
      {uploading ? <div className="upload-progress" aria-label="Tiến độ tải video">
        <span style={{ width: `${progress ?? 12}%` }} />
        <small>{progress === null ? 'Đang tải…' : `${progress}%`}</small>
      </div> : <>
        <span>hoặc</span>
        <button className="secondary-button" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>Chọn video</button>
      </>}
      <input ref={inputRef} hidden type="file" accept="video/mp4,.mp4" onChange={choose} />
      <small>MP4 · H.264 · tối đa theo cấu hình máy chủ</small>
    </div>
  </div>
}
