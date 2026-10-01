export interface MediaAsset {
  id: string
  original_filename: string
  media_url: string
  mime_type: string | null
  codec: string
  width: number
  height: number
  fps: number
  duration_ms: number
  size_bytes: number
  sha256: string
  created_at: string
}
