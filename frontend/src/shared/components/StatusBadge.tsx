import type { SessionStatus } from '../../features/sessions/types'
import { sessionStatusLabels } from '../i18n/vi'

export function StatusBadge({ status }: { status: SessionStatus }) {
  const tone = status === 'READY' || status === 'RUNNING'
    ? 'success'
    : status === 'ERROR' || status === 'CANCELLED'
      ? 'danger'
      : status === 'PAUSED'
        ? 'warning'
        : 'muted'
  return <span className={`status-pill ${tone}`}>{sessionStatusLabels[status] ?? status}</span>
}
