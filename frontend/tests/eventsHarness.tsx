import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AuthContext } from '../src/features/auth/AuthProvider'
import type { AuthUser } from '../src/features/auth/types'
import { EventsPage } from '../src/features/events/EventsPage'
import { ToastProvider } from '../src/shared/components/ToastProvider'
import '../src/shared/styles/index.css'

const user: AuthUser = { id: 'reviewer', username: 'reviewer', full_name: 'Reviewer', role: new URLSearchParams(location.search).has('supervisor') ? 'SUPERVISOR' : 'REVIEWER', is_active: true }
createRoot(document.getElementById('root')!).render(
  <AuthContext.Provider value={{ user, loading: false, login: async () => user, logout() {} }}>
    <ToastProvider><RouterProvider router={createBrowserRouter([{ path: '*', element: <EventsPage /> }])} /></ToastProvider>
  </AuthContext.Provider>,
)
