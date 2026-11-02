// SUGGESTIONS — the numbers a shift dials.
// Every phone number lives in settings as configuration, and the same holds in a franchise, except that there every…
import { useEffect, useState } from 'react'
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import DragPerson from '@/components/shared/DragPerson'
import { toast } from '@/stores/useToastStore'
import { DEFAULT_GROUPS } from '@/pages/features/suggestions/HelpfulContacts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { currentPlaceKey } from '@/lib/placeKey'

type ContactRow = { id?: string; group?: string; name?: string; note?: string; phone?: string }

const GROUPS = [
  { id: 'emergency', label: 'Emergency' },
  { id: 'hospitals', label: 'Hospitals' },
  { id: 'agencies', label: 'Agencies' },
  { id: 'team', label: 'Team' },
]

export default function SuggestionsSection() {
  const [rows, setRows] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ group: 'team', name: '', note: '', phone: '' })

  const load = async () => {
    try {
      const r = await api.list<ContactRow>('helpfulContacts')
      setRows(Array.isArray(r) ? r : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const add = async () => {
    const phone = draft.phone.trim()
    if (!phone) { toast({ type: 'warning', title: 'A number is required', body: 'Type the number this contact answers on.' }); return }
    setBusy(true)
    try {
      // The create answers with the row.
      const created = await api.create<ContactRow>('helpfulContacts', {
        group: draft.group, name: draft.name.trim() || phone,
        note: draft.note.trim(), phone,
      })
      setDraft({ group: draft.group, name: '', note: '', phone: '' })
      setRows((prev) => [...prev, created])
    } catch (e) {
      toast({ type: 'danger', title: 'Could not add the contact', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(false) }
  }

  const remove = async (row: ContactRow) => {
    if (!row.id) return
    setBusy(true)
    try {
      await api.remove('helpfulContacts', String(row.id))
      setRows((prev) => prev.filter((r) => String(r.id) !== String(row.id)))
    } catch (e) {
      toast({ type: 'danger', title: 'Could not remove it', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(false) }
  }

  /** Headquarters' original list, written as rows this place now owns. */
  const restore = async () => {
    setBusy(true)
    try {
      const restored: ContactRow[] = []
      for (const g of DEFAULT_GROUPS) {
        for (const c of g.contacts) {
          restored.push(await api.create<ContactRow>('helpfulContacts', {
            group: g.id, name: c.name, note: c.note ?? '', phone: c.phone,
          }))
        }
      }
      setRows((prev) => [...prev, ...restored])
      toast({ type: 'success', title: 'Standard list restored', body: 'Edit or remove any number that is not right for this workspace.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Could not restore the list', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(false) }
  }

  return (
    <section id="suggestions" className="scroll-mt-[84px]">
      <div className="rounded-[18px] border border-border bg-surface p-6">
        <div className="mb-4">
          <h2 className="text-[17px] font-semibold text-text-1">Suggestions</h2>
          <p className="text-[13px] text-text-3">
            The helpful contacts shown under the suggestion box — emergency lines, hospitals, agencies and
            your own team. They belong to this workspace: another place keeps its own, and empty is a
            perfectly good answer.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Reading the list…
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <select
                value={draft.group}
                onChange={(e) => setDraft({ ...draft, group: e.target.value })}
                className="h-9 rounded-[10px] border border-border bg-bg px-2 text-[13px] text-text-1"
              >
                {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <input
                value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="who answers"
                className="h-9 min-w-[160px] flex-1 rounded-[10px] border border-border bg-bg px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
              />
              <input
                value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="note (optional)"
                className="h-9 min-w-[120px] rounded-[10px] border border-border bg-bg px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
              />
              <input
                value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="number"
                className="h-9 min-w-[140px] rounded-[10px] border border-border bg-bg px-3 font-mono text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
              />
              <button
                onClick={() => void add()} disabled={busy}
                className="flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                <Plus size={14} /> Add
              </button>
            </div>

            {rows.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[13px] text-text-3">
                  No numbers here yet — the suggestion screen simply shows none.
                </p>
                {/* THE STANDARD LIST IS OHIO'S — the only defaults that
                    exist are Ohio's, so they are not offered elsewhere.
                    Offering it away from headquarters would
                    import one place's emergency lines into another, which is
                    the exact mixing this whole day was spent undoing. */}
                {!currentPlaceKey() && (
                  <button
                    onClick={() => void restore()} disabled={busy}
                    className="flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-[12.5px] font-medium text-text-1 hover:bg-surface-2 disabled:opacity-40"
                  >
                    <RotateCcw size={13} /> Restore the standard list
                  </button>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={String(r.id)} className="flex items-center gap-3 py-2">
                    <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wide text-text-3">
                      {GROUPS.find((g) => g.id === r.group)?.label ?? r.group}
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* only the TEAM group holds people — the emergency,
                          hospital and agency rows are organisations */}
                      <DragPerson
                        name={String(r.group) === 'team' ? String(r.name ?? '') : ''}
                        subtitle={r.note ? String(r.note) : undefined}
                        className="block min-w-0"
                      >
                        <span className="clamp-1 block text-[13px] font-medium text-text-1">{formatPhoneDisplay(r.name)}</span>
                      </DragPerson>
                      {r.note && <span className="block text-[11px] text-text-3">{r.note}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[12.5px] text-text-2">{formatPhoneDisplay(String(r.phone ?? ''))}</span>
                    <button
                      onClick={() => void remove(r)} disabled={busy}
                      title="Remove this number"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-3 hover:bg-surface-2 hover:text-tint-fg-pink disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  )
}
