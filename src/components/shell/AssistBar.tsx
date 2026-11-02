// THE ASSIST BAR — the old platform's bottom command pill, in our clothes.
// Three honest doors, nothing invented: the sparkle opens the same Copilot sheet the topbar pill opens, typing…
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { LayoutGrid, Sparkles } from 'lucide-react'
import { useShellStore } from '@/stores/useShellStore'
import { useAssistBarStore } from '@/stores/useAssistBarStore'
import { useAuthStore } from '@/auth/useAuthStore'

// WHERE THE BAR STANDS ASIDE: the bar itself is right, but it gets in the way of reading the chat — and the moment…
export const NO_ASSIST_BAR = ['/app/chat/', '/app/cortex/chat']

export default function AssistBar() {
  const enabled = useAssistBarStore((s) => s.enabled)
  const user = useAuthStore((s) => s.user)
  const { pathname } = useLocation()
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen)
  const setPaletteSeed = useShellStore((s) => s.setPaletteSeed)
  const setCopilotOpen = useShellStore((s) => s.setCopilotOpen)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  // GOES AND COMES BACK on rules, not guesses: scroll DOWN -> it leaves (you are reading toward the bottom) scroll…
  const [hiddenOn, setHiddenOn] = useState<string | null>(null)
  const lastY = useRef(new WeakMap<EventTarget, number>())
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = (e: Event) => {
      const t = e.target
      if (!t) return
      // ONLY THE PAGE'S OWN SCROLLER DECIDES (found live in the chat).
      const el = t as HTMLElement
      if (t !== document && el?.id !== 'main-scroll') return
      const y = t === document ? window.scrollY : el.scrollTop ?? 0
      const prev = lastY.current.get(t) ?? y
      lastY.current.set(t, y)
      if (y > prev + 4) setHiddenOn(window.location.pathname)
      else if (y < prev - 4) setHiddenOn(null)
    }
    const onMouse = (e: MouseEvent) => {
      if (window.innerHeight - e.clientY < 40) setHiddenOn(null)
    }
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('mousemove', onMouse, { passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('mousemove', onMouse)
    }
  }, [])

  if (!enabled) return null
  if (NO_ASSIST_BAR.some((r) => pathname.startsWith(r))) return null
  const away = hiddenOn === pathname && !focused && !text

  const submit = () => {
    const q = text.trim()
    setPaletteSeed(q)
    setPaletteOpen(true)
    setText('')
  }

  return (
    <div
      className={
        'pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 transition-all duration-300 print:hidden ' +
        (away ? 'translate-y-20 opacity-0' : 'translate-y-0 opacity-100')
      }
    >
      <div className="pointer-events-auto flex w-[min(560px,100%)] items-center gap-1.5 rounded-full border border-border bg-surface/95 py-1.5 pl-2 pr-2 shadow-3 backdrop-blur">
        {/* the same lavender the topbar's Copilot star wears — the same
            PURPLE on both: one Copilot, one colour */}
        {(user?.isMaster || user?.copilotStar !== false) && (
        <button
          onClick={() => setCopilotOpen(true)}
          title="Copilot"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-lavender text-tint-fg-lavender transition-transform duration-150 hover:scale-105"
        >
          <Sparkles size={15} />
        </button>
        )}
        <input
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          placeholder="Search apps, pages, actions…"
          className="h-8 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-text-1 outline-none placeholder:text-text-3"
        />
        {(user?.isMaster || user?.appsGrid !== false) && (
        <button
          onClick={() => navigate('/apps')}
          title="All apps"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-3 hover:bg-surface-2 hover:text-text-1"
        >
          <LayoutGrid size={16} />
        </button>
        )}
      </div>
    </div>
  )
}
