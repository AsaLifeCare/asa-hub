// The one dialog surface for the whole platform, mounted once in App.
// Everything the browser's confirm/prompt did, in the platform's own skin: focus lands where the answer is given…
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TriangleAlert } from 'lucide-react'
import { useDialogStore } from '@/stores/useDialogStore'
import { cn } from '@/lib/utils'

export default function DialogHost() {
  const pending = useDialogStore((s) => s.pending)
  const close = useDialogStore((s) => s.close)

  const [draft, setDraft] = useState('')
  const [askedId, setAskedId] = useState<number | null>(null)
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  // Each question starts from its own default — never the previous answer.
  if (pending && pending.id !== askedId) {
    setAskedId(pending.id)
    setDraft(pending.kind === 'prompt' ? (pending.defaultValue ?? '') : '')
  }

  useEffect(() => {
    if (!pending) return
    const t = window.setTimeout(() => {
      if (pending.kind === 'prompt') fieldRef.current?.focus()
      else confirmRef.current?.focus()
    }, 30)
    return () => window.clearTimeout(t)
  }, [pending?.id, pending])

  if (!pending) return null

  const isPrompt = pending.kind === 'prompt'
  const danger = pending.tone === 'danger'
  const blocked = isPrompt && !!pending.required && !draft.trim()

  const cancel = () => {
    if (pending.kind === 'confirm') pending.resolve(false)
    else pending.resolve(null)
    close()
  }

  const accept = () => {
    if (blocked) return
    if (pending.kind === 'confirm') pending.resolve(true)
    else pending.resolve(draft)
    close()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key !== 'Enter') return
    // In a textarea Enter writes a newline — only the explicit combo submits.
    if (isPrompt && pending.multiline && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    accept()
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200]" onKeyDown={onKey}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onMouseDown={cancel}
          className="absolute inset-0 bg-black/50"
        />
        <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4">
          <motion.div
            key={pending.id}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.17 }}
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title}
            className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-3"
          >
            <div className="flex items-start gap-3">
              {danger && (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-tint-danger">
                  <TriangleAlert size={17} className="text-tint-fg-danger" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-[15.5px] font-bold leading-5 text-text-1">{pending.title}</h2>
                {pending.body && (
                  <p className="mt-1.5 whitespace-pre-line text-[13px] leading-5 text-text-2">{pending.body}</p>
                )}
              </div>
            </div>

            {pending.detail && (
              <p className="mt-3 rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber">
                {pending.detail}
              </p>
            )}

            {isPrompt && (
              <div className="mt-4">
                {pending.label && (
                  <label
                    htmlFor="hub-dialog-field"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3"
                  >
                    {pending.label}
                    {!pending.required && <span className="ml-1 font-normal normal-case tracking-normal">— optional</span>}
                  </label>
                )}
                {pending.multiline ? (
                  <textarea
                    id="hub-dialog-field"
                    ref={(el) => { fieldRef.current = el }}
                    rows={4}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={pending.placeholder}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[13.5px] leading-5 text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
                  />
                ) : (
                  <input
                    id="hub-dialog-field"
                    ref={(el) => { fieldRef.current = el }}
                    type={pending.inputType === 'date' ? 'date' : 'text'}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={pending.placeholder}
                    className="h-9 w-full rounded-md border border-border bg-bg px-3 text-[13.5px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
                  />
                )}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={cancel}
                className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmRef}
                onClick={accept}
                disabled={blocked}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-md px-4 text-[13px] font-semibold transition-all duration-150 active:scale-[0.98] disabled:opacity-40',
                  danger ? 'bg-danger text-white hover:opacity-90' : 'bg-primary text-on-primary hover:bg-primary-hover',
                )}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </AnimatePresence>
  )
}
