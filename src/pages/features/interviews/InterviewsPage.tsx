// INTERVIEWS — the interviewer's own desk.
// An interviewer gets a special access that holds ONLY interviews, on every login carrying the INTERVIEW badge…
import { useCallback, useEffect, useState } from 'react'
import DocRoomSection from '@/components/shared/DocRoomSection'
import { useNavigate } from 'react-router'
import { CalendarClock, ClipboardCheck, RefreshCw } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import InterviewScorecardModal from '@/features/hiring/InterviewScorecardModal'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'

type InterviewRow = {
  candidate_id: string
  name: string
  slot: string
  ask_state: string
  scored: boolean
  score: string
  interviewer_name: string
}

export default function InterviewsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<InterviewRow[] | null>(null)
  const [canRecord, setCanRecord] = useState(true)
  const [refused, setRefused] = useState('')
  const [loading, setLoading] = useState(false)
  const [openFor, setOpenFor] = useState<InterviewRow | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    gasAction<{ rows: InterviewRow[]; can_record?: boolean }>('interviewMineList', {})
      .then((d) => {
        setRows(d.rows ?? [])
        // absent until the backend publish lands → assume the pen
        setCanRecord(d.can_record !== false)
        setRefused('')
      })
      .catch((e) => setRefused(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openScorecard = (r: InterviewRow) => { setOpenFor(r); setModalOpen(true) }
  const openProfile = (r: InterviewRow) =>
    navigate('/app/interviews/candidate?id=' + encodeURIComponent(r.candidate_id))

  if (refused) {
    return (
      <div className="mx-auto max-w-[560px] pt-16">
        <EmptyState
          title="The interviewer's pen opens this"
          body="This desk lists the candidates waiting for their in-person interview. It opens for the INTERVIEWER badge (and the hiring team) — ask the master if you should be holding it."
        />
      </div>
    )
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Interviews"
        subtitle={
          rows === null
            ? 'The candidates at the interview stage — click one to record the scorecard.'
            : `${rows.length} candidate${rows.length === 1 ? '' : 's'} at the interview stage — click one to record the scorecard.`
        }
        actions={
          <button
            onClick={load}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {rows === null ? (
        <p className="px-1 py-8 text-[14px] text-text-3">Reading the interview list…</p>
      ) : rows.length === 0 ? (
        <div className="mx-auto max-w-[560px] pt-10">
          <EmptyState
            title="Nobody is waiting"
            body="No candidate stands at the interview stage right now. When somebody books a time, they appear here with their slot."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            // a DIV, not a <button>: the card holds its own buttons (avatar, name, action row) and nested buttons…
            <div
              key={r.candidate_id}
              role="button"
              tabIndex={0}
              onClick={() => openScorecard(r)}
              onKeyDown={(e) => {
                // only when the card itself holds focus — inner buttons key themselves
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openScorecard(r) }
              }}
              className="flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
            >
              <div className="flex items-center gap-3">
                {/* the person is a ROUND face with initials, always — and a door to the profile */}
                <button
                  onClick={(e) => { e.stopPropagation(); openProfile(r) }}
                  className="shrink-0"
                  title={`Open ${r.name}'s profile`}
                >
                  <Avatar src={undefined} name={r.name} size="md" />
                </button>
                <span className="min-w-0 flex-1">
                  <DragPerson name={r.name} id={r.candidate_id}>
                    <span
                      onClick={(e) => { e.stopPropagation(); openProfile(r) }}
                      className="cursor-pointer truncate text-[15px] font-semibold text-text-1 hover:underline"
                    >
                      {r.name}
                    </span>
                  </DragPerson>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-text-3">
                    <CalendarClock size={12} />
                    {r.slot || 'no time booked yet'}
                    {r.ask_state ? ` · ${r.ask_state}` : ''}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-[12px] font-semibold',
                    r.scored ? 'bg-tint-mint text-tint-fg-mint' : 'bg-tint-amber text-tint-fg-amber',
                  )}
                >
                  <ClipboardCheck size={12} />
                  {r.scored ? `scored ${r.score}${r.interviewer_name ? ` by ${r.interviewer_name}` : ''}` : 'waiting for the scorecard'}
                </span>
              </div>
              <div className="flex justify-end border-t border-border pt-3">
                {/* look-only entry gets the neutral label; the modal locks itself */}
                <button
                  onClick={(e) => { e.stopPropagation(); openScorecard(r) }}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors',
                    canRecord
                      ? 'bg-primary text-on-primary hover:bg-primary-hover'
                      : 'border border-border bg-surface text-text-1 hover:bg-surface-2',
                  )}
                >
                  {canRecord ? 'Open scorecard' : 'View scorecard'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openFor && (
        <InterviewScorecardModal
          open={modalOpen}
          onOpenChange={(v: boolean) => { setModalOpen(v); if (!v) { setOpenFor(null); load() } }}
          candidateId={openFor.candidate_id}
          candidateName={openFor.name}
          onSaved={() => { setModalOpen(false); setOpenFor(null); load() }}
        />
      )}

      {/* the old platform's InterviewDocs reading room, folded in (gap survey §6) */}
      <DocRoomSection room="interviews" title="Interview documents"
        line="Question sets, process docs and forms from the interviews Drive folder." />
    </div>
  )
}
