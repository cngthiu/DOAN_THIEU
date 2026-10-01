import axios from 'axios'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { landingPathForRole } from '../../app/access'
import { ErrorState } from '../../shared/components/ErrorState'
import { FormField } from '../../shared/components/FormField'
import { Icon } from '../../shared/components/Icon'
import { useAuth } from './AuthProvider'

function loginErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.status === 401) {
    return 'Tên đăng nhập hoặc mật khẩu không đúng.'
  }
  return 'Không thể kết nối tới ExamGuard. Vui lòng thử lại.'
}

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={landingPathForRole(user.role)} replace />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const normalizedUsername = username.trim()
    const validation = {
      username: normalizedUsername ? undefined : 'Tên đăng nhập là bắt buộc.',
      password: password ? undefined : 'Mật khẩu là bắt buộc.',
    }
    setFieldErrors(validation)
    if (validation.username || validation.password) return
    setSubmitting(true)
    try {
      const loggedInUser = await login(normalizedUsername, password)
      navigate(landingPathForRole(loggedInUser.role), { replace: true })
    } catch (requestError) {
      setError(loginErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
          <div className="brand-badge"><Icon name="shield" /></div>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Hệ thống giám sát thi cử
            </span>
            <h1 id="login-title" style={{ fontSize: '20px', fontWeight: 700, margin: '2px 0 0' }}>Đăng nhập hệ thống</h1>
          </div>
        </div>
        <p className="secondary-text" style={{ fontSize: '13px', marginTop: '6px' }}>
          Nền tảng giám sát thi tập trung sử dụng camera AI & nhận diện hành vi
        </p>

        {error && <ErrorState message={error} />}

        <form onSubmit={submit} noValidate>
          <FormField label="Tên đăng nhập" htmlFor="username" required error={fieldErrors.username}>
            <input
              id="username"
              autoComplete="username"
              placeholder="username"
              maxLength={100}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FormField>
          <FormField label="Mật khẩu" htmlFor="password" required error={fieldErrors.password}>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Nhập mật khẩu"
              maxLength={1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>
          <button className="primary-button" type="submit" disabled={submitting} style={{ height: '42px', fontSize: '14px' }}>
            {submitting ? 'Đang xác thực…' : 'Đăng nhập vào hệ thống'}
          </button>
        </form>
      </section>
    </main>
  )
}
