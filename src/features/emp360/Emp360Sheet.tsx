// Employee 360 — everything the Employee Database holds about one person, in six tabs, opened over whatever screen…
// Tabs are fetched ONE AT A TIME, which is the point of the server's `tab` parameter: six tabs eagerly loaded would…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import Avatar from '@/components/shared/Avatar'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import DragPerson from '@/components/shared/DragPerson'
import Pager from '@/components/shared/Pager'
import { PAGE_SIZE, usePager } from '@/lib/pager'
import { ohioToday } from '@/lib/ohio'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'

export type Emp360Field = { key: string; label: string; value: string; editable?: boolean }
type ScoreRow = { key: string; label: string; state?: string; value?: string }
type Cert = { label: string; status: string; expires?: string; category?: string }

type Detail = {
  person: { id?: string; name: string; email?: string; phone?: string; avatar?: string }
  matched: boolean
  matchedBy?: string
  masterRow: string | null
  tab: string
  message?: string
  info?: { contact: Emp360Field[]; employment: Emp360Field[] }
  docs?: { fields: Emp360Field[]; scorecard: ScoreRow[]; staffDocs: Record<string, unknown>[] }
  // `certs` is an OBJECT keyed by certification, not a list — Emp360.gs builds it from certPicture_().
  training?: { certs: Record<string, Cert>; fields: Emp360Field[] }
  background?: { fields: Emp360Field[]; scorecard: ScoreRow[] }
  hr?: { callOffs: Record<string, unknown>[]; hrRecords: Record<string, unknown>[] }
  activity?: { supportRequests: Record<string, unknown>[]; dailyNotes: Record<string, unknown>[] }
}

const TABS = [
  { id: 'info', label: 'Info' },
  { id: 'docs', label: 'Docs' },
  { id: 'training', label: 'Training' },
  { id: 'background', label: 'Background' },
  { id: 'hr', label: 'HR' },
  { id: 'activity', label: 'Activity' },
]

type Tone = 'ok' | 'warning' | 'missing' | 'na' | 'plain'

const TONE_CLS: Record<Tone, string> = {
  ok: 'bg-tint-mint text-tint-fg-mint',
  warning: 'bg-tint-amber text-tint-fg-amber',
  missing: 'bg-tint-pink text-tint-fg-pink',
  na: 'bg-surface-2 text-text-3',
  plain: 'bg-surface-2 text-text-1',
}

/** 'YYYY-MM-DD' out of whatever the sheet wrote — by CUTTING, never parsing. */
function dateOnly(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(v.trim())
  return m ? m[1] : v.trim()
}

// Today on OHIO's calendar (promoted to @/lib/ohio) — a credential expiring today must not read as already expired…
const todayIso = ohioToday

// What a value MEANS, so the pill can carry it.
function toneOf(label: string, value: string): Tone {
  const v = value.trim()
  if (!v) return 'na'
  const iso = dateOnly(v)
  if (/exp|expir/i.test(label) && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const today = todayIso()
    if (iso < today) return 'missing'
    // 60 days is the window the Master's own formulas use for "coming due".
    const soon = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)))
    soon.setUTCDate(soon.getUTCDate() - 60)
    return soon.toISOString().slice(0, 10) <= today ? 'warning' : 'ok'
  }
  if (/^(yes|y|true|complete[d]?|active|pass(ed)?|clear)$/i.test(v)) return 'ok'
  if (/^(no|n|false|pending|missing|expired|inactive|fail(ed)?)$/i.test(v)) return 'missing'
  return 'plain'
}

const PHONE_FIELD = /(phone|mobile|fax)(_?number)?$/i

