/**
 * The Recruiting page (recruitLogic.ts, SmartCommsRecruitingPage.tsx) and the Desk's "Sends from" cell:
 * chips read off the sources, sentences, unreadable sources. Server sides: test-recruit-book.py and the self-test.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import {
  MESSAGE_COLUMNS, RESOURCE, SCREEN_COLUMNS, SITUATION_LABEL, countWords, messageChip, messageCopy,
  messageSentence, screenChip, splitRows, statusSentences,
  type RecruitMessage, type RecruitRow, type RecruitScreen, type RecruitStatus,
} from '@/pages/features/smartcomms/recruitLogic'
import { RecruitingView } from '@/pages/features/smartcomms/SmartCommsRecruitingPage'

const ROOT = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const GS = read('apps-script/CommRecruit.gs')
const PY = read('server/recruit_book.py')

function draw(node: Parameters<typeof renderToString>[0]): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderToString(node)
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

const status = (over: Partial<RecruitStatus> = {}): RecruitStatus => ({
  row_kind: 'status', id: 'status', source_state: 'read', source_why: '', source_at: '2026-09-23T11:00:00Z',
  source_modified_at: '', keeper_at: '', copy_at: '2026-09-23T12:05:00Z',
  copy_counts: { recruit_pipeline: 1700, recruit_onboarding: 253 },
  houses: [{ tab: 'recruit_pipeline', title: 'ASA Data — RecruitPipeline', state: 'written', rows: 1700,
             proved_at: 'x', why: '' }],
  birth_at: '2026-09-23T12:05:00Z', baseline: 253, cards_state: 'read', cards_why: '', cards_at: '',
  last_pass_at: '', last_post_at: '', last_post_why: '',
  counts: { hiring_screen_day_reminder: { recorded: 2 } }, planned_at: '', held_why: '', ...over,
})
const screen = (over: Partial<RecruitScreen> = {}): RecruitScreen => ({
  row_kind: 'screen', id: 'RB-1', day: 'today', first_name: 'Ann', name: 'Ann Able', last4: '0101',
  screener: 'Tieara', time: '11AM', location: '1305 49th St, NW, Canton', status: '3 - In Person',
  verdict: 'recorded', why: 'the sending dial stands at `record`: nobody was contacted', state: 'recorded',
  source: 'TP-1684', ...over,
})
const message = (over: Partial<RecruitMessage> = {}): RecruitMessage => ({
  row_kind: 'message', id: 'RB-2', situation: 'hiring_onboarding_start', first_name: 'Ben', name: 'Ben Baker',
  last4: '0102', state: 'recorded', why: 'nobody was contacted', first_seen: '2026-09-23T12:05:00Z',
  said_at: '2026-09-23T12:05:05Z', count: 1, detail: '', source: 'OC-252', ...over,
})
const WORDS = 'Hello Ben, this is Arthur from Asa Life Care. Welcome aboard — your onboarding starts here.'
/** A text the dial held, as the door answers it: the copy the mock outbox row carries. */
const held = (over: Partial<RecruitMessage> = {}): RecruitMessage => message({
  state: 'recorded', words: WORDS, to_masked: '•••0102', line: 'Administration', channel: 'sms',
  why: 'the sending dial stands at `record`, not `send`: the candidate on the recruiters\' book was resolved (1) '
    + 'and written down, and NOBODY WAS CONTACTED.',
  ...over,
})

