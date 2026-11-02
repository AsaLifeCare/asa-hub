// The platform-contacts merge review — an INTELLIGENT merge, inside the Hub, across the profile of every user.
// Preview first, apply second — the shape PeopleMergeModal proved: the admin sees every account the merge would…
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AppIcon } from '@/lib/icons'
import { gasAction } from '@/features/hiring/shared'
import { fetchUsers } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type PlanItem = {
  user_id: string
  name: string
  matched_by: 'link' | 'email' | 'phone' | 'name'
  person: string
  /** the scalar columns the merge would fill or refresh */
  fills: string[]
  phones_add: number
  emails_add: number
}

type Preview = {
  examined: number
  planned: number
  unchanged: number
  matched_by: { link: number; email: number; phone: number; name: number }
  skipped_merged: number
  skipped_client: number
  garbage_roles: number
  near: number
  near_named: string[]
  // not linked, each with its reason: matched only by what the account wrote itself (a profile e-mail, a phone, a…
  confirm?: number
  confirm_named?: string[]
  ambiguous: number
  ambiguous_named: string[]
  unmatched: number
  unmatched_named: string[]
  people: number
  source_at: string
  plan: PlanItem[]
}

type ApplyResult = {
  touched: number
  cells: number
  phones_added: number
  emails_added: number
  remaining: number
  missing: string[]
  planned: number
}

const chipCls = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold'
const HOW_LABEL: Record<PlanItem['matched_by'], string> = {
  link: 'already linked',
  email: 'same sign-in e-mail',
  phone: 'same phone',
  name: 'same name',
}
const FILL_LABEL: Record<string, string> = {
  people_id: 'link',
  roster_status: 'status',
  employee_id: 'employee id',
  start_date: 'start date',
  end_date: 'end date',
  title: 'title',
  phone: 'phone',
}