/** One label-and-value pill. Editable only when the SERVER said so. */
function Pill({
  label,
  value,
  tone,
  editable,
  onSave,
  fieldKey,
}: {
  label: string
  value: string
  tone?: Tone
  editable?: boolean
  onSave?: (key: string, value: string) => Promise<void>
  fieldKey?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(value), [value])

  const isPhone = !!fieldKey && PHONE_FIELD.test(fieldKey)
  const shown = isPhone ? formatPhoneDisplay(value) : dateOnly(value)
  const t = tone ?? toneOf(label, value)

  if (editing && onSave && fieldKey) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-primary bg-surface py-0.5 pl-3 pr-1">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-text-3">{label}</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
          className="h-6 w-36 rounded-sm bg-transparent px-1 text-[13.5px] text-text-1 outline-none"
        />
        <button
          onClick={async () => {
            setSaving(true)
            try { await onSave(fieldKey, draft.trim()); setEditing(false) } finally { setSaving(false) }
          }}
          disabled={saving}
          aria-label={`Save ${label}`}
          className="grid h-6 w-6 place-items-center rounded-full bg-primary text-on-primary disabled:opacity-50"
        >
          <Check size={12} />
        </button>
        <button
          onClick={() => { setDraft(value); setEditing(false) }}
          aria-label="Cancel"
          className="grid h-6 w-6 place-items-center rounded-full text-text-3 hover:bg-surface-2"
        >
          <X size={12} />
        </button>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-3 text-[13.5px] leading-5',
        editable ? 'pr-1' : 'pr-3',
        TONE_CLS[t],
      )}
      title={value ? `${label}: ${isPhone ? shown : value}` : `${label} — nothing on file`}
    >
      <span className="shrink-0 text-[11.5px] font-semibold uppercase tracking-[0.04em] opacity-70">{label}</span>
      <span className="truncate font-medium">{shown || '—'}</span>
      {editable && onSave && fieldKey && (
        <button
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100"
        >
          <Pencil size={11} />
        </button>
      )}
    </span>
  )
}

function PillGroup({
  title,
  fields,
  onSave,
}: {
  title: string
  fields?: Emp360Field[]
  onSave?: (key: string, value: string) => Promise<void>
}) {
  if (!fields?.length) return null
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {fields.map((f) => (
          <Pill
            key={f.key}
            fieldKey={f.key}
            label={f.label}
            value={f.value}
            editable={f.editable}
            onSave={onSave}
          />
        ))}
      </div>
    </div>
  )
}

