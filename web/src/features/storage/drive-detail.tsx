import { type ReactNode } from 'react'
import { DriveGlyph } from '@/components/drive-glyph'
import { card, Facts, Led, SectionTitle, TypeBadge } from '@/components/ui'
import { type Disk, formatBytes, type Pool, type Smart } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { driveHealth, smartHealth } from '@/lib/health'
import { driveKind, partitionHealth, shopQuery } from '@/lib/storage'

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
        <span className="ml-auto flex items-center gap-1.5">
          {disk.model && (
            <a
              href={`https://geizhals.de/?fs=${encodeURIComponent(shopQuery(disk.model))}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Search ${shopQuery(disk.model)} on geizhals.de`}
              className="grid h-6 w-6 place-items-center rounded-control text-fg-muted outline-accent-cyan transition hover:bg-white/[0.08] hover:text-fg-inverse focus-visible:outline-2"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 fill-none stroke-current"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 4h2l2.4 11h10.2L20 8H6.2" />
                <circle cx="9" cy="19.5" r="1.3" />
                <circle cx="17" cy="19.5" r="1.3" />
              </svg>
            </a>
          )}
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
                  <th className="py-2 pr-2 pl-4 text-left font-semibold">Partition</th>
                  <th className="px-2 py-2 text-right font-semibold">Size</th>
                  <th className="px-2 py-2 text-left font-semibold">Filesystem</th>

                  <th className="py-2 pr-4 pl-2 text-left font-semibold">Used by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {partitions.map((partition) => {
                  const target = pools.find((p) => p.name === partition.pool)
                  const health = partitionHealth(partition, disk, pools)
                  return (
                    <tr key={partition.name} className={partition.pool ? '' : 'opacity-45'}>
                      <td className="py-2 pr-2 pl-4 font-mono whitespace-nowrap text-fg-inverse">{partition.name}</td>
                      <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                        {formatBytes(partition.size)}
                      </td>
                      <td className="px-2 py-2 font-mono whitespace-nowrap">
                        {partition.fstype || <span className="text-fg-dim">—</span>}
                        {partition.label && partition.label !== partition.pool && (
                          <span className="text-fg-muted"> · {partition.label}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 pl-1.5 whitespace-nowrap">
                        {target ? (
                          <button
                            type="button"
                            onClick={() => onOpenPool(target.name)}
                            className="flex items-center gap-2 rounded-control px-1.5 py-0.5 text-left outline-accent-cyan transition-colors hover:bg-white/[0.06] focus-visible:outline-2"
                          >
                            {health && <Led health={health} small />}
                            <span className="text-accent-cyan">→</span>
                            <span className="font-mono text-fg-inverse">{target.name}</span>
                          </button>
                        ) : (
                          <span className="px-1.5 text-fg-dim">{partition.pool || partition.role || 'unassigned'}</span>
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
