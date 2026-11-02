// "Start Onboarding Manual" — big two-column modal for the Onboarding Tracker.
// LEFT — candidate details (name*, position*, email*, phone, house, manager person picker, start date, source) plus…
import { useRef, useState } from 'react'
import { addDays, format } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import { ONBOARDING_PACKET } from '@/lib/seed-expansion'
import type { OnboardingChecklistItem } from '@/lib/seed-expansion'
import { toast } from '@/stores/useToastStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { AppIcon } from '@/lib/icons'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'
import { ohioToday } from '@/lib/ohio'

const POSITIONS = ['DSP', 'House Manager', 'Nurse', 'Coordinator']
const HOUSES = ['Maple House', 'Cedar House', 'Birch House', 'Willow House']
const SOURCES = ['Referral', 'Indeed', 'Careers page', 'Job fair', 'Agency']

const OWNER_TINT: Record<string, TintName> = { Candidate: 'blue', HR: 'peach', Auto: 'mint' }

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

type FormState = {
  name: string
  position: string
  email: string
  phone: string
  house: string
  manager: string
  startDate: string
  source: string
}

const emptyForm = (): FormState => ({
  name: '',
  position: '',
  email: '',
  phone: '',
  house: '',
  manager: '',
  startDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
  source: '',
})

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-medium text-text-2">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <span className={cn('block', error && '[&_input]:border-danger [&_select]:border-danger')}>{children}</span>
    </label>
  )
}

/** One prepared checklist parameter rendered as a toggle row. */
function ParamRow({
  label,
  owner,
  on,
  onToggle,
}: {
  label: string
  owner: string
  on: boolean
  onToggle: () => void
}) {
  const tint = OWNER_TINT[owner] ?? 'blue'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2"
    >
      <span
        className={cn(
          'relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-150',
          on ? 'bg-primary' : 'bg-surface-3',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface shadow-1 transition-transform duration-150',
            on ? 'translate-x-[16px]' : 'translate-x-[2px]',
          )}
        />
      </span>
      <span className={cn('clamp-1 flex-1 text-[13px]', on ? 'font-medium text-text-1' : 'text-text-3 line-through')}>
        {label}
      </span>
      <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold', TINT_BG[tint], TINT_FG[tint])}>
        {owner}
      </span>
    </button>
  )
}

