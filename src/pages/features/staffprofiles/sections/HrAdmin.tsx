// HR Admin: the restricted record — Personal & Tax, Work Authorization, Driver Details, Screening and Account…
// The SSN, the licence number and the BCI reference arrive masked from Apps Script; a value with more digits than a…
import { KeyRound, Lock, Send, ShieldOff, ShieldCheck } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import {
  cellWords, driverLine, hrOf, mayEditSection, screenWords, stampWords, type RosterRow, type StaffAsk, type StaffHr,
} from '../staffModel'
import { readHr, readKey, useStaffRead, type ReadState } from '../useStaffRead'
import { Cell, CellGrid, EditPencil, Masked, ReadLine, WhyNote } from '../StaffParts'
import { orNone } from '../staffValues'
import { useStaffViewer } from '../staffViewer'

export default function HrAdminSection({ row, onAsk }: { row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const hr = useStaffRead(readKey('staffProfileHr', row.key), () => readHr(row.key), hrOf)
  return <HrAdminView hr={hr} onAsk={onAsk} onRetry={hr.reload} />
}

const day = (v: string) => orNone(cellWords(v))

const ACCOUNT_BTN = 'inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2'

export function HrAdminView({ hr, onAsk, onRetry }: { hr: ReadState<StaffHr>; onAsk: (ask: StaffAsk) => void; onRetry: () => void }) {
  const viewer = useStaffViewer()
  const { writes } = viewer
  const h = hr.data
  const pencil = mayEditSection(viewer, 'hr') ? <EditPencil section="hr" onAsk={onAsk} /> : undefined
  return (
    <div className="grid gap-5" data-hr="">
      <div className="flex items-start gap-3 rounded-[16px] border border-tint-amber bg-tint-amber px-4 py-3.5 text-tint-fg-amber" data-restricted="">
        <Lock size={17} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-[13.5px] font-semibold">Restricted HR record</p>
          <p className="text-[12.5px] leading-5">Sensitive values are masked where possible. Views and changes belong in the audit history.</p>
        </div>
      </div>
      <ReadLine state={hr} what="the HR record" onRetry={onRetry} />
      {h && <WhyNote why={h.why} degraded={h.degraded} />}
      {h && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <SectionCard title="Personal & Tax" extra={pencil}>
            <CellGrid>
              <Cell label="SSN"><Masked value={h.personal.ssn_masked} /></Cell>
              <Cell label="Date of birth">{day(h.personal.dob)}</Cell>
              <Cell label="Address">{orNone(h.personal.address)}</Cell>
              <Cell label="City">{orNone(h.personal.city)}</Cell>
              <Cell label="State">{orNone(h.personal.state)}</Cell>
              <Cell label="Zip">{orNone(h.personal.zip)}</Cell>
              <Cell label="W-4 date">{day(h.personal.w4_date)}</Cell>
              <Cell label="Pay authorization form date">{day(h.personal.pay_auth_date)}</Cell>
            </CellGrid>
          </SectionCard>

          <SectionCard title="Work Authorization" extra={pencil}>
            <CellGrid>
              <Cell label="I-9 date">{day(h.work_auth.i9_date)}</Cell>
              <Cell label="I-9 completed">{orNone(cellWords(h.work_auth.i9_completed))}</Cell>
              <Cell label="I-9 type 1">{orNone(h.work_auth.i9_type_1)}</Cell>
              <Cell label="I-9 type 1 expiration">{day(h.work_auth.i9_type_1_exp)}</Cell>
              <Cell label="I-9 type 2">{orNone(h.work_auth.i9_type_2)}</Cell>
              <Cell label="I-9 type 2 expiration">{day(h.work_auth.i9_type_2_exp)}</Cell>
              <Cell label="HIPAA form date">{day(h.work_auth.hipaa_date)}</Cell>
            </CellGrid>
          </SectionCard>

          <SectionCard title="Driver Details" extra={pencil}>
            <CellGrid>
              <Cell label="Driver">{orNone(driverLine(h.driver))}</Cell>
              <Cell label="Driver license number"><Masked value={h.driver.license_masked} /></Cell>
              <Cell label="License expiration">{day(h.driver.license_exp)}</Cell>
              <Cell label="Driver's abstract (original)">{day(h.driver.abstract_original)}</Cell>
              <Cell label="Driver's abstract (latest)">{day(h.driver.abstract_latest)}</Cell>
              <Cell label="Insurance expiration">{day(h.driver.insurance_exp)}</Cell>
            </CellGrid>
          </SectionCard>

          <SectionCard title="Screening" extra={pencil}>
            <CellGrid>
              {h.screening.map((s) => (
                <Cell key={s.id} label={s.label}>
                  {screenWords(s)}
                  {s.refMasked && <span className="ml-1.5 font-mono text-[12px] text-text-3" data-masked="">{s.refMasked}</span>}
                </Cell>
              ))}
              <Cell label="BCI check date">{day(h.bci_check_date)}</Cell>
              <Cell label="Rapback entry date">{day(h.rapback_entry_date)}</Cell>
            </CellGrid>
          </SectionCard>

          <SectionCard title="Account Access" className="lg:col-span-2">
            {h.account ? (
              <>
                <CellGrid>
                  <Cell label="Login">{orNone(h.account.login)}</Cell>
                  <Cell label="Account status">{h.account.active ? 'Active' : 'Disabled'}</Cell>
                  <Cell label="Role">{orNone(h.account.role)}</Cell>
                  <Cell label="Last sign-in">{h.account.last_login ? stampWords(h.account.last_login) : 'Never signed in'}</Cell>
                </CellGrid>
                <p className="mt-3 text-[12px] text-text-3">Passwords are never displayed or exported.</p>
                {writes && <div className="mt-3 flex flex-wrap gap-2" data-account-buttons="">
                  <button type="button" className={ACCOUNT_BTN} onClick={() => onAsk({ kind: 'invite' })} data-account="invite">
                    <Send size={14} /> Send Invite
                  </button>
                  <button type="button" className={ACCOUNT_BTN} onClick={() => onAsk({ kind: 'access' })} data-account="access">
                    {h.account.active ? <><ShieldOff size={14} /> Disable Access</> : <><ShieldCheck size={14} /> Enable Access</>}
                  </button>
                  <button type="button" className={ACCOUNT_BTN} onClick={() => onAsk({ kind: 'reset' })} data-account="reset">
                    <KeyRound size={14} /> Reset Password
                  </button>
                </div>}
              </>
            ) : (
              <p className="text-[13px] text-text-3" data-no-account="">
                No platform account is matched to this person{h.account_why ? ` — ${h.account_why}` : ''}.
              </p>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  )
}
