/**
 * Scheduling · House Calendars' drag and drop for a house manager and up (the operator, 2026-11-02): where the board
 * says the viewer moves shifts (viewer.drag_move), every shift not yet begun and every OPEN shift may be picked up, a
 * drop opens the side panel that reads what that drop does from the server (schedulingCellSave, via move, preview), and
 * Confirm writes it at once with the two cells the preview read. Anybody else keeps the drag that opens Swap shifts and
 * the OPEN shift panels. The feature is App Control's `scheduling.dragMove`, the master's alone until released.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { SchedulingView } from '@/pages/features/scheduling/SchedulingPage'
import DragMovePanel from '@/pages/features/scheduling/DragMovePanel'
import { moveShift, previewMove, type BoardState } from '@/pages/features/scheduling/schedulingLane'
import { boardFrom, boardNowMs, dragKeys, movesHouse, previewFrom, type Board } from '@/pages/features/scheduling/schedulingModel'
import { APP_FEATURES } from '@/lib/featureAccess'
import { SHELL_HIDDEN, primeShellHides } from '@/lib/myWorkHides'

primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false })
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const NO = { hm: false, lead: false, med: 0 }
const SHIFT = (text: string, start: number, end: number, more: Record<string, unknown> = {}) =>
  ({ text, kind: 'evening', start, end, state: 'scheduled', ...more })

function board(viewer: Record<string, unknown>): Board {
  return boardFrom({
    ok: true, now: '2026-10-03T12:00:00Z', today: '2026-10-03',
    period: { id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' },
    periods: [{ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' }],
    houses: [{ code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM', staff: 2, managers: ['Mia Manager'], open: 2 }],
    viewer: { uid: 'U1', name: 'Ann Roe', key: 'annroe', is_master: false, is_director: false, editor_of: [], can_edit_any: false, ...viewer },
    test_mode: { on: false, readable: true, why: '' }, display: { hidden: { hours: true } },
    settings: { min_days_ahead: 7, outreach_wait_min: 7, cycle_days: 28, roll_lead_days: 7, directors: ['Ty Bond'], directors_readable: true },
    grids: {
      BM4060: {
        code: 'BM4060',
        cols: [
          { iso: '2026-10-03', date: '10/3', short: 'Oct 3', weekday: 'SAT' },
          { iso: '2026-10-06', date: '10/6', short: 'Oct 6', weekday: 'TUE' },
          { iso: '2026-10-13', date: '10/13', short: 'Oct 13', weekday: 'TUE' },
        ],
        rows: [
          { row_id: 'OPEN:1', kind: 'open', name: 'OPEN', key: '', designation: '', badges: NO, me: false,
            cells: [SHIFT('12A-8A', 0, 8, { kind: 'overnight', state: 'open' }), SHIFT('4P-12A', 16, 24, { state: 'open' }), null] },
          // 8A-4P on Oct 3 began at 8:00 in Ohio (the board reads 12:00Z): never picked up
          { row_id: 'P:miamanager', kind: 'person', name: 'Mia Manager', key: 'miamanager', designation: '**',
            badges: { hm: true, lead: false, med: 3 }, me: false,
            cells: [SHIFT('8A-4P', 8, 16, { kind: 'morning' }), SHIFT('8A-4P', 8, 16, { kind: 'morning' }), { text: 'OFF', kind: 'off', state: 'scheduled' }] },
          { row_id: 'P:annroe', kind: 'person', name: 'Ann Roe', key: 'annroe', designation: '', badges: NO, me: true,
            cells: [null, null, SHIFT('4P-12A', 16, 24, { flow: { id: 'SF9', kind: 'request_off', state: 'waiting' } })] },
        ],
        days: [],
      },
    },
    busy: {}, people: [{ key: 'miamanager', name: 'Mia Manager', has_account: true }, { key: 'annroe', name: 'Ann Roe', has_account: true }],
    mine: [], waiting_on_me: [],
  })
}

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const ready = (b: Board): BoardState => ({ status: 'ready', board: b, error: '', refreshing: false })
const draw = (b: Board) => flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/scheduling/calendar?house=BM4060'] },
  createElement(SchedulingView, { state: ready(b), sessionMaster: false, onReload: () => {}, onAbsorb: () => {} }))))

describe('scheduling — drag and drop that moves at once (house manager and up)', () => {
  it('the board says the houses; nothing is worked out on the screen', () => {
    const mover = board({ drag_move: ['BM4060'] })
    assert.deepEqual(mover.viewer.drag_move, ['BM4060'])
    assert.equal(movesHouse(mover, 'BM4060'), true)
    assert.equal(movesHouse(mover, 'MS4060'), false)
    // a director or an editor the board does not name still drags into the workflows
    assert.equal(movesHouse(board({ is_director: true, editor_of: ['BM4060'] }), 'BM4060'), false)
    assert.equal('drag_move' in board({}).viewer, false)
  })

  it('a mover picks up every shift not yet begun and every OPEN shift — one a request waits on too', () => {
    const mover = board({ drag_move: ['BM4060'] })
    assert.deepEqual([...dragKeys(mover, 'BM4060', boardNowMs(mover))].sort(),
      ['OPEN:1|2026-10-03', 'OPEN:1|2026-10-06', 'P:annroe|2026-10-13', 'P:miamanager|2026-10-06'])
    // the staff's own drag is unchanged: the OPEN shifts and their own, never one a request waits on
    const staff = board({})
    assert.deepEqual([...dragKeys(staff, 'BM4060', boardNowMs(staff))].sort(), ['OPEN:1|2026-10-03', 'OPEN:1|2026-10-06'])
  })

  it('the grid draws somebody else\'s shift as one to pick up, for a mover alone', () => {
    const moverHtml = draw(board({ drag_move: ['BM4060'] }))
    assert.match(moverHtml, /data-at="P:miamanager\|2026-10-06" data-drag=""/)
    assert.doesNotMatch(moverHtml, /data-at="P:miamanager\|2026-10-03" data-drag=""/)
    assert.doesNotMatch(draw(board({})), /data-at="P:miamanager\|2026-10-06" data-drag=""/)
  })

  it('the panel reads before anything can be confirmed; closed it draws nothing', () => {
    const at = { house: 'BM4060', from_row_id: 'P:annroe', from_date: '2026-10-13', to_row_id: 'P:miamanager', to_date: '2026-10-13' }
    const open = flat(renderToString(createElement(DragMovePanel, { at, onClose: () => {}, onWrite: () => {} })))
    assert.ok(open.includes('Working out what this move does'), open)
    assert.match(open, /data-act="move-confirm" disabled=""/)
    assert.ok(open.includes('Cancel — leave the calendar as it is'))
    const shut = flat(renderToString(createElement(DragMovePanel, { at: null, onClose: () => {}, onWrite: () => {} })))
    assert.ok(!shut.includes('data-move-panel'))
  })

  it('a preview is read whole; an unknown tone only says, an unknown kind is none', () => {
    const p = previewFrom({ ok: true, preview: {
      kind: 'exchange', title: 'Exchange the shifts', blocked: '', needs_override: true, seen_from: '4P-12A', seen_to: 'OFF',
      changes: [{ row_id: 'P:annroe', name: 'Ann Roe', date: '2026-10-13', day: 'Tue 10/13', was: '4P-12A', now: '' }],
      notes: [{ tone: 'warn', text: 'Training' }, { tone: 'loud', text: 'Told' }, { tone: 'block', text: '' }],
    } })
    assert.equal(p.kind, 'exchange')
    assert.equal(p.needs_override, true)
    assert.deepEqual(p.notes, [{ tone: 'warn', text: 'Training' }, { tone: 'info', text: 'Told' }])
    assert.equal(previewFrom({ preview: { kind: 'teleport' } }).kind, '')
    assert.equal(previewFrom({}).title, 'Move shift')
  })

  it('App Control lists the feature, the master\'s alone until released', () => {
    const row = APP_FEATURES.scheduling.find((f) => f.id === 'scheduling.dragMove')
    assert.ok(row && row.masterUntilReleased === true, JSON.stringify(row))
  })
})

describe('scheduling — the drag and drop at the door', () => {
  const realFetch = globalThis.fetch
  const sent: { action: string; payload: Record<string, unknown> }[] = []
  let answer: { status: number; data?: unknown; message?: string } = { status: 200 }
  before(() => {
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }
      sent.push({ action: env.action, payload: env.payload })
      return new Response(JSON.stringify(answer))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  const at = { house: 'BM4060', from_row_id: 'OPEN:1', from_date: '2026-10-06', to_row_id: 'P:annroe', to_date: '2026-10-06' }

  it('the preview asks schedulingCellSave via move, writes nothing, and reads the server\'s answer', async () => {
    sent.length = 0
    answer = { status: 200, data: { ok: true, preview: { kind: 'assign', title: 'Give the OPEN shift', blocked: 'Not possible: Ann Roe is already at MS 8A-4P that day.',
      changes: [], notes: [{ tone: 'block', text: 'Not possible: Ann Roe is already at MS 8A-4P that day.' }], seen_from: '4P-12A', seen_to: '' } } }
    const p = await previewMove(at)
    assert.deepEqual(sent, [{ action: 'schedulingCellSave', payload: { ...at, via: 'move', preview: true } }])
    assert.equal(p.kind, 'assign')
    assert.ok(p.blocked.startsWith('Not possible'))
  })

  it('Confirm sends the two cells the preview read, and the override only when Staff Preferences spoke', async () => {
    answer = { status: 200, data: { ok: true, said: 'Give the OPEN shift: …', period_id: 'P2026-09-28', grids: {}, busy: {}, test_mode: { on: false, readable: true, why: '' } } }
    sent.length = 0
    await moveShift(at, { seen_from: '4P-12A', seen_to: '' })
    await moveShift(at, { seen_from: '4P-12A', seen_to: '' }, true)
    assert.deepEqual(sent.map((s) => s.payload), [
      { ...at, via: 'move', seen_from: '4P-12A', seen_to: '' },
      { ...at, via: 'move', seen_from: '4P-12A', seen_to: '', override: true },
    ])
  })
})
