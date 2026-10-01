import { forwardRef, type ReactNode } from 'react'

import { VideoPlayer } from './VideoPlayer'

interface VideoMonitorProps {
  mediaUrl: string
  title: string
  overlay?: ReactNode
  loop?: boolean
  realtime?: boolean
  onPause?(video: HTMLVideoElement): void
  onPlay?(video: HTMLVideoElement): void
  onSeeking?(video: HTMLVideoElement): void
  onSeeked?(video: HTMLVideoElement): void
  onEnded?(video: HTMLVideoElement): void
}

export const VideoMonitor = forwardRef<HTMLVideoElement, VideoMonitorProps>(
  ({ mediaUrl, title, ...events }, ref) => <div className="video-monitor">
    <VideoPlayer ref={ref} src={mediaUrl} title={title} {...events} />
  </div>,
)

VideoMonitor.displayName = 'VideoMonitor'
