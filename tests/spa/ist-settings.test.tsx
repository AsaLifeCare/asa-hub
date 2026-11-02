/**
 * Settings → IST, the typed editor: every declared key drawn by its type, checked as typed, with its
 * help and a reset; and the Employee Tracker painting IST and certification states from the settings.
 * The declaration and the reader are tests/spa/ist-config.test.ts; the relay is tools/test-ist-config.py.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactElement, ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import {
  IST_CONFIG_GROUPS, IST_CONFIG_KEYS, IST_CONFIG_SHIPPED, IST_CONFIG_SPEC, IST_CONFIG_FALLBACK,
  type IstConfig,
} from '@/lib/istConfig'
import IstSettingsEditor, {
  cfgHint, draftProblem, editorGroups, keepDrafts, rowSpec, storedOf, type CfgAnswer, type CfgRow,
} from '@/pages/settings/IstSettingsEditor'
import { istLook } from '@/pages/features/employeetracker/EmployeeTrackerPage'

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>

/** Every element under a node the editor returned, for the ones a test presses. */
function elementsOf(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) elementsOf(n, out); return out }
  if (!node || typeof node !== 'object' || !('props' in node)) return out
  const el = node as El
  out.push(el)
  elementsOf(el.props.children, out)
  return out
}

/** The editor's own element tree, drawn with handlers that record what they were called with. */
function pressable(a: CfgAnswer, draft: Record<string, string>) {
  const changed: [string, string][] = []
  const saved: string[] = []
  const tree = IstSettingsEditor({ answer: a, draft, busy: '', onChange: (k, v) => changed.push([k, v]),
                                   onSave: (k) => saved.push(k) })
  const all = elementsOf(tree)
  const card = (key: string) => elementsOf(all.find((e) => e.props['data-ist-key'] === key) ?? null)
  return { changed, saved, card }
}

/** istConfigGet's answer as the backend builds it from the declaration, with some cells overridden. */
function answerOf(over: Record<string, { raw: string; problem?: string }> = {}): CfgAnswer {
  const rows: CfgRow[] = IST_CONFIG_KEYS.map((key) => {
    const d = IST_CONFIG_SPEC[key]
    const o = over[key]
    return {
      key, raw: o?.raw ?? d.value, value: o && !o.problem ? o.raw : d.value, default_value: d.value,
      note: d.note, group: d.group, type: d.type, min: d.min ?? null, max: d.max ?? null,
      allowed: d.allowed ?? null, keys: d.keys ?? null, values: d.values ?? null,
      placeholders: d.placeholders ?? null, problem: o?.problem ?? '',
    }
  })
  return { rows, groups: [...IST_CONFIG_GROUPS], unknown_rows: [], tab: 'ist_config', source: 'sheet',
           blind: false, blind_reason: '' }
}

const draftOf = (a: CfgAnswer, over: Record<string, string> = {}) =>
  ({ ...Object.fromEntries(a.rows.map((r) => [r.key, r.value])), ...over })

const draw = (a: CfgAnswer, draft: Record<string, string>) => renderToString(
  <IstSettingsEditor answer={a} draft={draft} busy="" onChange={() => {}} onSave={() => {}} />)

/** The markup of one key's card. */
function cardOf(html: string, key: string): string {
  const at = html.indexOf(`data-ist-key="${key}"`)
  assert.ok(at !== -1, `${key} is not drawn`)
  const next = html.indexOf('data-ist-key="', at + 10)
  return html.slice(at, next === -1 ? undefined : next)
}

