import { createContext, type ReactNode, use, useEffect, useEffectEvent, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ScrollArea } from '@/components/scroll'

// the open popup's title element, which names the dialog
const ModalTitleId = createContext<string | undefined>(undefined)

export function Modal({
  focusKey,
  onBack,
  onClose,
  children,
}: {
  focusKey: string
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
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')]
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    if (e.shiftKey && (current === first || current === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (current === last || !panel.current.contains(current))) {
      e.preventDefault()
      first.focus()
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

  return createPortal(
    <div
      className="nixlens-modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/55 px-4 pt-[calc(1rem+var(--safe-top))] pb-[calc(1rem+var(--safe-bottom))] backdrop-blur-[6px] md:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="nixlens-modal glass-strong flex max-h-[calc(100dvh-4rem-var(--safe-top)-var(--safe-bottom))] w-full max-w-5xl flex-col overflow-hidden rounded-surface font-sans text-fg-base outline-none"
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
    </div>,
    document.body,
  )
}

// the element that names the open popup
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
      <button
        type="button"
        onClick={onClose}
        title="Close"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-fg-muted transition outline-accent-cyan hover:bg-fill-hover hover:text-fg-inverse focus-visible:outline-2"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
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
