import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { App } from './api'

const iconBase = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'

const iconSizes = {
  lg: { box: 'h-16 w-16 rounded-2xl', img: 'h-10 w-10', letter: 'text-2xl' },
  sm: { box: 'h-11 w-11 rounded-xl', img: 'h-7 w-7', letter: 'text-lg' },
  xs: { box: 'h-6 w-6 rounded-md', img: 'h-4 w-4', letter: 'text-[11px]' },
}

export function AppIcon({ app, size = 'lg' }: { app: App; size?: keyof typeof iconSizes }) {
  const [failed, setFailed] = useState(false)
  const s = iconSizes[size]
  return (
    <div
      className={`${s.box} glass-tile grid place-items-center`}
    >
      {failed ? (
        <span className={`${s.letter} font-semibold text-fg-base`}>{app.name.charAt(0).toUpperCase()}</span>
      ) : (
        <img src={`${iconBase}/${app.name}.svg`} alt="" className={s.img} onError={() => setFailed(true)} />
      )}
    </div>
  )
}

export function AppGrid({ apps, onOpen }: { apps: App[]; onOpen: (app: App, from: DOMRect) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-y-6">
      {apps.map((app) => (
        <button
          key={app.url}
          onClick={(e: MouseEvent<HTMLButtonElement>) =>
            onOpen(app, (e.currentTarget.firstElementChild ?? e.currentTarget).getBoundingClientRect())
          }
          title={`${app.name} on ${app.machine}${app.frameable ? '' : ' (opens in a new tab)'}`}
          className="group flex flex-col items-center gap-2.5 transition-transform duration-300 ease-out hover:-translate-y-1 active:scale-95"
        >
          <div className="relative">
            <AppIcon app={app} />
            {!app.frameable && (
              <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-bg-overlay/90 text-[10px] text-fg-base shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_2px_6px_rgb(0_0_0/0.5)]">
                ↗
              </span>
            )}
          </div>
          <span className="max-w-full truncate px-1 text-xs text-fg-muted transition-colors group-hover:text-fg-inverse">{app.name}</span>
        </button>
      ))}
    </div>
  )
}

export function Dock({
  open,
  active,
  onHome,
  onSelect,
  onClose,
}: {
  open: App[]
  active: string | null
  onHome: () => void
  onSelect: (app: App) => void
  onClose: (app: App) => void
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center">
      <div className="glass-strong pointer-events-auto flex items-end gap-2 rounded-[26px] px-3 pt-2 pb-1.5">
        <button
          onClick={onHome}
          title="Home"
          className={`mb-2 grid h-11 w-11 place-items-center rounded-xl border transition hover:-translate-y-1 ${active === null ? 'glass-accent text-accent-cyan' : 'glass-tile text-fg-base'}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z" />
          </svg>
        </button>
        {open.length > 0 && <div className="mx-1 mb-1.5 h-8 w-px self-center bg-white/[0.12]" />}
        {open.map((app) => (
          <div key={app.url} data-dock={app.url} className="group relative flex flex-col items-center">
            <button
              onClick={() => onSelect(app)}
              title={`${app.name} on ${app.machine}`}
              className="transition hover:-translate-y-1"
            >
              <AppIcon app={app} size="sm" />
            </button>
            <button
              onClick={() => onClose(app)}
              title={`Close ${app.name}`}
              className="absolute -top-1 -right-1 hidden h-4 w-4 place-items-center rounded-full border border-white/15 bg-bg-overlay text-[10px] leading-none text-fg-base shadow-[0_2px_6px_rgb(0_0_0/0.5)] group-hover:grid hover:bg-error hover:text-fg-inverse"
            >
              ×
            </button>
            <span
              className={`mt-1 h-1 rounded-full transition-all ${active === app.url ? 'w-3 bg-accent-cyan shadow-[0_0_6px_var(--color-accent-cyan)]' : 'w-1 bg-fg-muted'}`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export const windowMargin = 12
const windowBottom = 96

export type WindowState = 'shown' | 'home' | 'switch'

function TitleButton({ title, onClick, danger, children }: {
  title: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid h-7 w-7 place-items-center rounded-lg text-fg-muted transition hover:text-fg-inverse ${danger ? 'hover:bg-error/80' : 'hover:bg-white/[0.08]'}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

export function AppWindow({
  app,
  state,
  origin,
  onMinimize,
  onClose,
}: {
  app: App
  state: WindowState
  origin?: string
  onMinimize: () => void
  onClose: () => void
}) {
  const [entered, setEntered] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)

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
      data-state={entered ? state : 'home'}
      style={{
        top: windowMargin,
        left: windowMargin,
        right: windowMargin,
        bottom: windowBottom,
        transformOrigin: origin ?? '50% 100%',
      }}
      className="nos-window glass-strong fixed z-40 flex flex-col overflow-hidden rounded-[22px]"
    >
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-white/[0.07] bg-white/[0.03] pr-2 pl-3.5">
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
            <div className="nos-breathe">
              <AppIcon app={app} />
            </div>
            <span className="text-xs text-fg-muted">Loading {app.name}…</span>
          </div>
        </div>
        <iframe
          ref={frame}
          src={app.url}
          title={app.name}
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    </div>
  )
}
