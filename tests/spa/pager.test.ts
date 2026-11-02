/**
 * usePager (src/lib/pager.ts) — the default every paged screen has always had,
 * and the kept page only Daily asks for.
 *
 * THE DEFAULT IS THE CONTRACT OF A DOZEN SCREENS. Staff Issues, Compliance,
 * System Logs, the Hiring archive, the client lists, Time Recon, the Employee
 * Tracker, Settings → Users all call usePager without `keep`, and each of
 * them must behave exactly as before: page 1 on mount, page 1 when the
 * reset key moves, clamped when the list shrinks, React's own setter, and the
 * page gone when the screen unmounts.
 */
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_KEPT_PAGES, PAGE_SIZE, anchorOf, forgetKeptPages, keepPage, pageCount, readKeptPage, resumePage, usePager,
  type PagerKeep,
} from '@/lib/pager'
import { forgetAllKept } from '@/lib/kept'
import { mountHook } from './react-host'

/** 'r0' is the newest, as every newest-first list in the platform orders it. */
const rows = (n: number, prefix = 'r') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
const self = (s: string) => s

type Props = { items: string[]; size?: number; reset?: unknown; keep?: PagerKeep<string> }
const usePagerOf = ({ items, size, reset, keep }: Props) => usePager(items, size ?? PAGE_SIZE, reset, keep)

beforeEach(() => forgetKeptPages())

describe('pageCount', () => {
  it('an empty list is one page, so "page 1 of 1" holds', () => {
    assert.equal(pageCount(0, 20), 1)
  })
  it('counts whole pages and the remainder', () => {
    assert.equal(pageCount(20, 20), 1)
    assert.equal(pageCount(21, 20), 2)
    assert.equal(pageCount(11, 1), 11)
  })
})

describe('usePager — the default, as every other screen calls it', () => {
  it('opens on page 1 with the first slice', () => {
    const h = mountHook(usePagerOf, { items: rows(45), reset: 'q' })
    const p = h.current
    assert.equal(p.page, 0)
    assert.equal(p.pages, 3)
    assert.deepEqual(p.slice, rows(20))
    assert.deepEqual([p.from, p.to, p.total], [1, 20, 45])
    h.unmount()
  })

  it('moves with setPage and returns to page 1 when the reset key moves', () => {
    const items = rows(45)
    const h = mountHook(usePagerOf, { items, reset: 'a' })
    h.run(() => h.current.setPage(2))
    assert.equal(h.current.page, 2)
    assert.deepEqual(h.current.slice, ['r40', 'r41', 'r42', 'r43', 'r44'])
    assert.deepEqual([h.current.from, h.current.to], [41, 45])
    h.rerender({ items, reset: 'b' })
    assert.equal(h.current.page, 0)
    h.rerender({ items, reset: 'a' })
    assert.equal(h.current.page, 0, 'going back to the earlier key does not bring its page back')
    h.unmount()
  })

  it('a list that shrinks under the page lands on its last page, not an empty one', () => {
    const h = mountHook(usePagerOf, { items: rows(45), reset: 'a' })
    h.run(() => h.current.setPage(2))
    h.rerender({ items: rows(25), reset: 'a' })
    assert.equal(h.current.page, 1)
    assert.equal(h.current.pages, 2)
    assert.deepEqual(h.current.slice, rows(25).slice(20))
    h.unmount()
  })

  it('the Record lists key the reset by row count — a new row returns to page 1', () => {
    const h = mountHook(usePagerOf, { items: rows(45), reset: 45 })
    h.run(() => h.current.setPage(1))
    h.rerender({ items: rows(46), reset: 46 })
    assert.equal(h.current.page, 0)
    h.unmount()
  })

  it('unmounting forgets the page — the default is not kept', () => {
    const items = rows(45)
    const a = mountHook(usePagerOf, { items, reset: 'q' })
    a.run(() => a.current.setPage(2))
    a.unmount()
    const b = mountHook(usePagerOf, { items, reset: 'q' })
    assert.equal(b.current.page, 0)
    b.unmount()
  })

  it("hands out React's own setter: one function for the life of the screen", () => {
    const items = rows(45)
    const h = mountHook(usePagerOf, { items, reset: 'q' })
    const first = h.current.setPage
    h.run(() => h.current.setPage((p) => p + 1))
    assert.equal(h.current.page, 1, 'a functional update counts from the page before it')
    h.rerender({ items: rows(45), reset: 'q' })
    assert.equal(h.current.setPage, first)
    h.unmount()
  })

  it('an empty list: page 1 of 1, nothing on it, and nothing to move to', () => {
    const h = mountHook(usePagerOf, { items: [], reset: 'q' })
    const p = h.current
    assert.deepEqual([p.page, p.pages, p.from, p.to, p.total], [0, 1, 0, 0, 0])
    assert.deepEqual(p.slice, [])
    h.run(() => h.current.setPage(3))
    assert.equal(h.current.page, 0)
    assert.deepEqual(h.current.slice, [])
    h.unmount()
  })
})

