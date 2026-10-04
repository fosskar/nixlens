import { Component, type ErrorInfo, type ReactNode } from 'react'

// a rendering error shows a message with a reload button instead of a blank page
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid min-h-screen place-items-center p-6 font-sans text-fg-base">
        <div className="glass max-w-md rounded-2xl p-6 text-center">
          <div className="text-lg font-semibold text-fg-inverse">Something went wrong</div>
          <p className="mt-2 text-sm text-fg-muted">{String(this.state.error)}</p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="glass-accent mt-5 rounded-xl px-4 py-2 text-sm text-fg-inverse"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
