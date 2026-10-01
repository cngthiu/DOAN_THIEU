import { apiClient } from '../../shared/api/client'
import type { MediaAsset } from './types'

export async function uploadVideo(
  file: File,
  onProgress: (percentage: number | null) => void,
): Promise<MediaAsset> {
  const body = new FormData()
  body.append('file', file)
  const response = await apiClient.post<MediaAsset>('/media/videos', body, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (!event.total) return onProgress(null)
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    },
  })
  return response.data
}

export async function getMediaFrame(mediaId: string, timestampMs = 5000): Promise<Blob> {
  return (await apiClient.get<Blob>(`/media/${mediaId}/frame`, {
    params: { timestamp_ms: timestampMs },
    responseType: 'blob',
  })).data
}
