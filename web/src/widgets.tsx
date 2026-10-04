import { type Disk, type System, formatBytes } from './api'

export const glass =
  'rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'

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

export function SystemWidget({ system }: { system?: System }) {
  if (!system) return <div className={`${glass} h-44`} />
  const memUsed = system.memTotal - system.memAvailable
  return (
    <div className={`${glass} flex h-44 flex-col justify-between p-5`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-white/60">System</span>
        <span className="text-xs text-white/40">up {formatUptime(system.uptimeSec)}</span>
      </div>
      <div className="flex justify-around">
        <Ring label="CPU" value={system.cpuPercent} detail={`${system.cpus} threads`} />
        <Ring
          label="Memory"
          value={(100 * memUsed) / system.memTotal}
          detail={`${formatBytes(memUsed)} / ${formatBytes(system.memTotal)}`}
        />
      </div>
    </div>
  )
}

function DriveSlot({ disk }: { disk: Disk }) {
  return (
    <div className="flex w-20 flex-col items-center gap-2" title={`${disk.model}\n${disk.serial}\n/dev/${disk.name}`}>
      <div className="flex h-24 w-12 flex-col items-center justify-between rounded-xl bg-neutral-900/90 p-2 ring-1 ring-white/10">
        <div className="h-14 w-6 rounded-md bg-black/70 ring-1 ring-white/5" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/30" title="health unknown" />
      </div>
      <div className="w-full text-center">
        <div className="truncate text-[11px] font-medium text-white/80">{disk.serial || disk.name}</div>
        <div className="text-[10px] text-white/45">
          {formatBytes(disk.size)} · {disk.transport || (disk.rotational ? 'hdd' : 'ssd')}
        </div>
      </div>
    </div>
  )
}

export function StorageWidget({ disks }: { disks?: Disk[] }) {
  if (!disks) return <div className={`${glass} h-44`} />
  const total = disks.reduce((sum, d) => sum + d.size, 0)
  return (
    <div className={`${glass} flex h-44 items-center gap-6 p-5`}>
      <div className="flex shrink-0 flex-col justify-between self-stretch">
        <span className="text-sm font-medium text-white/60">Drives</span>
        <div>
          <div className="text-3xl font-semibold">{formatBytes(total)}</div>
          <div className="text-xs text-white/50">
            {disks.length} {disks.length === 1 ? 'disk' : 'disks'} raw
          </div>
        </div>
      </div>
      <div className="flex flex-1 gap-1 overflow-x-auto">
        {disks.map((d) => (
          <DriveSlot key={d.name} disk={d} />
        ))}
      </div>
    </div>
  )
}
