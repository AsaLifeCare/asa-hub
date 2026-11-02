// THE ADDRESS PANEL of My Info — the one right panel at its standard width, never a dialog: street, city, state and…
// Cancel and Save stay grey until something changes, and Cancel returns the inputs to what the panel opened on.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Lock, MapPin } from 'lucide-react'
import { AddressMapFrame } from '@/components/shared/AddressMap'
import SidePanel from '@/components/shared/SidePanel'
import { editAnswerOf, type EditRefusal } from '@/lib/recordEdit'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { toast } from '@/stores/useToastStore'
import {
  ADDRESS_FIELDS, ADDRESS_LABEL, ADDRESS_MAX, ADDRESS_READING, US_STATES, addressAfter, addressBad, addressBase,
  addressChanges, addressDraftLine, type AddressKey, type AddressParts, type AddressState, type AddressView,
} from './addressModel'
import { sentence } from './myProfileModel'
import { saveAddress } from './useMyProfile'

export const ADDRESS_PANEL_LABEL = 'Address'
// a typed address reaches the map once the typing pauses, so the map never reloads on every key
export const ADDRESS_MAP_PAUSE_MS = 700
const NO_COLUMN = 'The Employee Database has no column for this.'
const BUTTON = 'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold disabled:cursor-not-allowed ' +
  'disabled:border-transparent disabled:bg-surface-2 disabled:text-text-3'

export default function AddressPanel({ open, ask, name, own, address, onClose, onSaved, onReread }: {
  open: boolean
  /** '' the caller's own record, the master's chosen staff key, null for none */
  ask: string | null
  name: string
  own: boolean
  address: AddressState
  onClose: () => void
  /** a save landed: the parts it wrote, drawn at once */
  onSaved: (next: AddressView) => void
  /** read the address again from the engine (the panel's witness) */
  onReread: () => void
}) {
  const shown = open && ask !== null
  return (
    <SidePanel open={shown} onClose={onClose} label={ADDRESS_PANEL_LABEL}
      title={own ? 'Your address' : `Address · ${name || 'this person'}`}>
      {shown && (
        <AddressBody key={ask ?? ''} ask={ask ?? ''} own={own} address={address} onDone={onClose} onSaved={onSaved}
          onReread={onReread} />
      )}
    </SidePanel>
  )
}

