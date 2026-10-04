import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { App } from './api'

const dashboardIcons = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons'

type IconSource = { url: string; mask: boolean }

function iconSource(icon: string): IconSource | null {
  if (icon === '') return null
  if (/^(https?:\/\/|\/)/.test(icon)) return { url: icon, mask: false }
  if (icon.startsWith('sh-'))
    return { url: `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${icon.slice(3)}.svg`, mask: false }
  if (icon.startsWith('mdi-'))
    return { url: `https://cdn.jsdelivr.net/npm/@mdi/svg/svg/${icon.slice(4)}.svg`, mask: true }
  const ext = /\.(svg|png|webp)$/.exec(icon)?.[1]
  if (ext) return { url: `${dashboardIcons}/${ext}/${icon}`, mask: false }
  return { url: `${dashboardIcons}/svg/${icon}.svg`, mask: false }
}

const iconSizes = {
  lg: { box: 'h-16 w-16 rounded-2xl', img: 'h-10 w-10', letter: 'text-2xl' },
  sm: { box: 'h-11 w-11 rounded-xl', img: 'h-7 w-7', letter: 'text-lg' },
  xs: { box: 'h-6 w-6 rounded-md', img: 'h-4 w-4', letter: 'text-[11px]' },
}

function AppIcon({ app, size = 'lg' }: { app: App; size?: keyof typeof iconSizes }) {
  const source = iconSource(app.icon)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const s = iconSizes[size]
  const failed = source === null || failedUrl === source.url
  const onError = () => source && setFailedUrl(source.url)
  return (
    <div className={`${s.box} glass-tile grid place-items-center`}>
      {failed ? (
        <span className={`${s.letter} font-semibold text-fg-base`}>{app.name.charAt(0).toUpperCase()}</span>
      ) : source.mask ? (
        <>
          <img src={source.url} alt="" hidden onError={onError} />
          <span
            className={`${s.img} bg-fg-base`}
            style={{
              maskImage: `url("${source.url}")`,
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
            }}
          />
        </>
      ) : (
        <img src={source.url} alt="" className={`${s.img} object-contain`} onError={onError} />
      )}
    </div>
  )
}

function byCategory(apps: App[]): [string, App[]][] {
  const groups = new Map<string, App[]>()
  for (const app of apps) {
    const list = groups.get(app.category)
    if (list) list.push(app)
    else groups.set(app.category, [app])
  }
  return [...groups]
}

const collapsedKey = 'nos.collapsed'

// a value from another version or edited by hand must not break the page
function loadCollapsed(): string[] {
  const stored = localStorage.getItem(collapsedKey)
  if (!stored) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch (e) {
    if (e instanceof SyntaxError) return []
    throw e
  }
  return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : []
}

export function AppGrid({ apps, onOpen }: { apps: App[]; onOpen: (app: App, from: DOMRect) => void }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const toggle = (category: string) => {
    const next = collapsed.includes(category) ? collapsed.filter((c) => c !== category) : [...collapsed, category]
    localStorage.setItem(collapsedKey, JSON.stringify(next))
    setCollapsed(next)
  }
  return (
    <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-2">
      {byCategory(apps).map(([category, list]) => {
        const open = !collapsed.includes(category)
        return (
          <section key={category}>
            <button
              onClick={() => toggle(category)}
              aria-expanded={open}
              className="group mb-4 flex w-full items-center gap-3 px-1 text-[11px] font-semibold tracking-[0.12em] text-fg-muted uppercase transition-colors hover:text-fg-base"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 shrink-0 fill-none stroke-current transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              {category || 'Other'}
              <span className="text-fg-dim tabular-nums">{list.length}</span>
              <span className="h-px flex-1 bg-gradient-to-r from-white/[0.10] to-transparent" />
            </button>
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div className={open ? '' : 'overflow-hidden'}>
                <AppSection apps={list} onOpen={onOpen} />
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function appTitle(app: App): string {
  const title = `${app.name} on ${app.machine}${app.frameable ? '' : ' (opens in a new tab)'}`
  return app.description ? `${title}\n${app.description}` : title
}

function AppSection({ apps, onOpen }: { apps: App[]; onOpen: (app: App, from: DOMRect) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-y-6">
      {apps.map((app) => (
        <button
          key={app.url}
          onClick={(e: MouseEvent<HTMLButtonElement>) =>
            onOpen(app, (e.currentTarget.firstElementChild ?? e.currentTarget).getBoundingClientRect())
          }
          title={appTitle(app)}
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
          <span className="max-w-full truncate px-1 text-xs text-fg-muted transition-colors group-hover:text-fg-inverse">
            {app.name}
          </span>
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
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--safe-bottom))] z-50 flex justify-center">
      <div className="glass-strong pointer-events-auto flex items-center gap-2 rounded-[26px] p-2.5">
        <button
          onClick={onHome}
          title="Home"
          aria-label="Home"
          className={`grid h-11 w-11 place-items-center rounded-xl border transition hover:-translate-y-1 ${active === null ? 'glass-accent text-accent-cyan' : 'glass-tile text-fg-base'}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z" />
          </svg>
        </button>
        {open.length > 0 && <div className="mx-1 h-8 w-px bg-white/[0.12]" />}
        {open.map((app) => (
          <div key={app.url} data-dock={app.url} className="group relative">
            <button
              onClick={() => onSelect(app)}
              title={`${app.name} on ${app.machine}`}
              aria-label={`${app.name} on ${app.machine}`}
              className="transition hover:-translate-y-1"
            >
              <AppIcon app={app} size="sm" />
            </button>
            <button
              onClick={() => onClose(app)}
              title={`Close ${app.name}`}
              aria-label={`Close ${app.name}`}
              className="absolute -top-1 -right-1 hidden group-focus-within:grid h-4 w-4 place-items-center rounded-full border border-white/15 bg-bg-overlay text-[10px] leading-none text-fg-base shadow-[0_2px_6px_rgb(0_0_0/0.5)] group-hover:grid hover:bg-error hover:text-fg-inverse"
            >
              ×
            </button>
            <span
              className={`absolute -bottom-2 left-1/2 h-1 -translate-x-1/2 rounded-full transition-all ${active === app.url ? 'w-3 bg-accent-cyan shadow-[0_0_6px_var(--color-accent-cyan)]' : 'w-1 bg-fg-muted'}`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export const windowMargin = 12
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
  maximized,
  onToggleMaximize,
  onMinimize,
  onClose,
}: {
  app: App
  state: WindowState
  origin?: string
  maximized: boolean
  onToggleMaximize: () => void
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
        top: `calc(${maximized ? 0 : windowMargin}px + var(--safe-top))`,
        left: `calc(${maximized ? 0 : windowMargin}px + var(--safe-left))`,
        right: `calc(${maximized ? 0 : windowMargin}px + var(--safe-right))`,
        bottom: `calc(${windowBottom}px + var(--safe-bottom))`,
        transformOrigin: origin ?? '50% 100%',
      }}
      className={`nos-window glass-strong fixed z-40 flex flex-col overflow-hidden outline-none ${maximized ? 'rounded-none border-x-0 border-t-0' : 'rounded-[22px]'}`}
    >
      <div
        onDoubleClick={(e) => {
          if (!(e.target instanceof Element && e.target.closest('button'))) onToggleMaximize()
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
          <TitleButton title={maximized ? 'Restore' : 'Maximize'} onClick={onToggleMaximize}>
            {maximized ? (
              <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" />
            ) : (
              <rect x="4" y="4" width="16" height="16" rx="2" />
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
          allow="fullscreen"
          allowFullScreen
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    </div>
  )
}
