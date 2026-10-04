import { useState } from 'react'
import { type Storage, type System, usePoll } from './api'
import { type Route, canGoBack, closeLayer, goBack, historyIndex, navigate } from './router'
import {
  type Crumb,
  DriveModal,
  Modal,
  ModalBody,
  ModalHeader,
  ModalTitle,
  PoolModal,
  StorageLists,
  type Target,
} from './storage'
import { SystemWidget, Unavailable } from './widgets'

type Detail = Extract<Route, { kind: 'machine' | 'pool' | 'disk' }>

// the detail popup: a machine, or one of its pools or drives. everything it
// shows follows from the address, so back and reload behave the same
export function Inspector({ route }: { route: Detail }) {
  const { machine } = route
  const base = `/api/machines/${encodeURIComponent(machine)}`
  const system = usePoll<System>(route.kind === 'machine' ? `${base}/system` : null, 3000)
  const storagePoll = usePoll<Storage>(`${base}/storage`, 30000)
  const storage = storagePoll.data

  // views slide in from the side they come from: forward when the history
  // entry is newer than the last one shown
  const index = historyIndex()
  const [shown, setShown] = useState<{ index: number; direction: 'forward' | 'back' | 'none' }>({
    index,
    direction: 'none',
  })
  if (shown.index !== index) setShown({ index, direction: index > shown.index ? 'forward' : 'back' })
  const direction = shown.index === index ? shown.direction : index > shown.index ? 'forward' : 'back'

  const open = (target: Target) => navigate({ kind: target.kind, machine, name: target.name })
  const item =
    route.kind === 'pool'
      ? route.name
      : route.kind === 'disk'
        ? storage?.disks.find((d) => d.name === route.name)?.serial || route.name
        : null
  const trail: Crumb[] = [
    { label: machine, onClick: () => navigate({ kind: 'machine', machine }) },
    ...(item ? [{ label: item, onClick: () => {} }] : []),
  ]

  const pool = route.kind === 'pool' ? storage?.pools.find((p) => p.name === route.name) : undefined
  const disk = route.kind === 'disk' ? storage?.disks.find((d) => d.name === route.name) : undefined

  return (
    <Modal
      focusKey={`${route.kind}:${'name' in route ? route.name : ''}`}
      direction={direction}
      trail={trail}
      onBack={canGoBack() ? goBack : undefined}
      onClose={closeLayer}
    >
      {route.kind === 'machine' ? (
        <>
          <ModalHeader onClose={closeLayer}>
            <ModalTitle className="truncate text-lg font-semibold text-fg-inverse">{machine}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <SystemWidget poll={system} />
              {storage ? (
                <StorageLists storage={storage} error={storagePoll.error} onOpen={open} />
              ) : (
                <Unavailable error={storagePoll.error} className="h-48" />
              )}
            </div>
          </ModalBody>
        </>
      ) : pool && storage ? (
        <PoolModal
          pool={pool}
          disks={storage.disks}
          machine={machine}
          onOpenDisk={(name) => open({ kind: 'disk', name })}
          onClose={closeLayer}
        />
      ) : disk && storage ? (
        <DriveModal
          disk={disk}
          pools={storage.pools}
          onOpenPool={(name) => open({ kind: 'pool', name })}
          onClose={closeLayer}
        />
      ) : (
        <>
          <ModalHeader onClose={closeLayer}>
            <ModalTitle className="truncate font-mono text-lg font-semibold text-fg-inverse">{item}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Unavailable
              error={
                storagePoll.error ??
                (storage ? `${route.kind} ${'name' in route ? route.name : ''} not found on ${machine}` : undefined)
              }
              className="h-32"
            />
          </ModalBody>
        </>
      )}
    </Modal>
  )
}