describe('the typed editor', () => {
  const a = answerOf()
  const html = draw(a, draftOf(a))

  it('draws every declared key, under every declared group — the first-shift rules included', () => {
    for (const k of IST_CONFIG_KEYS) cardOf(html, k)
    for (const g of IST_CONFIG_GROUPS) assert.ok(html.includes(`data-ist-group="${g.id}"`), g.id)
    assert.ok(html.includes('data-ist-group="first_shift"'))
  })

  it('draws each key by its type: a number, a yes/no, a choice, a course, free text', () => {
    assert.match(cardOf(html, 'ist_valid_days'), /type="number"[^>]*min="0"[^>]*max="3650"/)
    assert.match(cardOf(html, 'ist_trainer_must_be_free'), /<select[^>]*data-ist-input="yesno"/)
    assert.match(cardOf(html, 'ist_trained_scope'), /data-ist-input="choice"[\s\S]*>client</)
    assert.match(cardOf(html, 'ist_gate_certification'), /data-ist-input="course"[\s\S]*>mandt</)
    assert.match(cardOf(html, 'ist_cert_source_fields'), /<textarea[^>]*data-ist-input="pairs"/)
    assert.match(cardOf(html, 'ist_note_expired'), /data-ist-input="template"/)
  })

  it('carries each key\'s help, what it takes, and its declared value', () => {
    const card = cardOf(html, 'ist_valid_days')
    assert.ok(card.includes('A whole number.'))
    assert.ok(card.includes('0 to 3650'))
    assert.ok(card.includes('never lapses'))
    assert.match(card, /Default: <code>0<\/code>/)
    assert.equal(cfgHint(rowSpec(a.rows.find((r) => r.key === 'ist_trainer_when_no_hm')!)),
      'One of: approver, refuse.')
  })

  it('offers the reset only where the value differs from the declared one', () => {
    assert.ok(!cardOf(html, 'ist_valid_days').includes('Reset to default'))
    const edited = answerOf({ ist_valid_days: { raw: '365' } })
    assert.ok(cardOf(draw(edited, draftOf(edited)), 'ist_valid_days').includes('Reset to default'))
  })

  it('says why a draft would be refused, as it is typed, and disables its save', () => {
    const card = cardOf(draw(a, draftOf(a, { ist_valid_days: '99999' })), 'ist_valid_days')
    assert.match(card, /data-ist-problem/)
    assert.match(card, /whole number from 0 to 3650/)
    assert.match(card, /<button[^>]*disabled=""[^>]*>[\s\S]*Save/)
    assert.equal(draftProblem('ist_trained_scope', { ist_trained_scope: 'everyone' }) !== '', true)
  })

  it('checks one key against the cells as SAVED, because one key is saved at a time', () => {
    // the course list's edit is only a draft: the gate would be refused by the door, and says why
    const unsaved = draftProblem('ist_gate_certification',
      { ist_gate_certification: 'bbp', ist_cert_labels: 'dodd=D, bbp=B' }, a)
    assert.match(unsaved, /not a course in the course list/)
    assert.match(unsaved, /save ist_cert_labels first/)
    // a course the tab already carries (added in an earlier session) is a valid gate here
    const added = answerOf({ ist_cert_labels: { raw: `${IST_CONFIG_SHIPPED.ist_cert_labels}, fa=First Aid` } })
    assert.equal(draftProblem('ist_gate_certification', draftOf(added, { ist_gate_certification: 'fa' }), added), '')
    assert.match(cardOf(draw(added, draftOf(added)), 'ist_gate_certification'), />fa</)
  })

  it('refuses a course list that would orphan the gate, naming the gate', () => {
    const problem = draftProblem('ist_cert_labels', draftOf(a, { ist_cert_labels: 'cpr=CPR' }), a)
    assert.match(problem, /ist_gate_certification: "dodd" would no longer name a course/)
  })

  it('never saves a blank cell quietly — it says to use the reset instead', () => {
    const card = cardOf(draw(a, draftOf(a, { ist_page_size: '' })), 'ist_page_size')
    assert.match(card, /Use Reset to default/)
    assert.match(card, /<button[^>]*disabled=""[^>]*>[\s\S]*Save/)
  })

  it('pressing Reset hands the declared value to the draft, and Save saves that key', () => {
    const edited = answerOf({ ist_valid_days: { raw: '365' } })
    const { changed, card } = pressable(edited, draftOf(edited))
    const reset = card('ist_valid_days').find((e) => e.props['data-ist-reset'])
    assert.ok(reset, 'no reset on an edited cell')
    ;(reset.props.onClick as () => void)()
    assert.deepEqual(changed, [['ist_valid_days', '0']])
    const draftAfter = draftOf(edited, { ist_valid_days: '0' })
    const again = pressable(edited, draftAfter)
    const save = again.card('ist_valid_days').find((e) => e.props['data-ist-save'])
    assert.equal(save?.props.disabled, false)
    ;(save!.props.onClick as () => void)()
    assert.deepEqual(again.saved, ['ist_valid_days'])
  })

  it('a tab that could not be read turns every Save off', () => {
    const blind = { ...answerOf(), blind: true, source: 'last known' }
    const { card } = pressable(blind, draftOf(blind, { ist_valid_days: '30' }))
    assert.equal(card('ist_valid_days').find((e) => e.props['data-ist-save'])?.props.disabled, true)
  })

  it('names a cell the tab holds that the declaration refused, and lets it be saved to fix it', () => {
    const refused = answerOf({ ist_trained_scope: { raw: 'everyone', problem: 'takes one of house, client' } })
    const card = cardOf(draw(refused, draftOf(refused)), 'ist_trained_scope')
    assert.match(card, /reads “(<!-- -->)?everyone(<!-- -->)?” and is refused/)
    assert.match(card, /declared value answers until the cell is fixed/)
    assert.doesNotMatch(card, /<button[^>]*disabled=""[^>]*>[\s\S]*Save/)
  })

  it('a refused cell whose usable entries answer says what the platform uses meanwhile', () => {
    const partial = answerOf({ ist_status_tints: { raw: 'owed=fuchsia, done=green', problem: 'owed=fuchsia — the value must be one of …' } })
    partial.rows = partial.rows.map((r) => (r.key === 'ist_status_tints' ? { ...r, value: 'done=green' } : r))
    assert.match(cardOf(draw(partial, draftOf(partial)), 'ist_status_tints'),
      /uses meanwhile: “(<!-- -->)?done=green/)
  })

  it('a re-read keeps an unsaved edit on another key, and gives the key just saved the tab\'s value', () => {
    const before = answerOf().rows
    const after = answerOf({ ist_cert_labels: { raw: `${IST_CONFIG_SHIPPED.ist_cert_labels}, fa=First Aid` } }).rows
    const draft = { ...draftOf(answerOf()), ist_gate_certification: 'cpr',
                    ist_cert_labels: `${IST_CONFIG_SHIPPED.ist_cert_labels}, fa=First Aid` }
    const next = keepDrafts(before, after, draft, ['ist_cert_labels'])
    assert.equal(next.ist_gate_certification, 'cpr')
    assert.equal(next.ist_cert_labels, after.find((r) => r.key === 'ist_cert_labels')!.value)
    assert.equal(next.ist_valid_days, '0')
    assert.equal(storedOf(answerOf({ ist_page_size: { raw: '40' } })).ist_page_size, '40')
  })

  it('a group only the backend knows is still drawn, never dropped', () => {
    const extra = answerOf()
    extra.rows = [...extra.rows, { ...extra.rows[0], key: 'ist_from_the_future', group: 'future' }]
    assert.ok(editorGroups(extra).some((g) => g.id === 'future'))
    assert.ok(draw(extra, draftOf(extra)).includes('data-ist-group="future"'))
  })
})

