import type { ReactNode } from 'react'
import { type Disk, type Machine, type Poll, type System, formatBytes } from './api'

export const glass =
  'rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'

const card = 'rounded-2xl border border-white/10 bg-white/[0.05] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <span className="text-[11px] font-semibold tracking-wider text-white/45 uppercase">{children}</span>
      {aside && <span className="text-[11px] text-white/40">{aside}</span>}
    </div>
  )
}

function Unavailable({ error, className }: { error?: string; className: string }) {
  return (
    <div className={`${card} ${className} grid place-items-center p-4 text-center`}>
      {error ? (
        <div>
          <div className="text-sm font-medium text-white/70">Unavailable</div>
          <div className="mt-1 line-clamp-3 text-[11px] break-all text-white/40">{error}</div>
        </div>
      ) : (
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
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
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${m.name === selected ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]' : 'text-white/65 hover:bg-white/[0.06] hover:text-white'}`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${m.online ? 'bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.8)]' : 'bg-rose-400/80'}`}
            />
            <span className="flex-1 truncate font-medium">{m.name}</span>
            {m.self && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">hub</span>}
            {!m.online && <span className="text-[10px] text-rose-300/70">offline</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Ring({ label, value, detail }: { label: string; value: number; detail: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="rgb(45 212 191)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.min(value, 100) / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-sm font-semibold">
          {Math.round(value)}%
        </span>
      </div>
      <div className="text-center">
        <div className="text-xs font-medium text-white/80">{label}</div>
        <div className="text-[11px] text-white/50">{detail}</div>
      </div>
    </div>
  )
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
          <div className="flex justify-around">
            <Ring label="CPU" value={system.cpuPercent} detail={`${system.cpus} threads`} />
            <Ring
              label="Memory"
              value={(100 * (system.memTotal - system.memAvailable)) / system.memTotal}
              detail={`${formatBytes(system.memTotal - system.memAvailable, true)} / ${formatBytes(system.memTotal, true)}`}
            />
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/10 pt-3 text-[11px]">
            <dt className="text-white/40">NixOS</dt>
            <dd className="truncate text-right text-white/75">{system.nixosVersion}</dd>
            <dt className="text-white/40">Kernel</dt>
            <dd className="truncate text-right text-white/75">{system.kernel}</dd>
            <dt className="text-white/40">Load</dt>
            <dd className="truncate text-right text-white/75">{system.load.map((l) => l.toFixed(2)).join('  ')}</dd>
            <dt className="text-white/40">Swap</dt>
            <dd className="truncate text-right text-white/75">
              {system.swapTotal > 0
                ? `${formatBytes(system.swapTotal - system.swapFree, true)} / ${formatBytes(system.swapTotal, true)}`
                : 'none'}
            </dd>
          </dl>
        </div>
      ) : (
        <Unavailable error={poll.error} className="h-48" />
      )}
    </div>
  )
}

function DriveRow({ disk }: { disk: Disk }) {
  const label = disk.serial || disk.id || disk.name
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.05]"
      title={`${disk.id}\n${disk.model}\n${disk.serial}\n/dev/${disk.name}`}
    >
      <div className="flex h-10 w-7 shrink-0 flex-col items-center justify-between rounded-md bg-neutral-900/90 px-1 py-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] ring-1 ring-white/10">
        <div className="flex w-full flex-col gap-0.5">
          <div className="h-px w-full bg-white/10" />
          <div className="h-px w-full bg-white/10" />
          <div className="h-px w-full bg-white/10" />
        </div>
        <span className="h-1.5 w-1.5 rounded-full bg-white/30" title="health unknown" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-white/85">{label}</div>
        <div className="truncate text-[11px] text-white/45">{disk.model}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs font-medium text-white/80">{formatBytes(disk.size)}</div>
        <div className="text-[10px] tracking-wide text-white/40 uppercase">
          {disk.transport || (disk.rotational ? 'hdd' : 'ssd')}
        </div>
      </div>
    </div>
  )
}

export function DrivesWidget({ poll }: { poll: Poll<Disk[]> }) {
  const disks = poll.data
  if (!disks) {
    return (
      <div>
        <SectionTitle>Drives</SectionTitle>
        <Unavailable error={poll.error} className="h-28" />
      </div>
    )
  }
  const total = disks.reduce((sum, d) => sum + d.size, 0)
  return (
    <div>
      <SectionTitle>Drives</SectionTitle>
      <div className={`${card} p-2 ${poll.error ? 'opacity-50' : ''}`} title={poll.error}>
        <div className="flex items-baseline justify-between px-2 pt-1 pb-2">
          <span className="text-2xl font-semibold tracking-tight">{formatBytes(total)}</span>
          <span className="text-[11px] text-white/45">
            {disks.length} {disks.length === 1 ? 'disk' : 'disks'} raw
          </span>
        </div>
        <div className="flex flex-col">
          {disks.map((d) => (
            <DriveRow key={d.name} disk={d} />
          ))}
        </div>
      </div>
    </div>
  )
}
