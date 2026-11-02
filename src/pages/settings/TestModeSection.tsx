// Settings → Test mode.
// A master admin needs one configuration they can change: either add more people to the messages and the e-mails…
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Loader2, Radio } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import CatalogueNotice, { catalogueOf, type CatalogueState } from '@/components/shared/CatalogueNotice'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { fetchAlerts } from '@/lib/hiringAlerts'

type AlertRow = { key: string; value: string; note: string; default_value: string; group: string }
type TestMode = {
  on: boolean; explicit: boolean; unrecognized?: string; sms: string[]; emails: string[]; dropped: string[]
}

// The two positions.
type Position = 'off' | 'on'

// The words the server reads as on and off (AlertsConfig.gs hubTestModeState_).
const ON_WORDS = ['on', 'true', '1', 'test', 'sheet', 'rehearsal', 'paper']
const OFF_WORDS = ['off', 'false', '0', 'production']

function positionOf(rows: AlertRow[], resolved: TestMode): Position {
  const raw = String(rows.find((r) => r.key === 'test_mode')?.value ?? '').trim().toLowerCase()
  if (ON_WORDS.includes(raw)) return 'on'
  if (OFF_WORDS.includes(raw)) return 'off'
  return resolved.on ? 'on' : 'off'
}

const INPUT_CLS =
  'w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const LABEL: Record<string, string> = {
  test_redirect_sms: 'Tester phone numbers (named only — nothing is sent to them)',
  test_redirect_email: 'Tester e-mail addresses (named only — nothing is sent to them)',
  packet_rehearsal_number: 'Rehearsal number for [test] cards',
  test_banner: 'Banner inside redirected messages',
}

// THE SAME RULE THE SERVER APPLIES (AlertsConfig.gs hubTestModeRefusal_), so the admin is told before they press…
function localRefusal(sms: string | null, emails: string | null): string {
  const list = (raw: string) => raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
  const badPhone = sms === null ? [] : list(sms).filter((s) => s.replace(/\D/g, '').replace(/^1/, '').length !== 10)
  const badMail = emails === null ? [] : list(emails).filter((s) => !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(s))
  if (badPhone.length || badMail.length)
    return `Not a usable recipient: ${[...badPhone, ...badMail].join(', ')}`
  return ''
}

