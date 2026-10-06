import { createContext, type ReactNode, use, useEffect, useEffectEvent, useId, useRef } from 'react'
import { ScrollArea } from '@/components/scroll'
import { closeIcon, IconButton } from '@/components/ui'

// the open panel's title element, which names it
const ModalTitleId = createContext<string | undefined>(undefined)

// details roll out from under the sidebar over the apps, which blur behind
// them, and take the sidebar's margins and corners; on phones, where the
// sidebar sits above the page, they fill the screen. the sidebar stays usable,
// so this is not modal, but the apps behind are inert
export function Modal({
  focusKey,
  leaving,
  onBack,
  onClose,
  children,
}: {
  focusKey: string
  leaving: boolean
  onBack?: () => void
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  useEffect(() => {
    panel.current?.focus()
    panel.current?.querySelector('.nixlens-scroll')?.scrollTo({ top: 0 })
  }, [focusKey])

  return (
    <div
      ref={panel}
      role="region"
      aria-labelledby={titleId}
      tabIndex={-1}
      inert={leaving}
      className={`${leaving ? 'nixlens-detail-out' : 'nixlens-detail'} glass glass-blur fixed top-[calc(0.75rem+var(--safe-top))] right-[calc(0.75rem+var(--safe-right))] bottom-[calc(0.75rem+var(--safe-bottom))] left-[calc(0.75rem+var(--safe-left))] z-[35] flex flex-col overflow-hidden rounded-surface text-fg-base outline-none md:left-[calc(23.5rem+var(--safe-left))]`}
    >
      {onBack && (
        <nav className="flex shrink-0 items-center gap-1 border-b border-hairline px-3 py-2 text-2xs">
          <button
            type="button"
            onClick={onBack}
            title="Back (Alt+←)"
            className="mr-1 flex items-center gap-1 rounded-control px-2 py-1 text-fg-muted transition outline-accent-cyan hover:bg-fill-hover hover:text-fg-inverse focus-visible:outline-2"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 fill-none stroke-current"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Back
          </button>
        </nav>
      )}
      <div key={focusKey} className="flex min-h-0 flex-col">
        <ModalTitleId value={titleId}>{children}</ModalTitleId>
      </div>
    </div>
  )
}

// the element that names the open panel
export function ModalTitle({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span id={use(ModalTitleId)} className={className}>
      {children}
    </span>
  )
}

export function ModalHeader({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-hairline bg-fill py-3.5 pr-3 pl-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <IconButton label="Close" onClick={onClose}>
        {closeIcon}
      </IconButton>
    </div>
  )
}

export function ModalBody({ children }: { children: ReactNode }) {
  return (
    <ScrollArea>
      <div className="flex flex-col gap-6 p-5">{children}</div>
    </ScrollArea>
  )
}
