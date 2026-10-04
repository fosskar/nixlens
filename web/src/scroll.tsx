import { type ReactNode, useEffect, useRef, useState } from 'react'

function ScrollHint({
  direction,
  visible,
  onClick,
}: {
  direction: 'up' | 'down'
  visible: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      title={direction === 'up' ? 'Scroll up' : 'Scroll down'}
      className={`nos-scroll-hint absolute left-1/2 z-10 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-fg-base shadow-[0_6px_18px_-6px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.12)] backdrop-blur-xl backdrop-saturate-150 transition-[opacity,transform,background-color] duration-300 hover:bg-white/[0.16] hover:text-fg-inverse ${direction === 'up' ? 'top-2' : 'bottom-2'} ${visible ? 'opacity-100' : 'pointer-events-none scale-75 opacity-0'}`}
      data-direction={direction}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 fill-none stroke-current"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={direction === 'up' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
      </svg>
    </button>
  )
}

// a scroll container without a scrollbar: the edges fade where content
// continues and a small glass arrow offers to scroll there
export function ScrollArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () =>
      setEdges({
        top: el.scrollTop > 4,
        bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
      })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  const scrollBy = (sign: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ top: sign * el.clientHeight * 0.8, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className="relative flex min-h-0 flex-col">
      <div
        ref={ref}
        className="nos-scroll min-h-0 overflow-y-auto"
        data-fade-top={edges.top || undefined}
        data-fade-bottom={edges.bottom || undefined}
      >
        {children}
      </div>
      <ScrollHint direction="up" visible={edges.top} onClick={() => scrollBy(-1)} />
      <ScrollHint direction="down" visible={edges.bottom} onClick={() => scrollBy(1)} />
    </div>
  )
}
