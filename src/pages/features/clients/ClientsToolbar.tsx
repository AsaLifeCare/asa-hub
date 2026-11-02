// The toolbar the three Clients views share on their SELECTION screens — Share, Export and Add client — the same…
// The Views selector is NOT here anymore: the three views are one page, and the switcher lives once on that page's…
import { useEffect, useState } from 'react'
import { Download, Loader2, Plus, ScanText, Search, Share2, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { share } from '@/stores/useShareStore'
import { exportRows, type ExportColumn } from '@/lib/exportTable'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import Avatar from '@/components/shared/Avatar'
import { useClientsPolicyStore } from '@/stores/useClientsPolicyStore'
import type { ClientRow } from './shared'

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'name', label: 'Client' },
  { key: 'clientNumber', label: 'Client #' },
  { key: 'guardianName', label: 'Guardian' },
  { key: 'supervisionShort', label: 'Supervision' },
  { key: 'isp_year', label: 'ISP period' },
  { key: 'status', label: 'Status' },
]

// ONE SHAPE FOR NINE HANDS — every button inside this box is standardised.
const btn =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40'

export default function ClientsToolbar({ rows, view }: { rows: ClientRow[]; view: string }) {
  const canEdit = useCan('clients.edit')
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [adding, setAdding] = useState(false)
  const [creatingUser, setCreatingUser] = useState<null | 'client' | 'guardian'>(null)
  const [syncing, setSyncing] = useState(false)
  const [reading, setReading] = useState(false)
  /** the two bulk passes (items 16 & 18) */
  const [bulking, setBulking] = useState<null | 'clients' | 'guardians'>(null)

  const runBulk = (kind: 'clients' | 'guardians') => {
    const action = kind === 'clients' ? 'usersFromClients' : 'usersFromGuardians'
    setBulking(kind)
    void gasAction<{ created: number; already: number; skipped: number; skipped_named?: string[] }>(action, {})
      .then((d) => {
        const names = (d.skipped_named ?? []).slice(0, 5).join(' · ')
        toast({
          type: d.created ? 'success' : 'info',
          title: kind === 'clients'
            ? `${d.created} client account${d.created === 1 ? '' : 's'} created`
            : `${d.created} guardian account${d.created === 1 ? '' : 's'} created`,
          body: `${d.already} already had one · ${d.skipped} skipped` +
                (names ? ` — ${names}${(d.skipped_named?.length ?? 0) > 5 ? '…' : ''}` : '') +
                '. No e-mail was sent to anyone.',
        })
        invalidate('users' as never)
      })
      .catch((e) => toast({ type: 'danger', title: 'The pass did not run', body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setBulking(null))
  }
  // PER ITEM, by the master's word.
  const tools = useClientsPolicyStore((s) => s.tools)
  return (
    // wraps on purpose — see `btn` above: a hand that does not fit belongs on a second line, never off the edge…
    <div className="flex flex-wrap items-center gap-2">
      {tools.includes('share') && (
      <button
        className={btn}
        onClick={() =>
          share({
            title: `Clients — ${view}`,
            subtitle: `${rows.length} ${rows.length === 1 ? 'client' : 'clients'}`,
            rows,
            columns: EXPORT_COLUMNS,
            filename: 'clients',
            icon: 'heart-pulse',
          })
        }
      >
        <Share2 size={14} />
        Share
      </button>
      )}
      {tools.includes('export') && (
      <button className={btn} onClick={() => exportRows('clients', EXPORT_COLUMNS, rows, 'csv')}>
        <Download size={14} />
        Export
      </button>
      )}
      {tools.includes('add') && canEdit && (
        <button className={btn} onClick={() => setAdding(true)}>
          <Plus size={14} />
          Add client
        </button>
      )}
      {/* A CLIENT (or their guardian) BECOMES A USER
          — on all three views, the admin's hand only; the backend refuses
          everybody else regardless of what the UI drew. */}
      {isAdmin && (
        <button className={btn} onClick={() => setCreatingUser('client')}>
          <UserPlus size={14} />
          Create user
        </button>
      )}
      {isAdmin && (
        <button className={btn} onClick={() => setCreatingUser('guardian')}>
          <ShieldCheck size={14} />
          Create user guardian
        </button>
      )}
      {/* THE TWO BULK PASSES — every real user can be created from the
          clients, and every guardian whose status is Active can become a
          user, with no mail sent to anybody.
          Idempotent, mail-free, every skip named in the answer. */}
      {isAdmin && (
        <button
          className={btn}
          disabled={bulking !== null}
          title="Create a user account for EVERY client that lacks one — no e-mail is sent"
          onClick={() => runBulk('clients')}
        >
          {bulking === 'clients' ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          {bulking === 'clients' ? 'Creating…' : 'Users for all clients'}
        </button>
      )}
      {isAdmin && (
        <button
          className={btn}
          disabled={bulking !== null}
          title="Create a user account for every Active guardian the plans name — no e-mail is sent"
          onClick={() => runBulk('guardians')}
        >
          {bulking === 'guardians' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {bulking === 'guardians' ? 'Creating…' : 'Users for all guardians'}
        </button>
      )}
      {/* GUARDIANS INTO THE ROSTER — guardians have to reach the general
          roster, or no guardian will ever exist for a user to be made from.
          The plans name them; until this runs they exist nowhere a person can
          pick them. Fill-blank only, idempotent — pressing it twice changes
          nothing. */}
      {isAdmin && (
        <button
          className={btn}
          disabled={syncing}
          title="Add every plan's guardian to the General roster — never overwrites a typed cell"
          onClick={() => {
            setSyncing(true)
            void gasAction<{ created?: number; filled?: number; examined?: number }>('guardiansToRoster', {})
              .then((d) => {
                const created = d.created ?? 0
                const filled = d.filled ?? 0
                toast(created || filled
                  ? { type: 'success', title: 'Guardians on the roster', body: `${created} added · ${filled} completed — they are in Users → General now.` }
                  : { type: 'info', title: 'Nothing to add', body: 'Every named guardian is already on the roster.' })
              })
              .catch((e) => toast({ type: 'danger', title: 'Could not sync guardians', body: e instanceof Error ? e.message : 'Try again.' }))
              .finally(() => setSyncing(false))
          }}
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <UsersRound size={14} />}
          {syncing ? 'Adding…' : 'Guardians to roster'}
        </button>
      )}
      {/* READ THE PLANS — the reader has to be VERY generic and still
          collect. The pattern rules only know the words the 23
          plans in front of us happened to use; this reads each plan and keeps
          ONLY what the plan itself contains — the answers land in
          `isp_contacts` and the client rows read them first. */}
      {isAdmin && (
        <button
          className={btn}
          disabled={reading}
          title="Read every plan for the guardian's name, e-mail and phone — nothing is stored that is not written in the plan"
          onClick={() => {
            setReading(true)
            void gasAction<{ wrote?: number; refused?: number; skipped?: number; read?: number }>(
              'ispContactsSweep', { redo: true },
            )
              .then((d) => {
                const wrote = d.wrote ?? 0
                toast(wrote
                  ? { type: 'success', title: `${wrote} plan(s) read`,
                      body: `${d.refused ?? 0} could not be read. Press Guardians to roster to carry the contacts across.` }
                  : { type: 'info', title: 'Nothing was read',
                      body: 'No plan answered — check that an AI key is set on the project.' })
              })
              .catch((e) => toast({ type: 'danger', title: 'Could not read the plans', body: e instanceof Error ? e.message : 'Try again.' }))
              .finally(() => setReading(false))
          }}
        >
          {reading ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />}
          {reading ? 'Reading…' : 'Read the plans'}
        </button>
      )}
      {/* the Views selector is not a toolbar hand — it lives once on the
          unified page's left side (ClientsPage.tsx) */}
      {adding && <AddClientModal onClose={() => setAdding(false)} />}
      {creatingUser && <CreateClientUserModal kind={creatingUser} rows={rows} onClose={() => setCreatingUser(null)} />}
    </div>
  )
}

// What the account would sign in as — the backend's own rule, previewed: the e-mail when the record holds one, else…
function loginPreview(r: ClientRow, kind: 'client' | 'guardian'): string {
  const digits = (v?: string) => String(v ?? '').replace(/\D+/g, '')
  if (kind === 'client') {
    return String(r.client_email ?? '').trim().toLowerCase() || digits(r.client_phone)
  }
  // the guardian's own e-mail first; digits stand in
  return String(r.guardian_email ?? '').trim().toLowerCase() || digits(r.guardian_phone)
}

// Pick the client, read the login the account will be born with, confirm.
function CreateClientUserModal({ kind, rows, onClose }: { kind: 'client' | 'guardian'; rows: ClientRow[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const guardianName = (r: ClientRow) => String(r.guardianName ?? r.guardian_name ?? '').trim()
  const list = rows
    .filter((r) => (kind === 'guardian' ? guardianName(r) && guardianName(r).toLowerCase() !== 'self' : true))
    .filter((r) => !q.trim() || `${r.name} ${guardianName(r)}`.toLowerCase().includes(q.trim().toLowerCase()))

  const create = async (r: ClientRow) => {
    setBusyId(r.id)
    try {
      const d = await gasAction<{ already?: boolean; login: string }>('clientUserCreate', { client_id: r.id, kind })
      toast(
        d.already
          ? { type: 'info', title: 'Already a user', body: `${kind === 'guardian' ? guardianName(r) : r.name} signs in as ${d.login}.` }
          : { type: 'success', title: kind === 'guardian' ? 'Guardian account created' : 'Client account created', body: `Signs in as ${d.login} with the system default password.` },
      )
      onClose()
    } catch (e) {
      toast({ type: 'danger', title: 'Not created', body: e instanceof Error ? e.message : 'Try again.' })
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={() => !busyId && onClose()}>
      <div className="w-full max-w-[520px] rounded-lg border border-border bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 font-display text-[15px] font-semibold text-text-1">
          {kind === 'guardian' ? 'Create user guardian' : 'Create user'}
        </p>
        <p className="mb-3 text-[12.5px] text-text-3">
          {kind === 'guardian'
            ? 'The guardian signs in with their e-mail — or their phone’s pure digits when the plan holds none.'
            : 'The client signs in with their e-mail — or their phone’s pure digits when the record holds no e-mail.'}
        </p>
        <div className="relative mb-2.5">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search clients…" className={`${field} pl-8`} />
        </div>
        <div className="scroll-thin max-h-[300px] space-y-1 overflow-y-auto">
          {list.length === 0 ? (
            <p className="p-4 text-center text-[12.5px] italic text-text-3">
              {kind === 'guardian' ? 'No client with a separate guardian matches.' : 'No client matches.'}
            </p>
          ) : (
            list.map((r) => {
              const login = loginPreview(r, kind)
              return (
                <button
                  key={r.id}
                  disabled={!login || busyId !== null}
                  onClick={() => void create(r)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  title={login ? `Signs in as ${login}` : 'No e-mail and no phone on the record — nothing to sign in with'}
                >
                  <Avatar src={r.avatar} name={kind === 'guardian' ? guardianName(r) : r.name} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-text-1">
                      {kind === 'guardian' ? guardianName(r) : r.name}
                    </span>
                    {kind === 'guardian' && <span className="block text-[11px] text-text-3">Guardian of {r.name}</span>}
                  </span>
                  {busyId === r.id ? (
                    <Loader2 size={13} className="animate-spin text-text-3" />
                  ) : (
                    <span className={`text-[11.5px] tabular-nums ${login ? 'text-text-3' : 'italic text-danger'}`}>
                      {login || 'nothing to sign in with'}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={() => !busyId && onClose()} className={btn}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const field =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary'

function AddClientModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [clientNumber, setClientNumber] = useState('')
  const [houseName, setHouseName] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      // THE DECLARED RESOLUTION — everything the platform resolves passes through the resolver, because this is a…
      await gasAction('clientCreate', {
        name: name.trim(),
        clientNumber: clientNumber.trim(),
        houseName: houseName.trim(),
        guardianName: guardianName.trim(),
        status: 'active',
      })
      invalidate('clients')
      noteWrite('clients')
      toast({ type: 'success', title: 'Client created', body: `${name.trim()} is on the directory.` })
      onClose()
    } catch (e) {
      toast({ type: 'danger', title: 'Not created', body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-[440px] rounded-lg border border-border bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 font-display text-[15px] font-semibold text-text-1">Add client</p>
        <p className="mb-3 text-[12.5px] text-text-3">
          Create a client record. Chart details fill in after intake.
        </p>
        <div className="space-y-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus className={field} />
          <input value={clientNumber} onChange={(e) => setClientNumber(e.target.value)} placeholder="Client # (e.g. CL-1200)" className={field} />
          <input value={houseName} onChange={(e) => setHouseName(e.target.value)} placeholder="House" className={field} />
          <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="Guardian — name (relationship)" className={field} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => !busy && onClose()} className={btn}>Cancel</button>
          <button
            onClick={() => void save()}
            disabled={!name.trim() || busy}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-on-primary disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create client'}
          </button>
        </div>
      </div>
    </div>
  )
}

// The same square on the Directory — this layout is common to all three views.
export function DirectoryToolbar() {
  const [rows, setRows] = useState<ClientRow[]>([])
  useEffect(() => {
    let alive = true
    api.list<ClientRow>('clients').then((r) => { if (alive) setRows(r ?? []) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return <ClientsToolbar rows={rows} view="Directory" />
}
