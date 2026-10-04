import { AppIcon } from '@/features/apps/icon'
import { type App } from '@/lib/api'

export function Dock({
  open,
  closing,
  active,
  onHome,
  onSelect,
  onClose,
}: {
  open: App[]
  closing: string[]
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
          // a closing app stays until its window has shrunk into the icon,
          // which fades with it, so the dock does not jump mid-animation
          <div
            key={app.url}
            data-dock={app.url}
            inert={closing.includes(app.url)}
            className={`group relative transition-[opacity,scale] duration-300 ${closing.includes(app.url) ? 'scale-50 opacity-0' : ''}`}
          >
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
