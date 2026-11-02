// "Are you sure" for the destructive half of the ops screens.
// These rows live in the ESTATE's spreadsheets — the same documents the old world's forms write into — so a removal…
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TriangleAlert } from 'lucide-react'
import { outlineBtnCls } from '@/pages/features/clientops/OpsPageShell'

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Remove',
  busyLabel = 'Removing…',
  cancelLabel = 'Keep it',
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  /** What the confirm button says while the act runs — the verb, not always "Removing". */
  busyLabel?: string
  cancelLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/45"
          />
          <div className="absolute inset-0 grid place-items-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              role="alertdialog"
              aria-modal="true"
              aria-label={title}
              className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-3"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-tint-danger">
                  <TriangleAlert size={17} className="text-tint-fg-danger" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-[15.5px] font-bold text-text-1">{title}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-text-2">{body}</p>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button onClick={onCancel} className={outlineBtnCls}>{cancelLabel}</button>
                <button
                  onClick={onConfirm}
                  disabled={busy}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-danger px-4 text-[13px] font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                >
                  {busy ? busyLabel : confirmLabel}
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}
