// Toast stacks: routine toasts in the person's chosen corner (max four, 5s); urgent ones pinned right, open-shift…
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, Siren, X, XCircle } from 'lucide-react'
import { useToastStore, type ToastItem, type ToastType } from '@/stores/useToastStore'
import { TOAST_TINT } from '@/stores/useToastStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useUiPrefsStore, type ToastPosition } from '@/stores/useUiPrefsStore'
import { stackOrder, urgentCorner } from './toastLayout'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'

/** Container per corner: where the stack pins and which way rows align. */
const CORNER_CLS: Record<ToastPosition, string> = {
  'top-left': 'top-5 left-5 items-start',
  'top-right': 'top-5 right-5 items-end',
  'bottom-left': 'bottom-5 left-5 items-start',
  'bottom-right': 'bottom-5 right-5 items-end',
}

const ICONS: Record<ToastType, typeof Info> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  danger: XCircle,
}
const BAR: Record<ToastType, string> = {
  success: 'var(--success)',
  info: 'var(--info)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
}

/** The longest a browser timer can wait; a later expiry is simply not timed. */
const MAX_TIMER_MS = 2 ** 31 - 1

/** Following a toast's link is reading what it was about. */
function useOpen(t: ToastItem) {
  const dismiss = useToastStore((s) => s.dismiss)
  const navigate = useNavigate()
  return () => {
    if (!t.action) return
    navigate(t.action.href)
    if (t.key) useNotificationStore.getState().markRead(t.key)
    dismiss(t.id)
  }
}

function motionFor(position: ToastPosition) {
  // enter from its own edge, exit toward its pinned side
  const fromTop = position.startsWith('top')
  const fromLeft = position.endsWith('left')
  return {
    layout: true as const,
    initial: { opacity: 0, y: fromTop ? -16 : 16, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, x: fromLeft ? -24 : 24 },
    transition: { type: 'spring' as const, stiffness: 340, damping: 30 },
  }
}

function ToastCard({ t, position }: { t: ToastItem; position: ToastPosition }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const open = useOpen(t)
  const Icon = ICONS[t.type]

  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), 5000)
    return () => clearTimeout(id)
  }, [t.id, dismiss])

  return (
    <motion.div
      {...motionFor(position)}
      className="relative w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-md border border-border bg-surface shadow-2"
      role="status"
    >
      <span className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ background: BAR[t.type] }} />
      <div className="flex items-start gap-3 p-3.5 pl-4">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-[8px]', TINT_BG[TOAST_TINT[t.type]])}>
          <Icon size={15} className={TINT_FG[TOAST_TINT[t.type]]} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-5 text-text-1">{t.title}</p>
          {t.body && <p className="clamp-2 mt-0.5 text-[13px] leading-5 text-text-2">{t.body}</p>}
          {t.action && (
            <button
              onClick={open}
              className="mt-1 text-[12px] font-semibold text-primary hover:text-primary-hover"
            >
              {t.action.label} →
            </button>
          )}
        </div>
        <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
          <X size={13} />
        </button>
      </div>
      <motion.span
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: 5, ease: 'linear' }}
        className="block h-[2px]"
        style={{ background: BAR[t.type] }}
      />
    </motion.div>
  )
}

/** The urgent card: no timer; an invitation leaves when its window closes. */
function UrgentCard({ t, position }: { t: ToastItem; position: ToastPosition }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const open = useOpen(t)
  // closing it marks it read, so it never pins again
  const close = () => {
    if (t.key) useNotificationStore.getState().markRead(t.key)
    dismiss(t.id)
  }

  useEffect(() => {
    if (!t.expiresAt) return
    const wait = t.expiresAt - Date.now()
    if (wait > MAX_TIMER_MS) return
    const id = setTimeout(() => dismiss(t.id), Math.max(0, wait))
    return () => clearTimeout(id)
  }, [t.id, t.expiresAt, dismiss])

  return (
    <motion.div
      {...motionFor(position)}
      data-urgent-toast=""
      className="relative w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-md border border-[#5c0000] bg-[#8b0000] text-white shadow-3"
      role="alert"
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-white/15">
          <Siren size={15} className="text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-5 text-white">{t.title}</p>
          {t.body && <p className="clamp-3 mt-0.5 text-[13px] leading-5 text-white/85">{t.body}</p>}
          {t.action && (
            <button
              onClick={open}
              className="mt-1.5 rounded-sm bg-white px-2.5 py-1 text-[12px] font-semibold text-[#8b0000] hover:bg-white/90"
            >
              {t.action.label} →
            </button>
          )}
        </div>
        <button onClick={close} aria-label="Dismiss" className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-white/80 hover:bg-white/15 hover:text-white">
          <X size={13} />
        </button>
      </div>
    </motion.div>
  )
}

/** Drawn even when empty so screen readers announce the first row. */
function Stack({ items, position, assertive }: { items: ToastItem[]; position: ToastPosition; assertive?: boolean }) {
  return (
    <div
      aria-live={assertive ? 'assertive' : 'polite'}
      data-toast-corner={position}
      className={cn('pointer-events-none fixed z-[60] flex flex-col gap-2.5 [&>*]:pointer-events-auto', CORNER_CLS[position])}
    >
      <AnimatePresence>
        {items.map((t) => (t.urgent
          ? <UrgentCard key={t.id} t={t} position={position} />
          : <ToastCard key={t.id} t={t} position={position} />))}
      </AnimatePresence>
    </div>
  )
}

/** The stacks for these toasts and this corner (testable without the stores). */
export function ToastStacks({ toasts, position }: { toasts: ToastItem[]; position: ToastPosition }) {
  const pinned = urgentCorner(position)
  if (pinned === position) {
    // one polite column; an urgent card is its own role="alert"
    return <Stack items={stackOrder(toasts, position)} position={position} />
  }
  return (
    <>
      <Stack items={stackOrder(toasts.filter((t) => !t.urgent), position)} position={position} />
      <Stack items={stackOrder(toasts.filter((t) => t.urgent), pinned)} position={pinned} assertive />
    </>
  )
}

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const position = useUiPrefsStore((s) => s.toastPosition)
  return <ToastStacks toasts={toasts} position={position} />
}
