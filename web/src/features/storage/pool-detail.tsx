import { DriveGlyph } from '@/components/drive-glyph'
import { card, Facts, Led, SectionTitle, TypeBadge } from '@/components/ui'
import {
  type Dataset,
  type Disk,
  type Pool,
  type PoolDetail as ZfsPoolDetail,
  type PoolGroup,
  type PoolMember,
  usePoll,
} from '@/lib/api'
import { formatCapacity, formatRecordsize, shortAgo } from '@/lib/format'
import { type Health, memberHealth, pillStyles, poolHealth, redundant, resilvering, textStyles } from '@/lib/health'
import {
  datasetDepth,
  groupTitle,
  memberPartition,
  poolType,
  rawCapacity,
  scanLine,
  tolerance,
  usedPercent,
} from '@/lib/storage'

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

const dotRows = 4

const dotCount = 4 * 48

// the drives' raw space as dots: used, free, and what redundancy takes
function CapacityView({ pool, disks }: { pool: Pool; disks: Disk[] }) {
  const scan = scanLine(pool)
  if (!redundant(pool) && pool.state !== 'mounted') {
    return <div className={`${card} p-4 text-[12px] text-fg-muted`}>Not mounted; usage unavailable.</div>
  }
  const raw = Math.max(rawCapacity(pool, disks), pool.usable)
  const protection = raw - pool.usable
  const usedDots = Math.round((dotCount * pool.used) / raw)
  const protectionDots = Math.round((dotCount * protection) / raw)
  const percent = usedPercent(pool)
  const usedColor = percent >= 90 ? 'bg-error' : percent >= 80 ? 'bg-warning' : 'bg-accent-cyan'
  const legend: [string, string, number][] = [
    [usedColor, 'used', pool.used],
    ['bg-accent-cyan/25', 'free', pool.available],
    ...(protection > 0 ? ([['bg-accent-tertiary/60', 'protection', protection]] as [string, string, number][]) : []),
  ]
  return (
    <div className={`${card} grid items-center gap-5 p-4 md:grid-cols-[auto_minmax(0,1fr)] md:gap-8`}>
      <div>
        <div className="text-3xl font-semibold tracking-tight text-fg-inverse tabular-nums">
          {formatCapacity(pool.available)}
        </div>
        <div className="mt-0.5 text-[12px] text-fg-muted">available of {formatCapacity(pool.usable)}</div>
        {scan && <div className={`mt-2 text-[11px] ${textStyles[scan.health]}`}>{scan.text}</div>}
      </div>
      <div>
        <div
          className="grid grid-flow-col gap-[3px]"
          style={{ gridTemplateRows: `repeat(${dotRows}, minmax(0, 1fr))` }}
          role="img"
          aria-label={`${formatCapacity(pool.used)} used, ${formatCapacity(pool.available)} free, ${formatCapacity(protection)} for protection`}
        >
          {Array.from({ length: dotCount }, (_, i) => (
            <span
              key={i}
              className={`aspect-square rounded-[2px] ${i < usedDots ? usedColor : i >= dotCount - protectionDots ? 'bg-accent-tertiary/60' : 'bg-accent-cyan/25'}`}
            />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] text-fg-muted tabular-nums">
          {legend.map(([color, label, bytes]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-[2px] ${color}`} />
              {label} <span className="font-mono text-fg-base">{formatCapacity(bytes)}</span>
            </span>
          ))}
        </div>
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

// pips for the failures a vdev can still take, emptied by failing members
function Tolerance({ group, pool }: { group: PoolGroup; pool: Pool }) {
  const total = tolerance(group)
  if (total === null) return null
  const failing = group.members.filter((m) => memberHealth(m, pool) !== 'ok').length
  const left = Math.max(total - failing, 0)
  const health: Health = total === 0 ? 'unknown' : left === 0 ? 'error' : left < total ? 'warn' : 'ok'
  const text =
    total === 0
      ? 'no redundancy'
      : left === 0
        ? 'no failure left'
        : left < total
          ? `can lose ${left} more`
          : `can lose ${total} ${total === 1 ? 'drive' : 'drives'}`
  return (
    <span className={`flex items-center gap-1.5 text-[11px] ${textStyles[health]}`}>
      {Array.from({ length: total }, (_, i) => (
        <svg
          key={i}
          viewBox="0 0 16 16"
          className={`h-3 w-3 ${i < left ? 'fill-current' : 'fill-none'} stroke-current`}
        >
          <path d="M8 1.5l5.5 2v4.2c0 3.3-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.5-5.5-6.8V3.5z" strokeWidth="1.3" />
        </svg>
      ))}
      {text}
    </span>
  )
}

function MemberTile({
  member,
  pool,
  disk,
  onOpenDisk,
}: {
  member: PoolMember
  pool: Pool
  disk?: Disk
  onOpenDisk: (name: string) => void
}) {
  const health = memberHealth(member, pool)
  const state = member.device === '' ? 'missing' : member.state.toLowerCase()
  const label = disk?.serial || member.device || 'missing'
  const content = (
    <>
      {disk ? (
        <DriveGlyph disk={disk} health={health} />
      ) : (
        <span className="grid h-14 w-9 place-items-center rounded-md border border-dashed border-error/60 text-error">
          ?
        </span>
      )}
      <span className="w-full truncate text-center font-mono text-[9px] text-fg-base">{label}</span>
      {health !== 'ok' && (
        <span className={`text-[9px] ${textStyles[health]}`}>
          {member.errors > 0 ? `${member.errors} errors` : state}
        </span>
      )}
    </>
  )
  const layout = 'flex w-[4.5rem] flex-col items-center gap-1 rounded-lg px-1 py-1.5'
  const title = [disk?.model, memberPartition(member, pool, disk), member.state].filter(Boolean).join('\n')
  if (!disk) return <div className={layout}>{content}</div>
  return (
    <button
      type="button"
      onClick={() => onOpenDisk(disk.name)}
      title={title}
      className={`${layout} outline-accent-cyan transition-colors hover:bg-white/[0.05] focus-visible:outline-2`}
    >
      {content}
    </button>
  )
}

function VdevTree({ pool, disks, onOpenDisk }: { pool: Pool; disks: Disk[]; onOpenDisk: (name: string) => void }) {
  const groups = pool.groups ?? []
  return (
    <section>
      <SectionTitle aside={`${groups.length} ${groups.length === 1 ? 'vdev' : 'vdevs'}`}>Layout</SectionTitle>
      <div className="flex flex-wrap gap-3">
        {groups.map((group) => (
          <div key={group.name} className={`${card} p-3`}>
            <div className="flex items-center gap-3 px-1 text-[12px]">
              <span className="font-mono font-semibold text-fg-inverse">{groupTitle(group)}</span>
              <span className="ml-auto">
                <Tolerance group={group} pool={pool} />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-1">
              {group.members.map((member, i) => (
                <MemberTile
                  key={member.device || member.path || i}
                  member={member}
                  pool={pool}
                  disk={disks.find((d) => d.name === member.device)}
                  onOpenDisk={onOpenDisk}
                />
              ))}
            </div>
          </div>
        ))}
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
  const detail = usePoll<ZfsPoolDetail>(
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
      <CapacityView pool={pool} disks={disks} />
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