describe('the kept store', () => {
  it('holds at most MAX_KEPT_PAGES lists, dropping the least recently kept', () => {
    for (let i = 0; i < MAX_KEPT_PAGES + 5; i++) keepPage(`k${i}`, { page: i, anchor: '', seen: 's' })
    assert.equal(readKeptPage('k0'), undefined)
    assert.equal(readKeptPage('k4'), undefined)
    assert.equal(readKeptPage('k5')?.page, 5)
    // keeping an old one again makes it the newest
    keepPage('k5', { page: 50, anchor: '', seen: 's' })
    keepPage('extra', { page: 1, anchor: '', seen: 's' })
    assert.equal(readKeptPage('k5')?.page, 50)
    assert.equal(readKeptPage('k6'), undefined)
  })

  it('anchors a page by its first item, and page 1 by nothing — it follows the head', () => {
    const items = rows(10)
    assert.equal(anchorOf(items, 0, 3, self), '')
    assert.equal(anchorOf(items, 2, 3, self), 'r6')
    assert.equal(anchorOf(items, 9, 3, self), '', 'a page past the end has no first item')
    assert.equal(anchorOf(items, 2, 3), '', 'no ids, no anchor')
  })

  it('resumes on page 1 when nothing is kept or it was kept under another reset key', () => {
    const items = rows(10)
    assert.equal(resumePage(undefined, 'all', items, 1, self), 0)
    assert.equal(resumePage({ page: 4, anchor: 'r4', seen: 'daily' }, 'all', items, 1, self), 0)
  })

  it('resumes on the page that holds the anchor, or on the number when the anchor is gone', () => {
    const kept = { page: 4, anchor: 'r4', seen: 'all' }
    assert.equal(resumePage(kept, 'all', ['n0', 'n1', ...rows(10)], 1, self), 6)
    assert.equal(resumePage(kept, 'all', ['n0', ...rows(10)], 3, self), 1)
    assert.equal(resumePage(kept, 'all', rows(10).filter((r) => r !== 'r4'), 1, self), 4)
    assert.equal(resumePage(kept, 'all', rows(10), 1), 4, 'without ids the number is all there is')
  })
})

