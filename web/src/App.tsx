import { useEffect, useRef, useState } from 'react'
import { type App as AppEntry, type Machine, type Me, type Storage, type System, usePoll } from './api'
import { AppGrid, AppWindow, Dock, windowMargin } from './apps'
import { ScrollArea } from './scroll'
import { DrivesWidget } from './storage'
import { MachineSwitcher, SystemWidget, glass } from './widgets'

const machineKey = 'nos.machine'
const maximizedKey = 'nos.maximized'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function originOf(rect: DOMRect): string {
  const x = rect.left + rect.width / 2 - windowMargin
  const y = rect.top + rect.height / 2 - windowMargin
  return `${x}px ${y}px`
}

function dockRect(url: string): DOMRect | undefined {
  return document.querySelector(`[data-dock="${CSS.escape(url)}"]`)?.getBoundingClientRect()
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function App() {
  const me = usePoll<Me>('/api/me', 60000).data
  const admin = me?.admin ?? false
  const firstName = me?.name.split(' ')[0]
  const machinesPoll = usePoll<Machine[]>(admin ? '/api/machines' : null, 10000)
  const machines = machinesPoll.data ?? []
  const apps = usePoll<AppEntry[]>('/api/apps', 30000).data ?? []

  const [stored, setStored] = useState(() => localStorage.getItem(machineKey))
  const selected = (machines.find((m) => m.name === stored) ?? machines.find((m) => m.self))?.name
  const base = selected ? `/api/machines/${encodeURIComponent(selected)}` : null
  const system = usePoll<System>(base && `${base}/system`, 3000)
  const storage = usePoll<Storage>(base && `${base}/storage`, 30000)

  const selectMachine = (name: string) => {
    localStorage.setItem(machineKey, name)
    setStored(name)
  }

  const [open, setOpen] = useState<AppEntry[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [origins, setOrigins] = useState<Record<string, string>>({})
  const [closing, setClosing] = useState<string[]>([])
  const closingRef = useRef(new Set<string>())
  // where keyboard focus was before an app came to the front, to return there
  const returnFocus = useRef<HTMLElement | null>(null)
  const [maximized, setMaximized] = useState(() => localStorage.getItem(maximizedKey) === 'true')
  const toggleMaximized = () => {
    localStorage.setItem(maximizedKey, String(!maximized))
    setMaximized(!maximized)
  }

  const setOrigin = (url: string, rect?: DOMRect) => {
    if (rect) setOrigins((o) => ({ ...o, [url]: originOf(rect) }))
  }

  const openApp = (app: AppEntry, from?: DOMRect) => {
    if (!app.frameable) {
      window.open(app.url, '_blank', 'noopener')
      return
    }
    setOrigin(app.url, from)
    closingRef.current.delete(app.url)
    setClosing((c) => c.filter((u) => u !== app.url))
    setOpen((o) => (o.some((a) => a.url === app.url) ? o : [...o, app]))
    if (active === null && document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement
    setActive(app.url)
  }

  useEffect(() => {
    if (active === null) returnFocus.current?.focus()
  }, [active])

  const goHome = () => {
    if (active) setOrigin(active, dockRect(active))
    setActive(null)
  }

  const closeApp = (app: AppEntry) => {
    setOrigin(app.url, dockRect(app.url))
    setActive((a) => (a === app.url ? null : a))
    closingRef.current.add(app.url)
    setClosing((c) => [...c, app.url])
    setTimeout(
      () => {
        if (!closingRef.current.delete(app.url)) return
        setOpen((o) => o.filter((a) => a.url !== app.url))
        setClosing((c) => c.filter((u) => u !== app.url))
      },
      reducedMotion() ? 150 : 400,
    )
  }

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const rect = dockRect(active)
      if (rect) setOrigins((o) => ({ ...o, [active]: originOf(rect) }))
      setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const self = machines.find((m) => m.self)

  const online = machines.filter((m) => m.online).length

  return (
    <div className="min-h-screen font-sans text-fg-base">
      <div
        className={`transition-opacity duration-300 ${active ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        inert={active !== null}
      >
        {self && <title>{self.name}</title>}
        {admin && (
          <aside
            className={`${glass} m-3 mt-[calc(0.75rem+var(--safe-top))] flex flex-col md:fixed md:top-[calc(0.75rem+var(--safe-top))] md:bottom-[calc(0.75rem+var(--safe-bottom))] md:left-[calc(0.75rem+var(--safe-left))] md:m-0 md:w-[22rem] md:overflow-hidden`}
          >
            <ScrollArea>
              <div className="flex flex-col gap-7 p-4 md:pb-6">
                <div className="flex items-center gap-2.5 px-1 pt-1">
                  <img src="/favicon.svg" alt="" className="h-7 w-7 drop-shadow-[0_2px_8px_rgb(22_160_133/0.45)]" />
                  <span className="text-lg font-semibold tracking-tight text-fg-inverse">nOS</span>
                </div>
                {machinesPoll.data ? (
                  <MachineSwitcher machines={machines} selected={selected} onSelect={selectMachine} />
                ) : (
                  <div className="px-1 text-xs text-fg-muted">{machinesPoll.error ?? 'Loading machines…'}</div>
                )}
                {selected && (
                  <>
                    <SystemWidget poll={system} />
                    <DrivesWidget key={selected} poll={storage} machine={selected} />
                  </>
                )}
              </div>
            </ScrollArea>
          </aside>
        )}

        <main
          className={`nos-dock-fade px-6 pt-[calc(2.5rem+var(--safe-top))] pb-32 transition-transform duration-300 md:fixed md:inset-y-0 md:right-0 md:overflow-y-auto ${admin ? 'md:left-[23.5rem]' : 'md:left-0'} md:pt-[calc(4rem+var(--safe-top))] ${active ? 'scale-[0.985]' : ''}`}
        >
          <div className="mx-auto max-w-5xl">
            <header className="mb-10 text-center">
              <h1 className="bg-gradient-to-b from-fg-inverse to-fg-base bg-clip-text text-4xl font-semibold tracking-tight text-transparent md:text-5xl">
                {greeting()}
                {firstName && `, ${firstName}`}.
              </h1>
              {machinesPoll.data && (
                <p className="mt-3 text-sm text-fg-muted tabular-nums">
                  {online} of {machines.length} {machines.length === 1 ? 'machine' : 'machines'} online · {apps.length}{' '}
                  apps
                </p>
              )}
            </header>
            <AppGrid apps={apps} onOpen={openApp} />
          </div>
        </main>
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-36 bg-gradient-to-t from-bg-elevated via-bg-elevated/80 to-transparent md:hidden" />
      </div>

      {open.map((app) => (
        <AppWindow
          key={app.url}
          app={app}
          state={active === app.url ? 'shown' : active === null ? 'home' : 'switch'}
          origin={origins[app.url]}
          maximized={maximized}
          onToggleMaximize={toggleMaximized}
          onMinimize={goHome}
          onClose={() => closeApp(app)}
        />
      ))}

      <Dock
        open={open.filter((a) => !closing.includes(a.url))}
        active={active}
        onHome={goHome}
        onSelect={(app) => openApp(app, dockRect(app.url))}
        onClose={closeApp}
      />
    </div>
  )
}
