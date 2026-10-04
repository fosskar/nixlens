import { useEffect, useRef } from 'react'
import { type Storage, type System, usePoll } from './api'
import { type Route, canGoBack, closeLayer, goBack, navigate } from './router'
import { poolBays } from './health'
import { DriveDetail, Modal, ModalBody, ModalHeader, ModalTitle, PoolDetail } from './storage'
import { SectionTitle, SystemWidget, Unavailable } from './widgets'

type Detail = Extract<Route, { kind: 'machine' | 'pool' | 'disk' }>

const block = 'flex scroll-mt-4 flex-col gap-5 rounded-2xl border p-4 transition-colors duration-500'

// one page with everything about a machine; a pool or drive in the address
// is scrolled to and marked, so links from the sidebar land on it
export function Inspector({ route }: { route: Detail }) {
  const { machine } = route
  const base = `/api/machines/${encodeURIComponent(machine)}`
  const system = usePoll<System>(`${base}/system`, 3000)
  const storagePoll = usePoll<Storage>(`${base}/storage`, 30000)
  const storage = storagePoll.data
  const target = route.kind === 'machine' ? null : `${route.kind}-${route.name}`
  const body = useRef<HTMLDivElement>(null)
  const loaded = storage !== undefined

  useEffect(() => {
    if (!target || !loaded) return
    const el = body.current?.querySelector(`[data-target="${CSS.escape(target)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [target, loaded])

  const openDisk = (name: string) => navigate({ kind: 'disk', machine, name })
  const openPool = (name: string) => navigate({ kind: 'pool', machine, name })
  const marked = (key: string) =>
    key === target ? 'border-accent-cyan/40 bg-accent/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'
  const pools = storage?.pools ?? []
  const disks = storage?.disks ?? []
  // drives in the order of the sidebar's bays, then those it leaves out
  const first = storage ? poolBays(storage).bays.flatMap((b) => b.groups.flatMap((g) => g.drives)) : []
  const ordered = [...first, ...disks.filter((d) => !first.includes(d))]

  return (
    <Modal focusKey={machine} onBack={canGoBack() ? goBack : undefined} onClose={closeLayer}>
      <ModalHeader onClose={closeLayer}>
        <ModalTitle className="truncate text-lg font-semibold text-fg-inverse">{machine}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div ref={body} className="flex flex-col gap-8">
          <SystemWidget poll={system} />
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
