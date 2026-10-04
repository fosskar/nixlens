import { useEffect, useState } from 'react'
import { type App as AppEntry, type Disk, type System, usePoll } from './api'
import { AppGrid, AppWindow, Dock } from './apps'
import { StorageWidget, SystemWidget } from './widgets'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function App() {
  const system = usePoll<System>('/api/system', 3000)
  const disks = usePoll<Disk[]>('/api/disks', 30000)
  const apps = usePoll<AppEntry[]>('/api/apps', 60000)

  const [open, setOpen] = useState<AppEntry[]>([])
  const [active, setActive] = useState<string | null>(null)

  const openApp = (app: AppEntry) => {
    setOpen((o) => (o.some((a) => a.url === app.url) ? o : [...o, app]))
    setActive(app.url)
  }
  const closeApp = (app: AppEntry) => {
    setOpen((o) => o.filter((a) => a.url !== app.url))
    setActive((a) => (a === app.url ? null : a))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (system) document.title = system.hostname
  }, [system])

  return (
    <div className="min-h-screen text-white">
      <main
        className={`mx-auto max-w-5xl px-6 pt-16 pb-32 transition duration-300 ${active ? 'scale-[0.98] opacity-0' : 'opacity-100'}`}
      >
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">{greeting()}.</h1>
          {system && (
            <p className="mt-2 text-sm text-white/50">
              {system.hostname} · NixOS {system.nixosVersion} · Linux {system.kernel}
            </p>
          )}
        </header>

        <section className="mb-12 grid gap-4 md:grid-cols-[1fr_1.6fr]">
          <SystemWidget system={system} />
          <StorageWidget disks={disks} />
        </section>

        <AppGrid apps={apps ?? []} onOpen={openApp} />
      </main>

      {open.map((app) => (
        <AppWindow key={app.url} app={app} visible={active === app.url} />
      ))}

      <Dock open={open} active={active} onHome={() => setActive(null)} onSelect={openApp} onClose={closeApp} />
    </div>
  )
}
