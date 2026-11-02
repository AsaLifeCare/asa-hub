// Ops-flows action modals + dispatcher.
// Sheet/detail templates stay generic: config actions carry an `action` id and the templates forward it to…
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { create } from 'zustand'
import { format, addDays } from 'date-fns'
// true instants ("reported at", signature stamps) wear Ohio wall-clock for every viewer; day-valued sheet fields…
import { ohioDateTime, ohioDayYear, ohioToday, ohioWall } from '@/lib/ohio'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Permission } from '@/auth/types'
import { toast } from '@/stores/useToastStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { gasAction } from '@/features/hiring/shared'
import { fileToBase64 } from '@/engine/templates/documents/importDoc'
import { AppIcon } from '@/lib/icons'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { Badge } from '@/components/shared/Badge'
import DragPerson from '@/components/shared/DragPerson'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'
import PeopleMergeModal from '@/features/people/PeopleMergeModal'
import { cachedUsers, fetchUsers, findAccountByName } from '@/lib/usersDirectory'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'

/* ---------------- store + dispatcher ---------------- */

export type OpsModal =
  | { kind: 'mui-escalate'; incident: any }
  | { kind: 'policy-open'; ack: any }
  | { kind: 'policy-import' }
  | { kind: 'route-add' }
  | { kind: 'project-new' }
  | { kind: 'people-merge' }
  | { kind: 'staff-profile'; shift: any }
  | { kind: 'house-panel'; shift: any }

type OpsModalState = {
  modal: OpsModal | null
  open: (m: OpsModal) => void
  close: () => void
}

const useOpsModalStore = create<OpsModalState>()((set) => ({
  modal: null,
  open: (m) => set({ modal: m }),
  close: () => set({ modal: null }),
}))

/** Google Maps directions deep link (works without an API key). */
export function openRouteInMaps(route: any) {
  const origin = encodeURIComponent(String(route?.origin ?? ''))
  const destination = encodeURIComponent(String(route?.destination ?? ''))
  const stops: string[] = Array.isArray(route?.stops) ? route.stops : []
  const waypoints = stops.length ? `&waypoints=${encodeURIComponent(stops.join('|'))}` : ''
  window.open(
    `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}`,
    '_blank',
    'noopener,noreferrer',
  )
}

/** Entry point used by Sheet/Detail template action dispatch. */
export function dispatchOpsAction(action: string, record?: any) {
  const { open } = useOpsModalStore.getState()
  switch (action) {
    case 'mui-escalate':
      open({ kind: 'mui-escalate', incident: record })
      break
    case 'policy-open':
      open({ kind: 'policy-open', ack: record })
      break
    case 'policy-import':
      open({ kind: 'policy-import' })
      break
    case 'route-add':
      open({ kind: 'route-add' })
      break
    case 'project-new':
      open({ kind: 'project-new' })
      break
    case 'people-merge':
      open({ kind: 'people-merge' })
      break
    case 'staff-profile':
      open({ kind: 'staff-profile', shift: record })
      break
    case 'house-panel':
      open({ kind: 'house-panel', shift: record })
      break
    case 'maps-open':
      openRouteInMaps(record)
      break
    default:
      toast({ type: 'info', title: 'Unknown action', body: `No handler registered for "${action}".` })
  }
}

/* ---------------- shared form styling ---------------- */

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-medium text-text-2">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {error && <span className="text-[11px] text-danger">Required</span>}
    </label>
  )
}

/** Re-check a permission at the mutation call site (UI gating is not security). */
function guardPerm(allowed: boolean, perm: Permission): boolean {
  if (allowed) return true
  toast({ type: 'warning', title: 'Not allowed', body: `Requires ${perm} — ask an admin.` })
  return false
}

/* ================= 1 · Escalate to MUI ================= */

const MUI_CLASSES = [
  'MUI — Abuse/Neglect allegation',
  'MUI — Serious injury',
  'MUI — Medication error w/ harm',
  'MUI — Missing person',
  'MUI — Death',
  'UI — not MUI',
]

