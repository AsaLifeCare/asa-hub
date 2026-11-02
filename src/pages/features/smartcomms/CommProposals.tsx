// WHAT THE REPLIES TAUGHT — the screen where a word waits for a person.
// The comms lane's vocabulary is frozen in code: a fixed list of stop words, a fixed list of opt-in words, a fixed…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Quote, RefreshCw, ShieldCheck, X,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { gasAction } from '@/features/hiring/shared'
import { onLiveEvent } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

// Every cell arrives as the spreadsheet held it, so every field is a string — including the numbers.
type Proposal = {
  id: string; created_at: string; status: string
  vocabularies_allowed: string; phrase: string; phrase_norm: string; tokens: string
  family: string; shape: string
  evidence_n: string; people_n: string; coverage: string
  leak_control: string; leak_contains: string
  would_catch: string; would_catch_wrongly: string
  verdict: string; why: string
  merged_list: string; shipped_intact: string
  example: string; example_ref: string; example_withheld: string
  corpus_n: string; control_n: string; notes: string
  decision: string; decided_by: string; decided_at: string
  decision_reason: string; decided_vocabulary: string
}
type House = { tab: string; declared: boolean; why: string }
type Answer = {
  rows: Proposal[]
  proposable: string[]
  forbidden: string[]
  shipped: Record<string, string[]>
  learned: Record<string, string[]>
  houses: { proposals: House; vocabulary: House }
}

// A number the sheet held, or null — and null is never drawn as 0.
const num = (s: string): number | null => {
  const t = String(s ?? '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const VOCAB_LABEL: Record<string, string> = {
  opt_out_phrases: 'Stop words',
  wrong_number_phrases: 'Wrong-number words',
  availability_phrases: 'Availability words',
  opt_in_phrases: 'Start words',
}

// What approving one costs if it is wrong.
const VOCAB_COST: Record<string, string> = {
  opt_out_phrases:
    'Wrong, this silences somebody who never asked to be silenced. They stop hearing from us until a person releases them — recoverable, and it errs toward not contacting.',
  wrong_number_phrases:
    'Wrong, this files a real person as our own bad data and stops the thread. Same direction, same undo.',
  availability_phrases:
    'Wrong, this reads a shift preference somebody did not state. It suppresses nobody; a demand owner sees it and corrects it.',
}

function Chip({ tint, children }: { tint: ExtendedTintName; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG[tint], TINT_FG[tint])}>
      {children}
    </span>
  )
}

/** One fact, with its own label. The unit of judgement on this page. */
function Fact({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint?: ExtendedTintName }) {
  return (
    <div className="rounded-md bg-surface-2 px-2.5 py-2" style={tint ? { borderLeft: `3px solid ${TINT_VAR[tint]}` } : undefined}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</p>
      <p className="mt-0.5 font-stat text-[15px] leading-[1.2] text-text-1">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] leading-[1.45] text-text-2">{sub}</p> : null}
    </div>
  )
}

