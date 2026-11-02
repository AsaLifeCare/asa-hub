// Settings → Client Finances — the knobs, and the card feed.
// Appears only while the Client Finances app is installed, exactly like Hiring messages, Smart Comms and Lead…
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle, Upload, Zap } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { askConfirm } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'
import TestLane from './TestLane'

type Vocab = { fundTypes: string[]; categories: string[]; txnTypes: string[]; exemptReasons: string[] }
type Parsed = { client: string; date: string; vendor: string; amount: string; postedDate: string
  location: string; accountId: string; accountLast4: string; cardType: string }
type ImportResult = { imported: number; skipped: number; unreadable: number; unmatched: { name: string; rows: number }[] }

// The headers we look for, lowercased.
const FIELD_ALIASES: Record<keyof Parsed, string[]> = {
  client: ['cardholder name', 'cardholder', 'client', 'customer', 'name'],
  date: ['transaction date', 'date', 'trans date'],
  vendor: ['vendor', 'merchant', 'payee'],
  amount: ['amount', 'transaction amount', 'value'],
  postedDate: ['posted date', 'post date', 'settlement date'],
  location: ['location', 'merchant location', 'city'],
  accountId: ['account id', 'account'],
  // The last four is how two cards for one person are told apart.
  accountLast4: ['account (last 4)', 'account last 4', 'last 4', 'last four'],
  cardType: ['type', 'transaction type'],
}

// A CSV split that survives quoted fields containing commas — vendor names are full of them, and a naive split…
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

// A date cell as YYYY-MM-DD.
function normalDate(v: string): string {
  const s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s)
  if (!us) return ''
  const y = us[3].length === 2 ? `20${us[3]}` : us[3]
  return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
}

/** One editable list. Add is a chip; the shipped values carry no remove. */
function VocabEditor({ vocab, onSaved }: { vocab: Vocab | null; onSaved: (v: Vocab) => void }) {
  const [draft, setDraft] = useState<Vocab | null>(null)
  const [adding, setAdding] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (vocab) setDraft(vocab) }, [vocab])
  if (!draft) return <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Loading…</p>

  const LISTS: { key: keyof Vocab; label: string }[] = [
    { key: 'fundTypes', label: 'Funds' },
    { key: 'categories', label: 'Categories' },
    { key: 'exemptReasons', label: 'Reasons a receipt is exempt' },
  ]
  const add = (k: keyof Vocab) => {
    const v = (adding[k] ?? '').trim()
    if (!v) return
    if ((draft[k] as string[]).includes(v)) { setAdding((a) => ({ ...a, [k]: '' })); return }
    setDraft({ ...draft, [k]: [...(draft[k] as string[]), v] })
    setAdding((a) => ({ ...a, [k]: '' }))
  }
  const drop = (k: keyof Vocab, v: string) =>
    setDraft({ ...draft, [k]: (draft[k] as string[]).filter((x) => x !== v) })

  const save = async () => {
    setSaving(true)
    try {
      const out = await gasAction<Vocab>('finSettingsSet', {
        fundTypes: draft.fundTypes, categories: draft.categories, exemptReasons: draft.exemptReasons,
      })
      onSaved(out)
      setDraft(out)
      toast({ type: 'success', title: 'Saved', body: 'In force on the next entry — no deploy needed.' })
    } catch (e) {
      // The server refuses a removal that would orphan money, and THAT sentence is the useful one — "try again"…
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3.5">
      {LISTS.map(({ key, label }) => (
        <div key={key}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(draft[key] as string[]).map((v) => (
              <span key={v} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12.5px] text-text-2">
                {v}
                <button type="button" onClick={() => drop(key, v)} aria-label={`Remove ${v}`}
                  className="text-text-3 transition-colors hover:text-danger">×</button>
              </span>
            ))}
            <input
              value={adding[key] ?? ''}
              onChange={(e) => setAdding((a) => ({ ...a, [key]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(key) } }}
              placeholder="add…"
              className="h-7 w-28 rounded-full border border-dashed border-border-strong bg-transparent px-2.5 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
            />
          </div>
        </div>
      ))}
      <div className="flex justify-end border-t border-border pt-3">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
          {saving && <Loader2 size={13} className="animate-spin" />} Save lists
        </button>
      </div>
    </div>
  )
}

type SyncResult = {
  dryRun: boolean; imported: number; wouldImport: number; skipped: number
  unreadable: number; unmatched: { name: string; rows: number }[]; message: string
}