describe('every answer and every verdict has its own chip', () => {
  it('reads the door\'s answers off CommRecruit.gs and finds a chip for each', () => {
    const answers = new Set<string>()
    for (const m of GS.matchAll(/done\('([a-z_]+)'/g)) answers.add(m[1])
    for (const m of GS.matchAll(/state: '([a-z_]+)'/g)) answers.add(m[1])
    assert.ok(answers.size >= 12, `found only ${[...answers].join(', ')}`)
    for (const s of answers) assert.notEqual(messageChip(s).label, s, `"${s}" has no chip of its own`)
  })
  it('reads the relay\'s own states and verdicts off recruit_book.py and finds a chip for each', () => {
    const states = new Set<string>()
    for (const set of ['FINAL', 'NOT_NOW']) {
      const block = new RegExp(`${set} = frozenset\\(\\{([\\s\\S]*?)\\}\\)`).exec(PY)
      assert.ok(block, `${set} not found in recruit_book.py`)
      for (const m of block![1].matchAll(/"([a-z_]+)"/g)) states.add(m[1])
    }
    assert.ok(states.size >= 18, `found only ${[...states].join(', ')}`)
    for (const s of states) assert.notEqual(messageChip(s).label, s, `"${s}" has no chip of its own`)
    const verdicts = new Set<string>()
    for (const m of PY.matchAll(/v\["verdict"\], v\["why"\] = "([a-z_]+)"/g)) verdicts.add(m[1])
    assert.ok(verdicts.size >= 6, `found only ${[...verdicts].join(', ')}`)
    for (const v of verdicts) assert.notEqual(screenChip(v).label, v, `"${v}" has no chip of its own`)
  })
})

describe('the sentence under a text', () => {
  it('says the text was sent only when it reached the person', () => {
    assert.match(messageSentence(message({ state: 'told' })).text, /was sent — nobody needs to text it by hand/)
    for (const s of ['recorded', 'rehearsed', 'redirected', 'held', 'failed', 'offered', 'refused_quiet',
                     'dial_unknown', 'gave_up', 'opted_out', 'hub_card', 'stale', 'shared_line']) {
      assert.doesNotMatch(messageSentence(message({ state: s })).text, / was sent\b/, s)
    }
  })
  it('says NOBODY WAS CONTACTED whenever nothing left, and names the mock outbox in test mode', () => {
    const rec = messageSentence(message({ state: 'recorded' })).text
    assert.match(rec, /mock outbox \(ASA Data — CommMock\)/)
    assert.match(rec, /NOBODY WAS CONTACTED/)
    assert.match(rec, /not sent later/)
    for (const s of ['held', 'failed', 'gave_up', 'opted_out', 'hub_card', 'no_number']) {
      assert.match(messageSentence(message({ state: s })).text, /NOBODY WAS CONTACTED|NOT contacted/, s)
    }
    assert.match(messageSentence(message({ state: 'redirected' })).text, /candidate was NOT contacted/)
  })
  it('counts in words and leaves the baseline out', () => {
    assert.equal(countWords({ told: 1, recorded: 3, baseline: 250 }), '3 recorded — not sent, 1 told')
    assert.equal(countWords(undefined), 'nothing yet')
  })
})

describe('the copy of a text that was held', () => {
  it('shows the words, the number and the line, under a heading that does not say they went', () => {
    const copy = messageCopy(held())
    assert.equal(copy.kind, 'words')
    if (copy.kind !== 'words') return
    assert.equal(copy.words, WORDS)
    assert.equal(copy.heading, 'What would have gone')
    assert.equal(copy.went, false)
    assert.equal(copy.where, 'sms · to •••0102 · from Administration')
  })
  it('a text that really went reads as sent, and one sent to the testers says so', () => {
    const told = messageCopy(held({ state: 'told', why: '' }))
    assert.equal(told.kind === 'words' && told.heading, 'What was sent')
    assert.equal(told.kind === 'words' && told.went, true)
    const testers = messageCopy(held({ state: 'redirected' }))
    assert.equal(testers.kind === 'words' && testers.heading, 'What went to the testers')
  })
  it('a text that had already gone under this occasion reads as gone, as its chip and sentence say', () => {
    const dup = messageCopy(held({ state: 'duplicate', why: 'this exact text already went' }))
    assert.equal(dup.kind === 'words' && dup.heading, 'What had already gone')
    assert.equal(dup.kind === 'words' && dup.went, true)
    assert.equal(messageChip('duplicate').label, 'Already sent')
  })
  it('a copy the door says it composed but whose words did not come back is said in words — never an empty message', () => {
    const copy = messageCopy(held({ words: '' }))
    assert.equal(copy.kind, 'missing')
    assert.match(copy.kind === 'missing' ? copy.text : '', /could not be read, not a text that said nothing/)
    assert.equal(messageCopy(held({ words: '', channel: '', words_chars: 120 })).kind, 'missing')
  })
  it('a state decided before the words existed shows no copy at all', () => {
    for (const s of ['refused_quiet', 'dial_off', 'dial_unknown', 'no_number', 'stale', 'hub_card', 'owed']) {
      assert.equal(messageCopy(message({ state: s, words: '' })).kind, 'none', s)
    }
  })
  it('held, failed and gave_up answered before any words were composed claim no unreadable copy', () => {
    // a row off on the Desk, the time budget, a door nobody reached: the door set no channel
    for (const s of ['held', 'failed', 'gave_up']) {
      assert.equal(messageCopy(message({ state: s, words: '', channel: '' })).kind, 'none', s)
    }
  })
  it('a held text the door composed was held by the send door — its sentence never says the row is off', () => {
    const gated = messageSentence(held({ state: 'held', why: 'HUB_RPC_SEND is off' })).text
    assert.match(gated, /The send door held the onboarding start — NOBODY WAS CONTACTED/)
    assert.doesNotMatch(gated, /off on the Desk/)
    assert.match(messageSentence(message({ state: 'held', channel: '' })).text, /The row is off on the Desk/)
  })
  it('a row written before the door answered any copy claims none — whatever its state', () => {
    for (const s of ['told', 'recorded', 'rehearsed', 'redirected', 'duplicate', 'opted_out', 'held', 'failed']) {
      assert.equal(messageCopy(message({ state: s })).kind, 'none', s)
    }
  })
  it('falls back to the last four digits and the default line when the door named neither', () => {
    const copy = messageCopy(held({ to_masked: '', line: '', channel: '' }))
    assert.equal(copy.kind === 'words' && copy.where, 'sms · to •••0102 · from the Automations line')
  })
  it('a line named by its number reads formatted, on the card and in the export', () => {
    const copy = messageCopy(held({ line: '+13309195558' }))
    assert.equal(copy.kind === 'words' && copy.where, 'sms · to •••0102 · from (330) 919-5558')
    const line = MESSAGE_COLUMNS.find((c) => c.key === 'line')!
    assert.equal(String(line.accessor!(held({ line: '+13309195558' }))), '(330) 919-5558')
    assert.equal(String(line.accessor!(held())), 'Administration')
  })
  it('a copy cut short says how much of it is shown; a whole one says nothing of the kind', () => {
    const cut = messageCopy(held({ words_chars: 4512 }))
    assert.equal(cut.kind, 'words')
    assert.match(cut.kind === 'words' ? cut.cut : '', new RegExp(`first ${WORDS.length} of its 4,512 characters`))
    const whole = messageCopy(held({ words_chars: WORDS.length }))
    assert.equal(whole.kind === 'words' && whole.cut, '')
    const trailing = messageCopy(held({ words: `${WORDS}\n`, words_chars: WORDS.length + 1 }))
    assert.equal(trailing.kind === 'words' && trailing.cut, '')
    const noLength = messageCopy(held({ words_chars: undefined }))
    assert.equal(noLength.kind === 'words' && noLength.cut, '')
  })
  it('the relay carries the copy on the message row, and the door answers it', () => {
    assert.match(PY, /MESSAGE_FIELDS = \([\s\S]*?"words", "words_chars", "to_masked", "line", "channel"\)/)
    assert.match(PY, /COPY_FIELDS = \(\("words", 4000\), \("to_masked", 40\), \("line", 80\), \("channel", 20\)\)/)
    assert.match(GS, /var RECRUIT_WORDS_MAX = 4000;/)
    assert.match(GS, /res\.words = String\(body\)\.slice\(0, RECRUIT_WORDS_MAX\)/)
    assert.match(GS, /res\.words_chars = String\(body\)\.length/)
    assert.match(GS, /res\.to_masked = \(typeof rpcMaskTo_ === 'function'\) \? rpcMaskTo_\(num\.to\) : ''/)
    assert.ok(GS.indexOf("res.channel = 'sms'") > GS.indexOf('var body = smartRender_'),
      'the channel marks a composed copy only once the words exist')
  })
})

describe('what the lane could not see is said', () => {
  it('a file with no state says the page cannot say what would be sent', () => {
    assert.match(statusSentences(null)[0].text, /cannot say what it would send/)
  })
  it('a book that could not be read says why and that nothing is emptied', () => {
    const t = statusSentences(status({ source_state: 'unread', source_why: 'the keeper cannot see it' }))
      .map((s) => s.text).join(' ')
    assert.match(t, /could not be read — the keeper cannot see it/)
    assert.match(t, /nothing is emptied/)
    assert.match(t, /NOTHING is texted from it/)
  })
  it('a hiring board nobody can read means nothing is offered, and a house not minted is named', () => {
    const t = statusSentences(status({
      cards_state: 'unread', cards_why: 'the hiring board\'s file is too old',
      houses: [{ tab: 'recruit_onboarding', title: 'ASA Data — RecruitOnboarding', state: 'no_house', rows: 0,
                 proved_at: '', why: 'run tools/mint_recruit_houses.py' }],
    })).map((s) => s.text).join(' ')
    assert.match(t, /NOTHING is offered until it can/)
    assert.match(t, /RecruitOnboarding is not minted yet/)
  })
  it('splits the file by kind and never invents a state row', () => {
    const got = splitRows([screen(), message(), status()] as RecruitRow[])
    assert.equal(got.status?.row_kind, 'status')
    assert.equal(got.screens.length, 1)
    assert.equal(got.messages.length, 1)
    assert.equal(splitRows([screen()] as RecruitRow[]).status, null)
    assert.equal(splitRows(null).status, null)
  })
})

describe('Share, Export and Print carry the lists as shown', () => {
  it('the state column is the chip and the last columns are the sentence and the row on the book', () => {
    const state = MESSAGE_COLUMNS.find((c) => c.label === 'State')!
    const what = MESSAGE_COLUMNS.find((c) => c.label === 'What happened')!
    assert.equal(String(state.accessor!(message({ state: 'told' }))), 'Told')
    assert.match(String(what.accessor!(message())), /NOBODY WAS CONTACTED/)
    const words = MESSAGE_COLUMNS.find((c) => c.label === 'Words')!
    assert.equal(String(words.accessor!(held())), WORDS)
    assert.match(String(words.accessor!(held({ words: '' }))), /could not be read/)
    assert.equal(String(words.accessor!(message({ state: 'dial_off', words: '' }))), '')
    assert.equal(String(words.accessor!(message({ state: 'held', words: '', channel: '' }))), '')
    assert.match(String(words.accessor!(held({ words_chars: 4512 }))),
      new RegExp(`^${WORDS} … \\(Only the first ${WORDS.length} of its 4,512 characters were kept`))
    assert.ok(MESSAGE_COLUMNS.some((c) => c.key === 'to_masked') && MESSAGE_COLUMNS.some((c) => c.key === 'line'))
    const rem = SCREEN_COLUMNS.find((c) => c.label === 'Reminder')!
    assert.equal(String(rem.accessor!(screen({ verdict: 'owed' }))), 'Due now')
    assert.ok(!SCREEN_COLUMNS.some((c) => /phone$/i.test(c.key)), 'a column may carry the last four digits, never a number')
  })
})

describe('the page draws', () => {
  it('draws the lane\'s state, the screens with their verdicts, and each text with what happened', () => {
    const html = draw(<RecruitingView rows={[status(), screen(), message()] as RecruitRow[]} />)
    assert.match(html, /What the lane can see/)
    assert.match(html, /1700 Talent Pipeline and 253 Onboarding Checklist rows/)
    assert.match(html, /Tieara/)
    assert.match(html, /Recorded — not sent/)
    assert.match(html, /NOBODY WAS CONTACTED/)
    assert.match(html, /•••0101/)
    for (const label of Object.values(SITUATION_LABEL)) assert.match(html, new RegExp(label))
  })
  it('draws a held text with its words, its number, its line and its reason — and never as sent', () => {
    const html = draw(<RecruitingView rows={[status(), held()] as RecruitRow[]} />)
    assert.match(html, /What would have gone/)
    assert.match(html, /Welcome aboard/)
    assert.match(html, /sms · to •••0102 · from Administration/)
    assert.match(html, /NOBODY WAS CONTACTED/)
    assert.doesNotMatch(html, /What was sent/)
    assert.doesNotMatch(html, /went to the testers/)
  })
  it('draws a text that really went as sent, with the same words under it', () => {
    const html = draw(<RecruitingView rows={[status(), held({ state: 'told', why: '' })] as RecruitRow[]} />)
    assert.match(html, /What was sent/)
    assert.match(html, /Welcome aboard/)
    assert.match(html, /was sent — nobody needs to text it by hand/)
  })
  it('a text whose copy did not come back says so instead of drawing an empty message', () => {
    const html = draw(<RecruitingView rows={[status(), held({ words: '' })] as RecruitRow[]} />)
    assert.match(html, /did not come back with the answer/)
    assert.doesNotMatch(html, /What would have gone/)
  })
  it('a row switched off on the Desk says it is off — and claims no copy that could not be read', () => {
    const html = draw(<RecruitingView rows={[status(), message({
      state: 'held', words: '', channel: '', why: 'the situation hiring_onboarding_start is off on the Desk',
    })] as RecruitRow[]} />)
    assert.match(html, /The row is off on the Desk/)
    assert.doesNotMatch(html, /could not be read, not a text/)
    assert.doesNotMatch(html, /What would have gone/)
  })
  it('a copy cut short is drawn with the sentence that says so', () => {
    const html = draw(<RecruitingView rows={[status(), held({ words_chars: 4512 })] as RecruitRow[]} />)
    assert.match(html, /Welcome aboard/)
    assert.match(html, /of its 4,512 characters were kept — the rest is not shown here/)
  })
  it('a file that did not answer is not zeros, and a book that could not be read is not an empty day', () => {
    assert.match(draw(<RecruitingView rows={null} />), /could not be seen, not an empty one/)
    const blind = draw(<RecruitingView rows={[status({ source_state: 'unread', source_why: 'x' })] as RecruitRow[]} />)
    assert.match(blind, /this is not an empty day/)
    assert.doesNotMatch(blind, /has no in-person screen today/)
  })
  it('reads the relay\'s file, writes nothing, asks no browser dialog, and uses the platform\'s own controls', () => {
    const src = read('src/pages/features/smartcomms/SmartCommsRecruitingPage.tsx')
    assert.match(src, /readSlice<RecruitRow>\(RESOURCE\)/)
    assert.doesNotMatch(src, /gasAction\(/)
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(/)
    assert.match(src, /share\(\{/)
    assert.match(src, /<ExportMenu /)
    assert.match(src, /window\.print\(\)/)
    assert.match(src, /<PageSwitch \/>/)
  })
  it('is the resource the relay builds, registered as a page of the app and routed', () => {
    assert.equal(RESOURCE, 'recruitBook')
    assert.match(PY, /RESOURCES = \("recruitBook",\)/)
    const reg = read('src/registry/apps-notifications.ts')
    assert.match(reg, /id: 'recruiting', type: 'sheet', title: 'Recruiting texts'[\s\S]{0,120}resource: 'recruitBook'/)
    assert.match(read('src/pages/AppRoutePage.tsx'), /'smartcomms\/recruiting': SmartCommsRecruitingPage/)
  })
})

describe('the Desk\'s "Sends from" cell', () => {
  it('is editable on every row, says where a blank one leaves from, and shows on the card', () => {
    const desk = read('src/pages/features/smartcomms/SmartCommsPage.tsx')
    assert.match(desk, /set\('from_line', e\.target\.value\)/)
    assert.match(desk, /Blank: texts leave from the Automations line/)
    assert.match(desk, /label=\{`from \$\{formatPhoneDisplay\(String\(s\.from_line\)\.trim\(\)\)\}`\}/)
  })
  it('the three rows each have a caption and a reach card on the Desk', () => {
    const desk = read('src/pages/features/smartcomms/SmartCommsPage.tsx')
    for (const id of Object.keys(SITUATION_LABEL)) {
      assert.ok((desk.match(new RegExp(`\\b${id}: `, 'g')) || []).length >= 2, `${id} lacks a caption or a reach card`)
    }
  })
})
