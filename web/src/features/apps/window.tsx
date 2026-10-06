import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/features/apps/icon'
import { type App } from '@/lib/api'

export type Point = { x: number; y: number }

const windowMargin = 12

const windowBottom = 96

type WindowState = 'shown' | 'home' | 'switch'

function TitleButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`grid h-7 w-7 place-items-center rounded-lg text-fg-muted transition hover:text-fg-inverse ${danger ? 'hover:bg-error/80' : 'hover:bg-white/[0.08]'}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-none stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  )
}

export function AppWindow({
  app,
  state,
  origin,
  floating,
  onToggleFloating,
  onMinimize,
  onClose,
}: {
  app: App
  state: WindowState
  origin?: Point
  floating: boolean
  onToggleFloating: () => void
  onMinimize: () => void
  onClose: () => void
}) {
  const [entered, setEntered] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const shown = state === 'shown'

  // hidden elements cannot take focus, so wait until the window is visible
  useEffect(() => {
    if (shown && entered) panel.current?.focus()
  }, [shown, entered])

  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])

  const reload = () => {
    if (!frame.current) return
    setLoaded(false)
    frame.current.src = app.url
  }

  return (
    <div
      ref={panel}
      role="region"
      aria-label={app.name}
      tabIndex={-1}
      inert={!shown}
      data-state={entered ? state : 'home'}
      style={{
        // filling windows reach every edge and the dock floats above them;
        // floating ones keep a margin and end above the dock
        top: `calc(${floating ? windowMargin : 0}px + var(--safe-top))`,
        left: `calc(${floating ? windowMargin : 0}px + var(--safe-left))`,
        right: `calc(${floating ? windowMargin : 0}px + var(--safe-right))`,
        bottom: floating ? `calc(${windowBottom}px + var(--safe-bottom))` : 'var(--safe-bottom)',
        transformOrigin: origin
          ? `${origin.x - (floating ? windowMargin : 0)}px ${origin.y - (floating ? windowMargin : 0)}px`
          : '50% 100%',
      }}
      className={`nixlens-window glass-strong fixed z-40 flex flex-col overflow-hidden outline-none ${floating ? 'rounded-[22px]' : 'rounded-none border-0'}`}
    >
      <div
        onDoubleClick={(e) => {
          if (!(e.target instanceof Element && e.target.closest('button'))) onToggleFloating()
        }}
        className="flex h-11 shrink-0 items-center gap-2.5 border-b border-white/[0.07] bg-white/[0.03] pr-2 pl-3.5 select-none"
      >
        <AppIcon app={app} size="xs" />
        <span className="truncate text-sm font-medium text-fg-inverse">{app.name}</span>
        <span className="truncate font-mono text-xs text-fg-muted">{app.machine}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <TitleButton title="Reload" onClick={reload}>
            <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
          </TitleButton>
          <TitleButton title="Open in new tab" onClick={() => window.open(app.url, '_blank', 'noopener')}>
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </TitleButton>
          <TitleButton title={floating ? 'Fill screen' : 'Float window'} onClick={onToggleFloating}>
            {floating ? (
              <rect x="4" y="4" width="16" height="16" rx="2" />
            ) : (
              <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" />
            )}
          </TitleButton>
          <TitleButton title="Minimize" onClick={onMinimize}>
            <path d="M6 12h12" />
          </TitleButton>
          <TitleButton title="Close" onClick={onClose} danger>
            <path d="M6 6l12 12M18 6L6 18" />
          </TitleButton>
        </div>
      </div>
      <div className="relative flex-1">
        <div
          className={`absolute inset-0 grid place-items-center transition-opacity duration-300 ${loaded ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="nixlens-breathe">
              <AppIcon app={app} />
            </div>
            <span className="text-xs text-fg-muted">Loading {app.name}…</span>
          </div>
        </div>
        <iframe
          ref={frame}
          src={app.url}
          title={app.name}
          allow="fullscreen"
          allowFullScreen
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    </div>
  )
}
