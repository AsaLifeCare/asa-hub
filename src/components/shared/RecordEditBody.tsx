// THE EDIT BODY every record app puts inside its own right panel (a SidePanel body, never a dialog).
// One input per field; a locked field is drawn read-only with its reason and where it is edited instead.
import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { toast } from '@/stores/useToastStore'
import {
  diffChanges, editAsDate, editShown, type EditAnswer, type EditChange, type EditField, type EditRefusal,
} from '@/lib/recordEdit'

const INPUT_TYPE: Record<string, string> = { phone: 'tel', email: 'email', url: 'url' }

export default function RecordEditBody({ fields, onFile, onDone, intro, applyLabel, stay = false, locked = false }: {
  fields: readonly EditField[]
  /** files the changes; `confirmed` names the fields whose confirmation box is ticked */
  onFile: (changes: EditChange[], confirmed: string[]) => Promise<EditAnswer>
  onDone: () => void
  intro?: string
  /** the second press's words for n changes (default "Save n changes — press again") */
  applyLabel?: (n: number) => string
  /** a landed save keeps the panel open: what follows the write is the caller's to show (an Apply strip) */
  stay?: boolean
  /** the form is held while the caller's own work runs */
  locked?: boolean
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<EditRefusal[]>([])
  const changes = useMemo(() => diffChanges(fields, draft), [fields, draft])
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields])
  const unconfirmed = changes.some((c) => byKey.get(c.field)?.confirm && !ticked[c.field])

  const put = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setArmed(false)
  }

  const file = async () => {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    try {
      const got = await onFile(changes, changes.filter((c) => ticked[c.field]).map((c) => c.field))
      setArmed(false)
      setRefused(got.refused)
      const kept = new Set(got.refused.map((r) => r.field))
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => kept.has(k))))
      if (got.refused.length) {
        toast({ type: 'warning', title: got.written.length ? 'Partly saved' : 'Not saved',
          body: `${got.refused.length} field${got.refused.length === 1 ? ' was' : 's were'} refused — the reasons are on the form.` })
      } else if (!stay) {
        toast({ type: 'success', title: 'Saved', body: `${got.written.length} field${got.written.length === 1 ? '' : 's'} saved.` })
        onDone()
      }
    } catch (e) {
      setArmed(false)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const why = new Map(refused.map((r) => [r.field, r.why]))
  // one column no wider than the panel, and a long unbroken value (a link) breaks anywhere: neither widens the form
  return (
    <div className="grid grid-cols-1 gap-5 pt-1" data-record-edit="">
      {intro && <p className="text-[12.5px] leading-5 text-text-3">{intro}</p>}
      <div className="grid grid-cols-1 gap-3">
        {fields.map((f) => (f.lockedBy ? (
          <div key={f.key} className="grid gap-1.5" data-edit-locked={f.key}>
            <span className="text-[12px] font-medium text-text-2">{f.label}</span>
            <div className="flex min-h-9 items-center gap-2 rounded-sm border border-dashed border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text-2">
              <Lock size={13} className="shrink-0 text-text-3" />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{editShown(f) || '—'}</span>
            </div>
            {(f.lockedBy.why || f.lockedBy.door) && (
              <p className="text-[11.5px] leading-4 text-text-3">
                {f.lockedBy.why}{f.lockedBy.door ? ` Edited in ${f.lockedBy.door}.` : ''}
              </p>
            )}
          </div>
        ) : (
          <div key={f.key} className="grid gap-1" data-edit-field={f.key}>
            <Field label={f.label}>
              {f.kind === 'select' ? (
                <select value={draft[f.key] ?? editShown(f)} disabled={busy} className={inputCls}
                  onChange={(e) => put(f.key, e.target.value)}>
                  {[...new Set(['', editShown(f), ...(f.options ?? [])])].map((o) => (
                    <option key={o} value={o}>{o ? (f.optionLabels?.[o] ?? o) : '—'}</option>
                  ))}
                </select>
              ) : f.kind === 'textarea' ? (
                <textarea value={draft[f.key] ?? editShown(f)} disabled={busy} maxLength={f.max ?? 4000} rows={8}
                  className={`${inputCls} h-auto min-h-[160px] py-2 leading-5`} onChange={(e) => put(f.key, e.target.value)} />

              ) : (
                <input type={editAsDate(f) ? 'date' : (INPUT_TYPE[f.kind] ?? 'text')} value={draft[f.key] ?? editShown(f)}
                  disabled={busy} maxLength={f.max ?? 500} className={inputCls} onChange={(e) => put(f.key, e.target.value)} />
              )}
            </Field>
            {f.hint && <p className="text-[11.5px] leading-4 text-text-3">{f.hint}</p>}
            {f.confirm && changes.some((c) => c.field === f.key) && (
              <label className="mt-1 flex items-start gap-2 text-[12px] text-text-2" data-edit-confirm={f.key}>
                <input type="checkbox" checked={!!ticked[f.key]} disabled={busy}
                  onChange={(e) => { setTicked((t) => ({ ...t, [f.key]: e.target.checked })); setArmed(false) }} />
                <span>{f.confirm}</span>
              </label>
            )}
            {why.has(f.key) && <p className="text-[11.5px] leading-4 text-danger" data-edit-refused={f.key}>{why.get(f.key)}</p>}
          </div>
        )))}
      </div>
      {armed && changes.length > 0 && (
        <div className="grid gap-1.5 rounded-md border border-border bg-surface-2 p-3 text-[12.5px]" data-edit-review="">
          <span className="font-semibold text-text-1">What will be saved</span>
          {changes.map((c) => {
            const f = byKey.get(c.field)
            const word = (v: string) => f?.optionLabels?.[v] ?? v
            return (
              <span key={c.field} className="break-words text-text-2 [overflow-wrap:anywhere]">
                {f?.label ?? c.field}: {word(f ? editShown(f) : c.expected) || '—'} → {word(c.value) || '(blank)'}
              </span>
            )
          })}
        </div>
      )}
      <DraftButtons armed={armed} busy={busy || locked} disabled={changes.length === 0 || unconfirmed} label="Review changes"
        armedLabel={applyLabel ? applyLabel(changes.length) : `Save ${changes.length} change${changes.length === 1 ? '' : 's'} — press again`}
        onPress={() => void file()} onDisarm={() => setArmed(false)} onCancel={onDone} />
    </div>
  )
}
