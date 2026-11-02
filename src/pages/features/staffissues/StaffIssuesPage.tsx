// STAFF ISSUES — the live HR tracker, as its own app, read here and started here.
// WHY IT MOVED.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertOctagon, Loader2, RefreshCw, Search, ShieldQuestion } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Pager from '@/components/shared/Pager'
import { usePager } from '@/lib/pager'
import { api } from '@/lib/api'
import StartStaffIssue from './StartStaffIssue'
import { cn } from '@/lib/utils'

type DigestPerson = {
  name?: string
  /** exact · ambiguous · unmatched · unknown (the roster could not be read) */
  match?: string
  roster_name?: string
  status?: string
  why?: string
}

type IssueRow = {
  id?: string
  date?: string
  employees_involved?: string
  situation?: string
  follow_up?: string
  disciplinary_action?: string
  result?: string
  termination_summary?: string
  /** server/hr_digest.py — see the header. Absent on a slice built before it. */
  digest_verdict?: string
  /** settled · read · unreadable · pending */
  digest_state?: string
  digest_from?: string
  digest_note?: string
  digest_why?: string
  digest_via?: string
  digest_at?: string
  digest_people?: DigestPerson[]
  // Why no availability fact left a row the estate's own dropdown settled as ended — the row names two people and…
  digest_hold_why?: string
  digest_failed?: string
  digest_roster_why?: string
}

// The closed set, in the order a reader wants to meet it.
const VERDICTS: { id: string; label: string; tint: string }[] = [
  { id: 'ended', label: 'employment ended', tint: 'bg-tint-slate text-tint-fg-slate' },
  { id: 'suspended', label: 'suspended', tint: 'bg-tint-peach text-tint-fg-peach' },
  { id: 'open_concern', label: 'still live', tint: 'bg-tint-amber text-tint-fg-amber' },
  { id: 'resolved', label: 'resolved', tint: 'bg-tint-mint text-tint-fg-mint' },
  { id: 'unclear', label: 'the row does not say', tint: 'bg-tint-slate text-tint-fg-slate' },
]

const VERDICT_TINT = new Map(VERDICTS.map((v) => [v.id, v.tint]))
const VERDICT_LABEL = new Map(VERDICTS.map((v) => [v.id, v.label]))

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

