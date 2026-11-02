/**
 * The published mark on the shift screens: its sentence and note. The server side is tools/test-effective-roster.py.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import {
  PUBLISHED_RING, publishedLine, publishedRoad, type PublishedMark,
} from '@/pages/features/shifts/publishedMark'
import PublishedNote from '@/pages/features/shifts/PublishedNote'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const MARK: PublishedMark = {
  at: '2026-09-23T15:00:00Z', by: 'Hana Boss', via: 'publish', state: 'pending',
  location: 'CAN - BM - BM4060',
}
const SAME_DAY = new Date('2026-09-23T18:00:00Z')
const LATER = new Date('2026-09-25T18:00:00Z')

describe('the road a published cell came by', () => {
  it('names every road the relay writes, in the board\'s words', () => {
    assert.equal(publishedRoad('publish'), 'published on Calendar Builder')
    assert.equal(publishedRoad('decision:assigned'), "given by the house manager's decision")
    assert.equal(publishedRoad('decision:approved'), "given by the house manager's decision")
    assert.equal(publishedRoad('claim:app'), 'taken from an open shift')
    assert.equal(publishedRoad('handoff'), 'swapped, with both people agreeing')
    assert.equal(publishedRoad('master_push'), 'pushed from the master grid')
    assert.equal(publishedRoad(''), 'published by the platform')
  })
})

describe('the sentence a marked cell carries', () => {
  it('says when on Ohio\'s clock (the time alone, today), by whom, and that the copy is catching up', () => {
    assert.equal(publishedLine(MARK, SAME_DAY),
      'Published on Calendar Builder at 11:00 AM by Hana Boss. Shown everywhere now, before the ' +
      'calendar copy has caught up.')
  })
  it('gives the date on another day, and says no more once the copy has read it back', () => {
    const line = publishedLine({ ...MARK, state: 'confirmed' }, LATER)
    assert.equal(line, 'Published on Calendar Builder at Sep 23, 2026, 11:00 AM by Hana Boss.')
  })
  it('names a house manager\'s decision as the decision it was', () => {
    assert.match(publishedLine({ ...MARK, via: 'decision:assigned', state: 'confirmed' }, SAME_DAY) ?? '',
      /^Given by the house manager's decision at 11:00 AM by Hana Boss\.$/)
  })
  it('says a cell typed over in the workbook afterwards is the workbook\'s word, not the publish', () => {
    assert.equal(publishedLine({ ...MARK, state: 'changed' }, SAME_DAY),
      'Changed in the house calendars workbook after it was published on Calendar Builder at ' +
      '11:00 AM by Hana Boss.')
  })
  it('says nothing for an unmarked cell, or a mark with no readable instant', () => {
    assert.equal(publishedLine(undefined, SAME_DAY), null)
    assert.equal(publishedLine(null, SAME_DAY), null)
    assert.equal(publishedLine({ ...MARK, at: '' }, SAME_DAY), null)
    assert.equal(publishedLine({ ...MARK, at: 'not a time' }, SAME_DAY), null)
  })
  it('leaves out "by" when nobody is named', () => {
    assert.equal(publishedLine({ ...MARK, by: '', state: 'confirmed' }, SAME_DAY),
      'Published on Calendar Builder at 11:00 AM.')
  })
})

describe('the note, drawn', () => {
  it('draws the sentence for a marked cell', () => {
    const html = renderToString(<PublishedNote mark={MARK} now={SAME_DAY} />)
    assert.match(html, /Published on Calendar Builder at 11:00 AM by Hana Boss/)
  })
  it('draws nothing at all for an unmarked cell', () => {
    assert.equal(renderToString(<PublishedNote mark={undefined} now={SAME_DAY} />), '')
  })
})

describe('the mark is the relay\'s own shape', () => {
  it('carries exactly the fields effective_roster._mark writes', () => {
    const relay = read('server/effective_roster.py')
    const body = relay.slice(relay.indexOf('def _mark('), relay.indexOf('def synthetic('))
    for (const field of ['"at"', '"by"', '"via"', '"state"', '"location"']) {
      assert.ok(body.includes(field), `the relay's mark writes ${field}`)
    }
    const type = read('src/pages/features/shifts/publishedMark.ts')
    for (const field of ['at: string', 'by: string', 'via: string', 'state: string', 'location?: string']) {
      assert.ok(type.includes(field), `the screen's mark reads ${field}`)
    }
  })
  it('names the relay\'s roads — the ones its writers record', () => {
    const roads = [read('server/calendar_builder_houses.py'), read('server/shift_requests.py'),
      read('server/shift_handoff.py'), read('server/calendar_builder_write.py')].join('\n')
    // a swap's road is 'handoff', written as rehearsal:handoff when the staff-answers rehearsal played it
    for (const via of ['via="publish"', 'via=f"decision:{how}"', 'via=f"claim:{via}"',
      'via=sr.rehearsed_via("handoff", _evidence(row))', '"master_push"']) {
      assert.ok(roads.includes(via), via)
    }
  })
})

describe('where a marked cell is drawn', () => {
  it('the last roster (the live calendar\'s fallback) dots it, says the sentence on hover, and keys it', () => {
    const page = read('src/pages/features/shifts/LastRosterWeek.tsx')
    assert.ok(page.includes('c?.published && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success" />'))
    assert.ok(page.includes('publishedLine(c.published)'))
    assert.ok(page.includes('Published on the platform'))
  })
  it('the live panel says it in full, where the old board\'s popover did', () => {
    const panel = read('src/pages/features/shifts/ShiftCellPanel.tsx')
    assert.ok(panel.includes('<PublishedNote mark={published} />'))
    assert.ok(panel.includes('How it got here'))
    // and the live grid dots a cell whose publish the copy has not caught up with
    assert.match(read('src/pages/features/shifts/HouseGrid.tsx'), /c\.pending && !c\.test_mode && !c\.draft && !co && \(\s*<span aria-hidden className="absolute right-1 top-1 h-1\.5 w-1\.5 rounded-full bg-success" \/>/)
  })
  it('the Cards ring the day and say the sentence on hover', () => {
    const page = read('src/pages/features/shifts/ShiftCardsPage.tsx')
    assert.ok(page.includes('w.published && PUBLISHED_RING'))
    assert.ok(page.includes('publishedLine(w.published)'))
  })
  it('the Cards\' ring is one class string', () => {
    assert.equal(PUBLISHED_RING, 'ring-1 ring-inset ring-primary')
  })
  it('the data carries it through untouched: the matrix cell and the card day both type it', () => {
    assert.ok(read('src/pages/features/shifts/useShiftData.ts').includes('published?: PublishedMark'))
    assert.ok(read('src/lib/seed-shifts2.ts').includes('published?: { at: string; by: string; via: string'))
  })
  it('and nothing on these screens reads the role or opens a browser dialog', () => {
    for (const p of ['src/pages/features/shifts/publishedMark.ts', 'src/pages/features/shifts/PublishedNote.tsx']) {
      const text = read(p)
      assert.ok(!/window\.(confirm|alert|prompt)/.test(text), p)
      assert.ok(!/\brole\b\s*===/.test(text), p)
    }
  })
})