export default function CommProposalsPage() {
  const [data, setData] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')
  const [vocab, setVocab] = useState<Record<string, string>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  const [openRow, setOpenRow] = useState<Record<string, boolean>>({})
  const [showDecided, setShowDecided] = useState(false)

  // `quiet` is a live re-read: nothing flashes, and a failure keeps what was last read on the screen
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setErr('') }
    try {
      setData(await gasAction<Answer>('commProposalsList', {}, { timeoutMs: 120_000 }))
    } catch (e) {
      if (!quiet) setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ALWAYS CURRENT: the Smart Comms event, a reconnected stream and a tab brought back into view read it again, one
  // read at a time. No timer.
  const reading = useRef(false)
  const again = useRef(false)
  useEffect(() => {
    const reread = () => {
      if (reading.current) { again.current = true; return }
      reading.current = true
      void load(true).finally(() => {
        reading.current = false
        if (again.current) { again.current = false; reread() }
      })
    }
    const seen = () => { if (document.visibilityState === 'visible') reread() }
    const offRing = onLiveEvent('smartcomms', reread)
    const offOpen = onLiveEvent('open', reread)
    document.addEventListener('visibilitychange', seen)
    return () => { offRing(); offOpen(); document.removeEventListener('visibilitychange', seen) }
  }, [load])

  const decide = useCallback(async (p: Proposal, action: 'approve' | 'reject') => {
    setBusyId(p.id)
    try {
      const r = await gasAction<{ message?: string; already?: boolean }>('commProposalsDecide', {
        // The word itself is NOT sent.
        id: p.id, decision: action, vocabulary: vocab[p.id] || '', reason: reason[p.id] || '',
      }, { timeoutMs: 120_000 })
      toast({
        type: r.already ? 'info' : action === 'approve' ? 'success' : 'info',
        title: action === 'approve' ? 'One row appended to the vocabulary' : 'Refused, and recorded as refused',
        body: r.message || '',
      })
      await load()
    } catch (e) {
      toast({
        type: 'danger',
        title: action === 'approve' ? 'Nothing was taught' : 'The refusal did not land',
        body: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusyId('')
    }
  }, [load, reason, vocab])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const waiting = useMemo(() => rows.filter((r) => !r.decision && r.status !== 'blocked'), [rows])
  const blocked = useMemo(() => rows.filter((r) => !r.decision && r.status === 'blocked'), [rows])
  const decided = useMemo(() => rows.filter((r) => !!r.decision), [rows])
  const taught = decided.filter((r) => r.decision === 'approved').length
  const refused = decided.filter((r) => r.decision === 'rejected').length
  const ready = !!data && !loading

  const houses = data?.houses
  const houseTrouble = houses
    ? [houses.proposals, houses.vocabulary].filter((h) => h.why).map((h) => h.why)
    : []

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="What the replies taught"
          subtitle="Words the lane keeps failing to read, counted rather than guessed — and what each one would cost if it were wrong."
          actions={
            <>
              <PageSwitch />
              <button
                type="button" onClick={() => void load()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </>
          }
        />
      </motion.div>

      {/* the headline, on the one dark surface this design system keeps */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">Waiting for your word</p>
            <p className="font-stat text-[60px] leading-none text-white">{ready ? waiting.length : '…'}</p>
            <p className="mt-1 text-[12px] text-white/60">
              {ready
                ? <>of {rows.length} phrase{rows.length === 1 ? '' : 's'} the counter has written</>
                : <>of — phrases the counter has written</>}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">Where they stand</p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {ready && ([
                ['amber', waiting.length], ['mint', taught], ['slate', refused], ['pink', blocked.length],
              ] as [ExtendedTintName, number][]).map(([tint, n]) => (
                n ? <span key={tint} style={{ width: `${(n / Math.max(1, rows.length)) * 100}%`, background: heroBand(tint) }} /> : null
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-white/70">
              {([
                ['amber', 'Waiting', waiting.length], ['mint', 'Taught', taught],
                ['slate', 'Refused', refused], ['pink', 'Blocked by the counter', blocked.length],
              ] as [ExtendedTintName, string, number][]).map(([tint, label, n]) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(tint) }} />
                  {label} <span className="font-stat text-white">{ready ? n : '—'}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] text-white/80">
              Approving appends <span className="font-stat text-white">one</span> row to the live vocabulary and does
              nothing else — no publish, no deploy, no code change, and not one character written into the settings
              cell that would replace the shipped brake words. The lane reads the new word on its own, within a minute.
            </p>
          </div>
        </div>
      </div>

      {err ? (
        <Card padded={false} className="mb-4 overflow-hidden">
          <div className="p-4" style={{ borderLeft: `3px solid ${TINT_VAR.pink}` }}>
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.pink }} />
              <div className="min-w-0">
                <p className="font-display text-[14.5px] font-bold leading-[1.35] text-text-1">The door did not answer</p>
                <p className="mt-1 break-words text-[12.5px] leading-[1.5] text-text-2">{err}</p>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {houseTrouble.map((why) => (
        <Card key={why} padded={false} className="mb-4 overflow-hidden">
          <div className="p-4" style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.amber }} />
              <p className="min-w-0 break-words text-[12.5px] leading-[1.5] text-text-2">
                {why} Until then this screen is not empty because there is nothing to learn — it is empty because
                nothing could be read.
              </p>
            </div>
          </div>
        </Card>
      ))}

      {/* WHAT THE LANE KNOWS TODAY, and the one list that may never grow. */}
      {data ? (
        <Card className="mb-4">
          <p className="font-display text-[15px] font-bold leading-[1.3] text-text-1">What the lane reads today</p>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">
            The shipped words are in the code and nothing on this page can remove one. Taught words are rows in the
            vocabulary house; the lane adds them to the shipped list, and adding is the only thing it can do with them.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {data.proposable.map((v) => (
              <div key={v} className="rounded-md border border-border p-3">
                <p className="text-[12.5px] font-semibold text-text-1">{VOCAB_LABEL[v] || v}</p>
                <p className="mt-1 text-[11.5px] leading-[1.5] text-text-2">
                  <span className="font-stat text-text-1">{data.shipped[v]?.length ?? 0}</span> shipped
                  {' · '}
                  <span className="font-stat text-text-1">{data.learned[v]?.length ?? 0}</span> taught
                </p>
                {/* EVERY WORD, NOT A COUNT — the shipped ones in grey, the taught ones in mint */}
                {data.shipped[v]?.length || data.learned[v]?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(data.shipped[v] ?? []).map((w) => (
                      <span key={'s:' + w} title="Shipped in the code"
                        className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-2">{w}</span>
                    ))}
                    {(data.learned[v] ?? []).map((w) => (
                      <span key={'l:' + w} title="Taught on this page"
                        className={cn('rounded-full px-2 py-0.5 font-mono text-[11px]', TINT_BG.mint, TINT_FG.mint)}>{w}</span>
                    ))}
                  </div>
                ) : null}
                {v === 'availability_phrases' ? (
                  <p className="mt-2 text-[11px] leading-[1.45] text-text-3">
                    Reading only — it changes no suppression at all.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-md bg-surface-2 p-3" style={{ borderLeft: `3px solid ${TINT_VAR.violet}` }}>
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-1">
              <Ban size={14} style={{ color: TINT_VAR.violet }} /> Start words are not on this screen, and never will be
            </p>
            <p className="mt-1 text-[11.5px] leading-[1.5] text-text-2">
              A new way to say <em className="not-italic font-semibold">stop</em> silences somebody who can be released
              again. A new way to say <em className="not-italic font-semibold">start</em> releases a suppression
              somebody asked for — it texts a person who told us to stop. The shipped list carries the scar: “yes” was
              on it until the mirror was counted, and of 89 messages it would have matched, 88 were the bare word “yes”
              answering a question. A counter cannot tell a release from an agreement, because they are the same words.
            </p>
          </div>
        </Card>
      ) : null}

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}

      {ready && rows.length === 0 && !houseTrouble.length ? (
        <Card>
          <EmptyState
            title="The counter has proposed nothing"
            body="It refuses until the replies it read CORRECTLY are numerous enough to measure a phrase against, and until one family of unreadable replies is large enough to be a family. Neither is a failure of this screen — it is the counter declining to speak from thin material."
          />
        </Card>
      ) : null}

      <ul className="space-y-3">
        {waiting.concat(blocked).map((p) => {
          const allowed = String(p.vocabularies_allowed || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
          const chosen = vocab[p.id] || ''
          const isBlocked = p.status === 'blocked' || p.verdict === 'blocked'
          const wrongly = num(p.would_catch_wrongly)
          const control = num(p.control_n)
          const catches = num(p.would_catch)
          const people = num(p.people_n)
          const evidence = num(p.evidence_n)
          const coverage = num(p.coverage)
          const contains = num(p.leak_contains)
          const intact = p.shipped_intact === 'yes'
          const open = !!openRow[p.id]
          const busy = busyId === p.id
          // THE COST SIDE, and the one place this page refuses to be reassuring.
          const costUnknown = control === null || control === 0
          return (
            <li key={p.id}>
              <Card padded={false} className="overflow-hidden">
                <div className="p-4" style={{ borderLeft: `3px solid ${TINT_VAR[isBlocked ? 'pink' : wrongly ? 'amber' : 'mint']}` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[15px] font-bold text-text-1">“{p.phrase}”</span>
                    {p.family ? <Chip tint="lavender">{p.family}</Chip> : null}
                    {isBlocked ? <Chip tint="pink"><Ban size={11} /> blocked by the counter</Chip> : null}
                    {intact ? (
                      <Chip tint="mint"><ShieldCheck size={11} /> shipped words survive</Chip>
                    ) : (
                      <Chip tint="pink"><AlertTriangle size={11} /> shipped words not proven intact</Chip>
                    )}
                  </div>

                  {/* the benefit and the cost, on the same row, in that order */}
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <Fact
                      label="Supported by"
                      value={evidence === null ? 'not counted' : `${evidence} repl${evidence === 1 ? 'y' : 'ies'}`}
                      sub={[
                        people === null ? '' : `${people} different people`,
                        coverage === null ? '' : `${Math.round(coverage * 100)}% of its family`,
                      ].filter(Boolean).join(' · ')}
                    />
                    <Fact
                      tint="mint"
                      label="Would have caught"
                      value={catches === null ? 'not counted' : `${catches} unread`}
                      sub="replies sitting in a queue that the lane could have read on its own"
                    />
                    <Fact
                      tint={costUnknown ? 'amber' : wrongly ? 'pink' : 'mint'}
                      label="Would have caught WRONGLY"
                      value={costUnknown ? 'not measured' : `${wrongly ?? 0} correct read${(wrongly ?? 0) === 1 ? '' : 's'}`}
                      sub={costUnknown
                        ? 'there are too few replies the machine read correctly to measure a leak against — treat the benefit above as unproven'
                        : `measured against ${control} repl${control === 1 ? 'y' : 'ies'} the machine read correctly`}
                    />
                    <Fact
                      label="Merely contained in"
                      value={contains === null ? 'not counted' : `${contains} longer repl${contains === 1 ? 'y' : 'ies'}`}
                      sub="harmless while the lane matches whole messages — and the exact trap a substring match would fall into"
                    />
                  </div>

                  {p.why ? <p className="mt-2 text-[12px] leading-[1.5] text-text-2">{p.why}</p> : null}

                  {/* the example: the words when they carry no name, a pointer when they do */}
                  {p.example ? (
                    <p className="mt-2 flex items-start gap-1.5 break-words text-[12.5px] leading-[1.5] text-text-2">
                      <Quote size={13} className="mt-0.5 shrink-0 text-text-3" />
                      <span className="font-mono">{p.example}</span>
                    </p>
                  ) : null}
                  {p.example_withheld ? (
                    <p className="mt-1 text-[11.5px] leading-[1.45] text-text-3">
                      {p.example_withheld}{p.example_ref ? ` — read them at ${p.example_ref}` : ''}
                    </p>
                  ) : null}

                  <button
                    type="button" onClick={() => setOpenRow((o) => ({ ...o, [p.id]: !o[p.id] }))}
                    className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-text-2 hover:text-text-1"
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    what the list would look like beside it
                  </button>
                  {open ? (
                    <div className="mt-2 rounded-md bg-surface-2 p-3">
                      <p className="text-[11.5px] leading-[1.5] text-text-2">
                        Nobody pastes this anywhere. It is shown for one reason: to prove every shipped word is still in
                        the list once the new one joins it. Approving writes a row; it does not write this.
                      </p>
                      <p className="mt-1.5 break-words font-mono text-[11.5px] leading-[1.6] text-text-1">{p.merged_list || '—'}</p>
                    </div>
                  ) : null}

                  {/* the decision */}
                  {isBlocked ? (
                    <p className="mt-3 rounded-md bg-surface-2 p-3 text-[12px] leading-[1.5] text-text-2">
                      This one cannot be approved, and it is shown rather than hidden: a phrase the lane keeps almost
                      learning is worth seeing, and a proposal deleted in silence teaches nobody.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-[11.5px] text-text-2">File it under</span>
                      {allowed.map((v) => (
                        <button
                          key={v} type="button"
                          onClick={() => setVocab((c) => ({ ...c, [p.id]: v }))}
                          title={VOCAB_COST[v] || ''}
                          className={cn(
                            'h-8 rounded-md border px-2.5 text-[12px] font-semibold transition-colors',
                            chosen === v ? 'border-transparent bg-surface-3 text-text-1' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                          )}
                        >
                          {VOCAB_LABEL[v] || v}
                        </button>
                      ))}
                      <input
                        value={reason[p.id] || ''}
                        onChange={(e) => setReason((c) => ({ ...c, [p.id]: e.target.value }))}
                        placeholder="why (kept with the decision)"
                        className="h-8 min-w-[160px] flex-1 rounded-md border border-border bg-surface px-2 text-[12px] text-text-1 placeholder:text-text-3"
                      />
                      <button
                        type="button" disabled={busy || !chosen}
                        onClick={() => void decide(p, 'approve')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                      >
                        <Check size={13} /> Teach it
                      </button>
                      <button
                        type="button" disabled={busy}
                        onClick={() => void decide(p, 'reject')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
                      >
                        <X size={13} /> Refuse
                      </button>
                    </div>
                  )}
                  {!isBlocked ? (
                    <p className="mt-1.5 text-[11.5px] leading-[1.45] text-text-3">
                      {chosen
                        ? VOCAB_COST[chosen] || ''
                        : 'Pick the list first — the counter never decides what a phrase MEANS, and that one judgement is yours. Refusing is a decision too: it is recorded, and the counter will not raise this phrase again.'}
                    </p>
                  ) : null}
                </div>
              </Card>
            </li>
          )
        })}
      </ul>

      {decided.length ? (
        <div className="mt-4">
          <button
            type="button" onClick={() => setShowDecided((v) => !v)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-2 hover:text-text-1"
          >
            {showDecided ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {decided.length} already decided
          </button>
          {showDecided ? (
            <ul className="mt-2 space-y-1.5">
              {decided.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-text-2">
                  <Chip tint={p.decision === 'approved' ? 'mint' : 'slate'}>{p.decision}</Chip>
                  <span className="font-mono text-text-1">{p.phrase}</span>
                  {p.decided_vocabulary ? <span>{VOCAB_LABEL[p.decided_vocabulary] || p.decided_vocabulary}</span> : null}
                  {p.decision_reason ? <span className="text-text-3">— {p.decision_reason}</span> : null}
                  <span className="ml-auto text-text-3">
                    {p.decided_by}{p.decided_at ? ` · ${String(p.decided_at).slice(0, 10)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
