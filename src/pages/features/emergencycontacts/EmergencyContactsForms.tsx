// The right panel of Emergency Contacts: a contact or a lane changed field by field, a new one added, or one removed
// after a confirm inside the panel (never a browser dialog). Each save is checked against what the panel showed.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import RecordEditBody from '@/components/shared/RecordEditBody'
import SidePanel from '@/components/shared/SidePanel'
import { AppIcon } from '@/lib/icons'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { editAnswerOf } from '@/lib/recordEdit'
import { cn } from '@/lib/utils'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { toast } from '@/stores/useToastStore'
import {
  CHIP_CHOICES, DEFAULT_CHIP, DEFAULT_ICON, ICON_CHOICES, LABEL_MAX, NAME_MAX, NOTE_MAX, PHONE_HINT, PHONE_MAX, chipLabel,
  contactFields, contactRemoval, findContact, findGroup, groupFields, groupRemoval, type Directory, type SavePayload,
} from './emergencyContactsModel'
import { saveDirectory } from './emergencyContactsLane'

/** What the panel holds: a contact, a lane, a new contact in a lane, or a new lane. */
export type DirectoryPanel =
  | { kind: 'contact'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'new-contact'; group: string }
  | { kind: 'new-group' }
  | null

type Sends = {
  directory: Directory
  /** a save's answer data: the directory it left replaces the page's */
  onAnswer: (data: unknown) => void
  /** a refusal, which may carry the directory kept now (a stale witness) */
  onRefusal: (err: unknown) => void
  onClose: () => void
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const DANGER = 'inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40'

/** One save through the panel: its answer laid on the page; a refusal's directory too, and the refusal thrown on. */
async function send(p: SavePayload, s: Sends): Promise<unknown> {
  try {
    const data = await saveDirectory(p)
    s.onAnswer(data)
    return data
  } catch (e) {
    s.onRefusal(e)
    throw e
  }
}

/** A lane's header as the page draws it. */
export function LanePreview({ label, icon, chip }: { label: string; icon: string; chip: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5', chip)} data-lane-preview="">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface/70"><AppIcon name={icon} size={15} /></span>
      <span className="text-[12px] font-bold uppercase tracking-[0.06em]">{label || 'New lane'}</span>
    </div>
  )
}

function Review({ lines }: { lines: [string, string][] }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-review="">
      <p className="mb-1 font-semibold text-text-1">This is what will be saved:</p>
      {lines.filter(([, v]) => v).map(([k, v]) => <p key={k}><span className="text-text-3">{k}:</span> {v}</p>)}
    </div>
  )
}

function Gone({ what, onClose }: { what: string; onClose: () => void }) {
  return (
    <div className="grid gap-3 pt-1" data-gone="">
      <p className="text-[13px] text-text-2">This {what} is not in the directory any more.</p>
      <button type="button" onClick={onClose} className="justify-self-end text-[12.5px] font-semibold text-primary hover:underline">Close</button>
    </div>
  )
}