const PREFILL_ACTIONS: Record<string, string> = {
  Fall: 'Client assessed by on-shift staff, vitals checked and first aid provided. Physician and delegating nurse notified; house manager made aware. Client resting comfortably under 15-minute observation.',
  'Medication error': 'Dose held where possible; delegating nurse and prescribing physician contacted immediately. Client monitored for adverse effects; MAR variance documented before end of shift.',
  Behavior: 'De-escalation per the Behavior Support Plan applied; environment cleared and other individuals moved to a calm space. Behavior specialist and house manager notified.',
  Injury: 'First aid administered; client transported for medical evaluation. Scene secured and witnesses identified. House manager and on-call supervisor notified immediately.',
  MUI: 'Immediate health and safety secured (first aid / 911 as indicated). Scene preserved, witnesses identified, supervisory chain notified. County board verbal report initiated within the 4-hour window.',
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A `datetime-local` value ("2026-08-16T14:30") is a WALL CLOCK somebody just typed — it carries no zone, so there…
function typedStamp(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v ?? '').trim())
  if (!m) return String(v ?? '')
  const [, year, mo, day, hh, mm] = m
  const month = MONTHS_SHORT[Number(mo) - 1]
  const h24 = Number(hh)
  if (!month || h24 > 23) return String(v ?? '')
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${month} ${Number(day)}, ${year}, ${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`
}

// A stored date, printed on OHIO's clock — the counterpart to typedStamp().
const dayLabel = (v?: string | null) => {
  const d = v ? ohioWall(v) : null
  return d ? format(d, 'MMM d, yyyy') : '—'
}

type NotifyItem = { id: string; label: string; name?: string; checked: boolean }

function EscalateMuiModal({ incident, onClose }: { incident: any; onClose: () => void }) {
  const user = useAuthStore((s) => s.user)
  const allowed = useCan('clients.edit')
  const [classification, setClassification] = useState(MUI_CLASSES[1])
  const [actions, setActions] = useState(PREFILL_ACTIONS[incident?.type as string] ?? PREFILL_ACTIONS.MUI)
  const [due, setDue] = useState(format(addDays(new Date(), 1), "yyyy-MM-dd'T'HH:mm"))
  const [notify, setNotify] = useState<NotifyItem[]>([
    { id: 'ssa', label: 'County DD board SSA', checked: true },
    { id: 'guardian', label: 'Guardian', checked: true },
    { id: 'house-manager', label: 'House manager', checked: true },
    { id: 'on-call', label: 'On-call supervisor', checked: true },
    { id: 'dodd', label: 'DODD hotline', name: '1-866-313-6733', checked: false },
  ])
  const [saving, setSaving] = useState(false)

  // Auto-resolve names from the client record (matched by initials) when possible.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const clients = await api.list<any>('clients')
        const c = clients.find((x) => x.initials === incident?.client)
        if (!c || cancelled) return
        setNotify((ns) =>
          ns.map((n) =>
            n.id === 'ssa'
              ? { ...n, name: c.ssaName ?? c.ssa?.name }
              : n.id === 'guardian'
                ? { ...n, name: c.guardianName ?? c.guardian?.name }
                : n.id === 'house-manager'
                  ? { ...n, name: c.houseManager }
                  : n,
          ),
        )
      } catch {
        /* resolution is best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [incident?.client])

  const isMui = classification.startsWith('MUI')
  const submit = async () => {
    if (!guardPerm(allowed, 'clients.edit')) return
    setSaving(true)
    try {
      const escalation = {
        classification,
        immediateActions: actions.trim(),
        notifications: notify.filter((n) => n.checked).map(({ label, name }) => ({ label, name })),
        reportedBy: user?.name ?? 'Unknown user',
        reportedAt: new Date().toISOString(),
        reportDueAt: new Date(due).toISOString(),
      }
      await api.update('incidents', String(incident.id), {
        muiStatus: isMui ? 'escalated' : 'monitoring',
        severity: isMui ? 'high' : incident.severity,
        status: incident.status === 'closed' ? 'in-review' : incident.status,
        escalation,
      })
      const ssaNote = notify.find((n) => n.id === 'ssa' && n.checked)
      // Raised in this session, not written to a tab: `notifications` is declared readOnly on the server, so the…
      useNotificationStore.getState().push({
        type: 'app',
        appId: 'incidents',
        title: `${classification} — ${incident.type} at ${incident.house}`,
        body: `Escalated by ${user?.name ?? 'staff'} · client ${incident.client}. ${ssaNote ? `SSA notified${ssaNote.name ? ` (${ssaNote.name})` : ''}. ` : ''}Written report due ${typedStamp(due)}.`,
        href: '/app/incidents/log',
        priority: 'high',
      })
      toast({
        type: 'success',
        title: isMui ? 'Escalated — MUI report due in 24h' : 'Marked as UI — monitoring',
        body: `Written report due ${typedStamp(due)}. SSA and supervisor notified.`,
      })
      onClose()
    } catch {
      toast({ type: 'danger', title: 'Could not escalate', body: 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto bg-surface sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[18px] font-bold text-text-1">
            <span className={cn('grid h-8 w-8 place-items-center rounded-[10px]', TINT_BG.pink)}>
              <AppIcon name="siren" size={16} className={TINT_FG.pink} />
            </span>
            Escalate to MUI
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Ohio DODD Major Unusual Incident escalation. Verbal county-board report is due within 4 hours of discovery; the written report follows in 24 hours.
          </DialogDescription>
        </DialogHeader>

        {/* incident summary (read-only) */}
        <div className="rounded-md border border-border bg-surface-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={String(incident?.type ?? 'Incident')} tint="pink" />
            <Badge label={String(incident?.status ?? 'open')} tint="amber" />
            {incident?.muiStatus && <Badge label={`MUI: ${String(incident.muiStatus)}`} tint="pink" />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
            {/* the client arrives as INITIALS on an incident — the user
                initials named by the rule, and a handle all the same */}
            <span className="text-text-3">Client <DragPerson name={String(incident?.client ?? '')} type="client" subtitle={incident?.house ? String(incident.house) : undefined} className="block"><span className="block font-medium text-text-1">{incident?.client ?? '—'}</span></DragPerson></span>
            <span className="text-text-3">House <span className="block font-medium text-text-1">{incident?.house ?? '—'}</span></span>
            <span className="text-text-3">Date <span className="block font-medium text-text-1">{dayLabel(incident?.date)}</span></span>
            <span className="text-text-3">Severity <span className="block font-medium capitalize text-text-1">{incident?.severity ?? '—'}</span></span>
          </div>
        </div>

        <div className="grid gap-4">
          <Field label="Severity classification" required>
            <select value={classification} onChange={(e) => setClassification(e.target.value)} className={inputCls}>
              {MUI_CLASSES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <Field label="Immediate actions taken" required>
            <textarea
              value={actions}
              onChange={(e) => setActions(e.target.value)}
              rows={4}
              className={cn(inputCls, 'h-auto py-2')}
            />
          </Field>

          <div className="grid gap-2">
            <span className="text-[12px] font-medium text-text-2">Notifications sent</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {notify.map((n) => (
                <label
                  key={n.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-sm border px-3 py-2 transition-colors',
                    n.checked ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={n.checked}
                    onChange={() => setNotify((ns) => ns.map((x) => (x.id === n.id ? { ...x, checked: !x.checked } : x)))}
                    className="h-4 w-4 cursor-pointer rounded-[6px] accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-text-1">{n.label}</span>
                    <span className="block truncate text-[11px] text-text-3">{n.name != null ? formatPhoneDisplay(n.name) : 'Name not on file'}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Reported by">
              <input value={user?.name ?? ''} readOnly className={cn(inputCls, 'bg-surface-2 text-text-2')} />
            </Field>
            <Field label="Reported at">
              <input value={ohioDateTime(new Date())} readOnly className={cn(inputCls, 'bg-surface-2 text-text-2')} />
            </Field>
            <Field label="Written report due" required>
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !actions.trim()}
            className="flex h-9 items-center gap-1.5 rounded-md bg-danger px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            <AppIcon name="siren" size={15} />
            {saving ? 'Escalating…' : isMui ? 'Escalate — report due in 24h' : 'Save as UI (monitoring)'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================= 2 · Fullscreen policy reader ================= */

const STATUS_TINTS: Record<string, TintName> = { signed: 'mint', pending: 'amber', overdue: 'pink' }

function PolicyReaderModal({ ack, onClose }: { ack: any; onClose: () => void }) {
  const user = useAuthStore((s) => s.user)
  const [signed, setSigned] = useState(ack?.status === 'signed')
  const [signing, setSigning] = useState(false)
  const body: string[] = Array.isArray(ack?.body) ? ack.body : []
  const status = signed ? 'signed' : String(ack?.status ?? 'pending')

  const markAcknowledged = async () => {
    setSigning(true)
    try {
      await api.update('policyAcks', String(ack.id), {
        status: 'signed',
        signedAt: new Date().toISOString(),
      })
      setSigned(true)
      toast({
        type: 'success',
        title: 'Policy acknowledged',
        body: `${user?.name ?? 'You'} acknowledged “${ack?.policy}” ${ack?.version ?? ''}.`,
      })
    } catch {
      toast({ type: 'danger', title: 'Could not save acknowledgment', body: 'Please try again.' })
    } finally {
      setSigning(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden bg-bg p-0 sm:max-w-[calc(100vw-3rem)]">
        {/* reader header */}
        <div className="border-b border-border bg-surface px-6 py-5 sm:px-10">
          <div className="mx-auto max-w-[760px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('grid h-9 w-9 place-items-center rounded-[10px]', TINT_BG.lavender)}>
                <AppIcon name="book-open-text" size={17} className={TINT_FG.lavender} />
              </span>
              <Badge label={status} tint={STATUS_TINTS[status] ?? 'amber'} />
              {ack?.pdfUrl && <Badge label="PDF" tint="blue" />}
            </div>
            <h1 className="mt-3 font-display text-[26px] font-bold leading-8 tracking-[-0.015em] text-text-1">
              {ack?.policy ?? 'Policy'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-text-3">
              <span className="flex items-center gap-1.5"><AppIcon name="tag" size={12} /> Version {ack?.version ?? '—'}</span>
              <span className="flex items-center gap-1.5">
                <AppIcon name="calendar" size={12} />
                Effective {dayLabel(ack?.effectiveDate)}
              </span>
              <span className="flex items-center gap-1.5"><AppIcon name="user" size={12} /> Assigned to {ack?.staff ?? '—'}</span>
              {ack?.signedAt && (
                <span className="flex items-center gap-1.5">
                  <AppIcon name="check-check" size={12} />
                  Signed {ohioDayYear(ack.signedAt)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* reader body */}
        <div className="scroll-thin flex-1 overflow-y-auto">
          {ack?.pdfUrl ? (
            <div className="flex h-full flex-col px-6 py-5 sm:px-10">
              <div className="mx-auto flex w-full max-w-[960px] flex-1 flex-col">
                <p className="mb-3 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-text-2">
                  Imported document{ack?.pdfName ? ` · ${ack.pdfName}` : ''}. If the
                  embedded viewer is blocked by your browser,{' '}
                  <a
                    href={`https://docs.google.com/viewer?url=${encodeURIComponent(ack.pdfUrl)}&embedded=true`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary hover:text-primary-hover"
                  >
                    open it in the Google viewer
                  </a>{' '}
                  or{' '}
                  <a href={ack.pdfUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:text-primary-hover">
                    download the file
                  </a>
                  .
                </p>
                <iframe
                  src={ack.pdfUrl}
                  title={`${ack?.policy ?? 'Policy'} (PDF)`}
                  className="w-full flex-1 rounded-md border border-border bg-surface"
                />
              </div>
            </div>
          ) : body.length > 0 ? (
            <article className="mx-auto max-w-[760px] px-6 py-8 sm:px-10">
              {body.map((section, i) =>
                section.startsWith('## ') ? (
                  <h2
                    key={i}
                    className={cn('font-display text-[17px] font-bold text-text-1', i === 0 ? 'mt-0' : 'mt-7')}
                  >
                    {section.slice(3)}
                  </h2>
                ) : (
                  <p key={i} className="mt-2.5 text-[14px] leading-6 text-text-2">
                    {section}
                  </p>
                ),
              )}
            </article>
          ) : (
            <div className="mx-auto max-w-[760px] px-6 py-16 text-center sm:px-10">
              <AppIcon name="file-text" size={28} className="mx-auto text-text-3" />
              <p className="mt-3 text-[14px] font-medium text-text-1">Policy text not attached</p>
              <p className="mt-1 text-[13px] text-text-3">
                Ask an admin to import the PDF or paste the policy body for this version.
              </p>
            </div>
          )}
        </div>

        {/* reader footer */}
        <div className="border-t border-border bg-surface px-6 py-4 sm:px-10">
          <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-3">
            <span className="text-[12px] text-text-3">
              Acknowledging as <DragPerson name={user?.name ?? ''} id={user?.id} avatar={user?.avatar || undefined}><span className="font-semibold text-text-1">{user?.name ?? '—'}</span></DragPerson>
              {ack?.staff && user?.name !== ack.staff ? ` (record assigned to ${ack.staff})` : ''}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={onClose}
                className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                Close
              </button>
              <button
                onClick={markAcknowledged}
                disabled={signed || signing}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name={signed ? 'check-check' : 'pen-line'} size={15} />
                {signed ? 'Acknowledged' : signing ? 'Signing…' : 'Mark as acknowledged'}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ================= 3 · Import policy (PDF / URL) ================= */

