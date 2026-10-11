import { card, Ring, SectionTitle, StaleNote, Unavailable } from '@/components/ui'
import { formatBytes, type Poll, type System } from '@/lib/api'
import { formatUptime } from '@/lib/format'

function memoryDetail(system: System): string {
  const total = system.memInstalled || system.memTotal
  return `${formatBytes(system.memTotal - system.memAvailable, true)} / ${formatBytes(total, true)}`
}

export function SystemWidget({ poll }: { poll: Poll<System> }) {
  const system = poll.data
  return (
    <div>
      <SectionTitle level={3} aside={system && `up ${formatUptime(system.uptimeSec)}`}>
        System
      </SectionTitle>
      <StaleNote poll={poll} />
      {system ? (
        <div className={`${card} grid items-center gap-4 p-4 md:grid-cols-2 md:gap-8`}>
          <div className="grid grid-cols-2 gap-3 md:order-last">
            <Ring label="CPU" value={system.cpuPercent} detail={`${system.cores} cores / ${system.cpus} threads`} />
            <Ring
              label="Memory"
              value={(100 * (system.memTotal - system.memAvailable)) / system.memTotal}
              detail={memoryDetail(system)}
            />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-hairline pt-3 text-xs md:border-t-0 md:pt-0">
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
