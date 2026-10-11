import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { closeIcon, IconButton, Led } from '@/components/ui'

type Notice = {
  message: string
  updated?: number
}

const maxLength = 500
const dismissedKey = 'nixlens.notice-dismissed'

// one poll for the banner and the editor, which updates it on saving
let current: Notice = { message: '' }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function publish(n: Notice) {
  current = n
  listeners.forEach((l) => l())
}

async function load() {
  const res = await fetch('/api/notice')
  if (!res.ok) throw new Error((await res.text()).trim() || `${res.status} ${res.statusText}`)
  publish((await res.json()) as Notice)
}

function poll() {
  load().catch((e: unknown) => console.warn('notice:', e))
}

function useNotice(): Notice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        poll()
        timer = setInterval(poll, 60000)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) clearInterval(timer)
      }
    },
    () => current,
  )
}

async function save(message: string) {
  const res = await fetch('/api/notice', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error((await res.text()).trim() || `${res.status} ${res.statusText}`)
  publish((await res.json()) as Notice)
}

// dismissing hides this notice until a new one is set
export function NoticeBanner() {
  const notice = useNotice()
  const [dismissed, setDismissed] = useState(() => Number(localStorage.getItem(dismissedKey)))
  if (!notice.message || notice.updated === dismissed) return null
  const dismiss = () => {
    localStorage.setItem(dismissedKey, String(notice.updated))
    setDismissed(notice.updated ?? 0)
  }
  return (
    <div
      role="status"
      className="glass glass-blur mx-auto mt-5 flex w-fit max-w-xl animate-[nixlens-fade_300ms_var(--ease-out)] items-center gap-3 rounded-surface py-2 pr-2 pl-4 text-left text-sm text-fg-base"
    >
      <Led health="warn" />
      <span className="min-w-0 py-0.5 break-words whitespace-pre-line">{notice.message}</span>
      <IconButton label="Dismiss" onClick={dismiss}>
        {closeIcon}
      </IconButton>
    </div>
  )
}

export function NoticeEditor({ onClose }: { onClose: () => void }) {
  const notice = useNotice()
  const [text, setText] = useState(notice.message)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const fieldId = useId()
  const errorId = useId()

  // a modal dialog keeps focus inside and makes the page behind inert
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    field.current?.focus()
    return () => previous?.focus()
  }, [])

  const submit = async (message: string) => {
    setBusy(true)
    setError('')
    try {
      await save(message)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const button =
    'rounded-control border px-3 py-1.5 text-xs transition outline-accent-cyan focus-visible:outline-2 disabled:opacity-40'
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto w-[min(28rem,calc(100%-1.5rem))] max-w-none animate-[nixlens-fade_150ms_var(--ease-out)] overflow-visible bg-transparent p-0 text-fg-base backdrop:animate-[nixlens-fade_150ms_var(--ease-out)] backdrop:bg-black/30"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // a press on the backdrop lands on the dialog itself
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        className="glass-strong glass-blur flex flex-col rounded-surface"
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <div className="flex items-center justify-between border-b border-hairline bg-fill py-3.5 pr-3 pl-5">
          <h2 id={titleId} className="text-base font-semibold text-fg-inverse">
            Notice for everyone
          </h2>
          <IconButton label="Close" onClick={onClose}>
            {closeIcon}
          </IconButton>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4">
          <label htmlFor={fieldId} className="text-xs font-medium text-fg-base">
            Message
          </label>
          <textarea
            ref={field}
            id={fieldId}
            aria-describedby={error ? errorId : undefined}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={maxLength}
            rows={4}
            placeholder="e.g. Maintenance tonight from 22:00, apps may be unavailable for a while."
            className="resize-none rounded-control border border-line bg-fill px-3 py-2 text-sm text-fg-base outline-accent-cyan placeholder:text-fg-muted focus-visible:outline-2"
          />
          <div className="flex justify-between gap-3 text-xs text-fg-muted">
            <span id={errorId} role="alert" className="text-error">
              {error}
            </span>
            <span className="tabular-nums">
              {text.length}/{maxLength}
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          {notice.message && (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit('')}
              className={`${button} mr-auto border-line text-fg-base hover:border-error/50 hover:bg-error/15 hover:text-error`}
            >
              Remove
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !text.trim() || text.trim() === notice.message}
            className={`${button} glass-accent text-fg-inverse`}
          >
            Show to everyone
          </button>
        </div>
      </form>
    </dialog>
  )
}