// THE CARD FEED — the whole of it, in one place.
function TrueLinkPanel() {
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState('')
  const [forced, setForced] = useState(false)

  const run = async (live: boolean) => {
    if (live && !(await askConfirm({
      title: 'Run the TrueLink sync for real?',
      body: 'This logs into TrueLink, waits for the SMS code, downloads the statement and WRITES the '
        + 'new transactions into the ledger.',
      detail: 'A rehearsal does all of that except the write.',
      confirmLabel: 'Run for real',
      tone: 'danger',
    }))) return
    setBusy(live ? 'live' : 'dry')
    setError('')
    setResult(null)
    try {
      const out = await gasAction<SyncResult>('truelinkSync', live ? { dry_run: false } : {})
      setResult(out)
      // ASKED FOR REAL AND GOT A REHEARSAL.
      if (live && out.dryRun) setForced(true)
      else setForced(false)
    } catch (e) {
      // The refusals are written to be read — "set BROWSER_AUTOMATION_URL", "only one of EMAIL/PASSWORD is set"…
      setError(e instanceof Error ? e.message : 'The sync could not be started.')
    } finally { setBusy('') }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] leading-4 text-text-3">
        Logs into TrueLink, clears the SMS code on its own, downloads the statement and adds what is new.
        Re-running an overlapping period is safe — a transaction already on file is recognised by the same
        fingerprint the CSV import uses and skipped. <strong className="text-text-2">It never replaces anything.</strong>
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void run(false)} disabled={!!busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
          {busy === 'dry' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Rehearse a sync
        </button>
        <button type="button" onClick={() => void run(true)} disabled={!!busy}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40">
          {busy === 'live' ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Run for real
        </button>
        {busy && <span className="self-center text-[11.5px] text-text-3">This takes a few minutes — it is driving a browser.</span>}
      </div>

      {error && (
        <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium leading-5 text-tint-fg-pink">{error}</p>
      )}

      {forced && (
        <p className="flex items-start gap-1.5 rounded-md bg-tint-amber px-3 py-2 text-[12.5px] font-medium leading-5 text-tint-fg-amber">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            You asked for a real run and got a <strong>rehearsal</strong>. The server is forcing test mode
            (<code>TRUELINK_DRY_RUN</code>). <strong>Nothing was written.</strong> Clear that variable and recreate the
            service when you want real runs.
          </span>
        </p>
      )}

      {result && (
        <div className="space-y-1.5 rounded-md border border-border bg-surface px-3 py-2.5 text-[12.5px]">
          {/* A REHEARSAL NEVER SAYS "IMPORTED". It says what it would import —
              the same distinction `redirected` carries on the message lanes. */}
          <p className={cn('flex items-center gap-1.5 font-semibold',
            result.dryRun ? 'text-text-2' : 'text-tint-fg-mint')}>
            {result.dryRun ? <PlayCircle size={13} /> : <CheckCircle2 size={13} />}
            {result.dryRun
              ? `Rehearsal — would add ${result.wouldImport}, ${result.skipped} already on file`
              : `${result.imported} added, ${result.skipped} already on file`}
          </p>
          {result.unreadable > 0 && <p className="text-text-3">{result.unreadable} row(s) had no usable date or amount.</p>}
          {result.unmatched.length > 0 && (
            <div className="rounded-sm bg-tint-amber px-2.5 py-2 text-tint-fg-amber">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={13} /> {result.unmatched.length} cardholder name(s) are not clients here
              </p>
              {/* the name is the person and the count is not — only the name
                  half is the handle */}
              <p className="mt-0.5">
                {result.unmatched.map((u, i) => (
                  <Fragment key={`${u.name}-${i}`}>
                    {i > 0 && ' · '}
                    <DragPerson name={u.name} type="client">{u.name}</DragPerson>
                    {` (${u.rows})`}
                  </Fragment>
                ))}
              </p>
              <p className="mt-1 text-[11.5px]">
                Their rows were <strong>not</strong> added. Match the spelling on the client record, then run again.
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-[11.5px] leading-5 text-text-3">
        <strong className="text-text-2">Test mode.</strong> The rehearsal above runs the whole path for real — the
        login, the SMS code, the download, the parse, the comparison against what is already on file — and skips only
        the write. The server can also force it for everybody with <code>TRUELINK_DRY_RUN</code>, and it is ON today;
        while it is, “Run for real” rehearses and says so.
        <br /><br />
        <strong className="text-text-2">Where the settings live.</strong> The address and secret of the automation, and
        the TrueLink login, are Script Properties on this platform’s own project —
        <code> BROWSER_AUTOMATION_URL</code>, <code>BROWSER_AUTOMATION_BOT_SECRET</code>,
        <code> TRUELINK_EMAIL</code>, <code>TRUELINK_PASSWORD</code>. Nothing here echoes them, and if one is missing
        the button above says which. The server can also hold the login itself, which is the better arrangement —
        then the two Script Properties come out.
      </p>
    </div>
  )
}

export default function FinanceSection() {
  const [vocab, setVocab] = useState<Vocab | null>(null)
  const [rows, setRows] = useState<Parsed[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    gasAction<Vocab>('finClients', {})
      .then((r) => alive && setVocab(r))
      .catch(() => { /* the vocabulary panel is informational */ })
    return () => { alive = false }
  }, [])

  const usable = useMemo(() => (rows ?? []).filter((r) => r.client && r.date && r.amount), [rows])

  const readFile = (f: File | null) => {
    setResult(null); setRows(null); setProblems([]); setFileName('')
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const lines = text.split(/\r?\n/).filter((l) => l.trim())
      if (lines.length < 2) { setProblems(['That file has no rows under its header.']); return }
      const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
      const idx: Partial<Record<keyof Parsed, number>> = {}
      ;(Object.keys(FIELD_ALIASES) as (keyof Parsed)[]).forEach((k) => {
        const hit = header.findIndex((h) => FIELD_ALIASES[k].includes(h))
        if (hit >= 0) idx[k] = hit
      })
      const missing = (['client', 'date', 'amount'] as (keyof Parsed)[]).filter((k) => idx[k] === undefined)
      if (missing.length) {
        // NAMES THE COLUMNS IT WANTED. "Invalid file" sends somebody to guess.
        setProblems([`Could not find a column for: ${missing.join(', ')}.`,
                     `The header read: ${header.join(' · ')}`])
        return
      }
      const parsed: Parsed[] = []
      const bad: string[] = []
      for (let i = 1; i < lines.length; i++) {
        const c = splitCsvLine(lines[i])
        const date = normalDate(c[idx.date as number] ?? '')
        if (!date) { bad.push(`line ${i + 1}: the date "${c[idx.date as number] ?? ''}" was not understood`); continue }
        parsed.push({
          client: c[idx.client as number] ?? '',
          date,
          vendor: idx.vendor !== undefined ? (c[idx.vendor] ?? '') : '',
          amount: c[idx.amount as number] ?? '',
          postedDate: idx.postedDate !== undefined ? normalDate(c[idx.postedDate] ?? '') : '',
          location: idx.location !== undefined ? (c[idx.location] ?? '') : '',
          accountId: idx.accountId !== undefined ? (c[idx.accountId] ?? '') : '',
          accountLast4: idx.accountLast4 !== undefined ? (c[idx.accountLast4] ?? '') : '',
          cardType: idx.cardType !== undefined ? (c[idx.cardType] ?? '') : '',
        })
      }
      setRows(parsed)
      setProblems(bad.slice(0, 5))
      setFileName(f.name)
    }
    reader.readAsText(f)
  }

  const send = async () => {
    if (!usable.length || busy) return
    setBusy(true)
    try {
      const out = await gasAction<ImportResult>('finImportCard', { rows: usable })
      setResult(out)
      toast({
        type: out.imported ? 'success' : 'info',
        title: out.imported ? `${out.imported} transaction(s) imported` : 'Nothing new to import',
        body: `${out.skipped} were already on file.`,
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not imported', body: e instanceof Error ? e.message : 'Nothing was written.' })
    } finally { setBusy(false) }
  }

  return (
    <motion.section
      id="finance"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Client Finances"
          sub="What the ledger accepts, and the one thing that has to be imported."
        />

        <div className="space-y-5">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">What the ledger accepts</p>
            <p className="mb-2.5 text-[11.5px] leading-4 text-text-3">
              Add what you need. The shipped values cannot be removed, and a <strong>fund</strong> with
              transactions against it cannot be removed at all — money attached to a name that
              vanished is money nobody can total.
            </p>
            <VocabEditor vocab={vocab} onSaved={setVocab} />
          </div>

          <div className="hidden">
            <p className="mb-2.5 text-[11.5px] leading-4 text-text-3">
              Shown, not editable. A fund type is an account and a typo in one opens a second,
              invisible bucket that the month close then totals on its own — the error reaches a
              person as their balance being wrong. Changing these is a code change on purpose.
            </p>
            {!vocab ? (
              <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Loading…</p>
            ) : (
              <dl className="space-y-2 text-[12.5px]">
                {([['Funds', vocab.fundTypes], ['Transaction types', vocab.txnTypes],
                   ['Categories', vocab.categories], ['Reasons a receipt is exempt', vocab.exemptReasons]] as const)
                  .map(([label, list]) => (
                    <div key={label} className="flex flex-wrap gap-1.5">
                      <dt className="w-full text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</dt>
                      {(list ?? []).map((v) => (
                        <dd key={v} className="rounded-full bg-surface-2 px-2 py-0.5 text-text-2">{v}</dd>
                      ))}
                    </div>
                  ))}
              </dl>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Import a card export</p>
            <p className="mb-2.5 text-[11.5px] leading-4 text-text-3">
              Occasional, and nothing here depends on it: the ledger already holds the history and
              accepts everything typed into the app. This is only for the debit-card statement, which
              has no other way in. Re-uploading an overlapping range is safe — a transaction already
              on file is recognised and skipped, so nobody’s spending is counted twice.
            </p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { readFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong px-3 py-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
              <Upload size={14} /> {fileName || 'Choose the CSV export'}
            </button>

            {problems.length > 0 && (
              <div className="mt-2 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-5 text-tint-fg-amber">
                {problems.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            )}

            {rows && (
              <div className="mt-3 rounded-md border border-border bg-surface-2/50 px-3 py-2.5 text-[12.5px] text-text-2">
                <p><strong className="text-text-1">{usable.length}</strong> row(s) ready
                  {rows.length !== usable.length && <> · {rows.length - usable.length} incomplete and skipped</>}</p>
                {/* NOTHING IS WRITTEN UNTIL THIS IS PRESSED. Reading a file and
                    importing it are two decisions, and the second one is money. */}
                <button type="button" onClick={() => void send()} disabled={!usable.length || busy}
                  className="mt-2 flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                  {busy && <Loader2 size={14} className="animate-spin" />} Import {usable.length} transaction(s)
                </button>
              </div>
            )}

            {result && (
              <div className="mt-3 space-y-1.5 rounded-md border border-border bg-surface px-3 py-2.5 text-[12.5px]">
                <p className="flex items-center gap-1.5 font-semibold text-tint-fg-mint">
                  <CheckCircle2 size={13} /> {result.imported} imported · {result.skipped} already on file
                </p>
                {result.unreadable > 0 && <p className="text-text-3">{result.unreadable} row(s) had no usable date or amount.</p>}
                {result.unmatched.length > 0 && (
                  <div className="rounded-sm bg-tint-amber px-2.5 py-2 text-tint-fg-amber">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle size={13} /> {result.unmatched.length} name(s) are not clients here
                    </p>
                    {/* Named, not counted. A cardholder we do not hold is either a
                        spelling difference or somebody missing from the roster,
                        and both need a person — never an invented client. */}
                    <p className="mt-0.5">
                      {result.unmatched.map((u, i) => (
                        <Fragment key={`${u.name}-${i}`}>
                          {i > 0 && ' · '}
                          <DragPerson name={u.name} type="client">{u.name}</DragPerson>
                          {` (${u.rows})`}
                        </Fragment>
                      ))}
                    </p>
                    <p className="mt-1 text-[11.5px]">
                      Their rows were <strong>not</strong> imported. Match the spelling to the client record, or add them, then upload again.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">TrueLink card feed</p>
            <TrueLinkPanel />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Sending</p>
            <TestLane app="Client Finances" sends="the receipt chase to a house manager" />
          </div>

          <div className="border-t border-border pt-4 text-[11.5px] leading-5 text-text-3">
            <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Receipts</p>
            <p>
              Stored in <strong className="text-text-2">ASA Hub — Client Receipts</strong>, a Drive folder this
              platform creates on first use. Reading a receipt is done by Google converting the image —
              the photo never leaves Google. The total is then matched against the typed amount
              <strong className="text-text-2"> arithmetically</strong>; only when no number can be found at all
              does the extracted <em>text</em> go to the platform’s model providers (Groq first,
              set by <code>GROK_API_KEY</code>). A receipt that cannot be read is marked unreadable
              and put in front of a person — it is never guessed.
            </p>
          </div>
        </div>
      </Card>
    </motion.section>
  )
}
