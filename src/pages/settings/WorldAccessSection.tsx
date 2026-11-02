// MY WORLD — the one setting on this page that is not the platform's.
// Every active account has a world and is the admin of it: headquarters plus a My world is the standard, it is…
import { useEffect, useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import DragPerson from '@/components/shared/DragPerson'
import { cn } from '@/lib/utils'

type Row = {
  member_id: string
  owner_name: string
  owner_email: string
  status: string
  world_open: boolean
  closed_by_me: boolean
}

export default function WorldAccessSection() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // A FAILED READ IS NOT AN EMPTY ANSWER.
  const load = async () => {
    try {
      const d = await gasAction<{ rows: Row[] }>('myWorldAccessList', {})
      setRows(d?.rows ?? [])
      setFailed(null)
    } catch (e) {
      setRows(null)
      setFailed(e instanceof Error ? e.message : 'the platform did not answer')
    }
  }
  useEffect(() => { void load() }, [])

  const setOpen = async (r: Row, open: boolean) => {
    setBusy(r.member_id)
    try {
      await gasAction('myWorldAccessSet', { member_id: r.member_id, open })
      await load()
      toast({
        type: 'success',
        title: open ? 'Your world is open to them' : 'Your world is closed',
        body: open
          ? `${r.owner_name} can open your My world from their platform. You can close it whenever you like.`
          : `${r.owner_name} can no longer open your My world. Only you can open it again.`,
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-5 text-text-3">
        Your My world is yours and always here — it is not something anybody grants or takes
        away. What you decide below is who ELSE can open it.
      </p>

      {rows === null && !failed && (
        <div className="flex items-center gap-2 text-[12.5px] text-text-3">
          <Loader2 size={13} className="animate-spin" /> reading…
        </div>
      )}

      {failed && (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
          <p className="font-semibold text-text-1">This could not be read</p>
          <p className="mt-0.5">{failed}</p>
          <p className="mt-1 text-text-3">
            Nothing changed. Your world is still yours, and whoever could open it before
            still can — this screen simply does not know who that is right now.
          </p>
          <button
            type="button"
            onClick={() => { setFailed(null); void load() }}
            className="mt-2 h-7 rounded-[8px] border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2"
          >Try again</button>
        </div>
      )}

      {rows?.length === 0 && (
        <p className="rounded-md border border-border bg-surface px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
          Nobody has brought you into their platform, so there is nothing to decide yet.
          If somebody does, your world starts open to them and this is where you close it.
        </p>
      )}

      <ul className="space-y-2">
        {(rows ?? []).map((r) => (
          <li key={r.member_id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-lavender text-tint-fg-lavender">
              <Globe size={15} />
            </span>
            <div className="min-w-0 flex-1">
              {/* The tile beside this is a Globe — a place, not a face. Only
                  the name is the person. */}
              <DragPerson name={r.owner_name} id={r.owner_email} subtitle={r.owner_email} className="block min-w-0">
                <p className="clamp-1 text-[13px] font-semibold text-text-1">{r.owner_name}</p>
              </DragPerson>
              <p className="clamp-1 text-[12px] text-text-3">
                {r.world_open
                  ? 'can open your My world'
                  : r.closed_by_me
                    ? 'cannot open your My world — you closed it'
                    : 'cannot open your My world'}
              </p>
            </div>
            <button
              type="button"
              disabled={busy === r.member_id}
              onClick={() => void setOpen(r, !r.world_open)}
              className={cn(
                'h-8 shrink-0 rounded-[8px] border px-3 text-[12px] font-semibold transition-colors disabled:opacity-40',
                r.world_open
                  ? 'border-border text-text-2 hover:bg-surface-2'
                  : 'border-primary bg-primary-soft text-primary-strong hover:bg-primary-soft/80',
              )}
            >
              {busy === r.member_id && <Loader2 size={12} className="mr-1 inline animate-spin" />}
              {r.world_open ? 'Close my world' : 'Open my world'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
