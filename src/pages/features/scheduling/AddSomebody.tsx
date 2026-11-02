/** Add Somebody: a person row for the house, from the people the platform knows who are not on its rows yet. */
import { useState } from 'react'
import { Loader2, UserPlus, X } from 'lucide-react'
import { houseLabel, type Board, type WriteAnswer } from './schedulingModel'
import { addPerson, prefsReasonOf, saidOf } from './schedulingLane'
import { FIELD, LABEL, Muted, PRIMARY_BTN, PrefsOverride, Refusal } from './SchedulingParts'

export default function AddSomebody({ board, house, onWrite, onClose }: {
  board: Board
  house: string
  onWrite: (answer: WriteAnswer, close: boolean) => void
  onClose: () => void
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [prefs, setPrefs] = useState<{ reason: string; name: string } | null>(null)
  const here = new Set((board.grids[house]?.rows ?? []).filter((r) => r.kind === 'person').map((r) => r.key))
  const choices = board.people.filter((p) => !here.has(p.key)).sort((a, b) => a.name.localeCompare(b.name))
  const picked = choices.find((p) => p.key === key) ?? null

  const add = async (override = false) => {
    const name = override ? prefs?.name ?? '' : picked?.name ?? ''
    if (!name || busy) return
    setBusy(true)
    setRefusal('')
    setPrefs(null)
    try {
      onWrite(await addPerson(house, name, override), true)
    } catch (err) {
      const reason = prefsReasonOf(err)
      if (reason && !override) setPrefs({ reason, name })
      else setRefusal(saidOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-[16px] border border-border bg-surface p-3 shadow-1" data-add-somebody="">
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${LABEL} min-w-[220px] flex-1`}>
          Add to {houseLabel(board, house)}
          <select value={key} onChange={(e) => { setKey(e.target.value); setPrefs(null) }} className={FIELD}>
            <option value="">Pick somebody…</option>
            {choices.map((p) => <option key={p.key} value={p.key}>{p.name}{p.has_account ? '' : ' (no account yet)'}</option>)}
          </select>
        </label>
        <button type="button" disabled={!picked || busy} onClick={() => void add()} className={PRIMARY_BTN}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Add their row
        </button>
        <button type="button" onClick={onClose} aria-label="Not now"
          className="grid h-9 w-9 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
          <X size={15} />
        </button>
      </div>
      {board.people.length === 0 && <Muted className="mt-2">The people list is not in this answer, so nobody can be offered.</Muted>}
      <Refusal>{refusal}</Refusal>
      {prefs && (
        <PrefsOverride reason={prefs.reason} label="Add anyway" busy={busy}
          onGo={() => void add(true)} onDrop={() => setPrefs(null)} />
      )}
    </div>
  )
}
