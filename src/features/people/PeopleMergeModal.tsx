// The merge review.
// The admin clicks Merge and THIS modal shows every fold before it happens: who stays (the right name), who goes…
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
import { noteWrite } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

type MergePair = {
  alias_id: string
  alias_name: string
  primary_id: string
  primary_name: string
  add_emails: string[]
  add_phones: string[]
  person_type: string
  system: boolean
  /** true = found by the collision scan just now, not pre-suggested */
  detected: boolean
  /** two different emails/phones on the two rows — possibly two humans */
  conflict: boolean
  score: string
  user_email: string
  already_user: boolean
}

// Different names sharing an e-mail or phone — a household, most likely.
type SharedGroup = { via: 'email' | 'phone'; value: string; people: { id: string; name: string }[] }

/** One stable key per shared group — the line itself is the identity. */
const sharedKey = (g: SharedGroup) => `${g.via}:${g.value}`

type ApplyResult = { merged: number; users_created: string[]; skipped: string[]; refused?: string[] }

const chipCls =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold'

export default function PeopleMergeModal({ scope, onClose }: { scope?: 'system'; onClose: () => void }) {
  const [pairs, setPairs] = useState<MergePair[] | null>(null)
  const [shared, setShared] = useState<SharedGroup[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // household groups the admin explicitly ticked — ALWAYS starts empty
  const [selectedShared, setSelectedShared] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  useEffect(() => {
    let alive = true
    gasAction<{ pairs: MergePair[]; shared?: SharedGroup[] }>('peopleMergePreview', scope ? { scope } : {})
      .then((r) => {
        if (!alive) return
        const got = r?.pairs ?? []
        setPairs(got)
        setShared(r?.shared ?? [])
        // Pre-checked = the exact-duplicate list (T12: the duplicate pairs start CHECKED, the household list starts…
        setSelected(new Set(got.filter((p) => !p.conflict).map((p) => p.alias_id)))
        setSelectedShared(new Set())
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Could not read the pending merges.'))
    return () => {
      alive = false
    }
  }, [scope])

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const toggleShared = (key: string) =>
    setSelectedShared((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  // How many people the confirm button folds: one per checked pair, plus everyone-but-the-survivor per checked…
  const foldCount =
    selected.size +
    shared.filter((g) => selectedShared.has(sharedKey(g)))
      .reduce((a, g) => a + Math.max(0, g.people.length - 1), 0)

  const apply = async () => {
    if ((!selected.size && !selectedShared.size) || !pairs) return
    setApplying(true)
    const chosenShared = shared.filter((g) => selectedShared.has(sharedKey(g)))
    try {
      // ALL kinds carry both sides: the backend refuses a suggested fold whose sheet row changed since the admin…
      const chosen = pairs.filter((p) => selected.has(p.alias_id))
      const r = await gasAction<ApplyResult>('peopleMergeApply', {
        suggested: chosen.filter((p) => !p.detected).map((p) => ({ alias_id: p.alias_id, primary_id: p.primary_id })),
        detected: chosen.filter((p) => p.detected).map((p) => ({ alias_id: p.alias_id, primary_id: p.primary_id })),
        households: chosenShared.map((g) => ({ via: g.via, value: g.value, ids: g.people.map((p) => p.id) })),
      })
      setResult(r)
      noteWrite('people')
      toast({
        type: 'success',
        title: `${r.merged} ${r.merged === 1 ? 'person' : 'people'} folded`,
        body: r.users_created.length ? `${r.users_created.length} jumped to Users.` : undefined,
      })
    } catch (err) {
      // VERIFY before accusing (a merge reported as failed had EXECUTED behind Google's interstitial): if the…
      try {
        const back = await gasAction<{ pairs: MergePair[]; shared?: SharedGroup[] }>('peopleMergePreview', scope ? { scope } : {})
        const pending = new Set((back?.pairs ?? []).map((p) => p.alias_id))
        const pendingShared = new Set((back?.shared ?? []).map(sharedKey))
        if ([...selected].every((id) => !pending.has(id)) &&
            chosenShared.every((g) => !pendingShared.has(sharedKey(g)))) {
          setResult({ merged: foldCount, users_created: [], skipped: [] } as unknown as ApplyResult)
          noteWrite('people')
          toast({ type: 'success', title: 'Merge landed', body: 'The receipt was slow, but the folds are signed.' })
          return
        }
      } catch { /* verification unreachable — report the original error */ }
      toast({ type: 'danger', title: 'Merge failed', body: err instanceof Error ? err.message : 'Nothing was signed.' })
    } finally {
      setApplying(false)
    }
  }

  const done = () => {
    onClose()
    // the fold changes the roster every screen reads — show the real thing
    window.location.reload()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && (result ? done() : onClose())}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{scope === 'system' ? 'Merge system variants' : 'Merge duplicate people'}</DialogTitle>
          <DialogDescription>
            Nothing is deleted — the duplicate is folded into the record that stays, its e-mails and
            phones are gathered, and the decision can be reversed. Confirmed people jump to Users.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="rounded-md bg-tint-pink/40 px-3 py-2 text-[13px] text-text-1">{error}</p>}

        {!pairs && !error && <p className="py-6 text-center text-[13px] text-text-3">Reading the pending merges…</p>}

        {pairs && pairs.length === 0 && !result && (
          <p className="py-6 text-center text-[13px] text-text-2">
            Nothing to fold — {scope === 'system' ? 'no system variants are pending.' : 'the roster shows one row per human.'}
          </p>
        )}

        {pairs && pairs.length > 0 && !result && (
          <div className="scroll-thin max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {pairs.map((p) => (
              <label
                key={p.alias_id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                  selected.has(p.alias_id) ? 'border-primary/50 bg-primary-soft/40' : 'border-border bg-surface',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(p.alias_id)}
                  onChange={() => toggle(p.alias_id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] text-text-1">
                    <span className="text-text-3 line-through">{p.alias_name}</span>
                    <span className="mx-1.5 text-text-3">→</span>
                    <span className="font-semibold">{p.primary_name}</span>
                    <span className="ml-1 text-[12px] text-text-3">stays</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {p.add_emails.length > 0 && (
                      <span className={cn(chipCls, 'bg-tint-mint/60 text-text-1')}>
                        +{p.add_emails.length} email{p.add_emails.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {p.add_phones.length > 0 && (
                      <span className={cn(chipCls, 'bg-tint-mint/60 text-text-1')}>
                        +{p.add_phones.length} phone{p.add_phones.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {p.add_emails.length === 0 && p.add_phones.length === 0 && (
                      <span className={cn(chipCls, 'bg-surface-2 text-text-3')}>nothing new to gather</span>
                    )}
                    {p.person_type && (
                      <span className={cn(chipCls, 'bg-tint-blue/50 text-text-1')}>{p.person_type}</span>
                    )}
                    {p.system && (
                      <span className={cn(chipCls, 'bg-tint-lavender/60 text-text-1')}>
                        <AppIcon name="shield" size={11} /> System
                      </span>
                    )}
                    {p.detected && (
                      <span className={cn(chipCls, 'bg-tint-blue/50 text-text-1')}>
                        <AppIcon name="radar" size={11} /> found now — same name
                      </span>
                    )}
                    {p.conflict && (
                      <span className={cn(chipCls, 'bg-tint-amber/60 text-text-1')}>
                        different email/phone — confirm it's one person
                      </span>
                    )}
                    {p.person_type === 'Client' && (
                      <span className={cn(chipCls, 'bg-tint-peach/60 text-text-1')}>
                        client — account is never auto-created
                      </span>
                    )}
                    {p.already_user ? (
                      <span className={cn(chipCls, 'bg-surface-2 text-text-3')}>already a user</span>
                    ) : p.user_email ? (
                      <span className={cn(chipCls, 'bg-tint-peach/50 text-text-1')}>→ becomes a user</span>
                    ) : (
                      <span className={cn(chipCls, 'bg-tint-amber/50 text-text-1')}>no email — stays out of Users</span>
                    )}
                    {Number(p.score) > 0 && Number(p.score) < 1 && (
                      <span className={cn(chipCls, 'bg-tint-amber/50 text-text-1')}>check this one</span>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {!result && shared.length > 0 && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <p className="text-[12px] font-semibold text-text-2">
              Sharing a phone or e-mail — different names (a household, most likely). Never folded
              automatically: tick a row ONLY when these are one person — the richest record stays.
            </p>
            <ul className="mt-1.5 space-y-1">
              {shared.map((g) => {
                const key = sharedKey(g)
                return (
                  <li key={key}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-md border px-2 py-1.5 transition-colors',
                        selectedShared.has(key) ? 'border-primary/50 bg-primary-soft/40' : 'border-transparent',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selectedShared.has(key)}
                        onChange={() => toggleShared(key)}
                      />
                      <span className="min-w-0 flex-1 text-[12.5px] text-text-1">
                        {g.people.map((p) => p.name).join(' + ')}
                        <span className="ml-1.5 text-[11.5px] text-text-3">
                          same {g.via}: {g.via === 'phone' ? formatPhoneDisplay(g.value) : g.value}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {result && (
          <div className="space-y-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-text-1">
            <p className="font-semibold">
              {result.merged} fold{result.merged === 1 ? '' : 's'} signed.
            </p>
            {result.users_created.length > 0 && (
              <p>
                Jumped to Users (no password yet — arm them in Settings → Users):{' '}
                <span className="font-semibold">{result.users_created.join(', ')}</span>
              </p>
            )}
            {result.skipped.length > 0 && (
              <p className="text-text-2">Not turned into users: {result.skipped.join('; ')}.</p>
            )}
            {(result.refused?.length ?? 0) > 0 && (
              <p className="text-text-2">Refused by the backend: {result.refused!.join('; ')}.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <button
              onClick={done}
              className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                disabled={!foldCount || applying}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="git-merge" size={15} />
                {applying ? 'Merging…' : `Merge ${foldCount} ${foldCount === 1 ? 'person' : 'people'}`}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
