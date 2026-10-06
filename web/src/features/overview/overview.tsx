import { card, Led, Ring, SectionTitle, Unavailable } from '@/components/ui'
import { PoolBays } from '@/features/overview/pool-bays'
import { type Disk, type Machine, type Poll, type Storage, type System } from '@/lib/api'
import { driveHealth, type Health, poolHealth } from '@/lib/health'
import { setPrefs, usePrefs } from '@/lib/prefs'
import { navigate } from '@/lib/router'
import { type Target, usedPercent } from '@/lib/storage'

export type MachineOverview = Machine & { system?: System; storage?: Storage }

type Problem = { health: Health; text: string; target?: Target }

const fullAt = 90
const gib = 1024 ** 3

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

// the last part of a go error is the cause ("connection refused"); the full
// text stays available on hover
function shortError(error?: string): string {
  if (!error) return 'unreachable'
  return error.split(': ').at(-1) ?? error
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  return d > 0 ? `${d}d` : `${Math.floor(sec / 3600)}h`
}

function MachineCard({ m }: { m: MachineOverview }) {
  const s = m.system
  const items = problems(m)
  const health = m.online ? (items.some((i) => i.health === 'error') ? 'error' : items.length ? 'warn' : 'ok') : 'error'

  // the whole card opens the machine; problem lines open their pool or drive
  // and sit above the card's button, since buttons cannot nest
  return (
    <div className={`${card} relative p-3.5 ${m.online ? '' : 'opacity-70'}`}>
      <button
        type="button"
        onClick={() => navigate({ kind: 'machine', machine: m.name })}
        aria-label={`Open ${m.name}`}
        className="absolute inset-0 rounded-card outline-accent-cyan transition hover:bg-fill focus-visible:outline-2"
      />
      <div className="pointer-events-none relative flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Led health={health} />
            <span className="truncate text-sm font-semibold text-fg-inverse">{m.name}</span>
            {m.self && <span className="text-2xs text-accent-cyan">hub</span>}
            <span className="ml-auto shrink-0 font-mono text-2xs text-fg-muted">
              {s ? `up ${uptime(s.uptimeSec)}` : 'offline'}
            </span>
          </div>
          {s && (
            <div className="mt-1 truncate pl-4 font-mono text-2xs text-fg-muted">
              NixOS {s.nixosVersion.split('.').slice(0, 2).join('.')} · Linux {s.kernel} · {s.cores}c/{s.cpus}t
            </div>
          )}
          {!m.online && (
            <div className="mt-1 truncate pl-4 text-2xs text-error/90" title={m.error}>
              {shortError(m.error)}
            </div>
          )}
        </div>

        {s && (
          <div className="grid grid-cols-2 gap-3">
            <Ring small label="CPU" value={s.cpuPercent} detail={`load ${s.load[0].toFixed(2)}`} />
            <Ring
              small
              label="Memory"
              value={(100 * (s.memTotal - s.memAvailable)) / s.memTotal}
              detail={`${Math.round((s.memTotal - s.memAvailable) / gib)} / ${Math.round((s.memInstalled || s.memTotal) / gib)} GiB`}
            />
          </div>
        )}

        {m.storage && (
          <div className="pointer-events-auto">
            <PoolBays storage={m.storage} onOpen={(t) => navigate({ kind: t.kind, machine: m.name, name: t.name })} />
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
                className="flex items-center gap-2 rounded-control px-1.5 py-1 text-left text-2xs text-fg-base outline-accent-cyan transition hover:bg-fill-hover focus-visible:outline-2"
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
  const { machinesOpen: open } = usePrefs()
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

  const count = `${machines.length} ${machines.length === 1 ? 'machine' : 'machines'}`
  // on phones the sidebar sits above the apps, so its cards stay folded into
  // the summary until opened
  return (
    <div className={poll.error ? 'opacity-50' : ''} title={poll.error}>
      <button
        type="button"
        onClick={() => setPrefs({ machinesOpen: !open })}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 px-1 text-fg-muted transition-colors hover:text-fg-base md:hidden"
      >
        <span className="flex items-center gap-2 text-2xs font-semibold tracking-[0.12em] uppercase">
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 shrink-0 self-center fill-none stroke-current transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          {count}
        </span>
        <span className="font-mono text-2xs tabular-nums">{summary}</span>
      </button>
      <div className="hidden md:block">
        <SectionTitle aside={summary}>{count}</SectionTitle>
      </div>
      <div className={`flex-col gap-2.5 md:mt-0 md:flex ${open ? 'mt-3 flex' : 'hidden'}`}>
        {machines.map((m) => (
          <MachineCard key={m.name} m={m} />
        ))}
      </div>
    </div>
  )
}
