import { type ReactNode, createContext, use, useEffect, useEffectEvent, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  type Dataset,
  type Disk,
  type Partition,
  type Pool,
  type PoolDetail,
  type PoolGroup,
  type PoolMember,
  type Storage,
  formatBytes,
  usePoll,
  type Smart,
} from './api'
import {
  type Health,
  driveHealth,
  formatCapacity,
  memberHealth,
  poolBays,
  poolHealth,
  redundant,
  resilvering,
  smartHealth,
  stateHealth,
  worst,
} from './health'
import { ScrollArea } from './scroll'
import { SectionTitle, card } from './widgets'

const pillStyles: Record<Health, string> = {
  ok: 'border-success/30 bg-success/10 text-success',
  warn: 'border-warning/35 bg-warning/10 text-warning',
  error: 'border-error/35 bg-error/10 text-error',
  unknown: 'border-white/10 bg-white/[0.04] text-fg-muted',
}

const textStyles: Record<Health, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-error',
  unknown: 'text-fg-muted',
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function timeAgo(unix: number): string {
  const sec = unix - Date.now() / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(sec) >= size) return relativeTime.format(Math.round(sec / size), unit)
  }
  return 'just now'
}

function shortAgo(unix: number): string {
  const sec = Date.now() / 1000 - unix
  const steps: [string, number][] = [
    ['y', 31536000],
    ['mo', 2592000],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ]
  for (const [unit, size] of steps) {
    if (sec >= size) return `${Math.floor(sec / size)}${unit} ago`
  }
  return 'just now'
}

function scanLine(pool: Pool): { text: string; health: Health } | null {
  const scan = pool.scan
  if (!scan) return pool.kind === 'zfs' ? { text: 'never scrubbed', health: 'unknown' } : null
  const resilver = scan.function === 'RESILVER'
  if (scan.state === 'SCANNING') return { text: resilver ? 'resilvering…' : 'scrubbing…', health: 'warn' }
  const errors = `${scan.errors} ${scan.errors === 1 ? 'error' : 'errors'}`
  const health: Health = scan.errors > 0 ? 'error' : 'unknown'
  if (scan.state === 'CANCELED')
    return { text: `${resilver ? 'resilver' : 'scrub'} canceled ${timeAgo(scan.end)} · ${errors}`, health }
  return { text: `${resilver ? 'resilvered' : 'scrubbed'} ${timeAgo(scan.end)} · ${errors}`, health }
}

function formatUsage(used: number, total: number): string {
  const [usedValue, usedUnit] = formatCapacity(used).split(' ')
  const [totalValue, totalUnit] = formatCapacity(total).split(' ')
  return usedUnit === totalUnit
    ? `${usedValue} / ${totalValue} ${totalUnit}`
    : `${usedValue} ${usedUnit} / ${totalValue} ${totalUnit}`
}

function formatRecordsize(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return value
  return n >= 1048576 ? `${n / 1048576}M` : `${n / 1024}K`
}

function usedPercent(pool: Pool): number {
  return pool.usable > 0 ? (100 * pool.used) / pool.usable : 0
}

function poolType(pool: Pool): string {
  if (!redundant(pool)) return pool.kind
  const layouts = new Set(
    pool.groups
      .filter((g) => g.class === 'data' || g.class === '')
      .map((g) => g.layout)
      .filter((l) => l !== '' && l !== 'single'),
  )
  return layouts.size > 0 ? `${pool.kind} · ${[...layouts].join(' + ')}` : pool.kind
}

function trailingNumber(name: string): string | undefined {
  return /(\d+)$/.exec(name)?.[1]
}

function memberPartition(member: PoolMember, pool: Pool, disk?: Disk): string {
  const base = member.path.split('/').pop() || member.device
  const candidates = (disk?.partitions ?? []).filter((p) => p.pool === pool.name)
  if (candidates.length === 1) return candidates[0].name
  const number = /-part(\d+)$/.exec(member.path)?.[1]
  return candidates.find((p) => number && trailingNumber(p.name) === number)?.name ?? base
}

