// Account Access in the right panel: Send Invite (the Users screen's userInvite), Disable or Enable Access…
// Each is confirmed inside the panel by a second press.
import { useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { DraftButtons } from '@/pages/features/locations/LocationParts'
import { inviteToast } from '@/pages/settings/UsersSection'
import {
  blockedSentence, readReleaseRefusal, rearmFailedLine, releaseReportView, type ReleaseResult,
} from '@/pages/features/releaseusers/releaseReport'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { hrOf, readRefusal, stampWords, type RosterRow, type StaffAccount } from './staffModel'
import {
  readHr, readKey, readReleaseStatus, resetPassword, sendInvite, setAccountActive, staffWrote, useStaffRead,
} from './useStaffRead'
import { ReadLine } from './StaffParts'

export const NO_PASSWORDS = 'Passwords are never displayed or exported.'

const errText = (e: unknown): string => readRefusal(e instanceof Error ? e.message : String(e))

/** The account the HR read matched to this person; the panel draws nothing to act on without one. */
function useAccount(row: RosterRow) {
  return useStaffRead(readKey('staffProfileHr', row.key), () => readHr(row.key), hrOf)
}

function AccountFacts({ account }: { account: StaffAccount }) {
  return (
    <dl className="grid gap-2 rounded-lg border border-border px-3 py-2.5 text-[12.5px]" data-account-facts="">
      <div className="flex justify-between gap-3"><dt className="text-text-3">Login</dt><dd className="break-all text-right text-text-1">{account.login || '—'}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-text-3">Status</dt><dd className="text-text-1">{account.active ? 'Active' : 'Disabled'}</dd></div>
      <div className="flex justify-between gap-3">
        <dt className="text-text-3">Last sign-in</dt>
        <dd className="text-text-1">{account.last_login ? stampWords(account.last_login) : 'Never signed in'}</dd>
      </div>
    </dl>
  )
}

function Frame({ row, children }: { row: RosterRow; children: (account: StaffAccount) => ReactNode }) {
  const hr = useAccount(row)
  const account = hr.data?.account ?? null
  return (
    <div className="grid gap-4 pt-1" data-account-panel="">
      <ReadLine state={hr} what="the account" onRetry={hr.reload} />
      {hr.data && !account && (
        <p className="text-[13px] text-text-3">No platform account is matched to {row.name}{hr.data.account_why ? ` — ${hr.data.account_why}` : ''}.</p>
      )}
      {account && (
        <>
          <AccountFacts account={account} />
          {children(account)}
        </>
      )}
      <p className="text-[11.5px] text-text-3">{NO_PASSWORDS}</p>
    </div>
  )
}

/* ---------- send invite ---------- */

export function InviteBody({ row, onDone }: { row: RosterRow; onDone: () => void }) {
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Frame row={row}>
      {(account) => {
        const by = account.login.includes('@') ? 'a letter to the login address' : 'a text to the login number'
        const send = async () => {
          const press = nextPress(armed, 'send')
          setArmed(press.armed)
          if (!press.act) return
          setBusy(true)
          try {
            toast(inviteToast(await sendInvite(account.user_id)))
            onDone()
          } catch (e) {
            toast({ type: 'danger', title: 'The invitation was not sent', body: errText(e) })
          } finally {
            setBusy(false)
          }
        }
        return (
          <>
            <p className="text-[13px] leading-5 text-text-2" data-invite-by="">
              The invitation goes by {by}. It carries the sign-in and says the platform asks for a new password at the first sign-in.
            </p>
            <DraftButtons armed={armed === 'send'} busy={busy} disabled={false} label="Send Invite" armedLabel="Send the invitation — press again"
              onPress={() => void send()} onDisarm={() => setArmed('')} onCancel={onDone} />
          </>
        )
      }}
    </Frame>
  )
}

/* ---------- disable or enable access ---------- */

export function AccessBody({ row, onDone }: { row: RosterRow; onDone: () => void }) {
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Frame row={row}>
      {(account) => {
        const turningOff = account.active
        const flip = async () => {
          const press = nextPress(armed, 'flip')
          setArmed(press.armed)
          if (!press.act) return
          setBusy(true)
          try {
            staffWrote(row.key, await setAccountActive(account.user_id, !turningOff))
            toast({ type: 'success', title: turningOff ? 'Access disabled' : 'Access enabled',
              body: turningOff ? `${row.name} can no longer sign in.` : `${row.name} can sign in again.` })
            onDone()
          } catch (e) {
            toast({ type: 'danger', title: 'Access was not changed', body: errText(e) })
          } finally {
            setBusy(false)
          }
        }
        return (
          <>
            <p className="text-[13px] leading-5 text-text-2" data-access-words="">
              {turningOff
                ? `${row.name} is signed out and cannot sign in. Nothing of theirs is deleted, and access can be turned back on.`
                : `${row.name} can sign in again with the password they already have.`}
            </p>
            <DraftButtons armed={armed === 'flip'} busy={busy} disabled={false} label={turningOff ? 'Disable Access' : 'Enable Access'}
              armedLabel={turningOff ? 'Disable access — press again' : 'Enable access — press again'}
              onPress={() => void flip()} onDisarm={() => setArmed('')} onCancel={onDone} />
          </>
        )
      }}
    </Frame>
  )
}

