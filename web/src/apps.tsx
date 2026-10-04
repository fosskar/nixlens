import { useState } from 'react'
import type { App } from './api'

const iconBase = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'

export function AppIcon({ app, size = 'lg' }: { app: App; size?: 'lg' | 'sm' }) {
  const [failed, setFailed] = useState(false)
  const box = size === 'lg' ? 'h-16 w-16 rounded-2xl' : 'h-11 w-11 rounded-xl'
  return (
    <div
      className={`${box} grid place-items-center border border-white/10 bg-white/[0.08] backdrop-blur-xl shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]`}
    >
      {failed ? (
        <span className={size === 'lg' ? 'text-2xl font-semibold' : 'text-lg font-semibold'}>
          {app.name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <img
          src={`${iconBase}/${app.name}.svg`}
          alt=""
          className={size === 'lg' ? 'h-10 w-10' : 'h-7 w-7'}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

export function AppGrid({ apps, onOpen }: { apps: App[]; onOpen: (app: App) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-y-6">
      {apps.map((app) => (
        <button
          key={app.url}
          onClick={() => onOpen(app)}
          className="group flex flex-col items-center gap-2 transition-transform duration-300 ease-out hover:-translate-y-1 active:scale-95"
        >
          <AppIcon app={app} />
          <span className="max-w-full truncate text-xs text-white/75 group-hover:text-white">{app.name}</span>
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
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center">
      <div className="flex items-end gap-2 rounded-3xl border border-white/10 bg-black/30 px-3 py-2 backdrop-blur-2xl">
        <button
          onClick={onHome}
          title="Home"
          className={`grid h-11 w-11 place-items-center rounded-xl border border-white/10 transition hover:-translate-y-1 ${active === null ? 'bg-white/20' : 'bg-white/[0.08]'}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white/90">
            <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z" />
          </svg>
        </button>
        {open.length > 0 && <div className="mx-1 h-8 w-px self-center bg-white/15" />}
        {open.map((app) => (
          <div key={app.url} className="group relative flex flex-col items-center">
            <button onClick={() => onSelect(app)} title={app.name} className="transition hover:-translate-y-1">
              <AppIcon app={app} size="sm" />
            </button>
            <button
              onClick={() => onClose(app)}
              title={`Close ${app.name}`}
              className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center rounded-full bg-neutral-700 text-[10px] leading-none group-hover:grid"
            >
              ×
            </button>
            <span className={`mt-1 h-1 w-1 rounded-full ${active === app.url ? 'bg-white' : 'bg-white/40'}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AppWindow({ app, visible }: { app: App; visible: boolean }) {
  return (
    <div
      className={`fixed inset-x-3 top-3 bottom-20 z-40 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80 shadow-2xl backdrop-blur-xl transition-all duration-300 ${visible ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'}`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between px-4 text-xs text-white/60">
        <span>{app.name}</span>
        <a href={app.url} target="_blank" rel="noreferrer" className="hover:text-white">
          open in new tab ↗
        </a>
      </div>
      <iframe src={app.url} title={app.name} className="flex-1 border-0 bg-white" />
    </div>
  )
}
