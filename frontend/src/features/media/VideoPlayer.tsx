import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'

import { formatDurationMs } from '../../shared/formatters'

export function formatVideoTime(seconds: number): string {
  return formatDurationMs(seconds * 1000)
}

interface VideoPlayerProps {
  src: string
  title: string
  overlay?: ReactNode
  loop?: boolean
  realtime?: boolean
  realtimeActive?: boolean
  onPause?(video: HTMLVideoElement): void
  onPlay?(video: HTMLVideoElement): void
  onSeeking?(video: HTMLVideoElement): void
  onSeeked?(video: HTMLVideoElement): void
  onEnded?(video: HTMLVideoElement): void
}

export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  ({ src, title, overlay, loop = false, realtime = false, realtimeActive = false, onPause, onPlay, onSeeking, onSeeked, onEnded }, forwardedRef) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const scrubbingRef = useRef(false)
    const pendingSeekTimeRef = useRef(0)
    const [playing, setPlaying] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)

    useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement)
    useEffect(() => {
      scrubbingRef.current = false; pendingSeekTimeRef.current = 0
      setPlaying(false); setLoading(true); setError(null); setCurrentTime(0); setDuration(0)
    }, [src])

    const previewTimeline = (time: number) => {
      pendingSeekTimeRef.current = time
      setCurrentTime(time)
      if (!scrubbingRef.current && videoRef.current) videoRef.current.currentTime = time
    }

    const finishTimelineScrub = () => {
      if (!scrubbingRef.current) return
      scrubbingRef.current = false
      if (videoRef.current) videoRef.current.currentTime = pendingSeekTimeRef.current
    }

    const toggle = async () => {
      const video = videoRef.current
      if (!video) return
      try {
        if (video.paused) await video.play()
        else video.pause()
      } catch {
        setError('Trình duyệt không thể phát video này.')
      }
    }

    const fullscreen = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await wrapperRef.current?.requestFullscreen()
      } catch {
        setError('Không thể mở chế độ toàn màn hình.')
      }
    }

    return <div className="video-player" ref={wrapperRef}>
      <div className="video-stage">
        <video
          ref={videoRef}
          src={src}
          aria-label={title}
          preload="auto"
          playsInline
          loop={loop}
          onLoadStart={() => setLoading(true)}
          onLoadedMetadata={(event) => {
            event.currentTarget.playbackRate = 1
            setDuration(event.currentTarget.duration)
            setLoading(false)
          }}
          onCanPlay={() => setLoading(false)}
          onPlaying={() => setLoading(false)}
          onWaiting={() => setLoading(true)}
          onStalled={() => setLoading(true)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={(event) => { setPlaying(true); onPlay?.(event.currentTarget) }}
          onPause={(event) => { setPlaying(false); onPause?.(event.currentTarget) }}
          onSeeking={(event) => onSeeking?.(event.currentTarget)}
          onSeeked={(event) => onSeeked?.(event.currentTarget)}
          onRateChange={(event) => {
            if (event.currentTarget.playbackRate !== 1) event.currentTarget.playbackRate = 1
          }}
          onEnded={(event) => { setPlaying(false); onEnded?.(event.currentTarget) }}
          onError={() => { setLoading(false); setError('Không thể tải hoặc giải mã video.') }}
        />
        {overlay}
        {loading && <div className="video-state">Đang tải video…</div>}
        {error && <div className="video-state error">{error}</div>}
      </div>
      {realtime ? <div className="realtime-video-bar"><span className={playing ? 'online' : ''}>● {playing ? 'Đang phát' : realtimeActive ? 'Tạm dừng' : 'Chưa bắt đầu'}</span><span>{realtimeActive ? 'Luồng camera mô phỏng · 1× thời gian thực' : 'Bấm Bắt đầu giám sát để chạy video và AI'}</span></div> : <div className="video-controls">
        <button type="button" onClick={() => void toggle()}>{playing ? 'Tạm dừng' : 'Phát'}</button>
        <span>{formatVideoTime(currentTime)}</span>
        <input
          className="video-timeline"
          aria-label="Vị trí video"
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(currentTime, duration || 0)}
          onPointerDown={() => {
            scrubbingRef.current = true
            pendingSeekTimeRef.current = videoRef.current?.currentTime ?? currentTime
          }}
          onPointerUp={finishTimelineScrub}
          onPointerCancel={finishTimelineScrub}
          onBlur={finishTimelineScrub}
          onChange={(event) => previewTimeline(Number(event.target.value))}
        />
        <span>{formatVideoTime(duration)}</span>
        <label className="volume-control">Âm lượng<input aria-label="Âm lượng" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => {
          const nextVolume = Number(event.target.value)
          setVolume(nextVolume)
          if (videoRef.current) videoRef.current.volume = nextVolume
        }} /></label>
        <button type="button" onClick={() => void fullscreen()}>Toàn màn hình</button>
      </div>}
    </div>
  },
)

VideoPlayer.displayName = 'VideoPlayer'