function Scorecard({ title, rows }: { title: string; rows?: ScoreRow[] }) {
  if (!rows?.length) return null
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((s) => (
          <span
            key={s.key}
            title={s.value ? `${s.label}: ${s.value}` : s.label}
            className={cn('rounded-full px-3 py-1 text-[13px] font-semibold', TONE_CLS[(s.state as Tone) || 'na'])}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// The certification picture, straight off certPicture_ — the same one the certification matrix serves, so the two…
function Certs({ certs }: { certs?: Record<string, Cert> }) {
  const list = useMemo(() => Object.entries(certs ?? {}), [certs])
  if (!list.length) {
    return <p className="text-[13.5px] text-text-3">No certification is on file for this person.</p>
  }
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">
        Certifications ({list.length})
      </p>
      <div className="flex flex-wrap gap-1.5">
        {list.map(([key, c]) => (
          <Pill
            key={key}
            label={c.label || key}
            value={c.expires ? dateOnly(c.expires) : c.status}
            tone={
              c.status === 'ok' || c.status === 'valid' ? 'ok'
                : c.status === 'expiring' || c.status === 'warning' ? 'warning'
                  : c.status === 'expired' || c.status === 'missing' ? 'missing'
                    : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

// The interesting columns of a row, as pills.
function RowPills({ row }: { row: Record<string, unknown> }) {
  const pairs = Object.entries(row)
    .filter(([k, v]) => k !== 'id' && v != null && String(v).trim() !== '')
    .slice(0, 8)
  if (!pairs.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border px-2.5 py-2">
      {pairs.map(([k, v]) => (
        <Pill key={k} fieldKey={k} label={k.replace(/_/g, ' ')} value={String(v)} />
      ))}
    </div>
  )
}

function RowList({ title, rows }: { title: string; rows?: Record<string, unknown>[] }) {
  const pager = usePager(rows ?? [], PAGE_SIZE, rows?.length)
  if (!rows) return null
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">
        {title} ({rows.length})
      </p>
      {!rows.length ? (
        <p className="text-[13.5px] text-text-3">Nothing recorded.</p>
      ) : (
        <div className="space-y-1.5">
          {pager.slice.map((r, i) => <RowPills key={i} row={r} />)}
          <Pager {...pager} onPage={pager.setPage} noun="rows" />
        </div>
      )}
    </div>
  )
}

export default function Emp360Sheet({
  open,
  onOpenChange,
  personId,
  employeeId,
  name,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  personId?: string
  employeeId?: string
  name?: string
}) {
  const [tab, setTab] = useState('info')
  const [data, setData] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (which: string) => {
    if (!open) return
    setBusy(true)
    setErr('')
    try {
      setData(await gasAction<Detail>('emp360Detail', { tab: which, personId, employeeId }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load this person.')
    } finally {
      setBusy(false)
    }
  }, [open, personId, employeeId])

  useEffect(() => { void load(tab) }, [tab, load])
  useEffect(() => { if (open) setTab('info') }, [open, personId, employeeId])

  const saveField = async (key: string, value: string) => {
    try {
      await gasAction('emp360EditField', { personId, employeeId, field: key, value })
      // The server declares this invalidates certMatrix and staffCerts — an edited expiry changes the certification…
      invalidate('certMatrix')
      noteWrite('certMatrix')
      toast({ type: 'success', title: 'Saved', body: `${key} updated on the Employee Database.` })
      await load(tab)
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  const person = data?.person
  const shownName = person?.name || name || ''

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col bg-surface sm:w-[384px]">
        <SheetHeader>
          <SheetTitle className="font-display">Employee 360</SheetTitle>
        </SheetHeader>

        {/* The whole header is the drag handle: this sheet is opened FROM a
            name, so the next thing somebody wants is that name on the tracker
            at the top left. */}
        <DragPerson
          name={shownName}
          id={person?.id}
          avatar={person?.avatar}
          subtitle={person?.email || (person?.phone && formatPhoneDisplay(person.phone))}
          title={`Drag ${shownName || 'this person'} to the top-left to focus the whole workspace on them`}
          className="block"
        >
          <div className="flex items-center gap-3 px-4 pt-1">
            <Avatar src={person?.avatar ?? ''} name={shownName || '—'} size="lg" />
            <div className="min-w-0">
              <p className="clamp-1 text-[16px] font-semibold text-text-1">{shownName || '—'}</p>
              <p className="clamp-1 text-[13px] text-text-3">
                {person?.email || (person?.phone && formatPhoneDisplay(person.phone)) || ''}
                {data?.matchedBy ? ` · matched by ${data.matchedBy}` : ''}
              </p>
            </div>
          </div>
        </DragPerson>

        <div className="px-4 pt-3">
          <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} />
        </div>

        <div className="scroll-thin mt-3 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {err && (
            <p className="rounded-md bg-tint-pink px-3 py-2 text-[13.5px] font-medium text-tint-fg-pink">{err}</p>
          )}

          {/* The server's own sentence for "the roster knows them, the
              Employee Database does not" — an answer, not a failure. */}
          {data && !data.matched && (
            <p className="rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2.5 text-[13.5px] leading-5 text-tint-fg-amber">
              {data.message || 'No row in the Employee Database matches this person.'}
            </p>
          )}

          {busy && !data && <p className="text-[14px] text-text-3">Loading…</p>}

          {data?.matched && tab === 'info' && data.info && (
            <>
              <PillGroup title="Contact" fields={data.info.contact} onSave={saveField} />
              <PillGroup title="Employment" fields={data.info.employment} onSave={saveField} />
            </>
          )}

          {data?.matched && tab === 'docs' && data.docs && (
            <>
              <Scorecard title="Document scorecard" rows={data.docs.scorecard} />
              <PillGroup title="Dates on the Master" fields={data.docs.fields} />
              <RowList title="Staff docs on file" rows={data.docs.staffDocs} />
            </>
          )}

          {data?.matched && tab === 'training' && data.training && (
            <>
              <Certs certs={data.training.certs} />
              <PillGroup title="Training dates on the Master" fields={data.training.fields} />
            </>
          )}

          {data?.matched && tab === 'background' && data.background && (
            <>
              <Scorecard title="Background scorecard" rows={data.background.scorecard} />
              <PillGroup title="Checks on the Master" fields={data.background.fields} />
            </>
          )}

          {data?.matched && tab === 'hr' && data.hr && (
            <>
              <RowList title="Call-offs" rows={data.hr.callOffs} />
              <RowList title="HR records" rows={data.hr.hrRecords} />
            </>
          )}

          {data?.matched && tab === 'activity' && data.activity && (
            <>
              <RowList title="Support requests" rows={data.activity.supportRequests} />
              <RowList title="Daily notes" rows={data.activity.dailyNotes} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
