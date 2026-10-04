import { useState } from 'react'
import { card, Led, SectionTitle, Unavailable } from '@/components/ui'
import { type NetInterface, type Poll } from '@/lib/api'

const kindLabels: Record<string, string> = {
  ethernet: 'Ethernet',
  wifi: 'Wi-Fi',
  usb: 'USB Ethernet',
  bond: 'Bond',
  bridge: 'Bridge',
  vlan: 'VLAN',
  wireguard: 'WireGuard',
  tun: 'Tunnel',
  tap: 'Tap',
  virtual: 'Virtual',
}

function speedLabel(mbps?: number): string {
  if (!mbps) return ''
  return mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`
}

// link-local addresses say nothing about where a machine is reachable
function shownAddresses(iface: NetInterface): string[] {
  return iface.addresses.filter((a) => !a.startsWith('fe80:') && !a.startsWith('169.254.'))
}

function details(iface: NetInterface): string {
  return [
    iface.name,
    iface.driver && `driver ${iface.driver}`,
    iface.mac && `mac ${iface.mac}`,
    `mtu ${iface.mtu}`,
    iface.master && `in ${iface.master}`,
    ...iface.addresses,
  ]
    .filter(Boolean)
    .join('\n')
}

// the link speed, and the port's own when the link is slower; a port
// without a link shows what it could do
function portSpeed(iface: NetInterface): string {
  const max = speedLabel(iface.maxSpeedMbps)
  if (!iface.up || !iface.speedMbps) return max || '—'
  const speed = speedLabel(iface.speedMbps)
  return max && (iface.maxSpeedMbps ?? 0) > iface.speedMbps ? `${speed}/${max}` : speed
}

// an rj45 socket: the latch notch on top, gold contacts below it, the
// speed on the body and the link led underneath
function Port({ iface }: { iface: NetInterface }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1.5" title={details(iface)}>
      <div
        className={`relative flex h-11 w-14 flex-col items-center rounded-md bg-bg-elevated/90 pt-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] ring-1 ring-white/10 ${iface.up ? '' : 'opacity-45'}`}
      >
        <span className="h-1.5 w-5 rounded-b-sm bg-black/70" />
        <span className="mt-0.5 font-mono text-[10px] font-semibold text-fg-inverse">{portSpeed(iface)}</span>
        <span className="nos-nvme-pins absolute bottom-1.5 h-1.5 w-9 rounded-[1px]" />
      </div>
      <Led health={iface.up ? 'ok' : 'unknown'} small />
      <span className="w-full truncate text-center font-mono text-[9px] text-fg-muted">{iface.name}</span>
    </div>
  )
}

// an address chip that copies the bare address, without its prefix length
function AddressChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  // the clipboard api exists only on https and localhost
  if (!window.isSecureContext) return <Chip>{address}</Chip>
  const copy = () => {
    void navigator.clipboard.writeText(address.split('/')[0]).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] outline-accent-cyan transition-colors focus-visible:outline-2 ${copied ? 'border-accent-cyan/40 bg-accent/15 text-accent-cyan' : 'border-white/[0.08] bg-white/[0.04] text-fg-base hover:border-white/20 hover:bg-white/[0.08]'}`}
    >
      {copied ? `✓ copied` : address}
    </button>
  )
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-fg-base">
      {children}
    </span>
  )
}

// every ipv4 address, but one ipv6 address per kind (global, unique
// local): slaac hands out a new temporary one every day; all are on hover
function chipAddresses(iface: NetInterface): { shown: string[]; hidden: string[] } {
  const all = shownAddresses(iface)
  const v4 = all.filter((a) => !a.includes(':'))
  const ula = all.find((a) => /^f[cd]/i.test(a))
  const global = all.find((a) => a.includes(':') && !/^f[cd]/i.test(a))
  const shown = [...v4, ...[global, ula].filter((a): a is string => a !== undefined)]
  return { shown, hidden: all.filter((a) => !shown.includes(a)) }
}

function Connection({ iface, members }: { iface: NetInterface; members: NetInterface[] }) {
  const { shown, hidden } = chipAddresses(iface)
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`${card} flex items-start gap-3 px-3.5 py-2.5`} title={details(iface)}>
      <span className="pt-1">
        <Led health={iface.up ? 'ok' : 'unknown'} small />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[12px]">
          <span className="font-mono font-medium text-fg-inverse">{iface.name}</span>
          <span className="text-[11px] text-fg-muted">{kindLabels[iface.kind] ?? iface.kind}</span>
          {!iface.up && <span className="text-[11px] text-fg-dim">{iface.state}</span>}
          <span className="ml-auto flex min-w-0 items-baseline gap-2 font-mono text-[10px] text-fg-muted">
            {members.length > 0 && <span className="truncate">via {members.map((m) => m.name).join(', ')}</span>}
            {iface.speedMbps && <span className="shrink-0 text-fg-base">{speedLabel(iface.speedMbps)}</span>}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {shown.map((a) => (
            <AddressChip key={a} address={a} />
          ))}
          {expanded && hidden.map((a) => <AddressChip key={a} address={a} />)}
          {hidden.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              title={expanded ? 'Show fewer addresses' : 'Show all addresses'}
              className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-fg-muted outline-accent-cyan transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-fg-inverse focus-visible:outline-2"
            >
              {expanded ? 'less' : `+${hidden.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// physical sockets as ports; below them every connection the machine is
// reachable on, which leaves out link-local-only devices such as a bmc's
// usb network; bridge and bond members are named on their master
export function NetworkWidget({ poll }: { poll: Poll<NetInterface[]> }) {
  const ifaces = poll.data
  if (!ifaces) {
    return (
      <section>
        <SectionTitle>Network</SectionTitle>
        <Unavailable error={poll.error} className="h-32" />
      </section>
    )
  }
  const ports = ifaces.filter((i) => i.kind === 'ethernet')
  const hardware = ['ethernet', 'wifi', 'usb', 'bond']
  const connections = ifaces
    .filter((i) => !i.master && (shownAddresses(i).length > 0 || ifaces.some((m) => m.master === i.name)))
    .sort((a, b) => Number(!hardware.includes(a.kind)) - Number(!hardware.includes(b.kind)))
  const up = ports.filter((p) => p.up).length
  return (
    <section className={poll.error ? 'opacity-50' : ''} title={poll.error}>
      <SectionTitle aside={ports.length > 0 ? `${up} of ${ports.length} ports linked` : undefined}>
        Network
      </SectionTitle>
      <div className="flex flex-col gap-3">
        {ports.length > 0 && (
          <div className={`${card} nos-bay flex flex-wrap gap-2 p-3`}>
            {ports.map((p) => (
              <Port key={p.name} iface={p} />
            ))}
          </div>
        )}
        {connections.length > 0 && (
          <div className="grid gap-2 lg:grid-cols-2">
            {connections.map((c) => (
              <Connection key={c.name} iface={c} members={ifaces.filter((i) => i.master === c.name)} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