export default function ContactsMergeModal({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  useEffect(() => {
    let alive = true
    gasAction<Preview>('usersContactMergePreview', {}, { timeoutMs: 120000 })
      .then((r) => {
        if (!alive) return
        setPreview(r)
        // every planned account starts CHECKED: the plan is blank-only and additive by construction, so the review…
        setSelected(new Set((r?.plan ?? []).map((p) => p.user_id)))
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Could not read the plan.'))
    return () => { alive = false }
  }, [])

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const apply = async () => {
    if (!preview || !selected.size) return
    setApplying(true)
    try {
      const r = await gasAction<ApplyResult>('usersContactMergeApply',
        { user_ids: [...selected] }, { timeoutMs: 180000 })
      setResult(r)
      toast({
        type: 'success',
        title: `${r.touched} account${r.touched === 1 ? '' : 's'} updated from the platform`,
        body: `${r.cells} cell${r.cells === 1 ? '' : 's'} filled · ${r.phones_added} phone${r.phones_added === 1 ? '' : 's'} and ${r.emails_added} e-mail${r.emails_added === 1 ? '' : 's'} kept as context` +
              (r.remaining ? ` · ${r.remaining} left for the next pass` : ''),
      })
      // there is no users slice — this refetch IS the reload
      void fetchUsers({ force: true }).catch(() => {})
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        toast({ type: 'info', title: 'The merge is already running', body: 'Check the platform log for its counts.' })
      } else {
        toast({ type: 'danger', title: 'The merge did not run', body: err instanceof Error ? err.message : 'Nothing was written.' })
      }
    } finally {
      setApplying(false)
    }
  }

  const plan = preview?.plan ?? []

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Merge platform contacts</DialogTitle>
          <DialogDescription>
            The platform&apos;s roster reaches the accounts. Blanks are filled, a different phone or e-mail is kept
            beside the account&apos;s own, the sign-in e-mail is never touched, and the roster status is information —
            it never deactivates anyone. Every filled value says where it came from.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="rounded-md bg-tint-pink/40 px-3 py-2 text-[13px] text-text-1">{error}</p>}
        {!preview && !error && <p className="py-6 text-center text-[13px] text-text-3">Reading the roster and the accounts…</p>}

        {preview && !result && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-3">
            <span className={cn(chipCls, 'bg-surface-2 text-text-2')}>{preview.examined} account{preview.examined === 1 ? '' : 's'} examined</span>
            <span className={cn(chipCls, 'bg-surface-2 text-text-2')}>{preview.people} roster row{preview.people === 1 ? '' : 's'}</span>
            <span className={cn(chipCls, 'bg-tint-mint/60 text-text-1')}>{preview.planned} would change</span>
            <span className={cn(chipCls, 'bg-surface-2 text-text-3')}>{preview.unchanged} already current</span>
            {preview.skipped_client > 0 && (
              <span className={cn(chipCls, 'bg-surface-2 text-text-3')}>{preview.skipped_client} client{preview.skipped_client === 1 ? '' : 's'} left as they are</span>
            )}
            {preview.garbage_roles > 0 && (
              <span className={cn(chipCls, 'bg-tint-amber/60 text-text-1')} title="Roster roles that are the application form's text, not a job — refused, never written">
                {preview.garbage_roles} polluted role{preview.garbage_roles === 1 ? '' : 's'} refused
              </span>
            )}
            {preview.source_at && (
              <span className={cn(chipCls, 'bg-surface-2 text-text-3')} title="When the platform last handed its list over">
                platform list as of {preview.source_at.slice(0, 16).replace('T', ' ')}
              </span>
            )}
          </div>
        )}

        {preview && plan.length === 0 && !result && (
          <p className="py-6 text-center text-[13px] text-text-2">
            Nothing to merge — every matched account already carries what the platform knows.
          </p>
        )}

        {preview && plan.length > 0 && !result && (
          <div className="scroll-thin max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
            {plan.map((p) => (
              <label
                key={p.user_id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors',
                  selected.has(p.user_id) ? 'border-primary/50 bg-primary-soft/40' : 'border-border bg-surface',
                )}
              >
                <input type="checkbox" className="mt-1" checked={selected.has(p.user_id)} onChange={() => toggle(p.user_id)} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] text-text-1">
                    <span className="font-semibold">{p.name}</span>
                    {p.person && p.person !== p.name && (
                      <span className="ml-1.5 text-[12px] text-text-3">roster: {p.person}</span>
                    )}
                    <span className="ml-1.5 text-[11.5px] text-text-3">· {HOW_LABEL[p.matched_by] ?? p.matched_by}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {p.fills.map((f) => (
                      <span key={f} className={cn(chipCls, 'bg-tint-mint/60 text-text-1')}>{FILL_LABEL[f] ?? f}</span>
                    ))}
                    {p.phones_add > 0 && (
                      <span className={cn(chipCls, 'bg-tint-blue/50 text-text-1')}>+{p.phones_add} phone{p.phones_add > 1 ? 's' : ''} (Platform)</span>
                    )}
                    {p.emails_add > 0 && (
                      <span className={cn(chipCls, 'bg-tint-blue/50 text-text-1')}>+{p.emails_add} e-mail{p.emails_add > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
              </label>
            ))}
            {preview.planned > plan.length && (
              <p className="px-1 pt-1 text-[11.5px] text-text-3">
                Showing the first {plan.length} of {preview.planned}; the rest ride the clock.
              </p>
            )}
          </div>
        )}

        {preview && !result && (preview.near_named.length > 0 || preview.ambiguous_named.length > 0 ||
          (preview.confirm_named ?? []).length > 0) && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12px] text-text-2">
            <p className="font-semibold">Questions the merge will not answer for you</p>
            {(preview.confirm_named ?? []).length > 0 && (
              <p className="mt-1">
                <span className="text-text-3">
                  Not linked, each saying why — what the account wrote itself, a name on a row carrying another
                  address, a row not on staff, or a link an older rule wrote. When it is the same person and the row is
                  on staff, put the account&apos;s sign-in e-mail on its roster row and the next pass links it:
                </span>{' '}
                {(preview.confirm_named ?? []).slice(0, 6).join(' · ')}{(preview.confirm_named ?? []).length > 6 ? '…' : ''}
              </p>
            )}
            {preview.near_named.length > 0 && (
              <p className="mt-1">
                <span className="text-text-3">Look like roster people (not matched):</span>{' '}
                {preview.near_named.slice(0, 6).join(' · ')}{preview.near_named.length > 6 ? '…' : ''}
              </p>
            )}
            {preview.ambiguous_named.length > 0 && (
              <p className="mt-1">
                <span className="text-text-3">Share a key with several roster people (skipped):</span>{' '}
                {preview.ambiguous_named.slice(0, 6).join(' · ')}{preview.ambiguous_named.length > 6 ? '…' : ''}
              </p>
            )}
            <p className="mt-1 text-[11.5px] text-text-3">Settle these by hand — Merge, or the roster&apos;s people review.</p>
          </div>
        )}

        {result && (
          <div className="space-y-1.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-text-1">
            <p className="font-semibold">{result.touched} account{result.touched === 1 ? '' : 's'} updated.</p>
            <p className="text-text-2">
              {result.cells} cell{result.cells === 1 ? '' : 's'} filled · {result.phones_added} phone{result.phones_added === 1 ? '' : 's'} and{' '}
              {result.emails_added} e-mail{result.emails_added === 1 ? '' : 's'} kept as Platform contexts.
            </p>
            {result.remaining > 0 && <p className="text-text-2">{result.remaining} left for the next pass — the clock finishes them within two hours.</p>}
            {result.missing.length > 0 && <p className="text-text-2">Not found at write time: {result.missing.join(', ')}.</p>}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <button onClick={onClose} className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover">
              Done
            </button>
          ) : (
            <>
              <button onClick={onClose} className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                Cancel
              </button>
              <button
                onClick={apply}
                disabled={!selected.size || applying || !preview}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="git-merge" size={15} />
                {applying ? 'Merging…' : `Merge ${selected.size} account${selected.size === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
