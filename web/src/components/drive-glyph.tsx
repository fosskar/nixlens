import { Led } from '@/components/ui'
import { type Disk } from '@/lib/api'
import { type Health } from '@/lib/health'
import { driveKind } from '@/lib/storage'

const glyphSizes = {
  lg: { hdd: 'h-14 w-9', ssd: 'h-11 w-9', nvme: 'h-14 w-[1.375rem]', pad: 'px-1.5 py-2' },
  sm: { hdd: 'h-10 w-6', ssd: 'h-8 w-6', nvme: 'h-10 w-4', pad: 'px-1 py-1.5' },
}

// 3.5" bay with a grille for hdds, a shorter 2.5" body with a label for
// sata ssds, an m.2 stick with its gold edge connector on top for nvme
export function DriveGlyph({ disk, health, size = 'lg' }: { disk: Disk; health: Health; size?: 'lg' | 'sm' }) {
  const kind = driveKind(disk)
  const s = glyphSizes[size]
  const led = <Led health={health} asleep={disk.smart?.standby} small={size === 'sm'} />
  const body = `flex shrink-0 flex-col items-center bg-bg-elevated/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] ring-1 ring-line`
  return (
    <span className="flex items-end justify-center">
      {kind === 'hdd' && (
        <span className={`${body} ${s.hdd} ${s.pad} justify-between rounded-md`}>
          <span className="flex w-full flex-col gap-0.5">
            <span className="h-px w-full bg-line" />
            <span className="h-px w-full bg-line" />
            <span className="h-px w-full bg-line" />
          </span>
          {led}
        </span>
      )}
      {kind === 'ssd' && (
        <span className={`${body} ${s.ssd} ${s.pad} justify-between rounded-md`}>
          <span className="h-[30%] w-full rounded-[3px] bg-fill ring-1 ring-line" />
          {led}
        </span>
      )}
      {kind === 'nvme' && (
        <span className={`${body} ${s.nvme} justify-between rounded-[4px] pb-1.5`}>
          <span className="nixlens-nvme-pins h-1.5 w-full rounded-t-[4px]" />
          <span className="flex w-full flex-col items-center gap-1">
            <span className="h-[18%] w-[70%] min-h-1.5 rounded-[2px] bg-black/55 ring-1 ring-line" />
            <span className="h-[18%] w-[70%] min-h-1.5 rounded-[2px] bg-black/55 ring-1 ring-line" />
          </span>
          {led}
        </span>
      )}
    </span>
  )
}