describe('usePager — a kept page', () => {
  const keep = (key: string): PagerKeep<string> => ({ key, idOf: self })

  it('survives the section unmounting and mounting again', () => {
    const items = rows(10)
    const a = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('K') })
    a.run(() => a.current.setPage(4))
    assert.deepEqual(a.current.slice, ['r4'])
    a.unmount()
    const b = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('K') })
    assert.equal(b.current.page, 4)
    assert.deepEqual(b.current.slice, ['r4'])
    b.unmount()
  })

  it('another key starts on page 1, and leaves the first key its page', () => {
    const items = rows(10)
    const a = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('A') })
    a.run(() => a.current.setPage(3))
    a.unmount()
    const b = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('B') })
    assert.equal(b.current.page, 0)
    b.unmount()
    const c = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('A') })
    assert.equal(c.current.page, 3)
    c.unmount()
  })

  it('a reset key that moves on screen returns to page 1 and forgets the kept page', () => {
    const items = rows(10)
    const h = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('K') })
    h.run(() => h.current.setPage(4))
    h.rerender({ items, size: 1, reset: 'daily', keep: keep('K') })
    assert.equal(h.current.page, 0)
    h.rerender({ items, size: 1, reset: 'all', keep: keep('K') })
    assert.equal(h.current.page, 0, 'the earlier key does not bring its page back — as with the default')
    h.unmount()
    const again = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('K') })
    assert.equal(again.current.page, 0)
    again.unmount()
  })

  it('mounted again under another reset key, the kept page does not apply', () => {
    const items = rows(10)
    const a = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('K') })
    a.run(() => a.current.setPage(4))
    a.unmount()
    const b = mountHook(usePagerOf, { items, size: 1, reset: 'daily', keep: keep('K') })
    assert.equal(b.current.page, 0)
    b.unmount()
  })

  it('a key and a reset key that move together are another record: each keeps its own page', () => {
    const items = rows(10)
    const h = mountHook(usePagerOf, { items, size: 1, reset: 'A', keep: keep('A') })
    h.run(() => h.current.setPage(2))
    h.rerender({ items, size: 1, reset: 'B', keep: keep('B') })
    assert.equal(h.current.page, 0, 'another record opens on its newest')
    h.run(() => h.current.setPage(1))
    h.rerender({ items, size: 1, reset: 'A', keep: keep('A') })
    assert.equal(h.current.page, 2)
    h.rerender({ items, size: 1, reset: 'B', keep: keep('B') })
    assert.equal(h.current.page, 1)
    h.unmount()
  })

  it('follows the item when rows arrive in front: the page number moves, the reader does not', () => {
    const a = mountHook(usePagerOf, { items: rows(10), size: 1, reset: 'all', keep: keep('K') })
    a.run(() => a.current.setPage(4))
    a.unmount()
    const b = mountHook(usePagerOf, { items: ['n0', 'n1', ...rows(10)], size: 1, reset: 'all', keep: keep('K') })
    assert.deepEqual(b.current.slice, ['r4'])
    assert.equal(b.current.page, 6)
    assert.equal(b.current.pages, 12)
    b.unmount()
  })

  it('page 1 follows the head: a reader on the newest sees what arrived', () => {
    const a = mountHook(usePagerOf, { items: rows(10), size: 1, reset: 'all', keep: keep('K') })
    a.run(() => a.current.setPage(3))
    a.run(() => a.current.setPage(0))
    a.unmount()
    const b = mountHook(usePagerOf, { items: ['n0', ...rows(10)], size: 1, reset: 'all', keep: keep('K') })
    assert.equal(b.current.page, 0)
    assert.deepEqual(b.current.slice, ['n0'])
    b.unmount()
  })

  it('rows still being read do not cost the kept page', () => {
    const a = mountHook(usePagerOf, { items: rows(10), size: 1, reset: 'all', keep: keep('K') })
    a.run(() => a.current.setPage(4))
    a.unmount()
    const b = mountHook(usePagerOf, { items: rows(0), size: 1, reset: 'all', keep: keep('K') })
    assert.equal(b.current.page, 0)
    assert.deepEqual(b.current.slice, [])
    assert.equal(readKeptPage('K')?.anchor, 'r4', 'an empty list is not a reason to forget')
    b.rerender({ items: rows(10), size: 1, reset: 'all', keep: keep('K') })
    assert.equal(b.current.page, 4)
    assert.deepEqual(b.current.slice, ['r4'])
    b.unmount()
  })

  it('a functional update counts from the page on screen, not the number kept', () => {
    const a = mountHook(usePagerOf, { items: rows(10), size: 1, reset: 'all', keep: keep('K') })
    a.run(() => a.current.setPage(4))
    a.unmount()
    const b = mountHook(usePagerOf, { items: ['n0', ...rows(10)], size: 1, reset: 'all', keep: keep('K') })
    assert.equal(b.current.page, 5)
    b.run(() => b.current.setPage((p) => p + 1))
    assert.deepEqual(b.current.slice, ['r5'])
    b.unmount()
  })

  it('two functional updates in one handler move two pages, as React’s own setter does', () => {
    const kept = mountHook(usePagerOf, { items: rows(10), size: 1, reset: 'all', keep: keep('K') })
    kept.run(() => {
      kept.current.setPage((p) => p + 1)
      kept.current.setPage((p) => p + 1)
    })
    const plain = mountHook(usePagerOf, { items: rows(10), size: 1, reset: 'all' })
    plain.run(() => {
      plain.current.setPage((p) => p + 1)
      plain.current.setPage((p) => p + 1)
    })
    assert.equal(plain.current.page, 2)
    assert.equal(kept.current.page, plain.current.page)
    assert.deepEqual(kept.current.slice, ['r2'])
    kept.unmount()
    plain.unmount()
  })

  it('a functional update after a plain one in the same handler counts from the plain one', () => {
    const h = mountHook(usePagerOf, { items: rows(10), size: 1, reset: 'all', keep: keep('K') })
    h.run(() => {
      h.current.setPage(6)
      h.current.setPage((p) => p - 1)
    })
    assert.equal(h.current.page, 5)
    h.unmount()
  })

  it('an empty kept list is page 1 of 1', () => {
    const h = mountHook(usePagerOf, { items: [], size: 1, reset: 'all', keep: keep('K') })
    const p = h.current
    assert.deepEqual([p.page, p.pages, p.from, p.to, p.total], [0, 1, 0, 0, 0])
    h.unmount()
  })

  it('a sign-out forgets every kept page', () => {
    const items = rows(10)
    const a = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('K') })
    a.run(() => a.current.setPage(4))
    a.unmount()
    forgetAllKept()
    assert.equal(readKeptPage('K'), undefined)
    const b = mountHook(usePagerOf, { items, size: 1, reset: 'all', keep: keep('K') })
    assert.equal(b.current.page, 0)
    b.unmount()
  })
})