function driveTitle(disk: Disk): string {
  return [
    disk.model,
    `/dev/${disk.name}`,
    formatBytes(disk.size),
    ...(disk.partitions ?? []).filter((p) => p.pool).map((p) => `${p.name} → ${p.pool}${p.role ? ` · ${p.role}` : ''}`),
  ]
    .filter(Boolean)
    .join('\n')
}

export function Led({ health, small, asleep }: { health: Health; small?: boolean; asleep?: boolean }) {
  return (
    <span
      title={asleep ? 'asleep' : undefined}
      className={`nos-led nos-led-${health} ${small ? 'h-1.5 w-1.5' : ''} ${asleep ? 'nos-led-asleep' : ''}`}
    />
  )
}

function TypeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-px text-[10px] font-medium tracking-wide whitespace-nowrap text-fg-muted">
      {children}
    </span>
  )
}

function HealthPill({ pool }: { pool: Pool }) {
  const health = poolHealth(pool)
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${pillStyles[health]}`}
    >
      <Led health={health} small />
      {resilvering(pool) ? 'resilvering' : pool.state || 'unknown'}
    </span>
  )
}

function UsageBar({ percent, className }: { percent: number; className: string }) {
  const fill =
    percent >= 90
      ? 'from-error/80 to-error'
      : percent >= 80
        ? 'from-warning/80 to-warning'
        : 'from-accent to-accent-cyan'
  return (
    <div
      className={`overflow-hidden rounded-full bg-white/[0.07] shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] ${className}`}
    >
      <div
        className={`h-full rounded-full bg-gradient-to-r ${fill} shadow-[0_0_8px_color-mix(in_srgb,var(--color-accent-cyan)_40%,transparent)] transition-[width] duration-700 motion-reduce:transition-none`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  )
}

type DriveKind = 'hdd' | 'ssd' | 'nvme'

function driveKind(disk: Disk): DriveKind {
  if (disk.transport === 'nvme') return 'nvme'
  return disk.rotational ? 'hdd' : 'ssd'
}

const glyphSizes = {
  lg: { hdd: 'h-14 w-9', ssd: 'h-11 w-9', nvme: 'h-14 w-[1.375rem]', pad: 'px-1.5 py-2', frame: 'h-14' },
  sm: { hdd: 'h-10 w-6', ssd: 'h-8 w-6', nvme: 'h-10 w-4', pad: 'px-1 py-1.5', frame: 'h-10' },
}

// 3.5" bay with a grille for hdds, a shorter 2.5" body with a label for
// sata ssds, an m.2 stick with chips and a gold edge connector for nvme
function DriveGlyph({
  disk,
  health,
  lit,
  size = 'lg',
}: {
  disk: Disk
  health: Health
  lit?: boolean
  size?: 'lg' | 'sm'
}) {
  const kind = driveKind(disk)
  const s = glyphSizes[size]
  const ring = lit
    ? 'ring-accent-cyan/60 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_12px_-2px_color-mix(in_srgb,var(--color-accent-cyan)_55%,transparent)]'
    : 'ring-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'
  const led = <Led health={health} asleep={disk.smart?.standby} small={size === 'sm'} />
  const body = `flex shrink-0 flex-col items-center bg-bg-elevated/90 ring-1 transition-[box-shadow] duration-200 motion-reduce:transition-none ${ring}`
  return (
    <span className={`flex items-end justify-center ${s.frame}`}>
      {kind === 'hdd' && (
        <span className={`${body} ${s.hdd} ${s.pad} justify-between rounded-md`}>
          <span className="flex w-full flex-col gap-0.5">
            <span className="h-px w-full bg-white/10" />
            <span className="h-px w-full bg-white/10" />
            <span className="h-px w-full bg-white/10" />
          </span>
          {led}
        </span>
      )}
      {kind === 'ssd' && (
        <span className={`${body} ${s.ssd} ${s.pad} justify-between rounded-md`}>
          <span className="h-[30%] w-full rounded-[3px] bg-white/[0.07] ring-1 ring-white/[0.05]" />
          {led}
        </span>
      )}
      {kind === 'nvme' && (
        <span className={`${body} ${s.nvme} justify-between rounded-[4px] pt-1.5`}>
          {led}
          <span className="flex w-full flex-col items-center gap-1">
            <span className="h-[18%] w-[70%] min-h-1.5 rounded-[2px] bg-black/55 ring-1 ring-white/[0.08]" />
            <span className="h-[18%] w-[70%] min-h-1.5 rounded-[2px] bg-black/55 ring-1 ring-white/[0.08]" />
          </span>
          <span className="nos-nvme-pins h-1.5 w-full rounded-b-[4px]" />
        </span>
      )}
    </span>
  )
}

function DriveSlot({ disk, health, lit }: { disk: Disk; health: Health; lit?: boolean }) {
  const label = disk.serial || disk.name
  const half = Math.ceil(label.length / 2)
  const lines = label.length > 10 ? [label.slice(0, half), label.slice(half)] : [label]
  const kind = driveKind(disk)
  return (
    <div className="flex w-[4.25rem] flex-col items-center gap-1.5">
      <DriveGlyph disk={disk} health={health} lit={lit} />
      <div className="w-full text-center leading-tight">
        {lines.map((line, i) => (
          <div key={i} className="truncate font-mono text-[9px] text-fg-base">
            {line}
          </div>
        ))}
        <div className="text-[8px] tracking-wider text-fg-dim uppercase">{kind}</div>
      </div>
    </div>
  )
}

export type Target = { kind: 'pool' | 'disk'; name: string }

const linkTransition = 'transition-[opacity,background-color,border-color] duration-200 motion-reduce:transition-none'

function PoolRow({ pool, onOpen }: { pool: Pool; onOpen: () => void }) {
  const mounted = redundant(pool) || pool.state === 'mounted'
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`glass-card w-full rounded-xl px-3 py-2.5 text-left outline-accent-cyan hover:bg-white/[0.07] focus-visible:outline-2 ${linkTransition}`}
    >
      <div className="flex items-center gap-2">
        <Led health={poolHealth(pool)} />
        <span className="min-w-0 truncate font-mono text-[13px] font-semibold text-fg-inverse">{pool.name}</span>
        <span className="ml-auto">
          <TypeBadge>{poolType(pool)}</TypeBadge>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {mounted ? <UsageBar percent={usedPercent(pool)} className="h-1 flex-1" /> : <span className="flex-1" />}
        <span className="shrink-0 text-right font-mono text-[11px] text-fg-muted tabular-nums">
          {mounted ? formatUsage(pool.used, pool.usable) : 'not mounted'}
        </span>
      </div>
    </button>
  )
}

// the open popup's title element, which names the dialog
const ModalTitleId = createContext<string | undefined>(undefined)

export function Modal({
  focusKey,
  onBack,
  onClose,
  children,
}: {
  focusKey: string
  onBack?: () => void
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')]
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    if (e.shiftKey && (current === first || current === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (current === last || !panel.current.contains(current))) {
      e.preventDefault()
      first.focus()
    }
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  useEffect(() => {
    panel.current?.focus()
    panel.current?.querySelector('.nos-scroll')?.scrollTo({ top: 0 })
  }, [focusKey])

  return createPortal(
    <div
      className="nos-modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/55 px-4 pt-[calc(1rem+var(--safe-top))] pb-[calc(1rem+var(--safe-bottom))] backdrop-blur-[6px] md:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="nos-modal glass-strong flex max-h-[calc(100dvh-4rem-var(--safe-top)-var(--safe-bottom))] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] font-sans text-fg-base outline-none"
      >
        {onBack && (
          <nav className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-3 py-2 text-[11px]">
            <button
              type="button"
              onClick={onBack}
              title="Back (Alt+←)"
              className="mr-1 flex items-center gap-1 rounded-lg px-2 py-1 text-fg-muted transition outline-accent-cyan hover:bg-white/[0.08] hover:text-fg-inverse focus-visible:outline-2"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 fill-none stroke-current"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
              Back
            </button>
          </nav>
        )}
        <div key={focusKey} className="flex min-h-0 flex-col">
          <ModalTitleId value={titleId}>{children}</ModalTitleId>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// the element that names the open popup
export function ModalTitle({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span id={use(ModalTitleId)} className={className}>
      {children}
    </span>
  )
}

export function ModalHeader({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] bg-white/[0.03] py-3.5 pr-3 pl-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-muted transition outline-accent-cyan hover:bg-white/[0.08] hover:text-fg-inverse focus-visible:outline-2"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}

export function ModalBody({ children }: { children: ReactNode }) {
  return (
    <ScrollArea>
      <div className="flex flex-col gap-6 p-5">{children}</div>
    </ScrollArea>
  )
}

function SmartFacts({ smart, nvme }: { smart: Smart; nvme: boolean }) {
  const health = smartHealth(smart)
  const days = Math.floor(smart.powerOnHours / 24)
  const rows: [string, ReactNode][] =
    smart.passed === null
      ? []
      : [
          [
            'Status',
            <span
              key="status"
              className={health === 'ok' ? 'text-success' : health === 'warn' ? 'text-warning' : 'text-error'}
            >
              {smart.passed ? 'passed' : 'failed'}
            </span>,
          ],
          ['Temperature', `${smart.temperature} °C`],
          ['Power on', `${smart.powerOnHours.toLocaleString()} h · ${days.toLocaleString()} days`],
          ...((nvme
            ? [
                ['Wear', `${smart.percentageUsed} %`],
                ['Critical warning', smart.criticalWarning === 0 ? 'none' : `0x${smart.criticalWarning.toString(16)}`],
                ['Media errors', String(smart.mediaErrors)],
              ]
            : [
                ['Reallocated sectors', String(smart.reallocated)],
                ['Pending sectors', String(smart.pending)],
                ['Uncorrectable', String(smart.uncorrectable)],
              ]) as [string, ReactNode][]),
        ]
  return (
    <section>
      <SectionTitle
        aside={smart.standby ? 'asleep · not woken' : smart.updated > 0 ? `read ${timeAgo(smart.updated)}` : undefined}
      >
        SMART
      </SectionTitle>
      {rows.length > 0 ? (
        <Facts rows={rows} />
      ) : (
        <div className={`${card} p-4 text-[12px] text-fg-muted`}>
          The drive has been asleep since collection started; it is not woken up for SMART.
        </div>
      )}
    </section>
  )
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={`${card} grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-[12px]`}>
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-fg-muted">{term}</dt>
          <dd className="min-w-0 truncate text-right font-mono text-fg-base">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function UsageSummary({ pool }: { pool: Pool }) {
  const scan = scanLine(pool)
  const percent = usedPercent(pool)
  if (!redundant(pool) && pool.state !== 'mounted') {
    return <div className={`${card} p-4 text-[12px] text-fg-muted`}>Not mounted; usage unavailable.</div>
  }
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-baseline justify-between text-[12px] tabular-nums">
        <span className="text-fg-muted">
          <span className="font-medium text-fg-inverse">{formatCapacity(pool.used)}</span> used of{' '}
          <span className="font-medium text-fg-inverse">{formatCapacity(pool.usable)}</span>
        </span>
        <span className="font-mono text-fg-muted">{Math.round(percent)}%</span>
      </div>
      <UsageBar percent={percent} className="mt-2 h-2" />
      <div className="mt-2 flex justify-between gap-3 text-[11px] text-fg-muted tabular-nums">
        {scan && <span className={textStyles[scan.health]}>{scan.text}</span>}
        <span className="ml-auto">{formatCapacity(pool.available)} free</span>
      </div>
    </div>
  )
}

function MemberRow({
  member,
  pool,
  disk,
  showState,
  onOpenDisk,
}: {
  member: PoolMember
  pool: Pool
  disk?: Disk
  showState: boolean
  onOpenDisk: (name: string) => void
}) {
  const health = memberHealth(member, pool)
  const content = (
    <>
      {showState && <Led health={health} />}
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12px] text-fg-inverse">
          {disk?.serial || member.device || 'missing'}
        </span>
        <span className="block truncate text-[10px] text-fg-muted">{disk?.model || member.path}</span>
      </span>
      <span className="font-mono text-[11px] text-fg-muted">{memberPartition(member, pool, disk)}</span>
      {showState && (
        <span className="text-right text-[11px] tabular-nums">
          <span className={textStyles[health]}>{member.device === '' ? 'missing' : member.state || 'unknown'}</span>
          <span className={`block text-[10px] ${member.errors > 0 ? 'text-warning' : 'text-fg-dim'}`}>
            {member.errors} {member.errors === 1 ? 'error' : 'errors'}
          </span>
        </span>
      )}
    </>
  )
  const layout = `relative grid w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left ${showState ? 'grid-cols-[auto_1fr_auto_5.5rem] before:absolute before:top-1/2 before:-left-3 before:h-px before:w-2.5 before:bg-white/10' : 'grid-cols-[1fr_auto]'}`
  if (!disk) return <div className={layout}>{content}</div>
  return (
    <button
      type="button"
      onClick={() => onOpenDisk(disk.name)}
      title={`Show drive ${disk.serial || disk.name}`}
      className={`${layout} outline-accent-cyan transition-colors hover:bg-white/[0.05] focus-visible:outline-2`}
    >
      {content}
    </button>
  )
}

function groupTitle(group: PoolGroup): string {
  return `${group.name} · ${group.class || 'data'}`
}

function VdevTree({ pool, disks, onOpenDisk }: { pool: Pool; disks: Disk[]; onOpenDisk: (name: string) => void }) {
  const groups = pool.groups ?? []
  return (
    <section>
      <SectionTitle aside={`${groups.length} ${groups.length === 1 ? 'vdev' : 'vdevs'}`}>Layout</SectionTitle>
      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const health = stateHealth(group.state)
          return (
            <div key={group.name} className={`${card} p-3`}>
              <div className="flex items-center gap-2 px-1 text-[12px]">
                <span className="font-mono font-semibold text-fg-inverse">{groupTitle(group)}</span>
                <span className="text-[11px] text-fg-dim">
                  {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
                </span>
                <span className={`ml-auto text-[10px] font-semibold tracking-wide uppercase ${textStyles[health]}`}>
                  {group.state}
                </span>
              </div>
              <div className="mt-2 ml-2.5 flex flex-col border-l border-white/10 pl-3">
                {group.members.map((member, i) => (
                  <MemberRow
                    key={member.device || member.path || i}
                    member={member}
                    pool={pool}
                    disk={disks.find((d) => d.name === member.device)}
                    showState
                    onOpenDisk={onOpenDisk}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Chip({ name, value }: { name: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      <span className="text-fg-muted">{name}</span>
      <span className="font-mono text-fg-inverse">{value}</span>
    </span>
  )
}

function datasetDepth(dataset: Dataset, pool: string): number {
  return dataset.name === pool ? 0 : dataset.name.split('/').length - 1
}

function DatasetRow({ dataset, pool }: { dataset: Dataset; pool: string }) {
  const depth = datasetDepth(dataset, pool)
  const name = depth === 0 ? pool : dataset.name.split('/').pop()
  const limits = [
    dataset.quota > 0 && `quota ${formatCapacity(dataset.quota)}`,
    dataset.reservation > 0 && `reservation ${formatCapacity(dataset.reservation)}`,
  ].filter(Boolean)
  const mount = dataset.mountpoint === 'legacy' || dataset.mountpoint === 'none' || dataset.mountpoint === '-'
  return (
    <tr className="transition-colors hover:bg-white/[0.03]">
      <td className="py-2 pr-3 pl-4" title={dataset.name}>
        <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 0.75}rem` }}>
          <span className={`font-mono ${depth === 0 ? 'font-semibold text-fg-inverse' : 'text-fg-base'}`}>{name}</span>
          {dataset.type === 'volume' && <TypeBadge>volume</TypeBadge>}
        </div>
        {limits.length > 0 && (
          <div className="mt-0.5 text-[10px] text-accent-cyan/80" style={{ paddingLeft: `${depth * 0.75}rem` }}>
            {limits.join(' · ')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-fg-inverse">
        {formatCapacity(dataset.used)}
      </td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatCapacity(dataset.available)}</td>
      <td className="px-3 py-2 text-right font-mono">{dataset.compressRatio}x</td>
      <td className={`max-w-40 truncate px-3 py-2 font-mono ${mount ? 'text-fg-dim' : ''}`} title={dataset.mountpoint}>
        {dataset.mountpoint}
      </td>
      <td
        className="py-2 pr-4 pl-3 text-right whitespace-nowrap"
        title={dataset.snapshots > 0 ? `snapshots use ${formatCapacity(dataset.snapshotsUsed)}` : undefined}
      >
        {dataset.snapshots > 0 ? (
          <>
            <span className="font-mono text-fg-inverse">{dataset.snapshots}</span>
            {dataset.lastSnapshot > 0 && (
              <span className="text-fg-muted"> · latest {shortAgo(dataset.lastSnapshot)}</span>
            )}
          </>
        ) : (
          <span className="text-fg-dim">none</span>
        )}
      </td>
    </tr>
  )
}

