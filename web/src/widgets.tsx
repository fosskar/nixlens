import { type ReactNode, useId } from 'react'
import { type Machine, type Poll, type System, formatBytes } from './api'

export const glass = 'glass rounded-[28px]'

export const card = 'glass-card rounded-2xl'

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <span className="text-[11px] font-semibold tracking-[0.12em] text-fg-muted uppercase">{children}</span>
      {aside && <span className="font-mono text-[11px] text-fg-muted tabular-nums">{aside}</span>}
    </div>
  )
}

export function Unavailable({ error, className }: { error?: string; className: string }) {
  return (
    <div className={`${card} ${className} grid place-items-center p-4 text-center`}>
      {error ? (
        <div>
          <div className="text-sm font-medium text-error">Unavailable</div>
          <div className="mt-1 line-clamp-3 font-mono text-[11px] break-all text-fg-muted">{error}</div>
        </div>
      ) : (
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.08]" />
      )}
    </div>
  )
}

export function MachineSwitcher({
  machines,
  selected,
  onSelect,
}: {
  machines: Machine[]
  selected?: string
  onSelect: (name: string) => void
}) {
  return (
    <div>
      <SectionTitle aside={`${machines.filter((m) => m.online).length}/${machines.length} online`}>
        Machines
      </SectionTitle>
      <div className="flex flex-col gap-1">
        {machines.map((m) => (
          <button
            key={m.name}
            onClick={() => onSelect(m.name)}
            title={m.online ? m.name : `${m.name}: ${m.error || 'offline'}`}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${m.name === selected ? 'glass-accent text-fg-inverse' : 'border-transparent text-fg-muted hover:bg-white/[0.05] hover:text-fg-base'}`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${m.online ? 'bg-success shadow-[0_0_8px_var(--color-success)]' : 'bg-error shadow-[0_0_6px_var(--color-error)]'}`}
            />
            <span className="flex-1 truncate font-medium">{m.name}</span>
            {m.self && (
              <span className="rounded-md border border-accent-cyan/25 bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-cyan">
                hub
              </span>
            )}
            {!m.online && <span className="text-[10px] text-error/80">offline</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Ring({ label, value, detail }: { label: string; value: number; detail: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  const gradient = useId()
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div className="relative h-16 w-16">
        <svg
          viewBox="0 0 64 64"
          className="h-16 w-16 -rotate-90 drop-shadow-[0_0_6px_color-mix(in_srgb,var(--color-accent-cyan)_35%,transparent)]"
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-accent)" />
              <stop offset="100%" stopColor="var(--color-accent-cyan)" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.min(value, 100) / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-sm font-semibold text-fg-inverse tabular-nums">
          {Math.round(value)}%
        </span>
      </div>
      <div className="text-center">
        <div className="text-xs font-medium text-fg-base">{label}</div>
        <div className="text-[11px] whitespace-nowrap text-fg-muted tabular-nums">{detail}</div>
      </div>
    </div>
  )
}

function memoryDetail(system: System): string {
  const total = system.memInstalled || system.memTotal
  return `${formatBytes(system.memTotal - system.memAvailable, true)} / ${formatBytes(total, true)}`
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`
}

export function SystemWidget({ poll }: { poll: Poll<System> }) {
  const system = poll.data
  return (
    <div>
      <SectionTitle aside={system && `up ${formatUptime(system.uptimeSec)}`}>System</SectionTitle>
      {system ? (
        <div className={`${card} p-4 ${poll.error ? 'opacity-50' : ''}`} title={poll.error}>
          <div className="grid grid-cols-2 gap-3">
            <Ring label="CPU" value={system.cpuPercent} detail={`${system.cores} cores / ${system.cpus} threads`} />
            <Ring
              label="Memory"
              value={(100 * (system.memTotal - system.memAvailable)) / system.memTotal}
              detail={memoryDetail(system)}
            />
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-white/[0.07] pt-3 text-[11px]">
            <dt className="text-fg-muted">NixOS</dt>
            <dd className="truncate text-right font-mono text-fg-base tabular-nums">{system.nixosVersion}</dd>
            <dt className="text-fg-muted">Kernel</dt>
            <dd className="truncate text-right font-mono text-fg-base tabular-nums">{system.kernel}</dd>
            <dt className="text-fg-muted">Load</dt>
            <dd className="truncate text-right font-mono text-fg-base tabular-nums">
              {system.load.map((l) => l.toFixed(2)).join('  ')}
            </dd>
            <dt className="text-fg-muted">Swap</dt>
            <dd className="text-right font-mono text-fg-base tabular-nums">
              {system.swaps.length === 0
                ? 'none'
                : system.swaps.map((s) => (
                    <div key={s.device} className="truncate" title={s.device}>
                      <span className="text-fg-muted">{s.kind}</span> {formatBytes(s.used, true)} /{' '}
                      {formatBytes(s.size, true)}
                    </div>
                  ))}
            </dd>
          </dl>
        </div>
      ) : (
        <Unavailable error={poll.error} className="h-48" />
      )}
    </div>
  )
}