describe('the Employee Tracker paints from the settings', () => {
  const asRead = (over: Record<string, string> = {}): IstConfig => ({
    ...IST_CONFIG_FALLBACK, values: { ...IST_CONFIG_SHIPPED, ...over }, source: 'sheet', blind: false,
  })

  it('the shipped settings paint exactly what the page always painted', () => {
    const look = istLook(asRead())
    assert.equal(look.istCls('owed'), 'bg-tint-amber text-tint-fg-amber')
    assert.equal(look.istCls('done'), 'bg-tint-mint text-tint-fg-mint')
    assert.equal(look.istSoft('owed'), 'bg-tint-amber/60 text-tint-fg-amber')
    assert.equal(look.certCls('missing'), 'bg-surface-2 text-text-3')
    assert.equal(look.certCls('expired'), 'bg-tint-pink text-tint-fg-pink')
  })

  it('an edited colour reaches the chips', () => {
    const look = istLook(asRead({ ist_status_tints: 'owed=pink, done=green',
                                  ist_cert_status_tints: 'expiring=peach' }))
    assert.equal(look.istCls('owed'), 'bg-tint-pink text-tint-fg-pink')
    assert.equal(look.istSoft('owed'), 'bg-tint-pink/60 text-tint-fg-pink')
    assert.equal(look.certCls('expiring'), 'bg-tint-peach text-tint-fg-peach')
    assert.equal(look.certCls('missing'), 'bg-surface-2 text-text-3')
  })

  it('ist_valid_days decides whether a completed row is still owed', () => {
    const row = { status: 'done', trainedAt: '2020-01-01' }
    assert.equal(istLook(asRead()).owed(row), false)
    assert.equal(istLook(asRead({ ist_valid_days: '365' })).owed(row), true)
  })
})
