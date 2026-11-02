// ADD A MAILBOX FROM THE SCREEN — a way inside the mail app to add further accounts by entering an address and a…
// The old panel only EXPLAINED — the objection was that a password field would land the password in a queued write…
import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { gasAction, inputCls } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type Account = { id: string; address: string; primary: boolean }

export default function AddMailboxPanel({ accounts, isMaster, onAdded }: {
  accounts: Account[]
  isMaster: boolean
  /** fires with the new slot id — the page switches to it and re-reads */
  onAdded: (id: string) => void
}) {
  const [address, setAddress] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!address.trim() || !password || busy) return
    setBusy(true)
    try {
      const r = await gasAction<{ added: boolean; id: string; address: string }>(
        'platformMailAccountAdd', { address: address.trim(), password }, { timeoutMs: 120_000 })
      toast({ type: 'success', title: `${r.address} is wired`,
        body: `Slot ${r.id} — the mailserver accepted the credentials.` })
      setAddress(''); setPassword('')
      onAdded(r.id)
    } catch (e) {
      // The 409s are instructions (a file-shadowed slot names its exact Props.gs lines) — show the server's whole…
      toast({ type: 'danger', title: 'Not wired', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-surface-2/60 px-3 py-2.5">
      <p className="text-[12.5px] font-semibold text-text-1">
        {isMaster ? 'Add a mailbox' : 'Add a mailbox — the master wires it from this screen'}
      </p>

      {/* the five slots, wired or free — the same occupancy rows as before */}
      <div className="mt-1.5 space-y-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const wired = accounts.find((a) => a.id === String(n))
          return (
            <div key={n} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
              <span className={cn('w-4 tabular-nums', wired ? 'text-primary' : 'text-text-3')}>{n}</span>
              {wired ? (
                <span className="text-text-2">{wired.address}</span>
              ) : (
                <span className="text-text-3">{n === 1 ? 'the platform’s own voice' : 'free'}</span>
              )}
            </div>
          )
        })}
      </div>

      {isMaster ? (
        <div className="mt-2.5 flex flex-wrap items-end gap-2">
          <label className="block min-w-[220px] flex-1">
            <span className="mb-1 block text-[11.5px] font-medium text-text-2">Mailbox address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="somebody@asaop.org" autoComplete="off" className={inputCls} disabled={busy} />
          </label>
          <label className="block min-w-[180px] flex-1">
            <span className="mb-1 block text-[11.5px] font-medium text-text-2">Its password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="off" className={inputCls} disabled={busy}
              onKeyDown={(e) => e.key === 'Enter' && void add()} />
          </label>
          <button onClick={() => void add()} disabled={!address.trim() || !password || busy}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {busy ? 'Proving…' : 'Wire it'}
          </button>
          <p className="w-full text-[11.5px] text-text-3">
            The pair is tried against the mailserver first — a wrong password is refused here,
            not discovered later as a silent empty box. It is stored on the platform&apos;s server, readable
            by it alone and nowhere else, and it never touches a queue.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] text-text-3">
          Both halves or nothing — an address with no password is not a mailbox, and the
          numbers may have gaps. Wiring one is the master’s act, from this screen.
        </p>
      )}
    </div>
  )
}
