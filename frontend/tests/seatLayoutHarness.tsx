import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { SeatLayoutEditor } from '../src/features/rooms/SeatLayoutEditor'
import { getSeats } from '../src/features/rooms/api'
import type { Seat } from '../src/features/rooms/types'
import { ToastProvider } from '../src/shared/components/ToastProvider'
import '../src/shared/styles/index.css'

function Harness() {
  const [seats, setSeats] = useState<Seat[] | null>(null)
  useEffect(() => { void getSeats('test-room').then(setSeats) }, [])
  return <ToastProvider>{seats && <SeatLayoutEditor roomId="test-room" initialSeats={seats} referenceMediaId="test-frame" referenceTimestampMs={0} editable onSaved={setSeats} />}</ToastProvider>
}
createRoot(document.getElementById('root')!).render(<RouterProvider router={createBrowserRouter([{ path: '*', element: <Harness /> }])} />)
