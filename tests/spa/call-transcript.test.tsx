/**
 * THE CALL TRANSCRIPT PANEL — the one Staff and Staff Candidates draw (CallTranscript over the hotline screen's
 * Transcript): our line on the left in the neutral bubble, the person on the right in the primary bubble, a run of
 * turns under one name, each bubble holding its words and its own stamp, the words wrapping inside a bubble no wider
 * than four fifths of the panel, and a header with the call's facts and Copy transcript on the right. An empty or
 * partial transcript says so.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import CallTranscript from '@/pages/features/staffprofiles/CallTranscript'
import Transcript from '@/pages/features/smartcomms/hotline/Transcript'
import { transcriptOf, type TranscriptTurn } from '@/pages/features/staffprofiles/staffModel'
import { callRowOf, companyLabel, detailOf, sidedTurns, transcriptMeta, transcriptTitle } from '@/pages/features/staffprofiles/transcriptView'

// the conversation's entrance is framer-motion's, which listens on the window
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const noop = () => {}
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const LONG = 'https://example.org/a-very-long-unbroken-link-that-would-run-past-the-right-edge-of-a-384-pixel-panel-if-nothing-wrapped-it'

const WORDS = [
  '[0:00] +13309197595: ASA human resources, this is Ann.',
  '[0:03] +13309197595: How can I help?',
  '[0:05] +13305550142: You have the wrong number? I was told to call about my shift.',
  `[0:11] +13309197595: No, you are in the right place. ${LONG}`,
  '[0:18] +13305550142: Thanks!',
].join('\n')

const answer = (over: Record<string, unknown> = {}) => transcriptOf({
  call_id: 'AC1', at: '2026-09-05T14:00:00Z', line: '+13309197595', line_name: '', direction: 'incoming', duration_sec: '65',
  full_transcript: WORDS, speaker_transcript: WORDS, has_words: true, ...over,
})

const draw = (over: Record<string, unknown> = {}, phones = ['(330) 555-0142']) =>
  flat(renderToString(<CallTranscript t={answer(over)} name="Ann Lee" source="roster" phones={phones} retry={noop} />))

/** The class list of every element carrying `attr`. */
const classesOf = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`<[a-z]+ ${attr}[^>]*class="([^"]*)"`, 'g'))].map((m) => m[1].split(/\s+/))

describe('the two sides', () => {
  it('our line on the left in the neutral bubble, the person on the right in the primary bubble', () => {
    const html = draw()
    assert.equal((html.match(/data-bubble="left"/g) ?? []).length, 3)
    assert.equal((html.match(/data-bubble="right"/g) ?? []).length, 2)
    assert.equal((html.match(/data-bubble="centre"/g) ?? []).length, 0)
    for (const cls of classesOf(html, 'data-side="left"')) assert.ok(cls.includes('items-start'), 'left runs hug the left')
    for (const cls of classesOf(html, 'data-side="right"')) assert.ok(cls.includes('items-end'), 'right runs hug the right')
    for (const cls of classesOf(html, 'data-bubble="left"')) assert.ok(cls.includes('bg-surface-2') && cls.includes('border-border'))
    for (const cls of classesOf(html, 'data-bubble="right"')) assert.ok(cls.includes('bg-primary') && cls.includes('text-on-primary'))
  })

  it('our side is the line\'s name when the line book names it, else "ASA · <number>"; the other side is the person', () => {
    const speakers = (html: string) => [...html.matchAll(/data-speaker=""[^>]*>([^<]*)</g)].map((m) => m[1])
    assert.deepEqual(speakers(draw()), ['ASA · (330) 919-7595', 'Ann Lee', 'ASA · (330) 919-7595', 'Ann Lee'])
    assert.deepEqual(speakers(draw({ line_name: 'HR line' }))[0], 'HR line')
    assert.equal(companyLabel({ line: '', lineName: '' }), 'ASA')
  })

  it('a run of turns by one speaker is named once; a two-party call with one side unrecognised still has two sides', () => {
    const html = draw()
    assert.equal((html.match(/data-speaker=""/g) ?? []).length, 4, 'five turns, four runs')
    const turns: TranscriptTurn[] = [
      { at: '0:00', speaker: '+13307544040', role: 'agent', text: 'hi' },
      { at: '0:02', speaker: '+13305550000', role: 'other', text: 'hello' },
    ]
    assert.deepEqual(sidedTurns(turns).map((t) => t.role), ['agent', 'caller'])
    assert.deepEqual(sidedTurns([{ ...turns[0], role: 'other' }, { ...turns[1], role: 'caller' }]).map((t) => t.role), ['agent', 'caller'])
    const three = [...turns, { at: '0:04', speaker: '+12165550000', role: 'other' as const, text: 'me too' }]
    assert.deepEqual(sidedTurns(three).map((t) => t.role), ['agent', 'other', 'other'], 'three voices stay as read')
    const unknown = flat(renderToString(<CallTranscript t={answer({ line: '' })} name="Ann Lee" source="roster" phones={['(330) 555-0142']} retry={noop} />))
    assert.equal((unknown.match(/data-bubble="left"/g) ?? []).length, 3, 'the line not named: the other voice is still ours')
  })
})