/* ---------- reset password ---------- */

function Report({ report }: { report: ReleaseResult }) {
  const view = releaseReportView(report)
  return (
    <div data-reset-report={view.tone}
      className={cn('rounded-lg px-3 py-2.5 text-[12.5px] leading-5',
        view.tone === 'mint' ? 'bg-tint-mint text-tint-fg-mint' : view.tone === 'danger' ? 'bg-tint-danger text-tint-fg-danger' : 'bg-tint-amber text-tint-fg-amber')}>
      <p className="font-semibold">{view.headline}</p>
      {view.lockedOut && <p className="mt-1">The account is rearmed and nobody was told the new password — until they are given it, they cannot sign in.</p>}
      {report.outcome === 'rearm_failed' && <p className="mt-1">{rearmFailedLine(report.restored)}</p>}
      {!!report.warnings?.length && <ul className="mt-1 list-disc pl-4">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {!!report.why?.length && <ul className="mt-1 list-disc pl-4">{report.why.map((w) => <li key={w}>{w}</li>)}</ul>}
    </div>
  )
}

export function ResetBody({ row, onDone }: { row: RosterRow; onDone: () => void }) {
  return (
    <Frame row={row}>
      {(account) => <ResetInner key={account.user_id} row={row} userId={account.user_id} onDone={onDone} />}
    </Frame>
  )
}

function ResetInner({ row, userId, onDone }: { row: RosterRow; userId: string; onDone: () => void }) {
  const status = useStaffRead(readKey('releaseUserStatus', row.key, userId), () => readReleaseStatus(userId), (raw) => raw as {
    signed_in_before?: boolean; armed?: boolean; must_change?: boolean; sending_holds?: boolean; blocked_by?: string; will_clear?: string[]
  })
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ReleaseResult | null>(null)
  const [blocked, setBlocked] = useState(false)
  const s = status.data
  const ownPassword = !!s && (s.signed_in_before === true || (s.armed === true && s.must_change !== true))

  const press = async (anyway: boolean) => {
    const step = nextPress(armed, anyway ? 'anyway' : 'reset')
    setArmed(step.armed)
    if (!step.act) return
    setBusy(true)
    try {
      const got = await resetPassword(userId, anyway)
      setReport(got)
      setBlocked(false)
      // the person's answers, this release state among them, are read again
      staffWrote(row.key, got)
      toast({ type: got.emailed ? 'success' : 'warning', title: releaseReportView(got).headline, body: row.name })
    } catch (e) {
      const refusal = readReleaseRefusal(e)
      if (refusal.kind === 'blocked') {
        setReport(refusal.report)
        setBlocked(true)
      } else if (refusal.kind === 'rearmed' || refusal.kind === 'rearm_failed') {
        setReport(refusal.report)
        setBlocked(false)
        staffWrote(row.key, refusal.report)
        toast({ type: refusal.kind === 'rearmed' ? 'warning' : 'danger', title: releaseReportView(refusal.report).headline, body: row.name })
      } else {
        toast({ type: 'danger', title: 'The reset failed', body: readRefusal(refusal.message) })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3" data-reset="">
      <ReadLine state={status} what="the release state" onRetry={status.reload} />
      <p className="text-[13px] leading-5 text-text-2">
        The account is rearmed with a fresh temporary password and the invitation that names it is sent, as Release Users does.
        {ownPassword && <strong className="font-semibold text-text-1"> {row.name} has a password of their own, and it stops working at once.</strong>}
      </p>
      {s?.sending_holds && (
        <p className="flex items-start gap-2 rounded-lg bg-tint-amber px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber" data-reset-holds="">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> The letter would not reach them: {blockedSentence(s.blocked_by)}.
        </p>
      )}
      {!!s?.will_clear?.length && (
        <div className="text-[12.5px] text-text-2">
          <p className="font-semibold text-text-1">The reset clears:</p>
          <ul className="list-disc pl-4">{s.will_clear.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {report && <Report report={report} />}
      {busy && <p className="flex items-center gap-2 text-[12px] text-text-3"><Loader2 size={13} className="animate-spin" /> Resetting…</p>}
      {blocked ? (
        <>
          <p className="text-[12.5px] leading-5 text-text-2">
            Nothing was changed. The account can still be rearmed, knowing their current password stops working, nobody is
            told the new one, and they get back in with Forgot password on the sign-in page.
          </p>
          <DraftButtons armed={armed === 'anyway'} busy={busy} disabled={false} label="Rearm anyway"
            armedLabel="Rearm anyway — press again" onPress={() => void press(true)} onDisarm={() => setArmed('')} onCancel={onDone} />
        </>
      ) : (
        <DraftButtons armed={armed === 'reset'} busy={busy} disabled={!s} label="Reset Password" armedLabel="Reset password — press again"
          onPress={() => void press(false)} onDisarm={() => setArmed('')} onCancel={onDone} />
      )}
    </div>
  )
}
