// Recruiting texts: the three texts the recruiters' book owes (server/recruit_book.py, CommRecruit.gs).
// Reads only `recruitBook`; writes, sends and arms nothing.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarClock, Loader2, MessageSquareText, Printer, RefreshCw, Share2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import ExportMenu from '@/components/shared/ExportMenu'
import { readSlice } from '@/lib/snapshotClient'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { share } from '@/stores/useShareStore'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { TINT_BG, TINT_FG, type ExtendedTintName } from '@/lib/tints'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'
import {
  MESSAGE_COLUMNS, RESOURCE, SCREEN_COLUMNS, SITUATION_LABEL, countWords, messageChip, messageCopy,
  messageSentence, screenChip, splitRows, statusSentences,
  type RecruitMessage, type RecruitRow, type RecruitScreen,
} from '@/pages/features/smartcomms/recruitLogic'

const KEPT = 'smartcomms.recruiting.rows'
const BTN = 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40'
const ICON_BTN = 'grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

function Chip({ label, tint }: { label: string; tint: ExtendedTintName }) {
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG[tint], TINT_FG[tint])}>
      {label}
    </span>
  )
}

function stamp(iso: string): string {
  if (!iso) return ''
  try { return ohioDateTime(iso) } catch { return iso }
}

/** The controls every list on this app carries: Export, Share and Print. */
function ListControls({ what, filename, rows, columns }: {
  what: string; filename: string; rows: unknown[]; columns: typeof SCREEN_COLUMNS
}) {
  return (
    <div className="flex items-center gap-1">
      <ExportMenu filename={filename} columns={columns} rows={rows as never[]} />
      <button
        type="button"
        aria-label={`Share ${what}`}
        title={`Share ${what}`}
        onClick={() => share({
          title: `Recruiting texts — ${what}`,
          subtitle: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} — as shown on screen`,
          rows: rows as never[],
          columns,
          filename,
          icon: 'message-square',
        })}
        className={ICON_BTN}
      >
        <Share2 size={15} />
      </button>
      <button type="button" aria-label="Print" title={`Print ${what}`} onClick={() => window.print()} className={ICON_BTN}>
        <Printer size={15} />
      </button>
    </div>
  )
}

/** The page body, drawn only from the rows it is handed. */
export function RecruitingView({ rows, stale = false }: { rows: RecruitRow[] | null; stale?: boolean }) {
  const { status, screens, messages } = useMemo(() => splitRows(rows), [rows])
  const sentences = useMemo(() => statusSentences(status), [status])

  if (rows === null) {
    return (
      <Card padded={false} className="p-6">
        <p className="text-[13px] leading-5 text-text-2">
          Nothing answered for the recruiting lane’s file ({RESOURCE}). This is a list that could not be seen,
          not an empty one — the platform writes it once the lane has run.
        </p>
      </Card>
    )
  }

  return (
    <div>
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">What the lane can see</p>
        {stale && (
          <p className="mt-2 text-[12.5px] text-white/70">This is the last copy this browser kept — the file did not answer now.</p>
        )}
        <ul className="mt-2 space-y-1.5 text-[13px] leading-5 text-white/85">
          {sentences.map((s) => <li key={s.text}>{s.text}</li>)}
        </ul>
        <p className="mt-3 text-[11.5px] leading-4 text-white/55">
          The words, the switch and the line each text leaves from are on the Desk — no publish needed. While test mode
          is on, every text becomes a row in the mock outbox and NOBODY IS CONTACTED — and the words of each held text
          are shown below, with the number it was addressed to and the line it would have left from.
        </p>
      </div>

      {/* THE THREE TEXTS, counted. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {Object.entries(SITUATION_LABEL).map(([id, label]) => (
          <Card key={id} className="p-4">
            <p className="text-[13px] font-semibold text-text-1">{label}</p>
            <p className="mt-0.5 font-mono text-[11px] text-text-3">{id}</p>
            <p className="mt-2 text-[12.5px] leading-5 text-text-2">{countWords(status?.counts?.[id])}</p>
          </Card>
        ))}
      </div>

      {/* ---- SCREENS TODAY AND TOMORROW ---- */}
      <section aria-label="Screens today and tomorrow" className="mb-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text-1">
            <CalendarClock size={16} className="text-text-3" />
            Screens today and tomorrow
            <span className="ml-1 font-stat text-[12.5px] text-text-3">{screens.length}</span>
          </h2>
          <ListControls what="the screens" filename="recruiting-screens" rows={screens} columns={SCREEN_COLUMNS} />
        </div>
        {screens.length === 0 ? (
          <Card padded={false} className="p-5">
            <p className="text-[12.5px] leading-5 text-text-2">
              {status?.source_state === 'read'
                ? 'The recruiters’ book has no in-person screen today or tomorrow.'
                : 'The recruiters’ book could not be read, so no screen can be listed — this is not an empty day.'}
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-[12px] border border-border">
            <table className="w-full min-w-[720px] text-left text-[12.5px]">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-text-3">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Candidate</th>
                  <th className="px-3 py-2">House manager · place</th>
                  <th className="px-3 py-2">Reminder</th>
                </tr>
              </thead>
              <tbody>
                {screens.map((s: RecruitScreen) => {
                  const chip = screenChip(s.verdict)
                  return (
                    <tr key={s.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold text-text-1">{s.day}</span> · {s.time || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-text-1">{s.name || s.first_name || '—'}</span>
                        {s.last4 && <span className="ml-1 font-mono text-[11px] text-text-3">{`•••${s.last4}`}</span>}
                        <div className="text-[11px] text-text-3">{s.status} · row {s.source}</div>
                      </td>
                      <td className="px-3 py-2 text-text-2">{s.screener || '—'} · {s.location || '—'}</td>
                      <td className="px-3 py-2">
                        <Chip label={chip.label} tint={chip.tint} />
                        {s.why && <div className="mt-1 max-w-[42ch] text-[11.5px] leading-4 text-text-3">{s.why}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- EVERY TEXT THE LANE OWED ---- */}
      <section aria-label="Every text the lane owed">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text-1">
            <MessageSquareText size={16} className="text-text-3" />
            Texts
            <span className="ml-1 font-stat text-[12.5px] text-text-3">{messages.length}</span>
          </h2>
          <ListControls what="the texts" filename="recruiting-texts" rows={messages} columns={MESSAGE_COLUMNS} />
        </div>
        {messages.length === 0 ? (
          <Card padded={false} className="p-5">
            <p className="text-[12.5px] leading-5 text-text-2">
              No text has been owed yet. The candidates who had already passed when the lane began are never sent
              the onboarding start.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {messages.map((m: RecruitMessage) => {
              const chip = messageChip(m.state)
              const said = messageSentence(m)
              const copy = messageCopy(m)
              return (
                <Card key={m.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-text-1">{SITUATION_LABEL[m.situation] ?? m.situation}</span>
                    <Chip label={chip.label} tint={chip.tint} />
                    <span className="text-[12.5px] text-text-2">
                      {m.name || m.first_name || '—'}
                      {m.last4 && <span className="ml-1 font-mono text-[11px] text-text-3">{`•••${m.last4}`}</span>}
                    </span>
                    <span className="ml-auto text-[11.5px] text-text-3">{stamp(m.said_at || m.first_seen)}</span>
                  </div>
                  <p className={cn('mt-2 rounded-md px-3 py-1.5 text-[12px] leading-4', TINT_BG[said.tone], TINT_FG[said.tone])}>
                    {said.text}
                  </p>
                  {/* The copy itself, under a heading that never claims a held text went out. */}
                  {copy.kind === 'words' && (
                    <div className={cn('mt-2 rounded-md border bg-surface-2 px-3 py-2',
                                       copy.went ? 'border-tint-mint' : 'border-border')}>
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">
                        {copy.heading}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-text-1">
                        {copy.words}{copy.cut && ' …'}
                      </p>
                      {copy.cut && <p className="mt-1 text-[11px] font-semibold leading-4 text-text-2">{copy.cut}</p>}
                      <p className="mt-1.5 text-[11px] leading-4 text-text-3">
                        {copy.where} · {stamp(m.said_at || m.first_seen) || 'at an hour the lane did not write'}
                      </p>
                    </div>
                  )}
                  {copy.kind === 'missing' && (
                    <p className="mt-2 text-[11.5px] leading-4 text-text-3">{copy.text}</p>
                  )}
                  {m.why && <p className="mt-1.5 text-[11.5px] leading-4 text-text-3">{m.why}</p>}
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default function SmartCommsRecruitingPage() {
  /** null is NOT an empty lane — it is "we do not know yet". */
  const [rows, setRows] = useState<RecruitRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)

  const load = useCallback(async (loud: boolean) => {
    setLoading(true)
    const generation = keptGeneration()
    let got: RecruitRow[] | null = null
    try { got = await readSlice<RecruitRow>(RESOURCE) } catch { got = null }
    if (got === null) {
      const kept = readKept<RecruitRow[]>(KEPT)
      setRows(kept ?? null)
      setStale(!!kept)
      if (loud) {
        toast({ type: 'warning', title: 'Nothing answered for the recruiting lane',
                body: `The ${RESOURCE} file did not reply. The page shows what it knows, not zeros.` })
      }
    } else {
      setRows(got)
      setStale(false)
      keepIfCurrent(KEPT, got, generation)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load(false) }, [load])

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Recruiting texts"
          subtitle="The screen reminder, the onboarding start and the True Hire how-to — from the recruiters’ book, said by the platform."
          actions={
            <div className="flex items-center gap-2">
              <PageSwitch />
              <button type="button" onClick={() => void load(true)} className={BTN}>
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          }
        />
      </motion.div>
      {loading && rows === null ? (
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading…
        </p>
      ) : (
        <RecruitingView rows={rows} stale={stale} />
      )}
    </div>
  )
}
