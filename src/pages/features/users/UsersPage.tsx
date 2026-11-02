import { useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
// Users — ONE app over the three worlds, as three sections of a single app: · System Users — everyone who can sign…
import UsersSection, { RestrictedUsersSection } from '@/pages/settings/UsersSection'
import { FileSignature, Loader2, Network, UsersRound } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { fetchUsers } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'
import ContactsMergeModal from '@/features/people/ContactsMergeModal'


export default function UsersPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // ?sec=general (and every redirected People link, ?record= included) lands straight on the absorbed directory
  if (!isAdmin) return <div className="w-full"><RestrictedUsersSection /></div>
  return (
    <div className="w-full">
      {/* NO SWITCHER OVER ONE THING — the System users tab at the top goes.
          Two tabs went and the third stayed drawn, which is a control that
          offers a choice it does not
          have. The app is the accounts; the page says so in its own header.

          AND ONE LIST HOLDS THEM ALL — everybody in a single list, told
          apart by their own status. `active`
          hid every account waiting for a password — the very rows somebody
          opens this screen to fix. The status cell already tells them apart. */}
      <UsersSection key="all" variant="all" extraActions={<BulkPassBar />} />
    </div>
  )
}

// GENERAL = the whole People directory, absorbed — the People app itself is uninstalled.
type BulkPassCounts = {
  created: number
  already: number
  skipped: number
  // Names the pass DECLINED because they look like somebody who already has an account.
  near?: number
  // Empty cells on EXISTING accounts that learned what the roster knows.
  filled?: number
  // Numbers and addresses the roster knew that the account did not — kept BESIDE what it has, in the plural columns.
  added?: number
  created_named?: string[]
  near_named?: string[]
  skipped_named?: string[]
}
// …but a pass that outlives the relay's wait answers THIS instead: delivered, still running server-side — not a…
type BulkPassRunning = { accepted: true; running: true; message?: string }
type BulkPassResult = BulkPassCounts | BulkPassRunning

export function BulkPassBar() {
  // THE WHOLE ROSTER IN ONE PASS — every DSP in the general directory whose status is Active, Other or Pending…
  const [bulking, setBulking] = useState<'people' | 'signed' | null>(null)
  // THE PLATFORM CONTACTS MERGE (ContactsSync.gs) — preview, then apply; the clock runs the same merge unattended…
  const [merging, setMerging] = useState(false)
  const runBulk = (kind: 'people' | 'signed') => {
    setBulking(kind)
    const source = kind === 'people' ? 'the roster' : 'the signed contracts'
    void gasAction<BulkPassResult>(kind === 'people' ? 'usersFromPeople' : 'usersFromSigned', {})
      .then((d) => {
        if ('running' in d && d.running) {
          toast({
            type: 'warning',
            title: 'The pass is running in the background',
            body: d.message || 'The platform log will carry the counts — don’t press again.',
          })
        } else {
          const c = d as BulkPassCounts
          const names = (c.near_named ?? []).slice(0, 4).join(' · ')
          toast({
            type: c.created ? 'success' : 'info',
            title: `${c.created} account${c.created === 1 ? '' : 's'} created from ${source}`,
            body: `${c.already} already had one` +
                  (c.filled || c.added
                    ? ` (${c.filled ?? 0} blank field${c.filled === 1 ? '' : 's'} filled` +
                      (c.added ? `, ${c.added} extra contact${c.added === 1 ? '' : 's'} kept` : '') + ')'
                    : '') + ' · ' +
                  `${c.near ?? 0} look like existing people · ${c.skipped} skipped` +
                  // THE NEAR ONES BY NAME, not the skips: a skip explains itself ("no e-mail"), while a decision…
                  (names ? ` — ${names}${(c.near_named?.length ?? 0) > 4 ? '…' : ''}` : '') +
                  '. No e-mail was sent to anyone.',
          })
        }
        // Accounts may exist now (even mid-pass) — renew the shared users directory so System Users paints them on…
        void fetchUsers({ force: true }).catch(() => {})
      })
      .catch((e) => {
        if ((e as { status?: number }).status === 409) {
          // The backend's lock (or a lost-receipt save) — the work happened or is happening; pressing again is the…
          toast({
            type: 'info',
            title: 'The pass is already running',
            body: e instanceof Error ? e.message : 'Check the platform log for its counts.',
          })
          void fetchUsers({ force: true }).catch(() => {})
        } else {
          toast({ type: 'danger', title: 'The pass did not run', body: e instanceof Error ? e.message : 'Try again.' })
        }
      })
      .finally(() => setBulking(null))
  }
  return (
    <>
      {/* INSIDE THE CARD, BESIDE THE OTHER DOORS.
          They were a banner of their own above it, which
          made the accounts start halfway down the page and separated the two
          buttons that MAKE accounts from Merge, Invite and Add user, which act
          on the same ones. The explaining paragraph went with the banner — the
          labels say the source, and the passes now run on their own every two
          hours anyway (HubCore.gs, usersBulkDue_). */}
      <button
        onClick={() => runBulk('people')}
        disabled={bulking !== null}
        title="Everyone on the people roster who does not have an account yet — matched on login, phone and name, spelling variants included. Nobody is e-mailed."
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
      >
        {bulking === 'people' ? <Loader2 size={14} className="animate-spin" /> : <UsersRound size={14} />}
        Everyone on the roster
      </button>
      <button
        onClick={() => runBulk('signed')}
        disabled={bulking !== null}
        title="Whoever has signed a contract and does not have an account yet — same matching, and nobody is e-mailed."
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
      >
        {bulking === 'signed' ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
        Whoever signed a contract
      </button>
      <button
        onClick={() => setMerging(true)}
        disabled={bulking !== null}
        title="What the platform's roster knows about each account — blanks filled, other phones and e-mails kept beside, the sign-in e-mail never touched. Preview first; the clock runs it every two hours anyway."
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
      >
        <Network size={14} />
        Platform contacts
      </button>
      {merging && <ContactsMergeModal onClose={() => setMerging(false)} />}
    </>
  )

}


