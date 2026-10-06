import { DriveGlyph } from '@/components/drive-glyph'
import { Led, linkTransition, UsageBar } from '@/components/ui'
import { type Storage } from '@/lib/api'
import { formatUsage } from '@/lib/format'
import { driveHealth, poolHealth, redundant } from '@/lib/health'
import { driveTitle, poolBays, poolLayout, type Target, usedPercent } from '@/lib/storage'

// one panel per machine, a row per pool: name, layout and its drives on
// top, the bar beneath; data vdevs are set apart by a thin line
export function PoolBays({ storage, onOpen }: { storage: Storage; onOpen: (target: Target) => void }) {
  const bays = poolBays(storage)
  const pools = storage.pools ?? []
  if (bays.length === 0) return null

  return (
    <div className="nixlens-bay flex flex-col divide-y divide-hairline rounded-card">
      {bays.map(({ pool, groups }) => {
        const mounted = redundant(pool) || pool.state === 'mounted'
        // the row opens the pool; drives sit above its button, since
        // buttons cannot nest
        return (
          <div
            key={`${pool.kind}:${pool.name}`}
            className="relative px-3 py-2.5 first:rounded-t-card last:rounded-b-card"
          >
            <button
              type="button"
              onClick={() => onOpen({ kind: 'pool', name: pool.name })}
              aria-label={`Open pool ${pool.name}`}
              className={`absolute inset-0 rounded-[inherit] outline-accent-cyan hover:bg-fill focus-visible:outline-2 ${linkTransition}`}
            />
            <div className="pointer-events-none relative flex items-end gap-3">
              <div className="flex max-w-[55%] min-w-0 shrink-0 items-center gap-2 self-center">
                <Led health={poolHealth(pool)} />
                <span className="truncate font-mono text-[13px] font-semibold text-fg-inverse">{pool.name}</span>
                <span className="shrink-0 text-[10px] text-fg-muted">{poolLayout(pool)}</span>
              </div>
              <div className="pointer-events-auto ml-auto flex min-w-0 flex-wrap items-end justify-end gap-x-1.5 gap-y-1">
                {groups.map((group, i) => (
                  <div
                    key={i}
                    title={group.label}
                    className={`flex items-end gap-0.5 ${i > 0 ? 'border-l border-line pl-1.5' : ''}`}
                  >
                    {group.drives.map((disk) => (
                      <button
                        key={disk.name}
                        type="button"
                        title={driveTitle(disk)}
                        onClick={() => onOpen({ kind: 'disk', name: disk.name })}
                        aria-label={`${disk.model || 'drive'} ${disk.serial || disk.name}`}
                        className={`flex h-11 items-end rounded-control p-0.5 outline-accent-cyan hover:bg-fill-hover focus-visible:outline-2 ${linkTransition}`}
                      >
                        <DriveGlyph disk={disk} health={driveHealth(disk, pools)} size="sm" />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="pointer-events-none relative mt-2 flex items-center gap-3">
              {mounted ? <UsageBar percent={usedPercent(pool)} className="h-1 flex-1" /> : <span className="flex-1" />}
              <span className="shrink-0 font-mono text-[11px] text-fg-muted tabular-nums">
                {mounted ? formatUsage(pool.used, pool.usable) : 'not mounted'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
