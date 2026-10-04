import type { Disk, Machine, Poll, Pool, Storage, System } from './api'
import { type Health, driveHealth, formatCapacity, poolHealth } from './health'
import { navigate } from './router'
import { Led, type Target } from './storage'
import { SectionTitle, Unavailable, card } from './widgets'

export type MachineOverview = Machine & { system?: System; storage?: Storage }

type Problem = { health: Health; text: string; target?: Target }

const fullAt = 90

function usedPercent(pool: Pool): number {
  return pool.usable > 0 ? (100 * pool.used) / pool.usable : 0
}

function driveProblem(disk: Disk): string {
  const s = disk.smart
  if (s?.passed === false) return 'SMART failed'
  const parts = [
    s?.reallocated && `${s.reallocated} reallocated sectors`,
    s?.pending && `${s.pending} pending sectors`,
    s?.uncorrectable && `${s.uncorrectable} uncorrectable`,
    s?.criticalWarning && 'critical warning',
    s?.mediaErrors && `${s.mediaErrors} media errors`,
    s && s.percentageUsed >= 90 && `${s.percentageUsed} % worn`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'errors in its pool'
}

// what needs a look on one machine, worst first
function problems(m: MachineOverview): Problem[] {
  const pools = m.storage?.pools ?? []
  const items: Problem[] = []
  for (const pool of pools) {
    const health = poolHealth(pool)
    if (health === 'warn' || health === 'error') {
      items.push({
        health,
        text: `${pool.name} is ${pool.state.toLowerCase()}`,
        target: { kind: 'pool', name: pool.name },
      })
    } else if (pool.state !== 'unmounted' && usedPercent(pool) >= fullAt) {
      items.push({
        health: 'warn',
        text: `${pool.name} is ${Math.round(usedPercent(pool))} % full`,
        target: { kind: 'pool', name: pool.name },
      })
    }
  }
  for (const disk of m.storage?.disks ?? []) {
    const health = driveHealth(disk, pools)
    if (health === 'warn' || health === 'error') {
      items.push({
        health,
        text: `${disk.serial || disk.name}: ${driveProblem(disk)}`,
        target: { kind: 'disk', name: disk.name },
      })
    }
  }
  return items.sort((a, b) => (a.health === b.health ? 0 : a.health === 'error' ? -1 : 1))
}

function Bar({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${Math.round(percent)} %`}>
      <span className="w-8 text-[10px] text-fg-muted">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={`h-full rounded-full ${percent >= fullAt ? 'bg-warning' : 'bg-gradient-to-r from-accent to-accent-cyan'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  )
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  return d > 0 ? `${d}d` : `${Math.floor(sec / 3600)}h`
}

function MachineCard({ m }: { m: MachineOverview }) {
  const s = m.system
  const pools = (m.storage?.pools ?? []).filter((p) => p.state !== 'unmounted')
  const disks = m.storage?.disks ?? []
  const usable = pools.reduce((sum, p) => sum + p.usable, 0)
  const used = pools.reduce((sum, p) => sum + p.used, 0)
  const items = problems(m)

  // the whole card opens the machine; problem lines open their pool or drive
  // and sit above the card's button, since buttons cannot nest
  return (
    <div className={`${card} relative p-3.5 ${m.online ? '' : 'opacity-70'}`}>
      <button
        type="button"
        onClick={() => navigate({ kind: 'machine', machine: m.name })}
        aria-label={`Open ${m.name}`}
        className="absolute inset-0 rounded-2xl outline-accent-cyan transition hover:bg-white/[0.04] focus-visible:outline-2"
      />
      <div className="pointer-events-none relative flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Led
            health={
              m.online ? (items.some((i) => i.health === 'error') ? 'error' : items.length ? 'warn' : 'ok') : 'error'
            }
          />
          <span className="truncate text-sm font-semibold text-fg-inverse">{m.name}</span>
          {m.self && <span className="text-[10px] text-accent-cyan">hub</span>}
          <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">
            {s ? `up ${uptime(s.uptimeSec)}` : 'offline'}
          </span>
        </div>

        {!m.online && <div className="truncate text-[11px] text-error/90">{m.error || 'unreachable'}</div>}

        {s && (
          <div className="grid grid-cols-2 gap-x-3">
            <Bar label="CPU" percent={s.cpuPercent} />
            <Bar label="RAM" percent={(100 * (s.memTotal - s.memAvailable)) / s.memTotal} />
          </div>
        )}

        {usable > 0 && (
          <div>
            <Bar label="Disk" percent={(100 * used) / usable} />
            <div className="mt-1.5 flex items-center gap-1 pl-[2.375rem]">
              {disks.map((d) => (
                <span key={d.name} title={`${d.serial || d.name}`}>
                  <Led health={driveHealth(d, m.storage?.pools ?? [])} asleep={d.smart?.standby} small />
                </span>
              ))}
              <span className="ml-auto font-mono text-[10px] text-fg-muted tabular-nums">
                {formatCapacity(used)} / {formatCapacity(usable)}
              </span>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="pointer-events-auto -mx-1.5 flex flex-col">
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  item.target && navigate({ kind: item.target.kind, machine: m.name, name: item.target.name })
                }
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[11px] text-fg-base outline-accent-cyan transition hover:bg-white/[0.08] focus-visible:outline-2"
              >
                <Led health={item.health} small />
                <span className="min-w-0 flex-1 truncate">{item.text}</span>
                <span className="text-fg-muted">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function OverviewWidget({ poll }: { poll: Poll<MachineOverview[]> }) {
  const machines = poll.data
  if (!machines) return <Unavailable error={poll.error} className="h-48" />

  const offline = machines.filter((m) => !m.online).length
  const attention = machines.filter((m) => m.online && problems(m).length > 0).length
  const summary =
    offline + attention === 0
      ? 'all healthy'
      : [offline && `${offline} offline`, attention && `${attention} need${attention === 1 ? 's' : ''} attention`]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className={poll.error ? 'opacity-50' : ''} title={poll.error}>
      <SectionTitle aside={summary}>
        {machines.length} {machines.length === 1 ? 'machine' : 'machines'}
      </SectionTitle>
      <div className="flex flex-col gap-2.5">
        {machines.map((m) => (
          <MachineCard key={m.name} m={m} />
        ))}
      </div>
    </div>
  )
}