function ImportPolicyModal({ onClose }: { onClose: () => void }) {
  const allowed = useCan('apps.manage')
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('v1.0')
  const [effective, setEffective] = useState(ohioToday())
  const [mode, setMode] = useState<'file' | 'url'>('file')
  const [fileName, setFileName] = useState('')
  // THE FILE ITSELF, not just its name.
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const canSubmit = title.trim() && (mode === 'url' ? url.trim() : !!file)

  const submit = async () => {
    if (!guardPerm(allowed, 'apps.manage')) return
    if (!canSubmit) {
      toast({ type: 'warning', title: 'Missing details', body: 'Add a policy title and a file or URL.' })
      return
    }
    setSaving(true)
    try {
      // The file travels first: a row pointing at a document that failed to upload is a policy nobody can open, and…
      let pdfUrl = mode === 'url' ? url.trim() : ''
      if (mode === 'file' && file) {
        if (file.size > 25 * 1024 * 1024) {
          toast({ type: 'warning', title: 'The file is over 25MB', body: 'Host it and paste the link instead.' })
          setSaving(false)
          return
        }
        const up = await gasAction<{ file_url: string }>('libraryUpload', {
          filename: file.name,
          mime_type: file.type || 'application/pdf',
          base64: await fileToBase64(file),
        })
        pdfUrl = up.file_url
      }
      await api.create('policyAcks', {
        policy: title.trim(),
        version: version.trim() || 'v1.0',
        staff: 'All staff',
        signedAt: null,
        status: 'pending',
        // The date input hands back a calendar DAY; every seeded policy stores it as one.
        effectiveDate: effective,
        pdfUrl: pdfUrl || undefined,
        pdfName: mode === 'file' ? fileName : undefined,
      })
      toast({
        type: 'success',
        title: 'Policy imported',
        body: mode === 'file'
          ? `${fileName} is in the platform's Library folder and opens in the reader.`
          : 'The policy now opens in the embedded PDF viewer.',
      })
      onClose()
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not import policy',
        body: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">Import policy</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Attach a policy PDF — it is stored in the platform's Library folder — or link a hosted PDF that renders in the reader.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Policy title" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Visitor & Community Access" className={inputCls} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Version">
              <input value={version} onChange={(e) => setVersion(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Effective date">
              <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="flex h-9 items-center rounded-sm border border-border bg-surface p-1">
            {(['file', 'url'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[7px] text-[12px] font-semibold text-text-3 transition-colors duration-150',
                  mode === m && 'bg-surface-3 text-text-1',
                )}
              >
                <AppIcon name={m === 'file' ? 'file-down' : 'link-2'} size={13} />
                {m === 'file' ? 'Upload PDF' : 'PDF URL'}
              </button>
            ))}
          </div>
          {mode === 'file' ? (
            <Field label="PDF file" required>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                  setFileName(f?.name ?? '')
                }}
                className="w-full cursor-pointer rounded-sm border border-dashed border-border bg-surface px-3 py-2.5 text-[13px] text-text-2 file:mr-3 file:rounded-sm file:border-0 file:bg-primary-soft file:px-3 file:py-1 file:text-[12px] file:font-semibold file:text-primary-strong"
              />
            </Field>
          ) : (
            <Field label="Hosted PDF URL" required>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.org/policies/transport-safety.pdf"
                className={inputCls}
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !canSubmit}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            <AppIcon name="file-down" size={15} />
            {saving ? 'Importing…' : 'Import policy'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================= 4 · Add route (Transportation) ================= */

const VEHICLE_OPTIONS = ['Van 1 · Ford Transit', 'Van 2 · Dodge Caravan', 'Van 3 · Toyota Sienna', 'Bus 1 · Blue Bird']

function AddRouteModal({ onClose }: { onClose: () => void }) {
  const allowed = useCan('apps.manage')
  const [drivers, setDrivers] = useState<string[]>([])
  const [route, setRoute] = useState('')
  const [driver, setDriver] = useState('')
  const [vehicle, setVehicle] = useState(VEHICLE_OPTIONS[0])
  const [date, setDate] = useState(ohioToday())
  const [time, setTime] = useState('07:30')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [stops, setStops] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api
      .list<any>('people')
      .then((rows) => setDrivers(rows.map((p) => p.name)))
      .catch(() => setDrivers([]))
  }, [])

  const setStop = (i: number, v: string) => setStops((ss) => ss.map((s, j) => (j === i ? v : s)))
  const valid = route.trim() && driver && origin.trim() && destination.trim()

  const submit = async () => {
    if (!guardPerm(allowed, 'apps.manage')) return
    if (!valid) {
      toast({ type: 'warning', title: 'Missing details', body: 'Route name, driver, origin and destination are required.' })
      return
    }
    setSaving(true)
    try {
      await api.create('routes', {
        route: route.trim(),
        driver,
        vehicle,
        clients: stops.filter((s) => s.trim()).length,
        pickupTime: time,
        date,
        origin: origin.trim(),
        destination: destination.trim(),
        stops: stops.map((s) => s.trim()).filter(Boolean),
        status: 'on-time',
      })
      toast({ type: 'success', title: 'Route added', body: `${route.trim()} · ${driver} · ${date} ${time}.` })
      onClose()
    } catch {
      toast({ type: 'danger', title: 'Could not add route', body: 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto bg-surface sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[17px] font-bold text-text-1">
            <span className={cn('grid h-8 w-8 place-items-center rounded-[10px]', TINT_BG.peach)}>
              <AppIcon name="route" size={15} className={TINT_FG.peach} />
            </span>
            Add route
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Addresses power the Google Maps directions link and the embedded map preview on the route detail panel.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Route name" required>
            <input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. North AM run" className={inputCls} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Driver" required>
              <select value={driver} onChange={(e) => setDriver(e.target.value)} className={cn(inputCls, !driver && 'text-text-3')}>
                <option value="" disabled>Select driver…</option>
                {drivers.map((d) => (
                  <option key={d} value={d} className="text-text-1">{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Vehicle">
              <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={inputCls}>
                {VEHICLE_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Pickup time" required>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Origin" required>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="412 Market Ave N, Canton, OH 44702" className={inputCls} />
          </Field>
          <Field label="Destination" required>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="2950 Whipple Ave NW, Canton, OH 44708" className={inputCls} />
          </Field>
          <div className="grid gap-2">
            <span className="text-[12px] font-medium text-text-2">Stops (optional)</span>
            {stops.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <AppIcon name="map-pin" size={13} className="shrink-0 text-text-3" />
                <input
                  value={s}
                  onChange={(e) => setStop(i, e.target.value)}
                  placeholder={`Stop ${i + 1} address`}
                  className={inputCls}
                />
                <button
                  aria-label={`Remove stop ${i + 1}`}
                  onClick={() => setStops((ss) => ss.filter((_, j) => j !== i))}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-danger"
                >
                  <AppIcon name="x" size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setStops((ss) => [...ss, ''])}
              className="flex h-8 items-center justify-center gap-1.5 rounded-sm border border-dashed border-border text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <AppIcon name="plus" size={13} /> Add stop
            </button>
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !valid}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            <AppIcon name="route" size={15} />
            {saving ? 'Saving…' : 'Save route'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================= 5 · New project ================= */

const PROJECT_STATUSES: Project['status'][] = ['on-track', 'at-risk', 'blocked', 'done']
const PROJECT_HOUSES = ['All houses', 'Maple House', 'Cedar House', 'Birch House', 'Willow House']

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const allowed = useCan('apps.manage')
  const user = useAuthStore((s) => s.user)
  const [people, setPeople] = useState<any[]>([])
  const [docs, setDocs] = useState<any[]>([])
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('')
  const [status, setStatus] = useState<Project['status']>('on-track')
  const [progress, setProgress] = useState('10')
  const [due, setDue] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'))
  const [house, setHouse] = useState(PROJECT_HOUSES[0])
  const [area, setArea] = useState('')
  const [description, setDescription] = useState('')
  const [docIds, setDocIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api.list<any>('people').then(setPeople).catch(() => setPeople([]))
    void api.list<any>('documents').then(setDocs).catch(() => setDocs([]))
  }, [])

  const toggleDoc = (id: string) =>
    setDocIds((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const valid = title.trim() && owner
  const submit = async () => {
    if (!guardPerm(allowed, 'apps.manage')) return
    if (!valid) {
      toast({ type: 'warning', title: 'Missing details', body: 'A project title and owner are required.' })
      return
    }
    setSaving(true)
    try {
      const pct = Math.max(0, Math.min(100, Number(progress) || 0))
      const ownerRow = people.find((p) => p.name === owner)
      const existing = await api.list<any>('projects')
      const nextNum = existing.length + 1
      const docLinks = docs
        .filter((d) => docIds.has(d.id))
        .map((d) => ({ id: d.id, title: d.title, href: '/app/docs/library' }))
      await api.create('projects', {
        code: `PRJ-${String(nextNum).padStart(3, '0')}`,
        title: title.trim(),
        owner,
        ownerAvatar: ownerRow?.avatar ?? user?.avatar ?? '',
        avatar: ownerRow?.avatar ?? user?.avatar ?? '',
        status,
        progress: pct / 100,
        progressPct: pct,
        due: new Date(due).toISOString(),
        house,
        area: area.trim() || 'General',
        description: description.trim(),
        docLinks,
        docCount: docLinks.length,
      })
      toast({ type: 'success', title: 'Project created', body: `${title.trim()} · ${docLinks.length} linked document${docLinks.length === 1 ? '' : 's'}.` })
      onClose()
    } catch {
      toast({ type: 'danger', title: 'Could not create project', body: 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto bg-surface sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[17px] font-bold text-text-1">
            <span className={cn('grid h-8 w-8 place-items-center rounded-[10px]', TINT_BG.violet)}>
              <AppIcon name="folder-kanban" size={15} className={TINT_FG.violet} />
            </span>
            New project
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Link Knowledge documents so the project sheet and detail panel stay one click from the paperwork.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Project title" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. EVV compliance cleanup" className={inputCls} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Owner" required>
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className={cn(inputCls, !owner && 'text-text-3')}>
                <option value="" disabled>Select owner…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.name} className="text-text-1">{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as Project['status'])} className={inputCls}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Progress %">
              <input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Due date">
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </Field>
            <Field label="House">
              <select value={house} onChange={(e) => setHouse(e.target.value)} className={inputCls}>
                {PROJECT_HOUSES.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Area">
            <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Compliance" className={inputCls} />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cn(inputCls, 'h-auto py-2')} />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">
              Linked documentation {docIds.size > 0 && <span className="text-text-3">· {docIds.size} selected</span>}
            </span>
            <div className="scroll-thin grid max-h-44 gap-1 overflow-y-auto rounded-sm border border-border bg-surface-2 p-1.5">
              {docs.length === 0 && <p className="px-2 py-3 text-[12px] text-text-3">Loading documents…</p>}
              {docs.map((d) => (
                <label
                  key={d.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 transition-colors',
                    docIds.has(d.id) ? 'bg-primary-soft' : 'hover:bg-surface',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={docIds.has(d.id)}
                    onChange={() => toggleDoc(d.id)}
                    className="h-4 w-4 cursor-pointer rounded-[6px] accent-primary"
                  />
                  <AppIcon name="file-text" size={13} className="shrink-0 text-text-3" />
                  <span className="clamp-1 flex-1 text-[13px] font-medium text-text-1">{d.title}</span>
                  <span className="shrink-0 text-[11px] text-text-3">{d.id}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !valid}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            <AppIcon name="folder-kanban" size={15} />
            {saving ? 'Creating…' : 'Create project'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================= 6 · Open a shift's person ================= */

// Name → account: findAccountByName, shared from lib/usersDirectory.

// No modal to draw — a shift row carries a NAME, and the person lives wherever this viewer is allowed to look…
function StaffProfileOpener({ shift, onClose }: { shift: any; onClose: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const role = useAuthStore((s) => s.user?.role)
  const usersEnabled = useRegistryStore((s) => s.apps.some((a) => a.id === 'users' && a.enabled))
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const name = String(shift?.staff ?? '').trim()
      if (!name) {
        onClose()
        return
      }
      const seed = cachedUsers()
      let found = seed ? findAccountByName(seed, name) : null
      if (!found) {
        try {
          found = findAccountByName(await fetchUsers(), name)
        } catch {
          if (!cancelled) {
            toast({ type: 'danger', title: 'Could not open the profile', body: 'The accounts directory did not answer — try again in a moment.' })
            onClose()
          }
          return
        }
      }
      if (cancelled) return
      if (!found?.id) {
        toast({
          type: 'warning',
          title: `${name} has no platform account`,
          body: 'Only people who sign in to asa. have a profile here. An admin can invite them in Settings → Users.',
        })
        onClose()
        return
      }
      // Carry WHERE THIS CLICK CAME FROM: the profile's Back button returns here instead of its hardcoded…
      navigate(
        role === 'admin' && usersEnabled
          ? `/app/users/profile?u=${encodeURIComponent(found.id)}`
          : `/app/chat/messages?with=${encodeURIComponent(found.id)}`,
        { state: { from: location.pathname + location.search } },
      )
      onClose()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot: resolve and go, on the click that mounted this
  }, [])
  return null
}

/* ================= 7 · Open a shift's house ================= */

/** '7:00 AM' → minutes since midnight, for same-day ordering. No clock sorts last. */
function startMinutes(v: any): number {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(v ?? ''))
  if (!m) return 24 * 60
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3] ?? '')) h += 12
  return h * 60 + Number(m[2])
}

// DetailTemplate config for the house panel.
const HOUSE_PANEL_CONFIG = (hasAddress: boolean) => ({
  header: { title: 'name', subtitle: 'code' },
  sections: [
    // Image Bank scene portrait — a house with no photo renders no section.
    { kind: 'image', title: 'House', srcField: 'photo', altField: 'name' },
    {
      kind: 'fields',
      title: 'Details',
      fields: [
        { icon: 'house', label: 'Name', value: 'name' },
        { icon: 'hash', label: 'Code', value: 'code' },
        ...(hasAddress ? [{ icon: 'map-pin', label: 'Address', value: 'address' }] : []),
      ],
    },
    // keyless Google Maps embed of the joined address
    { kind: 'map', title: 'Location', addressField: 'address' },
    { kind: 'list', title: 'On the roster here', itemsField: 'roster' },
  ],
})

// The house chip on a coverage row is its own door: it opens the HOUSE in the side panel, not the shift.
function HousePanelOpener({ shift, onClose }: { shift: any; onClose: () => void }) {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const name = String(shift?.house ?? '').trim()
      const code = String(shift?.houseCode ?? '').trim()
      const photo = String(shift?.housePhoto ?? '').trim()
      // both slices are cached reads the coverage page has already made
      const [shifts, houses] = await Promise.all([
        api.list<any>('shifts').catch(() => [] as any[]),
        api.list<any>('houses').catch(() => [] as any[]),
      ])
      if (cancelled) return
      // Who's on the roster here: this house's rows from OHIO's today on (the roster is Ohio's, like every date on…
      const today = ohioToday()
      const dayKey = (v: any) => {
        const d = ohioWall(String(v ?? ''))
        return d ? format(d, 'yyyy-MM-dd') : ''
      }
      const roster = (Array.isArray(shifts) ? shifts : [])
        .filter((s) => String(s?.houseCode ?? '').trim() === code && dayKey(s?.date) >= today)
        .sort(
          (a, b) =>
            dayKey(a?.date).localeCompare(dayKey(b?.date)) || startMinutes(a?.start) - startMinutes(b?.start),
        )
        .slice(0, 10)
        .map((s) => {
          const d = ohioWall(String(s?.date ?? ''))
          const day = d ? format(d, 'EEE, MMM d') : String(s?.date ?? '')
          const time = [String(s?.start ?? '').trim(), String(s?.end ?? '').trim()].filter(Boolean).join('–')
          const when = [day, time].filter(Boolean).join(' ')
          return {
            title: String(s?.staff ?? '—'),
            meta: [when, String(s?.status ?? '').trim()].filter(Boolean).join(' · '),
            icon: 'user',
          }
        })
      // the house's own registry street, matched on the code exactly
      const hit = (Array.isArray(houses) ? houses : []).find((h) => String(h?.code ?? '') === code)
      const address = hit ? String(hit.address ?? '').trim() : ''
      useDetailPanelStore.getState().openDetail({
        config: HOUSE_PANEL_CONFIG(address !== ''),
        record: { name: name || code || 'House', code, photo, address, roster },
      })
      onClose()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot: assemble and open, on the click that mounted this
  }, [])
  return null
}

/* ================= mounted switch ================= */

type Project = { status: 'on-track' | 'at-risk' | 'blocked' | 'done' }

/** Mounted once (SheetTemplate). Renders the currently open ops-flow modal. */
export function OpsActionModals() {
  const modal = useOpsModalStore((s) => s.modal)
  const close = useOpsModalStore((s) => s.close)
  if (!modal) return null
  switch (modal.kind) {
    case 'mui-escalate':
      return <EscalateMuiModal incident={modal.incident} onClose={close} />
    case 'policy-open':
      return <PolicyReaderModal ack={modal.ack} onClose={close} />
    case 'policy-import':
      return <ImportPolicyModal onClose={close} />
    case 'route-add':
      return <AddRouteModal onClose={close} />
    case 'project-new':
      return <NewProjectModal onClose={close} />
    case 'people-merge':
      return <PeopleMergeModal onClose={close} />
    case 'staff-profile':
      return <StaffProfileOpener shift={modal.shift} onClose={close} />
    case 'house-panel':
      return <HousePanelOpener shift={modal.shift} onClose={close} />
    default:
      return null
  }
}
