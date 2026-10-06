import { useEffect, useRef } from 'react'
import { Modal, ModalBody, ModalHeader, ModalTitle } from '@/components/modal'
import { card, SectionTitle, Unavailable } from '@/components/ui'
import { SystemWidget } from '@/features/inspector/system'
import { NetworkWidget } from '@/features/network/network'
import { DriveDetail } from '@/features/storage/drive-detail'
import { PoolDetail } from '@/features/storage/pool-detail'
import { type NetInterface, type Storage, type System, usePoll } from '@/lib/api'
import { canGoBack, closeLayer, goBack, navigate, type Route } from '@/lib/router'
import { poolBays } from '@/lib/storage'

type Detail = Extract<Route, { kind: 'machine' | 'pool' | 'disk' }>

const block = 'flex scroll-mt-4 flex-col gap-5 rounded-card border p-4 transition-colors duration-300'

// one page with everything about a machine; a pool or drive in the address
// is scrolled to and marked, so links from the sidebar land on it
export function Inspector({ route, leaving }: { route: Detail; leaving: boolean }) {
  const { machine } = route
  const base = `/api/machines/${encodeURIComponent(machine)}`
  const system = usePoll<System>(`${base}/system`, 3000)
  const storagePoll = usePoll<Storage>(`${base}/storage`, 30000)
  const network = usePoll<NetInterface[]>(`${base}/network`, 10000)
  const storage = storagePoll.data
  const target = route.kind === 'machine' ? null : `${route.kind}-${route.name}`
  const body = useRef<HTMLDivElement>(null)
  const loaded = storage !== undefined
  const missing =
    route.kind === 'pool'
      ? loaded && !storage.pools.some((p) => p.name === route.name)
      : route.kind === 'disk' && loaded && !storage.disks.some((d) => d.name === route.name)

  useEffect(() => {
    if (!target || !loaded) return
    const el = body.current?.querySelector(`[data-target="${CSS.escape(target)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [target, loaded])

  const openDisk = (name: string) => navigate({ kind: 'disk', machine, name })
  const openPool = (name: string) => navigate({ kind: 'pool', machine, name })
  const marked = (key: string) =>
    key === target ? 'border-accent-cyan/40 bg-accent/[0.06]' : 'border-hairline bg-fill'
  const pools = storage?.pools ?? []
  const disks = storage?.disks ?? []
  // drives in the order of the sidebar's bays, then those it leaves out
  const first = storage ? poolBays(storage).flatMap((b) => b.groups.flatMap((g) => g.drives)) : []
  const ordered = [...first, ...disks.filter((d) => !first.includes(d))]

  return (
    <Modal focusKey={machine} leaving={leaving} onBack={canGoBack() ? goBack : undefined} onClose={closeLayer}>
      <ModalHeader onClose={closeLayer}>
        <ModalTitle className="truncate text-base font-semibold text-fg-inverse">{machine}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div ref={body} className="flex flex-col gap-8">
          {missing && (
            <p className={`${card} px-4 py-3 text-sm text-warning`}>
              No {route.kind === 'pool' ? 'pool' : 'drive'}{' '}
              <span className="font-mono">{route.kind !== 'machine' && route.name}</span> on {machine}
            </p>
          )}
          <SystemWidget poll={system} />
          <NetworkWidget poll={network} />
          {!storage ? (
            <Unavailable error={storagePoll.error} className="h-48" />
          ) : (
            <div className={`flex flex-col gap-8 ${storagePoll.error ? 'opacity-50' : ''}`} title={storagePoll.error}>
              <section>
                <SectionTitle aside={`${pools.length}`}>Pools</SectionTitle>
                <div className="flex flex-col gap-4">
                  {pools.map((pool) => (
                    <div
                      key={`${pool.kind}:${pool.name}`}
                      data-target={`pool-${pool.name}`}
                      className={`${block} ${marked(`pool-${pool.name}`)}`}
                    >
                      <PoolDetail pool={pool} disks={disks} machine={machine} onOpenDisk={openDisk} />
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <SectionTitle aside={`${disks.length}`}>Drives</SectionTitle>
                <div className="grid gap-4 lg:grid-cols-2">
                  {ordered.map((disk) => (
                    <div
                      key={disk.name}
                      data-target={`disk-${disk.name}`}
                      className={`${block} min-w-0 ${marked(`disk-${disk.name}`)}`}
                    >
                      <DriveDetail disk={disk} pools={pools} onOpenPool={openPool} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </ModalBody>
    </Modal>
  )
}
