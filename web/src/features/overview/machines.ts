import { type Machine, type Poll, type Storage, type System, usePoll, usePolls } from '@/lib/api'

export type MachineOverview = Machine & {
  system?: System
  storage?: Storage
  // no answer yet from the machine
  loading: boolean
  online: boolean
  error: string
}

// the list of machines comes from the hub at once; each machine's data then
// arrives on its own, so one that cannot be reached holds up only its card
export function useOverview(enabled: boolean): Poll<MachineOverview[]> {
  const list = usePoll<Machine[]>(enabled ? '/api/machines' : null, 60000)
  const base = (m: Machine) => `/api/machines/${encodeURIComponent(m.name)}`
  const machines = list.data ?? []
  const systems = usePolls<System>(
    machines.map((m) => `${base(m)}/system`),
    10000,
  )
  const storages = usePolls<Storage>(
    machines.map((m) => `${base(m)}/storage`),
    10000,
  )
  if (!list.data) return { error: list.error }
  return {
    error: list.error,
    data: list.data.map((m) => {
      const system = systems[`${base(m)}/system`]
      const storage = storages[`${base(m)}/storage`]
      return {
        ...m,
        system: system?.error ? undefined : system?.data,
        storage: storage?.error ? undefined : storage?.data,
        loading: system === undefined,
        online: system !== undefined && !system.error,
        error: [system?.error, storage?.error].filter(Boolean).join('\n'),
      }
    }),
  }
}