export default function TestModeSection() {
  const [rows, setRows] = useState<AlertRow[] | null>(null)
  const [state, setState] = useState<TestMode | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [pos, setPos] = useState<Position>('off')
  // What the cell says right now, so the banner and `dirty` speak about the world rather than about the draft.
  const [posWas, setPosWas] = useState<Position>('off')
  // Where the keys and their notes came from — the sheet, or the last-resort copy in the code.
  const [catalogue, setCatalogue] = useState<CatalogueState | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (fetchAlerts() as Promise<{ rows: AlertRow[]; test_mode: TestMode }>)
      .then((r) => {
        if (!alive) return
        const mine = r.rows.filter((x) => x.group === 'test' && x.key !== 'test_mode')
        setRows(mine)
        setState(r.test_mode)
        setCatalogue(catalogueOf(r))
        const p = positionOf(r.rows, r.test_mode)
        setPos(p)
        setPosWas(p)
        setDraft(Object.fromEntries(mine.map((x) => [x.key, x.value])))
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load test mode.'))
    return () => { alive = false }
  }, [])

  const changed = (key: string) => {
    const row = (rows ?? []).find((r) => r.key === key)
    return !!row && (draft[key] ?? '') !== row.value
  }
  // THE POSITION IS WRITTEN WHEN IT MOVED — or when the cell was never set, or holds a word the server does not…
  const writePos = !!state && (pos !== posWas || !state.explicit || !!state.unrecognized)
  const dirty = !!state && (writePos || (rows ?? []).some((r) => changed(r.key)))
  // Both lists are checked when either is typed, as the server does; neither is when only the switch moves — the…
  const listsTouched = changed('test_redirect_sms') || changed('test_redirect_email')
  const refusal = localRefusal(
    listsTouched ? draft.test_redirect_sms ?? '' : null,
    listsTouched ? draft.test_redirect_email ?? '' : null,
  )

  const save = async () => {
    if (!rows || refusal) return
    setSaving(true)
    const values: Record<string, string> = {}
    if (writePos) values.test_mode = pos === 'on' ? 'sheet' : 'off'
    rows.forEach((r) => { if (changed(r.key)) values[r.key] = draft[r.key] ?? '' })
    try {
      await gasAction('hiringAlertsSet', { values })
      // FORCE: this read is the judge of what the save just landed, so it must never ride a request born before the…
      const back = await (fetchAlerts({ force: true }) as Promise<{ rows: AlertRow[]; test_mode: TestMode }>)
      const mine = back.rows.filter((x) => x.group === 'test' && x.key !== 'test_mode')
      setRows(mine)
      setState(back.test_mode)
      const p = positionOf(back.rows, back.test_mode)
      setPos(p)
      setPosWas(p)
      setDraft(Object.fromEntries(mine.map((x) => [x.key, x.value])))
      toast({
        type: p === 'off' ? 'success' : 'warning',
        title: p === 'on' ? 'Test mode is ON' : 'Production mode',
        body: p === 'on'
          ? 'Nothing leaves the platform, on any channel, to anybody — testers included. Every message is a row in the mock outbox.'
          : 'Messages now reach their real recipients. The sending dial follows — there is no second step.',
      })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.section
      id="testmode"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Test mode"
          sub="Walk the whole process without a single message reaching a real applicant or a real member of staff."
        />

        {error ? (
          <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
        ) : !rows || !state ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : (
          <div className="space-y-5">
            <CatalogueNotice catalogue={catalogue} />
            {/* THE ONE SWITCH, two positions. Every on word is one position:
                nothing leaves in any of them. */}
            <div className="rounded-md border border-border bg-surface-2 px-4 py-3">
              <div className="flex items-start gap-3">
                <Radio size={16} className={pos === 'off' ? 'mt-0.5 text-text-3' : 'mt-0.5 text-tint-fg-amber'} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-text-1">
                    {pos === 'on'
                      ? 'On — nothing leaves the platform; every message is a row in the mock outbox'
                      : 'Off — messages reach their real recipients'}
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-4 text-text-3">
                    {pos === 'on'
                      ? 'The emergency stop, and the only switch: no phone and no inbox is reached, testers included. Every message is written into the mock outbox (ASA Data — CommMock) and the rehearsal house, where you read what it would have said. The sending dial follows it. The only letters that still leave are a password reset and an invitation a person has just asked for.'
                      : 'Everything flows to the people it names, and the sending dial follows (send) — there is no second step.'}
                  </p>
                </div>
              </div>
              <select
                value={pos}
                onChange={(e) => setPos(e.target.value as Position)}
                className={INPUT_CLS + ' mt-3 h-9'}
              >
                <option value="off">Off — real people are reached</option>
                <option value="on">On — nothing leaves, every message is a row in the mock</option>
              </select>
            </div>

            {/* the state that is TRUE right now, not the draft */}
            {posWas === 'on' ? (
              <p className="flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>
                  <strong>Test mode is on right now.</strong> Nothing leaves on any channel — not to a
                  tester either. Every message is a row in the mock outbox.
                  {!state.explicit && ' It was inferred from the tester lists — save once to make it explicit.'}
                </span>
              </p>
            ) : null}

            {state.unrecognized ? (
              <p className="rounded-md bg-tint-pink px-3 py-2 text-[12px] leading-4 text-tint-fg-pink">
                The switch reads “{state.unrecognized}”, which is neither on nor off, so it is held as on
                and nothing leaves. Save a position to replace the word.
              </p>
            ) : null}

            {state.dropped.length > 0 && (
              <p className="rounded-md bg-tint-pink px-3 py-2 text-[12px] leading-4 text-tint-fg-pink">
                Ignored, because they do not parse: {state.dropped.join(', ')}. Nothing is sent to a tester
                any more — the lists only name them.
              </p>
            )}

            {rows.map((r) => (
              <div key={r.key}>
                <label className="mb-1 block text-[13px] font-semibold text-text-1">
                  {LABEL[r.key] ?? r.key}
                </label>
                <input
                  value={draft[r.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                  placeholder={r.key === 'test_redirect_sms' ? '+13309195558, +13307544040' : ''}
                  className={INPUT_CLS + ' h-9'}
                />
                <p className="mt-1 text-[11.5px] leading-4 text-text-3">{r.note}</p>
              </div>
            ))}

            {refusal && (
              <p className="rounded-md bg-tint-pink px-3 py-2 text-[12px] leading-4 text-tint-fg-pink">{refusal}</p>
            )}

            <div className="flex justify-end border-t border-border pt-4">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving || !!refusal}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {pos === 'on' ? 'Save — test mode on' : 'Save — production'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