export default function StartOnboardingModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (row: any) => void
}) {
  const canEdit = useCan('hiring.edit')
  const users = useAuthStore((s) => s.users)
  const pushNotification = useNotificationStore((s) => s.push)

  const [form, setForm] = useState<FormState>(emptyForm)
  const [params, setParams] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ONBOARDING_PACKET.map((p) => [p.id, true])),
  )
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState<'pdf' | 'docx' | null>(null)
  const [detected, setDetected] = useState<string | null>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const docxRef = useRef<HTMLInputElement>(null)

  const set = (k: keyof FormState, v: string) => {
    setForm((s) => ({ ...s, [k]: v }))
    setErrors((s) => ({ ...s, [k]: false }))
  }

  const enabledItems = ONBOARDING_PACKET.filter((p) => params[p.id])
  const estDays = Math.max(1, Math.round(enabledItems.length * 0.4))
  const managerUser = users.find((u) => u.name === form.manager)

  const close = (o: boolean) => {
    if (!o) {
      setForm(emptyForm())
      setParams(Object.fromEntries(ONBOARDING_PACKET.map((p) => [p.id, true])))
      setErrors({})
      setDetected(null)
      setImporting(null)
    }
    onOpenChange(o)
  }

  /** Simulated resume/application parse — prefills the candidate column. */
  const simulateImport = (kind: 'pdf' | 'docx', fileName: string) => {
    setImporting(kind)
    setDetected(null)
    window.setTimeout(() => {
      const hit =
        kind === 'pdf'
          ? { name: 'Jane Doe', position: 'DSP', email: 'jane.doe@mail.example', phone: '(614) 555-0142', source: 'Careers page' }
          : { name: 'John Reyes', position: 'House Manager', email: 'john.reyes@mail.example', phone: '(614) 555-0117', source: 'Referral' }
      setForm((s) => ({ ...s, ...hit }))
      setErrors({})
      setImporting(null)
      setDetected(`Detected: ${hit.name} — ${hit.position}`)
      toast({
        type: 'success',
        title: `Detected: ${hit.name} — ${hit.position}`,
        body: `${fileName} parsed · form prefilled — review and press Start Onboarding.`,
      })
    }, 900)
  }

  const onFile = (kind: 'pdf' | 'docx') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    toast({ type: 'info', title: `Parsing ${file.name}…`, body: 'Extracting candidate details.' })
    simulateImport(kind, file.name)
  }

  const submit = async () => {
    if (!canEdit) {
      toast({ type: 'warning', title: 'Not allowed', body: 'Requires hiring.edit — ask an admin.' })
      return
    }
    const missing: Record<string, boolean> = {}
    if (!form.name.trim()) missing.name = true
    if (!form.position) missing.position = true
    if (!form.email.trim()) missing.email = true
    if (Object.keys(missing).length) {
      setErrors(missing)
      toast({ type: 'warning', title: 'Missing required fields', body: 'Name, position and email are required.' })
      return
    }
    if (enabledItems.length === 0) {
      toast({ type: 'warning', title: 'No checklist items', body: 'Keep at least one parameter switched on.' })
      return
    }
    setSaving(true)
    try {
      const today = ohioToday()
      const checklist: OnboardingChecklistItem[] = enabledItems.map((p) => ({
        ...p,
        status:
          p.owner === 'Auto'
            ? 'auto'
            : p.owner === 'Candidate' && p.stage !== 'packet'
              ? 'missing'
              : 'pending',
      }))
      const payload = {
        name: form.name.trim(),
        role: form.position,
        house: form.house || HOUSES[0],
        avatar: '',
        stage: 'packet',
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: '',
        source: form.source || 'Careers page',
        manager: form.manager || users[0]?.name || '',
        appliedAt: today,
        startedAt: today,
        startDate: form.startDate || today,
        daysInStage: 0,
        daysInOnboarding: 0,
        docsDone: checklist.filter((c) => c.status === 'done' || c.status === 'auto').length,
        checklist,
        notes: [
          { time: 'Just now', text: 'Onboarding started — new-hire packet sent via Dropbox', tint: 'blue' },
        ],
      }
      const row = await api.create('onboarding', payload)
      toast({
        type: 'success',
        title: `Onboarding started for ${payload.name}`,
        body: `${checklist.length} checklist items · Packet sent stage · ~${estDays} days to complete.`,
      })
      pushNotification({
        type: 'app',
        appId: 'onboarding',
        title: `Onboarding started — ${payload.name}`,
        body: `${payload.role}${payload.house ? ` · ${payload.house}` : ''} · ${checklist.length}/12 items requested`,
        priority: 'normal',
        href: '/app/onboarding/tracker',
      })
      onCreated?.(row)
      close(false)
    } catch {
      toast({ type: 'danger', title: 'Could not start onboarding', body: 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const mailto = form.email.trim()
    ? `mailto:${form.email.trim()}?subject=${encodeURIComponent('Onboarding — ASA LifeCare')}`
    : undefined

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface sm:max-w-[880px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[18px] font-bold text-text-1">Start Onboarding Manual</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Enter the new hire, review the prepared checklist parameters, then start onboarding — or import a
            candidate's application to prefill everything.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          {/* LEFT — candidate details */}
          <div className="grid content-start gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Candidate</h3>
            <Field label="Full name" required error={errors.name}>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Jane Doe"
                className={inputCls}
              />
            </Field>
            <Field label="Position" required error={errors.position}>
              <select
                value={form.position}
                onChange={(e) => set('position', e.target.value)}
                className={cn(inputCls, !form.position && 'text-text-3')}
              >
                <option value="" disabled>
                  Select position…
                </option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p} className="text-text-1">
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Email" required error={errors.email}>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="name@mail.example"
                className={inputCls}
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="(614) 555-0100"
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="House assignment">
                <select
                  value={form.house}
                  onChange={(e) => set('house', e.target.value)}
                  className={cn(inputCls, !form.house && 'text-text-3')}
                >
                  <option value="" disabled>
                    Select house…
                  </option>
                  {HOUSES.map((h) => (
                    <option key={h} value={h} className="text-text-1">
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start date">
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Manager">
              <div className="flex items-center gap-2">
                <select
                  value={form.manager}
                  onChange={(e) => set('manager', e.target.value)}
                  className={cn(inputCls, 'flex-1', !form.manager && 'text-text-3')}
                >
                  <option value="" disabled>
                    Select manager…
                  </option>
                  {users.map((u) => (
                    <option key={u.id} value={u.name} className="text-text-1">
                      {u.name} — {u.title}
                    </option>
                  ))}
                </select>
                {/* the ECHO of the choice, not the chooser — the <select> beside
                    it is what picks, so this face may be dragged away freely */}
                {managerUser && (
                  <DragPerson name={managerUser.name} id={managerUser.id} type="staff" avatar={managerUser.avatar} subtitle={managerUser.title} className="shrink-0">
                    <Avatar src={managerUser.avatar} name={managerUser.name} size="sm" />
                  </DragPerson>
                )}
              </div>
            </Field>
            <Field label="Source">
              <select
                value={form.source}
                onChange={(e) => set('source', e.target.value)}
                className={cn(inputCls, !form.source && 'text-text-3')}
              >
                <option value="" disabled>
                  Select source…
                </option>
                {SOURCES.map((s) => (
                  <option key={s} value={s} className="text-text-1">
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mt-1 flex items-center gap-2">
              {mailto ? (
                <a
                  href={mailto}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-primary transition-colors duration-150 hover:bg-primary-soft"
                >
                  <AppIcon name="mail" size={13} /> Email candidate
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Enter an email address first"
                  className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-3 opacity-60"
                >
                  <AppIcon name="mail" size={13} /> Email candidate
                </button>
              )}
              {detected && (
                <span className="clamp-1 inline-flex items-center gap-1.5 rounded-full bg-tint-mint px-2.5 py-1 text-[11px] font-semibold text-tint-fg-mint">
                  <AppIcon name="sparkles" size={11} /> {detected}
                </span>
              )}
            </div>
          </div>

          {/* RIGHT — prepared checklist parameters */}
          <div className="flex min-h-0 flex-col rounded-lg border border-border bg-surface-2/50 p-3">
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Checklist parameters
              </h3>
              <span className="text-[11px] font-semibold tabular-nums text-text-2">
                {enabledItems.length} items · ~{estDays} days
              </span>
            </div>
            <p className="mb-2 px-1 text-[11px] leading-4 text-text-3">
              Prepared packet items — switch off anything this hire doesn't need.
            </p>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {ONBOARDING_PACKET.map((p) => (
                <ParamRow
                  key={p.id}
                  label={p.label}
                  owner={p.owner}
                  on={Boolean(params[p.id])}
                  onToggle={() => setParams((s) => ({ ...s, [p.id]: !s[p.id] }))}
                />
              ))}
            </div>
          </div>
        </div>

        {/* footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <input ref={pdfRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onFile('pdf')} />
          <input
            ref={docxRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={onFile('docx')}
          />
          <button
            type="button"
            onClick={() => pdfRef.current?.click()}
            disabled={importing != null}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            <AppIcon name="file-text" size={14} className="text-tint-fg-pink" />
            {importing === 'pdf' ? 'Parsing…' : 'Import from PDF'}
          </button>
          <button
            type="button"
            onClick={() => docxRef.current?.click()}
            disabled={importing != null}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            <AppIcon name="file-type" size={14} className="text-tint-fg-blue" />
            {importing === 'docx' ? 'Parsing…' : 'Import from DOCX'}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => close(false)}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !canEdit}
            title={canEdit ? undefined : 'Requires hiring.edit — ask an admin'}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="user-plus" size={15} />
            {saving ? 'Starting…' : 'Start Onboarding'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
