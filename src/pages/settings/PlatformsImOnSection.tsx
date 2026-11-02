// THE PLATFORMS I STAND ON — the other side of a link, and the side that had no screen at all.
// The connection has to be endable from BOTH sides; leaving it to one interface alone is no answer.
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { cn } from '@/lib/utils'
import { useWorldOffered } from '@/lib/worldOffered'

type Platform = {
  member_id: string
  owner_name: string
  owner_email: string
  owner_avatar?: string
  added_at?: string
  scope?: string
}

export default function PlatformsImOnSection() {
  const [rows, setRows] = useState<Platform[] | null>(null)
  /** null while the list is honest about not having loaded (never []). */
  const [failed, setFailed] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const worldOn = useWorldOffered()

  const load = async () => {
    try {
      const r = await gasAction<{ platforms?: Platform[] }>('platformMemberMine', {})
      setRows(r?.platforms ?? [])
      setFailed(false)
    } catch {
      // AN EMPTY LIST IS A CLAIM.
      setRows(null)
      setFailed(true)
    }
  }
  useEffect(() => { void load() }, [])

  const leave = async (p: Platform) => {
    setBusy(p.member_id)
    try {
      await gasAction('platformMemberLeave', { member_id: p.member_id })
      toast({ type: 'info', title: 'You left that platform',
              body: `${p.owner_name} can no longer open your work. Your account, ${worldOn ? 'world and ' : ''}apps are untouched.` })
      setArmed(null)
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Could not leave', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="platformsimon" className="scroll-mt-[84px]">
      <div className="rounded-[18px] border border-border bg-surface p-6">
        <div className="mb-4">
          <h2 className="text-[17px] font-semibold text-text-1">Platforms you are on</h2>
          <p className="text-[13px] text-text-3">
            Accounts that may open your work here. Ending one is yours to do — you do not need
            their permission, the same way they never needed yours.
          </p>
        </div>

        {rows === null && !failed && (
          <p className="flex items-center gap-2 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        )}
        {failed && (
          <p className="text-[13px] text-tint-fg-amber">
            This list did not load, so it is not showing you anything rather than showing you
            nothing. Reload the page to try again.
          </p>
        )}
        {rows?.length === 0 && (
          <p className="text-[13px] text-text-3">
            You are not on anybody else&rsquo;s platform. Your work is only yours.
          </p>
        )}

        <div className="space-y-2">
          {(rows ?? []).map((p) => (
            <div key={p.member_id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-border p-3">
              {/* p.member_id names the MEMBERSHIP, not the owner — the e-mail
                  is the only identity the owner arrives with. */}
              <DragPerson name={p.owner_name} id={p.owner_email} avatar={p.owner_avatar} subtitle={p.owner_email} className="shrink-0">
                <Avatar src={p.owner_avatar} name={p.owner_name} size="sm" />
              </DragPerson>
              <div className="min-w-0 flex-1">
                <DragPerson name={p.owner_name} id={p.owner_email} avatar={p.owner_avatar} subtitle={p.owner_email} className="block min-w-0">
                  <p className="clamp-1 text-[13.5px] font-semibold text-text-1">{p.owner_name}</p>
                </DragPerson>
                <p className="clamp-1 text-[12px] text-text-3">
                  {p.owner_email}
                  {p.scope === 'work_world' && worldOn ? ' · your work and your world' : ' · your work'}
                  {p.added_at ? ` · since ${String(p.added_at).slice(0, 10)}` : ''}
                </p>
              </div>
              <button
                onClick={() => (armed === p.member_id ? void leave(p) : setArmed(p.member_id))}
                onBlur={() => setArmed((a) => (a === p.member_id ? null : a))}
                disabled={busy === p.member_id}
                className={cn(
                  'h-8 shrink-0 rounded-md border px-2.5 text-[12px] font-semibold transition-colors',
                  armed === p.member_id
                    ? 'border-tint-pink bg-tint-pink text-tint-fg-pink'
                    : 'border-border bg-surface text-text-1 hover:bg-surface-2',
                )}
              >
                {busy === p.member_id
                  ? 'Leaving…'
                  : armed === p.member_id
                    ? 'Press again — they must invite you back'
                    : `Leave ${p.owner_name.split(' ')[0]}'s platform`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
