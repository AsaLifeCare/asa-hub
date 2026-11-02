// PSI Log › New client: add a client to PsiAnywhere (app/psi_log.py create_client, /hub-lanes/psi-log/new-client) —
// PsiAnywhere's own "add individual" (insertNewIndividual), under the signed-in admin session. A consumer number
// already in use is refused; a name already on record asks to go on. App Control's psi-log.newClient row opens it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Check, Loader2, UserPlus } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { psiLane, PSI_LOG_HOME, signedOut, SESSION_ENDED } from './psiLane'
import { toast } from '@/stores/useToastStore'

export const NEW_CLIENT_PATH = '/hub-lanes/psi-log/new-client'
type Option = { id: string; name: string }
// ended: signed out because PsiAnywhere let go of the session, in its words
type Form = { signedIn: boolean; psiUser?: string; customers?: Option[]; locations?: Option[]; ended?: string }

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const opts = (v: unknown): Option[] => (Array.isArray(v) ? v.map((r) => {
  const o = (r ?? {}) as Record<string, unknown>
  return { id: text(o.id), name: text(o.name) }
}).filter((o) => o.id) : [])

const input = 'h-10 w-full rounded-sm border border-border bg-surface px-3 text-[13.5px] text-text-1 outline-none focus:border-primary'
const lbl = 'block space-y-1'
const cap = 'text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3'

const BLANK = {
  firstName: '', lastName: '', consumerNumber: '', billingNumber: '', defaultCustomer: '', currentlocation: '',
  address1: '', address2: '', city: '', state: '', zipcode: '', dateActive: '', dateBirth: '',
  evvEligible: false, selfWaiver: false,
}

export default function PsiNewClientPage() {
  const [form, setForm] = useState<Form | null>(null)
  const [why, setWhy] = useState('')
  const [v, setV] = useState({ ...BLANK })
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState<{ name: string; id: string; consumerNumber: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const got = await psiLane<Record<string, unknown>>(NEW_CLIENT_PATH)
      setForm({ signedIn: got?.signedIn === true, psiUser: text(got?.psiUser), customers: opts(got?.customers), locations: opts(got?.locations),
        ended: text(got?.ended) })
      setWhy('')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'the form could not be read')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const set = (k: keyof typeof BLANK) => (val: string | boolean) => { setV((s) => ({ ...s, [k]: val })); setConfirm('') }
  const ready = useMemo(() => v.firstName.trim() && v.lastName.trim() && v.consumerNumber.trim() && v.defaultCustomer && v.currentlocation, [v])

  const create = async (force: boolean): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const got = await psiLane<{ id?: string; name?: string; consumerNumber?: string; needsConfirm?: boolean; message?: string }>(
        NEW_CLIENT_PATH, { method: 'POST', body: JSON.stringify({ ...v, state: v.state.toUpperCase(), force }) })
      if (got?.needsConfirm) { setConfirm(text(got.message)); return }
      setDone({ name: text(got?.name), id: text(got?.id), consumerNumber: text(got?.consumerNumber) })
      setConfirm('')
      toast({ type: 'success', title: `${text(got?.name)} was added to PsiAnywhere` })
      setV({ ...BLANK })
    } catch (e) {
      // the PsiAnywhere session is gone: the sign-in card instead of a form that still looks signed in
      if (signedOut(e)) setForm({ signedIn: false, ended: e instanceof Error && e.message ? e.message : SESSION_ENDED })
      else toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader title="New client" subtitle="Add a client to PsiAnywhere." />
      {why && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
          {why}<button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
      {form && !form.signedIn && (
        <div className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-2">
          {form.ended && <div className="mb-2 font-semibold text-text-1">{form.ended}</div>}
          Sign in to PsiAnywhere on the <Link to={PSI_LOG_HOME} className="font-semibold text-primary hover:underline">PSI Log</Link> page first, with an administrator account.
        </div>
      )}
      {done && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-tint-mint bg-tint-mint px-3 py-2 text-[13px] text-text-1">
          <Check size={16} /> {done.name} was added (consumer number {done.consumerNumber}).
        </div>
      )}
      {form?.signedIn && (
        <form onSubmit={(e) => { e.preventDefault(); void create(false) }} className="rounded-lg border border-border bg-surface p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={lbl}><span className={cap}>First name *</span>
              <input value={v.firstName} onChange={(e) => set('firstName')(e.target.value)} className={input} autoFocus /></label>
            <label className={lbl}><span className={cap}>Last name *</span>
              <input value={v.lastName} onChange={(e) => set('lastName')(e.target.value)} className={input} /></label>
            <label className={lbl}><span className={cap}>Consumer number *</span>
              <input value={v.consumerNumber} onChange={(e) => set('consumerNumber')(e.target.value)} className={input} /></label>
            <label className={lbl}><span className={cap}>Billing number</span>
              <input value={v.billingNumber} onChange={(e) => set('billingNumber')(e.target.value)} placeholder="defaults to the consumer number" className={input} /></label>
            <label className={lbl}><span className={cap}>Customer *</span>
              <select value={v.defaultCustomer} onChange={(e) => set('defaultCustomer')(e.target.value)} className={input}>
                <option value="">Choose…</option>
                {form.customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label className={lbl}><span className={cap}>Location *</span>
              <select value={v.currentlocation} onChange={(e) => set('currentlocation')(e.target.value)} className={input}>
                <option value="">Choose…</option>
                {form.locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
            <label className={lbl}><span className={cap}>Address 1</span>
              <input value={v.address1} onChange={(e) => set('address1')(e.target.value)} className={input} /></label>
            <label className={lbl}><span className={cap}>Address 2</span>
              <input value={v.address2} onChange={(e) => set('address2')(e.target.value)} className={input} /></label>
            <label className={lbl}><span className={cap}>City</span>
              <input value={v.city} onChange={(e) => set('city')(e.target.value)} className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className={lbl}><span className={cap}>State</span>
                <input value={v.state} onChange={(e) => set('state')(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} className={input} /></label>
              <label className={lbl}><span className={cap}>Zip</span>
                <input value={v.zipcode} onChange={(e) => set('zipcode')(e.target.value)} maxLength={10} className={input} /></label>
            </div>
            <label className={lbl}><span className={cap}>Active date</span>
              <input type="date" value={v.dateActive} onChange={(e) => set('dateActive')(e.target.value)} className={input} /></label>
            <label className={lbl}><span className={cap}>Date of birth</span>
              <input type="date" value={v.dateBirth} onChange={(e) => set('dateBirth')(e.target.value)} className={input} /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-1">
              <input type="checkbox" checked={v.evvEligible} onChange={(e) => set('evvEligible')(e.target.checked)} /> EVV eligible
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-1">
              <input type="checkbox" checked={v.selfWaiver} onChange={(e) => set('selfWaiver')(e.target.checked)} /> SELF waiver
            </label>
          </div>
          {confirm && (
            <div className="mt-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
              {confirm}
              <button type="button" onClick={() => void create(true)} className="ml-2 font-semibold underline">Add anyway</button>
            </div>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="submit" disabled={!ready || busy}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Add client
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