function ZfsDetail({ machine, pool }: { machine: string; pool: Pool }) {
  const detail = usePoll<PoolDetail>(
    `/api/machines/${encodeURIComponent(machine)}/pool/${encodeURIComponent(pool.name)}`,
    60000,
  )
  if (!detail.data) {
    return (
      <section>
        <SectionTitle>Properties</SectionTitle>
        {detail.error ? (
          <div className={`${card} p-4 text-[12px]`}>
            <div className="font-medium text-error">Pool details unavailable</div>
            <div className="mt-1 font-mono text-[11px] break-all text-fg-muted">{detail.error}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {[16, 20, 14, 18, 12, 22].map((w, i) => (
                <div
                  key={i}
                  className="h-6 animate-pulse rounded-lg bg-white/[0.06]"
                  style={{ width: `${w * 0.25}rem` }}
                />
              ))}
            </div>
            <div className={`${card} h-32 animate-pulse`} />
          </div>
        )}
      </section>
    )
  }
  const p = detail.data.properties
  const percent = (v: string) => (/^\d+(\.\d+)?$/.test(v) ? `${v}%` : v)
  const chips: [string, string][] = [
    ['compression', p.compression],
    ['recordsize', formatRecordsize(p.recordsize)],
    ['ashift', p.ashift],
    ['encryption', p.encryption],
    ['atime', p.atime],
    ['autotrim', p.autotrim],
    ['fragmentation', percent(p.fragmentation)],
    ['dedup', `${p.dedupratio}x`],
  ]
  const datasets = detail.data.datasets ?? []
  return (
    <>
      <section>
        <SectionTitle>Properties</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {chips
            .filter(([, value]) => value !== '')
            .map(([name, value]) => (
              <Chip key={name} name={name} value={value} />
            ))}
        </div>
      </section>
      <section>
        <SectionTitle aside={`${datasets.length} ${datasets.length === 1 ? 'dataset' : 'datasets'}`}>
          Datasets
        </SectionTitle>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[12px] text-fg-base tabular-nums">
            <thead>
              <tr className="border-b border-white/[0.07] text-[10px] tracking-[0.08em] text-fg-muted uppercase">
                <th className="py-2 pr-3 pl-4 text-left font-semibold">Dataset</th>
                <th className="px-3 py-2 text-right font-semibold">Used</th>
                <th className="px-3 py-2 text-right font-semibold">Avail</th>
                <th className="px-3 py-2 text-right font-semibold">Ratio</th>
                <th className="px-3 py-2 text-left font-semibold">Mount</th>
                <th className="py-2 pr-4 pl-3 text-right font-semibold">Snapshots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {datasets.map((d) => (
                <DatasetRow key={d.name} dataset={d} pool={pool.name} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// everything about one pool, as a block of the machine view
export function PoolDetail({
  pool,
  disks,
  machine,
  onOpenDisk,
}: {
  pool: Pool
  disks: Disk[]
  machine: string
  onOpenDisk: (name: string) => void
}) {
  const members = pool.groups.flatMap((g) => g.members)
  return (
    <>
      <div className="flex items-center gap-3">
        <h3 className="truncate font-mono text-base font-semibold text-fg-inverse">{pool.name}</h3>
        <TypeBadge>{poolType(pool)}</TypeBadge>
        <span className="ml-auto">
          <HealthPill pool={pool} />
        </span>
      </div>
      <UsageSummary pool={pool} />
      {redundant(pool) ? (
        <VdevTree pool={pool} disks={disks} onOpenDisk={onOpenDisk} />
      ) : (
        <>
          <Facts
            rows={[
              ['Type', pool.kind],
              ['Mount point', pool.mount || 'not mounted'],
              ['Size', formatCapacity(pool.raw || pool.usable)],
            ]}
          />
          <section>
            <SectionTitle>Lives on</SectionTitle>
            <div className={`${card} p-2`}>
              {members.map((member, i) => (
                <MemberRow
                  key={member.path || i}
                  member={member}
                  pool={pool}
                  disk={disks.find((d) => d.name === member.device)}
                  showState={false}
                  onOpenDisk={onOpenDisk}
                />
              ))}
            </div>
          </section>
        </>
      )}
      {pool.kind === 'zfs' && <ZfsDetail machine={machine} pool={pool} />}
    </>
  )
}

function partitionHealth(partition: Partition, disk: Disk, pools: Pool[]): Health | undefined {
  const pool = pools.find((p) => p.name === partition.pool && redundant(p))
  const members = pool?.groups.flatMap((g) => g.members).filter((m) => m.device === disk.name) ?? []
  return pool && members.length > 0 ? worst(members.map((m) => memberHealth(m, pool))) : undefined
}

// everything about one drive, as a block of the machine view
export function DriveDetail({
  disk,
  pools,
  onOpenPool,
}: {
  disk: Disk
  pools: Pool[]
  onOpenPool: (name: string) => void
}) {
  const partitions = disk.partitions ?? []
  const memberships = partitions
    .filter((p) => p.pool && pools.some((pool) => pool.name === p.pool))
    .filter((p, i, all) => all.findIndex((q) => q.pool === p.pool) === i)
  return (
    <>
      <div className="flex items-center gap-3">
        <DriveGlyph disk={disk} health={driveHealth(disk, pools)} size="sm" />
        <span className="min-w-0">
          <h3 className="truncate text-base font-semibold text-fg-inverse">{disk.model || disk.name}</h3>
          <span className="block truncate font-mono text-[11px] text-fg-muted">{disk.serial}</span>
          {memberships.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {memberships.map((m) => (
                <button
                  key={m.pool}
                  type="button"
                  onClick={() => onOpenPool(m.pool)}
                  className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-fg-inverse transition outline-accent-cyan hover:bg-accent/20 focus-visible:outline-2"
                >
                  {m.pool}
                  <span className="text-fg-muted">· {m.role}</span>
                  <span className="text-accent-cyan">→</span>
                </button>
              ))}
            </span>
          )}
        </span>
        <span className="ml-auto">
          <TypeBadge>
            {formatBytes(disk.size)} · {driveKind(disk).toUpperCase()}
          </TypeBadge>
        </span>
      </div>
      <Facts
        rows={[
          ['Device', `/dev/${disk.name}`],
          ['By ID', disk.id ? `/dev/disk/by-id/${disk.id}` : '—'],
          ['Transport', disk.transport || '—'],
        ]}
      />
      {disk.smart && <SmartFacts smart={disk.smart} nvme={disk.transport === 'nvme'} />}
      <section>
        <SectionTitle aside={`${partitions.length} ${partitions.length === 1 ? 'partition' : 'partitions'}`}>
          Partitions
        </SectionTitle>
        {partitions.length === 0 ? (
          <div className={`${card} p-4 text-[12px] text-fg-muted`}>No partitions; the drive is unused.</div>
        ) : (
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-[12px] text-fg-base tabular-nums">
              <thead>
                <tr className="border-b border-white/[0.07] text-[10px] tracking-[0.08em] text-fg-muted uppercase">
                  <th className="py-2 pr-3 pl-4 text-left font-semibold">Partition</th>
                  <th className="px-3 py-2 text-right font-semibold">Size</th>
                  <th className="px-3 py-2 text-left font-semibold">Filesystem</th>
                  <th className="px-3 py-2 text-left font-semibold">Mount</th>
                  <th className="py-2 pr-4 pl-3 text-left font-semibold">Used by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {partitions.map((partition) => {
                  const target = pools.find((p) => p.name === partition.pool)
                  const health = partitionHealth(partition, disk, pools)
                  return (
                    <tr key={partition.name} className={partition.pool ? '' : 'opacity-45'}>
                      <td className="py-2 pr-3 pl-4 font-mono whitespace-nowrap text-fg-inverse">{partition.name}</td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                        {formatBytes(partition.size)}
                      </td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        {partition.fstype || <span className="text-fg-dim">—</span>}
                        {partition.label && <span className="text-fg-muted"> · {partition.label}</span>}
                      </td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        {partition.mount || <span className="text-fg-dim">—</span>}
                      </td>
                      <td className="py-1.5 pr-3 pl-1.5 whitespace-nowrap">
                        {target ? (
                          <button
                            type="button"
                            onClick={() => onOpenPool(target.name)}
                            className="flex items-center gap-2 rounded-lg px-1.5 py-0.5 text-left outline-accent-cyan transition-colors hover:bg-white/[0.06] focus-visible:outline-2"
                          >
                            {health && <Led health={health} small />}
                            <span className="text-accent-cyan">→</span>
                            <span className="font-mono text-fg-inverse">{target.name}</span>
                          </button>
                        ) : (
                          <span className="px-1.5 text-fg-dim">{partition.pool || 'unassigned'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

// one bay per pool holding its drives, the pool's bar beneath
export function PoolBays({ storage, onOpen }: { storage: Storage; onOpen: (target: Target) => void }) {
  const { bays, rest } = poolBays(storage)
  const pools = storage.pools ?? []

  const bay = (drives: Disk[]) => (
    <div className="nos-bay grid grid-cols-4 justify-items-center gap-y-1 rounded-xl p-1">
      {drives.map((disk) => (
        <button
          key={disk.name}
          type="button"
          title={driveTitle(disk)}
          onClick={() => onOpen({ kind: 'disk', name: disk.name })}
          className={`self-start rounded-lg py-1.5 outline-accent-cyan hover:bg-white/[0.05] focus-visible:outline-2 ${linkTransition}`}
        >
          <DriveSlot disk={disk} health={driveHealth(disk, pools)} />
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {bays.map(({ pool, drives }) => (
        <div key={`${pool.kind}:${pool.name}`} className="flex flex-col gap-1.5">
          {drives.length > 0 && bay(drives)}
          <PoolRow pool={pool} onOpen={() => onOpen({ kind: 'pool', name: pool.name })} />
        </div>
      ))}
      {rest.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {bay(rest)}
          <div className="px-1 text-[10px] tracking-[0.1em] text-fg-dim uppercase">not in a pool</div>
        </div>
      )}
    </div>
  )
}
