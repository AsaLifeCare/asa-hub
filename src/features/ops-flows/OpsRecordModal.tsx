// Report / edit one estate record — field-driven, so the three ops screens describe their columns and share this…
// The field list is written against the SHEET's real headers (the backend drops anything the sheet does not have)…
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { ChipPicker, Field, inputCls, primaryBtnCls, outlineBtnCls } from '@/pages/features/clientops/OpsPageShell'
import type { OpsRow } from './useOpsCrud'
import { cn } from '@/lib/utils'

export type OpsField = {
  key: string
  label: string
  kind?: 'text' | 'textarea' | 'date' | 'time' | 'chips' | 'select' | 'checks'
  options?: readonly string[]
  required?: boolean
  placeholder?: string
  /** the line under the label that says what the field asks */
  hint?: string
  /** shown only when this predicate passes — e.g. "how late" only for a late show */
  when?: (values: Record<string, string>) => boolean
  /** filled by the server (timestamps) or by the session (reporter) */
  auto?: boolean
}

export default function OpsRecordModal({
  open,
  title,
  fields,
  row,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  fields: OpsField[]
  /** null = report a new one; a row = edit that one */
  row: OpsRow | null
  /** a new report's starting values (the house it is about); stable identity */
  initial?: Record<string, string>
  busy?: boolean
  onClose: () => void
  onSubmit: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    const next: Record<string, string> = {}
    for (const f of fields) next[f.key] = String(row?.[f.key] ?? initial?.[f.key] ?? '')
    setValues(next)
  }, [open, row, initial, fields])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const shown = fields.filter((f) => !f.auto && (!f.when || f.when(values)))
  const missing = shown.filter((f) => f.required && !String(values[f.key] ?? '').trim())
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }))

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/45"
          />
          <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface shadow-3"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="font-display text-[17px] font-bold text-text-1">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid gap-3.5 px-5 py-4">
                {shown.map((f) => (
                  <Field key={f.key} label={f.label} required={f.required}>
                    {f.kind === 'textarea' ? (
                      <textarea
                        value={values[f.key] ?? ''}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        rows={3}
                        className={cn(inputCls, 'h-auto py-2 leading-5')}
                      />
                    ) : f.kind === 'chips' && f.options ? (
                      <ChipPicker options={f.options} value={(values[f.key] ?? '') as any} onChange={(v) => set(f.key, v)} />
                    ) : f.kind === 'select' && f.options ? (
                      <select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} className={inputCls}>
                        <option value="">—</option>
                        {f.options.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.kind === 'date' ? 'date' : f.kind === 'time' ? 'time' : 'text'}
                        value={values[f.key] ?? ''}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className={inputCls}
                      />
                    )}
                  </Field>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                <button onClick={onClose} className={outlineBtnCls}>Cancel</button>
                <button
                  onClick={() => onSubmit(values)}
                  disabled={busy || missing.length > 0}
                  title={missing.length ? `Still needed: ${missing.map((f) => f.label).join(', ')}` : undefined}
                  className={primaryBtnCls}
                >
                  {busy ? 'Saving…' : row ? 'Save changes' : 'Report'}
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}
