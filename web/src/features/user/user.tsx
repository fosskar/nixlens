import { type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { closeIcon, IconButton } from '@/components/ui'
import { type Me } from '@/lib/api'
import { type Accent, accents, reducedMotion, resetPrefs, setPrefs, usePrefs } from '@/lib/prefs'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

function MenuItem({ onClick, href, children }: { onClick?: () => void; href?: string; children: ReactNode }) {
  const className =
    'flex w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left text-sm text-fg-base transition outline-accent-cyan hover:bg-fill-hover hover:text-fg-inverse focus-visible:outline-2'
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  )
}

export function UserMenu({ me }: { me?: Me }) {
  const [open, setOpen] = useState(false)
  // closing plays the panel's slide-in backwards before it unmounts
  const [prefsState, setPrefsState] = useState<'closed' | 'open' | 'leaving'>('closed')
  const closePrefs = () => {
    setPrefsState('leaving')
    setTimeout(() => setPrefsState('closed'), reducedMotion() ? 0 : 150)
  }
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const name = me?.name || me?.user || ''

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div ref={root} className="fixed top-[calc(1rem+var(--safe-top))] right-[calc(1rem+var(--safe-right))] z-30">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={name ? `Account menu for ${name}` : 'Account menu'}
          className="glass-tile grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-fg-inverse transition outline-accent-cyan hover:scale-105 focus-visible:outline-2"
        >
          {name ? (
            initials(name)
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
            </svg>
          )}
        </button>
        {open && (
          <div id={menuId} className="glass-strong glass-blur absolute top-12 right-0 w-64 rounded-surface p-1.5">
            {name && (
              <div className="border-b border-hairline px-3 pt-2 pb-2.5">
                <div className="truncate text-sm font-semibold text-fg-inverse">{name}</div>
                {me?.email && <div className="truncate text-xs text-fg-muted">{me.email}</div>}
              </div>
            )}
            <div className="pt-1.5">
              <MenuItem
                onClick={() => {
                  setOpen(false)
                  setPrefsState('open')
                }}
              >
                Preferences…
              </MenuItem>
              {me?.accountUrl && (
                <MenuItem href={me.accountUrl}>
                  Account settings <span className="text-fg-muted">↗</span>
                </MenuItem>
              )}
            </div>
          </div>
        )}
      </div>
      {prefsState !== 'closed' && <PreferencesPanel leaving={prefsState === 'leaving'} onClose={closePrefs} />}
    </>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm text-fg-base">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-fg-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition outline-accent-cyan focus-visible:outline-2 ${checked ? 'border-accent-cyan/50 bg-accent/70' : 'border-line bg-fill'}`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-fg-inverse shadow transition-[left] ${checked ? 'left-[1.375rem]' : 'left-0.5'}`}
      />
    </button>
  )
}

function PreferencesPanel({ leaving, onClose }: { leaving: boolean; onClose: () => void }) {
  const prefs = usePrefs()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // runs once: every preference change re-renders the page, and moving focus
  // to the panel again would end a drag on the slider
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  })
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  return (
    <div
      // no dimming or blur: preferences preview live on the page behind
      className={`fixed inset-0 z-[70] ${leaving ? 'pointer-events-none' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${leaving ? 'nixlens-panel-out' : 'nixlens-panel'} glass-strong glass-blur absolute top-[calc(0.75rem+var(--safe-top))] right-[calc(0.75rem+var(--safe-right))] bottom-[calc(0.75rem+var(--safe-bottom))] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-surface font-sans outline-none`}
      >
        <div className="flex items-center justify-between border-b border-hairline bg-fill py-3.5 pr-3 pl-5">
          <h2 id={titleId} className="text-base font-semibold text-fg-inverse">
            Preferences
          </h2>
          <IconButton label="Close preferences" onClick={onClose}>
            {closeIcon}
          </IconButton>
        </div>
        <div className="flex-1 divide-y divide-hairline overflow-y-auto px-5 py-2">
          <Row label="Accent colour">
            <div role="radiogroup" aria-label="Accent colour" className="flex gap-2">
              {(Object.keys(accents) as Accent[]).map((accent) => (
                <button
                  key={accent}
                  type="button"
                  role="radio"
                  aria-checked={prefs.accent === accent}
                  aria-label={accent}
                  title={accent}
                  onClick={() => setPrefs({ accent })}
                  style={{ background: `linear-gradient(135deg, ${accents[accent][1]}, ${accents[accent][0]})` }}
                  className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-bg-elevated transition outline-accent-cyan focus-visible:outline-2 ${prefs.accent === accent ? 'ring-2 ring-fg-inverse' : 'ring-0 hover:scale-110'}`}
                />
              ))}
            </div>
          </Row>
          <Row label="Background glow" hint={`${Math.round(prefs.glow * 100)} %`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={prefs.glow}
              onChange={(e) => setPrefs({ glow: Number(e.target.value) })}
              aria-label="Background glow"
              className="w-32 accent-[var(--color-accent-cyan)]"
            />
          </Row>
          <Row label="Reduce transparency" hint="Solid panels without blur">
            <Toggle label="Reduce transparency" checked={prefs.solid} onChange={(solid) => setPrefs({ solid })} />
          </Row>
          <Row label="Reduce motion" hint="Also follows the system setting">
            <Toggle
              label="Reduce motion"
              checked={prefs.reduceMotion}
              onChange={(reduceMotion) => setPrefs({ reduceMotion })}
            />
          </Row>
          <Row label="Floating windows" hint="Margins around apps, ending above the dock">
            <Toggle label="Floating windows" checked={prefs.floating} onChange={(floating) => setPrefs({ floating })} />
          </Row>
          <Row label="Collapsed sections" hint={`${prefs.collapsed.length} collapsed`}>
            <button
              type="button"
              disabled={prefs.collapsed.length === 0}
              onClick={() => setPrefs({ collapsed: [] })}
              className="rounded-control border border-line px-3 py-1.5 text-xs text-fg-base transition outline-accent-cyan hover:bg-fill-hover focus-visible:outline-2 disabled:opacity-40"
            >
              Expand all
            </button>
          </Row>
        </div>
        <div className="border-t border-hairline px-5 py-3 text-right">
          <button
            type="button"
            onClick={resetPrefs}
            className="text-xs text-fg-muted transition outline-accent-cyan hover:text-fg-inverse focus-visible:outline-2"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  )
}