export function AddressBody({ ask, own, address, onDone, onSaved, onReread }: {
  ask: string
  own: boolean
  address: AddressState
  onDone: () => void
  onSaved: (next: AddressView) => void
  onReread: () => void
}) {
  const [draft, setDraft] = useState<Partial<AddressParts>>({})
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<EditRefusal[]>([])
  const [note, setNote] = useState('')
  const v = address.data
  const changes = useMemo(() => (v ? addressChanges(v, draft) : []), [v, draft])
  const wrong = changes.some((c) => addressBad(c.field as AddressKey, c.value))
  const line = v ? addressDraftLine(v, draft) : ''
  const [mapped, setMapped] = useState(line)

  // the witness a save is checked against is the engine's: read again as the panel opens
  useEffect(() => { onReread() }, [onReread])
  // the map follows the inputs: at once when the panel opens, after a pause while a new address is typed
  useEffect(() => {
    if (!mapped) { setMapped(line); return undefined }
    const t = setTimeout(() => setMapped(line), ADDRESS_MAP_PAUSE_MS)
    return () => clearTimeout(t)
  }, [line, mapped])

  if (!v) {
    return (
      <p className="pt-1 text-[12.5px] text-text-3" data-address-panel="">
        {address.status === 'refused' || address.status === 'failed' ? sentence(address.error) : ADDRESS_READING}
      </p>
    )
  }

  const put = (k: AddressKey, value: string) => {
    setDraft((d) => ({ ...d, [k]: value }))
    setNote('')
  }
  const keepOnly = (fields: string[]) => {
    const kept = new Set(fields)
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([f]) => kept.has(f))))
  }

  const save = async () => {
    if (!changes.length || wrong) return
    const sent = changes
    setBusy(true)
    setNote('')
    try {
      const got = editAnswerOf(await saveAddress(ask, sent))
      const next = addressAfter(v, sent, got.written)
      if (got.written.length) onSaved(next)
      setRefused(got.refused)
      keepOnly(got.refused.map((r) => r.field))
      if (got.refused.length) {
        setNote(got.written.length ? 'Partly saved — the reasons are under the fields.' : 'Not saved — the reasons are under the fields.')
      } else {
        toast({ type: 'success', title: 'Address saved', body: own ? 'Your address is updated.' : 'The address is updated.' })
        onDone()
      }
    } catch (e) {
      const err = e as { status?: unknown; envelope?: { data?: unknown } } | null
      const message = e instanceof Error ? e.message : String(e)
      if (err?.status === 409) {
        // changed since the panel opened: what landed is drawn, the rest is read again before anything is sent twice
        const a = editAnswerOf(err.envelope?.data)
        if (a.written.length) onSaved(addressAfter(v, sent, a.written))
        setRefused(a.refused)
        keepOnly(sent.map((c) => c.field).filter((f) => !a.written.includes(f)))
        setNote(`${sentence(message)} Check the address and save again.`)
        onReread()
      } else {
        setNote(`Not saved: ${sentence(message)}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const why = new Map(refused.map((r) => [r.field, r.why]))
  const dirty = changes.length > 0
  return (
    <div className="grid gap-5 pt-1" data-address-panel="">
      <p className="text-[12.5px] leading-5 text-text-3">
        {own ? 'Saved on your record in the Employee Database.' : 'Saved on this person’s record in the Employee Database.'}{' '}
        Only the fields you change are sent.
      </p>
      {mapped && (
        <div className="grid gap-2" data-address-panel-map="">
          <p className="flex items-start gap-2 text-[12.5px] leading-5 text-text-2" data-address-panel-line="">
            <MapPin size={14} className="mt-0.5 shrink-0 text-text-3" />
            <span className="min-w-0 break-words">{mapped}</span>
            {line !== mapped && <Loader2 size={13} className="mt-1 shrink-0 animate-spin text-text-3" data-address-map-waiting="" />}
          </p>
          <AddressMapFrame address={mapped} height={220} />
        </div>
      )}
      <div className="grid gap-3">
        {ADDRESS_FIELDS.map((k) => {
          const lock = v.locked[k] || (k in v.edit ? '' : NO_COLUMN)
          if (lock) {
            return (
              <div key={k} className="grid gap-1.5" data-address-locked={k}>
                <span className="text-[12px] font-medium text-text-2">{ADDRESS_LABEL[k]}</span>
                <div className="flex min-h-9 items-center gap-2 rounded-sm border border-dashed border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text-2">
                  <Lock size={13} className="shrink-0 text-text-3" />
                  <span className="min-w-0 break-words">{v.address[k] || '—'}</span>
                </div>
                <p className="text-[11.5px] leading-4 text-text-3">{sentence(lock)}</p>
              </div>
            )
          }
          const base = addressBase(v, k)
          const value = draft[k] ?? base
          const changed = changes.some((c) => c.field === k)
          const bad = changed ? addressBad(k, value) : ''
          return (
            <div key={k} className="grid gap-1" data-address-field={k}>
              <Field label={ADDRESS_LABEL[k]}>
                {k === 'state' ? (
                  <select value={value} disabled={busy} className={inputCls} onChange={(e) => put(k, e.target.value)}>
                    {[...new Set(['', base, ...US_STATES])].map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                  </select>
                ) : (
                  <input type="text" value={value} disabled={busy} maxLength={ADDRESS_MAX[k]} className={inputCls}
                    inputMode={k === 'zip' ? 'numeric' : undefined} autoComplete={AUTOCOMPLETE[k]}
                    onChange={(e) => put(k, e.target.value)} />
                )}
              </Field>
              {bad && <p className="text-[11.5px] leading-4 text-[var(--warning)]" data-address-bad={k}>{bad}</p>}
              {why.has(k) && <p className="text-[11.5px] leading-4 text-danger" data-address-refused={k}>{why.get(k)}</p>}
            </div>
          )
        })}
      </div>
      {note && <p role="alert" className="text-[12px] leading-5 text-[var(--warning)]" data-address-note="">{note}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3" data-address-actions="">
        <button type="button" disabled={!dirty || busy} data-address-cancel=""
          onClick={() => { setDraft({}); setRefused([]); setNote('') }}
          className={`${BUTTON} border border-border bg-surface text-text-1 hover:bg-surface-2`}>
          Cancel
        </button>
        <button type="button" disabled={!dirty || busy || wrong} data-address-save="" onClick={() => void save()}
          className={`${BUTTON} bg-primary text-on-primary hover:bg-primary-hover`}>
          {busy && <Loader2 size={14} className="animate-spin" />} Save
        </button>
      </div>
    </div>
  )
}

const AUTOCOMPLETE: Record<AddressKey, string> = {
  address: 'street-address', city: 'address-level2', state: 'address-level1', zip: 'postal-code',
}