describe('inside each bubble', () => {
  it('the words, then a small muted stamp — never outside the bubble', () => {
    const html = draw()
    const bubbles = [...html.matchAll(/<div data-bubble="(left|right)"[^>]*>([\s\S]*?)<\/div>/g)]
    assert.equal(bubbles.length, 5)
    const stamps = bubbles.map((b) => /<p data-stamp=""[^>]*>([^<]*)<\/p>$/.exec(b[2])?.[1])
    assert.deepEqual(stamps, ['0:00', '0:03', '0:05', '0:11', '0:18'])
    assert.ok(bubbles[2][2].startsWith('<p') && bubbles[2][2].includes('You have the wrong number?'), 'the words first')
    assert.equal((html.match(/data-stamp=""/g) ?? []).length, 5, 'no stamp stands outside a bubble')
    for (const cls of classesOf(html, 'data-stamp=""')) assert.ok(cls.includes('text-[10.5px]'), 'small')
  })

  it('the words wrap inside the panel: min-w-0 all the way down, a bubble at most four fifths wide, long words broken', () => {
    const html = draw()
    assert.ok(html.includes(LONG), 'the long line is drawn whole, to wrap')
    for (const cls of classesOf(html, 'data-bubble="(?:left|right)"')) {
      assert.ok(cls.includes('min-w-0') && cls.includes('max-w-[80%]'), cls.join(' '))
      assert.ok(!cls.some((c) => /^w-\[|^min-w-\[|whitespace-nowrap|^shrink-0$/.test(c)), 'no fixed width, nothing kept on one line')
    }
    const words = [...html.matchAll(/<div data-bubble="[a-z]+"[^>]*><p class="([^"]*)"/g)].map((m) => m[1].split(/\s+/))
    assert.equal(words.length, 5)
    for (const cls of words) assert.ok(cls.includes('break-words') && cls.includes('[overflow-wrap:anywhere]') && cls.includes('whitespace-pre-wrap'))
    for (const cls of classesOf(html, 'data-side="[a-z]+"')) assert.ok(cls.includes('min-w-0'))
    assert.match(html, /<section class="min-w-0" data-transcript=""/)
    assert.match(html, /data-call-transcript="AC1" class="[^"]*\bmin-w-0\b|class="[^"]*\bmin-w-0\b[^"]*" data-call-transcript="AC1"/)
    const source = readFileSync(resolve(ROOT, 'src/pages/features/smartcomms/hotline/Transcript.tsx'), 'utf8')
    assert.ok(!/max-w-\[88%\]|overflow-x-(auto|scroll)/.test(source), 'no wider bubble, no sideways scroll')
  })
})

describe('the header and the footer', () => {
  it('the call\'s title, day, clock, length, direction and line, with Copy transcript on the right', () => {
    const html = draw({ line_name: 'HR line' })
    const header = /<header[^>]*data-transcript-header=""[^>]*>([\s\S]*?)<\/header>/.exec(html)
    assert.ok(header, 'a header block')
    const cls = /<header class="([^"]*)"/.exec(html)?.[1].split(/\s+/) ?? []
    assert.ok(cls.includes('justify-between') && cls.includes('min-w-0'))
    assert.ok(header[1].indexOf('Call with Ann Lee') < header[1].indexOf('data-copy-transcript'), 'Copy transcript after the title, on the right')
    assert.match(header[1], /<button type="button" data-copy-transcript=""[^>]*shrink-0[^>]*>[\s\S]*Copy transcript<\/button>$/)
    const meta = /data-transcript-meta=""[^>]*>([^<]*)</.exec(header[1])?.[1]
    assert.equal(meta, 'Sep 05, 2026 · 10:00 AM · 1m 05s · Incoming · HR line (330) 919-7595')
    assert.deepEqual(transcriptMeta({ at: '', durationSec: null, direction: '', line: '', lineName: '' }), [])
    assert.equal(transcriptTitle({ kind: 'Phone screen' }, 'Maria Lopez'), 'Phone screen with Maria Lopez')
    assert.match(html, /<p class="[^"]*text-\[11px\][^"]*text-text-3[^"]*">Every read of a call’s words is logged with who asked\.<\/p>/)
  })

  it('the hotline desk keeps its plain label and the copy button beside it', () => {
    const t = answer()
    const html = flat(renderToString(<Transcript call={callRowOf(t)} who={{ name: 'Ann Lee', source: 'roster' }} state={detailOf(t, [])} retry={noop} />))
    assert.ok(!html.includes('data-transcript-header') && html.includes('>Transcript</h3>') && html.includes('data-copy-transcript'))
  })
})

describe('an empty or partial transcript', () => {
  it('no words on file, words with no speakers, and an answer with nothing in it each say so — never an empty conversation', () => {
    const none = draw({ full_transcript: '', speaker_transcript: '', has_words: false })
    assert.ok(none.includes('The call has no words on file') && !none.includes('data-conversation') && !none.includes('data-copy-transcript'))
    const block = draw({ speaker_transcript: '', full_transcript: 'Words without any speaker labels at all.' })
    assert.ok(block.includes('The speaker labels could not be read, so the words are shown as one block.'))
    assert.ok(block.includes('data-transcript-block') && block.includes('Words without any speaker labels at all.'))
    assert.match(block, /class="[^"]*break-words[^"]*\[overflow-wrap:anywhere\]/)
    const empty = draw({ speaker_transcript: '', full_transcript: '', has_words: true })
    assert.ok(empty.includes('The transcript on file holds no words.'))
  })
})
