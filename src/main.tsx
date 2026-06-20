import { Component, StrictMode } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Admin from './Admin.tsx'

const apiOrigin = (import.meta.env.VITE_API_ORIGIN || 'https://linasia.ru').replace(/\/$/, '')
const nativeFetch = window.fetch.bind(window)

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && (input.startsWith('/api/') || input.startsWith('/legal/'))) {
    return nativeFetch(`${apiOrigin}${input}`, init)
  }
  if (input instanceof URL && (input.pathname.startsWith('/api/') || input.pathname.startsWith('/legal/'))) {
    return nativeFetch(new URL(input.pathname + input.search + input.hash, apiOrigin), init)
  }
  if (input instanceof Request && (new URL(input.url)).origin === location.origin) {
    const url = new URL(input.url)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/legal/')) {
      return nativeFetch(new Request(new URL(url.pathname + url.search + url.hash, apiOrigin), input), init)
    }
  }
  return nativeFetch(input, init)
}

const isAdmin = window.location.pathname.startsWith('/lin-admin') || window.location.hash.includes('lin-admin')
const rootEl = document.getElementById('root')

class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    try {
      fetch('/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          type: 'frontend_error',
          path: location.pathname,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : '',
          componentStack: info.componentStack,
          userAgent: navigator.userAgent,
        }),
      }).catch(() => {})
    } catch { /* no-op */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="boot-fallback">
          <header className="boot-head">
            <span className="boot-brand"><span>林</span><span>LIN</span></span>
            <a href="https://t.me/lin_asia" rel="noopener noreferrer">Telegram</a>
          </header>
          <section className="boot-hero">
            <div>
              <div className="boot-kicker">Новый дроп</div>
              <h1 className="boot-title">Silent Wrath Top</h1>
              <a className="boot-btn" href="https://t.me/lin_asia" rel="noopener noreferrer">Предзаказ</a>
            </div>
          </section>
          <p className="boot-note">Каталог временно не загрузился. Напишите нам в Telegram, и мы поможем оформить заказ вручную.</p>
        </main>
      )
    }
    return this.props.children
  }
}

if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        {isAdmin ? <Admin /> : <App />}
      </RootErrorBoundary>
    </StrictMode>,
  )
}
