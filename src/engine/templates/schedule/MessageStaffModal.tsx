/** Message-staff modal (moved verbatim from ScheduleTemplate.tsx). */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { MessageCirclePlus, Send, X } from 'lucide-react'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { CalEvent } from '@/engine/types'
import type { Resource } from './types'

export function MessageStaffModal({
  resources,
  events,
  onClose,
}: {
  resources: Resource[]
  events: CalEvent[]
  onClose: () => void
}) {
  const push = useNotificationStore((s) => s.push)
  const prefill = (pid: string, eid: string) => {
    const p = resources.find((r) => r.id === pid)
    const rel = events.find((e) => e.id === eid)
    const first = p?.name.split(' ')[0] ?? 'there'
    const target = rel ? `"${rel.title}" on ${format(new Date(`${rel.date}T00:00:00`), 'EEE MMM d')}` : 'your next shift'
    return `Hi ${first} — can you cover / make it to ${target}?`
  }
  const [personId, setPersonId] = useState(resources[0]?.id ?? '')
  const [eventId, setEventId] = useState('')
  const [msg, setMsg] = useState(() => prefill(resources[0]?.id ?? '', ''))
  const [dirty, setDirty] = useState(false)
  const person = resources.find((r) => r.id === personId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const send = () => {
    if (!person || !msg.trim()) return
    push({
      type: 'reminder',
      title: `Message sent to ${person.name}`,
      body: msg.trim(),
      priority: 'normal',
      appId: 'schedule',
      href: '/app/schedule/week',
    })
    toast({ type: 'success', title: 'Message sent', body: `Delivered to ${person.name}.` })
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[400px] rounded-lg border border-border bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 font-display text-[15px] font-bold text-text-1">
            <MessageCirclePlus size={16} className="text-text-3" />
            Message staff
          </p>
          <button aria-label="Close" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-[8px] text-text-3 hover:bg-surface-2">
            <X size={14} />
          </button>
        </div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Teammate</label>
        <select
          value={personId}
          onChange={(e) => {
            setPersonId(e.target.value)
            if (!dirty) setMsg(prefill(e.target.value, eventId))
          }}
          className="mb-3 h-9 w-full rounded-sm border border-border bg-surface px-2 text-[13px] text-text-1 outline-none focus:border-primary"
        >
          {resources.map((r) => (
            <option key={r.id} value={r.id}>{r.name} · {r.role}</option>
          ))}
        </select>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Related event / day (optional)</label>
        <select
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value)
            if (!dirty) setMsg(prefill(personId, e.target.value))
          }}
          className="mb-3 h-9 w-full rounded-sm border border-border bg-surface px-2 text-[13px] text-text-1 outline-none focus:border-primary"
        >
          <option value="">No related event</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {format(new Date(`${e.date}T00:00:00`), 'EEE MMM d')} · {e.start} · {e.title}
            </option>
          ))}
        </select>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Message</label>
        <textarea
          autoFocus
          rows={4}
          value={msg}
          onChange={(e) => {
            setMsg(e.target.value)
            setDirty(true)
          }}
          className="mb-4 w-full resize-none rounded-sm border border-border bg-surface px-3 py-2 text-[13px] leading-5 text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-sm px-3 text-[12px] font-medium text-text-2 hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={send}
            disabled={!msg.trim()}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            <Send size={14} /> Send
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