// 'Jenna and Dominic', 'Smith, Jones / 48th' → ['Jenna', 'Dominic', …] — the old platform's RH screen's own split…
function involvedNames(raw?: string): string[] {
  return String(raw ?? '')
    .split(/[,/&]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function StaffIssuesPage() {
  const [rows, setRows] = useState<IssueRow[] | null>(null)
  const [failed, setFailed] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [q, setQ] = useState('')

  const load = useCallback((background: boolean) => {
    if (background) setRefreshing(true)
    else setFailed('')
    api.list<IssueRow>('staffIssues')
      .then((r) => { setRows(Array.isArray(r) ? r : []); setFailed('') })
      .catch((err) => setFailed(err instanceof Error ? err.message : 'The staffIssues slice did not answer.'))
      .finally(() => setRefreshing(false))
  }, [])
  useEffect(() => { load(false) }, [load])

  // READY IS NOT THE SAME AS EMPTY.
  const ready = rows !== null

  // the old platform's headline: who is flagged most often.
  const flagged = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows ?? []) {
      for (const n of involvedNames(r.employees_involved)) {
        counts.set(n, (counts.get(n) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [rows])

  // Counted from the rows themselves, never estimated: a situation carries an action when the sheet's own Action…
  const acted = useMemo(
    () => (rows ?? []).filter((r) => String(r.disciplinary_action ?? '').trim()).length,
    [rows],
  )

  // ENDED IS THE SHEET'S OWN WORD, NOT A READING OF ANYTHING.
  const ended = useMemo(
    () => (rows ?? []).filter((r) => r.digest_state === 'settled' && r.digest_verdict === 'ended').length,
    [rows],
  )

  // WHAT THE DIGEST HAS AND HAS NOT DONE.
  const digest = useMemo(() => {
    const all = rows ?? []
    const verdicts = new Map<string, number>()
    const names = { exact: 0, ambiguous: 0, unmatched: 0, unknown: 0 }
    let pending = 0
    let unreadable = 0
    let noted = 0
    let held = 0
    let failed = ''
    let rosterWhy = ''
    for (const r of all) {
      if (r.digest_failed) failed = r.digest_failed
      if (r.digest_roster_why) rosterWhy = r.digest_roster_why
      // A row the dropdown settled as ended that still handed nothing to scheduling.
      if (r.digest_hold_why) held += 1
      const state = r.digest_state ?? ''
      if (state === 'pending' || state === '') pending += 1
      if (state === 'unreadable') unreadable += 1
      if (r.digest_note) noted += 1
      const v = r.digest_verdict ?? ''
      if (v) verdicts.set(v, (verdicts.get(v) ?? 0) + 1)
      for (const p of r.digest_people ?? []) {
        const m = (p.match ?? '') as keyof typeof names
        if (m in names) names[m] += 1
      }
    }
    return { verdicts, names, pending, unreadable, noted, held, failed, rosterWhy, total: all.length }
  }, [rows])

  // THE UNMATCHED NAMES ARE NAMED.
  const unmatched = useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of rows ?? []) {
      for (const p of r.digest_people ?? []) {
        if (p.match !== 'unmatched' && p.match !== 'ambiguous') continue
        const label = `${p.name ?? ''}${p.match === 'ambiguous' ? ' (two people share this name)' : ''}`
        seen.set(label, (seen.get(label) ?? 0) + 1)
      }
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [rows])

  // Has anything been digested at all?
  const digestRan = useMemo(
    () => (rows ?? []).some((r) => r.digest_state === 'read' || r.digest_state === 'settled'
      || r.digest_state === 'unreadable'),
    [rows],
  )

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return rows ?? []
    return (rows ?? []).filter((r) =>
      `${r.date} ${r.employees_involved} ${r.situation} ${r.follow_up} ${r.disciplinary_action} ${r.result}`
        .toLowerCase().includes(n))
  }, [rows, q])

  const pager = usePager(visible, 50, q.trim().toLowerCase())
  const total = rows?.length ?? 0

  return (
    <div>
      {/* the headline, on the one dark surface this design system keeps */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Situations on file
            </p>
            <p className="font-stat text-[60px] leading-none text-white">{ready ? total : '—'}</p>
            <p className="mt-1 text-[12px] text-white/60">
              {ready
                ? <>{acted} carried an action · {ended} say the employment ended</>
                : <>the tracker has not answered yet</>}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Named most often
            </p>
            {ready && flagged.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {flagged.map(([name, count]) => (
                  <span
                    key={name}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                      count >= flagged[0][1]
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-white/70',
                    )}
                  >
                    {name} ×{count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-white/50">
                {ready
                  ? 'No situation on file names anybody yet.'
                  : 'Counted once the tracker answers.'}
              </p>
            )}
            {/* THE SHEET IS STILL THE ONLY WRITER. A staff issue started here
                is appended to that same sheet through one Apps Script door —
                nothing writes the mirror this table reads, which is why the
                new row waits for the mirror's own clock. */}
            <p className="mt-3 text-[11.5px] text-white/45">
              The estate's Employee HR Tracker sheet is the writer — HR staff and
              the old platform's RH grid write there, and this page reads the same rows back. An
              admin or manager can start
              a situation here; it is appended to that sheet, and the table below catches up when
              the mirror next refreshes, about half an hour later.
            </p>
          </div>
        </div>
      </div>

      {/* THE DIGEST, UNDER THE DARK HERO. It says what it is sure of, what it
          could not read, and which names it could not place — and when it has
          not run at all, it says that instead of drawing an empty summary. */}
      {ready && (
        <Card className="mb-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-tint-violet">
              <ShieldQuestion size={14} className="text-tint-fg-violet" />
            </span>
            <h3 className="text-[13.5px] font-bold text-text-1">What the digest is sure of</h3>
            {digest.pending > 0 && digestRan && (
              <span className="rounded-full bg-tint-slate px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-slate">
                {digest.pending} not read yet
              </span>
            )}
          </div>

          {digest.failed ? (
            <p className="text-[12px] text-tint-fg-amber">
              The digest did not run — {digest.failed}. The {digest.total} rows below are the
              tracker itself and stand on their own; nothing has been read about them, which is
              not the same as there being nothing to read.
            </p>
          ) : !digestRan ? (
            <p className="text-[12px] text-text-2">
              Nothing has been digested yet. The tracker below is complete and unaffected — a
              digest that has not run reads as <span className="font-semibold">not read</span>,
              never as “no issues”.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {VERDICTS.map((v) => {
                  const n = digest.verdicts.get(v.id) ?? 0
                  if (!n) return null
                  return (
                    <span
                      key={v.id}
                      className={cn('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', v.tint)}
                    >
                      {n} {v.label}
                    </span>
                  )
                })}
                {digest.unreadable > 0 && (
                  <span className="rounded-full bg-tint-pink px-2.5 py-1 text-[11.5px] font-semibold text-tint-fg-pink">
                    {digest.unreadable} could not be read
                  </span>
                )}
              </div>

              <p className="mt-3 text-[11.5px] text-text-2">
                <span className="font-semibold text-text-1">The names.</span>{' '}
                {digest.rosterWhy ? (
                  <>The staff roster could not be read ({digest.rosterWhy}), so no name on this
                  page has been placed. That is a read that failed, not a tracker without people.</>
                ) : (
                  <>{digest.names.exact} named one person on the roster exactly
                    {digest.names.ambiguous > 0 && <>, {digest.names.ambiguous} reach two people and were left alone</>}
                    {digest.names.unmatched > 0 && <>, {digest.names.unmatched} match nobody</>}.
                    “Employees Involved” is free text, so a name is either an exact match or it
                    is carried here for a human — never quietly matched to the nearest spelling.
                  </>
                )}
              </p>

              {unmatched.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {unmatched.slice(0, 24).map(([label, n]) => (
                    <span
                      key={label}
                      className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10.5px] font-medium text-text-2"
                    >
                      {label}{n > 1 ? ` ×${n}` : ''}
                    </span>
                  ))}
                  {unmatched.length > 24 && (
                    <span className="text-[10.5px] text-text-3">
                      and {unmatched.length - 24} more
                    </span>
                  )}
                </div>
              )}

              <p className="mt-3 text-[11.5px] text-text-3">
                Read here, and read for this page. Nothing on this screen is a score and nothing
                orders one person above another. The only fact that leaves this app is
                “employment ended”, taken from the estate's own Disciplinary Action dropdown, and
                only when the row names <span className="font-semibold text-text-2">one</span>{' '}
                person and that name matches exactly one person on the roster — because Disciplinary
                Action is a single cell, and on a row naming two people it cannot say which of them
                it is about. When the digest is unsure, the person stays available and a human
                should look.
              </p>
              {digest.held > 0 && (
                <p className="mt-2 text-[11.5px] text-text-3">
                  {digest.held} row{digest.held === 1 ? '' : 's'} the dropdown settled as ended
                  handed nothing to scheduling, because the name could not be pinned to one person.
                  {' '}Each says why on its own line below, and each is a row somebody should read.
                </p>
              )}
            </>
          )}
        </Card>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-amber">
          <AlertOctagon size={15} className="text-tint-fg-amber" />
        </span>
        <h2 className="text-[15px] font-bold text-text-1">Staff issues</h2>
        {/* Admin/manager only — the component draws nothing for anybody else.
            It carries its own receipt, which wraps onto a full-width line of
            this same row. `onSaved` does NOT prepend a row: the write lands in
            the sheet, not in this slice, and a row drawn here would be an
            invention. It re-reads so the table is at least current with the
            mirror it has. */}
        <StartStaffIssue onSaved={() => load(true)} />
        <button
          onClick={() => load(true)}
          disabled={refreshing || rows === null}
          title="Re-read the tracker"
          className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} /> Refresh
        </button>
      </div>

      {failed && (
        <p className="mb-2 text-[11.5px] text-tint-fg-amber">
          could not be read: staffIssues (HR tracker) — {failed}
        </p>
      )}

      <div className="mb-2 flex h-9 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-surface px-3">
        <Search size={13} className="text-text-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the tracker…"
          className="w-full bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3"
        />
      </div>

      <Card padded={false}>
        {rows === null && !failed ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-text-3">
            <Loader2 size={13} className="animate-spin" /> Reading the HR tracker…
          </div>
        ) : !visible.length ? (
          <EmptyState
            title={total > 0 ? 'Nothing matches' : 'No staff issues on file'}
            body={
              total > 0
                ? 'Adjust the search.'
                : failed
                  ? 'The tracker is unknown, not empty — the read above names what failed.'
                  : "The estate's Employee HR Tracker sheet holds no rows yet."
            }
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[1320px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">
                  <th className="whitespace-nowrap px-3 py-2">Date</th>
                  <th className="px-3 py-2">Employees involved</th>
                  <th className="px-3 py-2">Situation</th>
                  <th className="px-3 py-2">Follow up</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Digest</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 align-top last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-text-2">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2 font-semibold text-text-1">
                      {r.employees_involved || '—'}
                      {/* A NAME THE ROSTER DOES NOT CARRY IS SHOWN, NOT DROPPED.
                          The split on comma, slash, ampersand and "and" is a
                          guess, and where it guessed wrong this is where a
                          human sees it. */}
                      {(r.digest_people ?? []).some((p) => p.match === 'unmatched' || p.match === 'ambiguous') && (
                        <span className="mt-1 block text-[10.5px] font-medium text-text-3">
                          {(r.digest_people ?? [])
                            .filter((p) => p.match === 'unmatched' || p.match === 'ambiguous')
                            .map((p) => `“${p.name}” ${p.match === 'ambiguous' ? 'reaches two people' : 'matches nobody on the roster'}`)
                            .join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="min-w-[260px] px-3 py-2 text-text-2">{r.situation || '—'}</td>
                    <td className="min-w-[180px] px-3 py-2 text-text-2">{r.follow_up || '—'}</td>
                    <td className="min-w-[140px] px-3 py-2 text-text-2">
                      {r.disciplinary_action
                        ? <span className="inline-flex rounded-full bg-tint-amber px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-amber">{r.disciplinary_action}</span>
                        : '—'}
                    </td>
                    <td className="min-w-[140px] px-3 py-2 text-text-2">
                      {r.result || '—'}
                      {/* THE SUMMARY IS SHOWN AND CLAIMS NOTHING. It used to
                          raise a "termination" badge beside this row's own
                          name; measured, eight of the ten rows carrying this
                          column describe a different person entirely. */}
                      {r.termination_summary && (
                        <span className="mt-1 block text-[10.5px] text-text-3">
                          A write-up is filed in this row's Termination summary cell — read it in
                          the sheet: it often names somebody other than this row's employee.
                        </span>
                      )}
                    </td>
                    <td className="min-w-[200px] px-3 py-2">
                      {r.digest_state === 'unreadable' ? (
                        <>
                          <span className="inline-flex rounded-full bg-tint-pink px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-pink">
                            could not be read
                          </span>
                          {r.digest_why && (
                            <span className="mt-1 block text-[10.5px] text-text-3">{r.digest_why}</span>
                          )}
                        </>
                      ) : r.digest_verdict ? (
                        <>
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                              VERDICT_TINT.get(r.digest_verdict) ?? 'bg-tint-slate text-tint-fg-slate',
                            )}
                          >
                            {VERDICT_LABEL.get(r.digest_verdict) ?? r.digest_verdict}
                          </span>
                          {r.digest_state === 'settled' && (
                            <span className="ml-1 text-[10.5px] text-text-3">
                              the sheet's own “{r.digest_why}”
                            </span>
                          )}
                          {/* THE SENTENCE, AND IT GOES NO FURTHER THAN THIS CELL. */}
                          {r.digest_note && (
                            <span className="mt-1 block text-[11px] italic text-text-2">{r.digest_note}</span>
                          )}
                          {r.digest_state === 'read' && !r.digest_note && r.digest_why && (
                            <span className="mt-1 block text-[10.5px] text-text-3">{r.digest_why}</span>
                          )}
                          {/* WHY NOTHING LEFT THIS ROW. The dropdown settled it
                              and scheduling still learned nothing — that is a
                              row for a human, not a silence. */}
                          {r.digest_hold_why && (
                            <span className="mt-1 block text-[10.5px] text-tint-fg-amber">
                              Not sent to scheduling: {r.digest_hold_why}.
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[10.5px] text-text-3">not read yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pager
        className="mt-3"
        page={pager.page}
        pages={pager.pages}
        from={pager.from}
        to={pager.to}
        total={pager.total}
        onPage={pager.setPage}
        noun="issues"
      />
    </div>
  )
}