/** Remove, inside the panel: the first press says plainly what goes, the second removes it. */
function RemoveBlock({ label, words, done, onRemove, onDone }: {
  label: string
  words: string
  done: string
  onRemove: () => Promise<unknown>
  onDone: () => void
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const press = async () => {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    try {
      await onRemove()
      toast({ type: 'success', title: done })
      onDone()
    } catch (e) {
      setArmed(false)
      toast({ type: 'danger', title: 'Not removed', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-2 border-t border-border pt-4" data-remove="">
      {armed && (
        <p role="alert" className="rounded-md bg-tint-danger px-3 py-2 text-[12.5px] font-medium leading-5 text-tint-fg-danger" data-remove-confirm="">
          {words}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {armed && <button type="button" onClick={() => setArmed(false)} className="text-[12.5px] text-text-3 hover:text-text-1">Keep it</button>}
        <button type="button" onClick={() => void press()} disabled={busy} data-press-remove={armed ? 'confirm' : 'ask'}
          className={cn(DANGER, armed ? 'bg-[var(--danger)] text-white hover:opacity-90' : 'border border-border bg-surface text-[var(--danger)] hover:bg-surface-2')}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {armed ? `${label} — press again` : label}
        </button>
      </div>
    </div>
  )
}

function ContactBody({ id, ...s }: Sends & { id: string }) {
  const found = findContact(s.directory, id)
  if (!found) return <Gone what="contact" onClose={s.onClose} />
  const { group, contact } = found
  return (
    <div className="grid gap-5 pt-1" data-contact-panel={id}>
      <p className="text-[13px] text-text-2"><span className="font-semibold text-primary">{group.label}</span> · {contact.phone}</p>
      <RecordEditBody fields={contactFields(s.directory, group, contact)} onDone={s.onClose}
        intro="Each change is checked against what this panel shows. The directory is kept in the Hub's database."
        onFile={async (changes) => editAnswerOf(await send({ op: 'contact.edit', id, changes }, s))} />
      <RemoveBlock label="Remove contact" done="Contact removed" onDone={s.onClose}
        words={`${contact.name} (${contact.phone}) leaves the ${group.label} lane on every open directory.`}
        onRemove={() => send(contactRemoval(group, contact), s)} />
    </div>
  )
}

function GroupBody({ id, ...s }: Sends & { id: string }) {
  const group = findGroup(s.directory, id)
  if (!group) return <Gone what="lane" onClose={s.onClose} />
  const n = group.contacts.length
  return (
    <div className="grid gap-5 pt-1" data-group-panel={id}>
      <LanePreview label={group.label} icon={group.icon} chip={group.chip} />
      <RecordEditBody fields={groupFields(s.directory, group)} onDone={s.onClose}
        intro={`${n} contact${n === 1 ? '' : 's'} in this lane. Each change is checked against what this panel shows.`}
        onFile={async (changes) => editAnswerOf(await send({ op: 'group.edit', id, changes }, s))} />
      <RemoveBlock label="Remove lane" done="Lane removed" onDone={s.onClose}
        words={n
          ? `The ${group.label} lane leaves the directory with its ${n} contact${n === 1 ? '' : 's'} — they are removed with it.`
          : `The ${group.label} lane leaves the directory.`}
        onRemove={() => send(groupRemoval(group), s)} />
    </div>
  )
}

const placeOptions = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1))

function NewContactBody({ group, ...s }: Sends & { group: string }) {
  const d = s.directory
  const [lane, setLane] = useState(group || d.groups[0]?.id || '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [place, setPlace] = useState('')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const target = findGroup(d, lane)
  const last = (target?.contacts.length ?? 0) + 1
  const at = place ? Number(place) : last
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); setArmed(false) }

  const file = async () => {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    try {
      await send({ op: 'contact.add', contact: { group: lane, name: name.trim(), phone: phone.trim(), note: note.trim(), order: at } }, s)
      toast({ type: 'success', title: 'Contact added', body: name.trim() })
      s.onClose()
    } catch (e) {
      setArmed(false)
      toast({ type: 'danger', title: 'Not added', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-new-contact="">
      <div className="grid gap-3">
        <Field label="Lane" required>
          <select value={lane} disabled={busy} onChange={(e) => { edit(setLane)(e.target.value); setPlace('') }} className={inputCls}>
            {d.groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
        <Field label="Name" required>
          <input value={name} disabled={busy} maxLength={NAME_MAX} onChange={(e) => edit(setName)(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Phone" required>
          <input type="tel" value={phone} disabled={busy} maxLength={PHONE_MAX} onChange={(e) => edit(setPhone)(e.target.value)} className={inputCls} />
        </Field>
        <p className="-mt-1.5 text-[11.5px] leading-4 text-text-3">{PHONE_HINT}</p>
        <Field label="Note">
          <input value={note} disabled={busy} maxLength={NOTE_MAX} placeholder="A role, or “Non-Emergency”" onChange={(e) => edit(setNote)(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Place in the lane">
          <select value={place} disabled={busy} onChange={(e) => edit(setPlace)(e.target.value)} className={inputCls}>
            <option value="">Last</option>
            {placeOptions(last).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      {armed && <Review lines={[['Lane', target?.label ?? ''], ['Name', name.trim()], ['Phone', formatPhoneDisplay(phone)],
        ['Note', note.trim()], ['Place', String(at)]]} />}
      <DraftButtons armed={armed} busy={busy} disabled={!target || !name.trim() || !phone.trim()} label="Review contact"
        armedLabel="Add contact — press again" onPress={() => void file()} onDisarm={() => setArmed(false)} onCancel={s.onClose} />
    </div>
  )
}

function NewGroupBody(s: Sends) {
  const d = s.directory
  const [label, setLabel] = useState('')
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [chip, setChip] = useState(DEFAULT_CHIP)
  const [place, setPlace] = useState('')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const last = d.groups.length + 1
  const at = place ? Number(place) : last
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); setArmed(false) }

  const file = async () => {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    try {
      await send({ op: 'group.add', group: { label: label.trim(), icon, chip, order: at } }, s)
      toast({ type: 'success', title: 'Lane added', body: label.trim() })
      s.onClose()
    } catch (e) {
      setArmed(false)
      toast({ type: 'danger', title: 'Not added', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-new-group="">
      <LanePreview label={label.trim()} icon={icon} chip={chip} />
      <div className="grid gap-3">
        <Field label="Label" required>
          <input value={label} disabled={busy} maxLength={LABEL_MAX} onChange={(e) => edit(setLabel)(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Icon">
          <select value={icon} disabled={busy} onChange={(e) => edit(setIcon)(e.target.value)} className={inputCls}>
            {ICON_CHOICES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Colour">
          <select value={chip} disabled={busy} onChange={(e) => edit(setChip)(e.target.value)} className={inputCls}>
            {CHIP_CHOICES.map((c) => <option key={c.chip} value={c.chip}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Place among the lanes">
          <select value={place} disabled={busy} onChange={(e) => edit(setPlace)(e.target.value)} className={inputCls}>
            <option value="">Last</option>
            {placeOptions(last).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      {armed && <Review lines={[['Label', label.trim()], ['Icon', icon], ['Colour', chipLabel(chip)], ['Place', String(at)]]} />}
      <DraftButtons armed={armed} busy={busy} disabled={!label.trim()} label="Review lane" armedLabel="Add lane — press again"
        onPress={() => void file()} onDisarm={() => setArmed(false)} onCancel={s.onClose} />
    </div>
  )
}

function titleOf(panel: DirectoryPanel, d: Directory): string {
  if (!panel) return ''
  if (panel.kind === 'contact') return findContact(d, panel.id)?.contact.name ?? 'Contact'
  if (panel.kind === 'group') return `${findGroup(d, panel.id)?.label ?? 'The'} lane`
  return panel.kind === 'new-contact' ? 'New contact' : 'New lane'
}

/** The one right panel of the page, at the standard width. */
export default function DirectoryPanelHost({ panel, ...s }: Sends & { panel: DirectoryPanel }) {
  const key = panel ? `${panel.kind}:${'id' in panel ? panel.id : 'group' in panel ? panel.group : ''}` : ''
  return (
    <SidePanel open={panel !== null} onClose={s.onClose} label="Emergency contacts" title={titleOf(panel, s.directory)}>
      {panel?.kind === 'contact' && <ContactBody key={key} id={panel.id} {...s} />}
      {panel?.kind === 'group' && <GroupBody key={key} id={panel.id} {...s} />}
      {panel?.kind === 'new-contact' && <NewContactBody key={key} group={panel.group} {...s} />}
      {panel?.kind === 'new-group' && <NewGroupBody key={key} {...s} />}
    </SidePanel>
  )
}
