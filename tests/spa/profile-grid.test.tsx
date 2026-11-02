/** ProfileGrid, drawn: where each slot lands at every breakpoint, and the pages that use it. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import ProfileGrid from '@/components/shared/ProfileGrid'

const SCREENS = ['sm', 'md', 'lg', 'xl', '2xl'] as const
type Width = 'base' | (typeof SCREENS)[number]
type Slot = 'head' | 'rail' | 'story' | 'details'
type Item = Slot | 'main'
type Place = { col?: number; rowStart?: number; rowEnd?: number; span?: number }

function draw(el: React.ReactElement) {
  const html = renderToString(el)
  const root = /^<div class="([^"]*)"/.exec(html)?.[1] ?? ''
  const slots = [...html.matchAll(/<(div|aside) class="([^"]*)"><i>(\w+)<\/i>/g)]
    .map((m) => ({ tag: m[1], cls: m[2], name: m[3] as Slot }))
  /** the wrapper that holds story and details */
  const main = /<div class="([^"]*)"><div class="[^"]*"><i>story<\/i>/.exec(html)?.[1] ?? ''
  return { root, slots, main }
}

/** the utilities in force at a width, mobile-first, later screens overriding earlier ones */
function active(cls: string, width: Width): string[] {
  const upTo = width === 'base' ? [] : SCREENS.slice(0, SCREENS.indexOf(width) + 1)
  const layers = ['', ...upTo.map((s) => `${s}:`)]
  const out: string[] = []
  for (const layer of layers) {
    for (const c of cls.split(/\s+/)) {
      if (layer === '' ? !c.includes(':') : c.startsWith(layer)) out.push(c.slice(layer.length))
    }
  }
  return out
}

function tracks(utils: string[], axis: 'cols' | 'rows'): string[] {
  let t: string[] = ['auto']
  for (const u of utils) {
    const arb = new RegExp(`^grid-${axis}-\\[(.+)\\]$`).exec(u)
    const num = new RegExp(`^grid-${axis}-(\\d+)$`).exec(u)
    if (arb) t = arb[1].split(/_(?![^(]*\))/)
    else if (num) t = Array(Number(num[1])).fill('1fr')
  }
  return t
}

function place(utils: string[]): Place {
  const p: Place = {}
  for (const u of utils) {
    let m: RegExpExecArray | null
    if ((m = /^col-start-(\d+)$/.exec(u))) p.col = Number(m[1])
    else if ((m = /^row-start-(\d+)$/.exec(u))) { p.rowStart = Number(m[1]); p.rowEnd = undefined; p.span = undefined }
    else if (u === 'row-span-full') { p.rowStart = 1; p.rowEnd = -1; p.span = undefined }
    else if ((m = /^row-span-(\d+)$/.exec(u))) { p.span = Number(m[1]); p.rowEnd = undefined }
  }
  return p
}

function layout(el: React.ReactElement, width: Width) {
  const { root, slots, main } = draw(el)
  const r = active(root, width)
  const cols = tracks(r, 'cols')
  const rows = tracks(r, 'rows')
  const dissolved = active(main, width).includes('contents')
  const at = Object.fromEntries(slots.map((s) => [s.name, place(active(s.cls, width))])) as Record<Item, Place>
  at.main = place(active(main, width))
  /** what the root grid places: with the wrapper dissolved, story and details stand in for it */
  const items: Item[] = ['head', 'rail', ...(dissolved ? slots.map((s) => s.name).filter((n) => n === 'story' || n === 'details') : ['main' as const])]
  /** [col, first row, last row], -1 resolved against the explicit rows */
  const cells = (p: Place): [number, number, number] => {
    const start = p.rowStart ?? 1
    const last = p.rowEnd === -1 ? rows.length : start + (p.span ?? 1) - 1
    return [p.col ?? 1, start, last]
  }
  return { cols, rows, at, cells, slots, dissolved, items, main }
}

const full = (extra: Partial<React.ComponentProps<typeof ProfileGrid>> = {}) => (
  <ProfileGrid head={<i>head</i>} rail={<i>rail</i>} story={<i>story</i>} details={<i>details</i>} {...extra} />
)

describe('ProfileGrid — the rail never waits for the story, the details never wait for the rail', () => {
  it('the DOM is the one-column reading order: head, rail, story, details', () => {
    const d = draw(full())
    assert.deepEqual(d.slots.map((s) => s.name), ['head', 'rail', 'story', 'details'])
    assert.equal(d.slots[1].tag, 'aside')
    assert.ok(d.main, 'story and details share one wrapper')
  })

  for (const width of ['base', 'sm', 'md'] as Width[]) {
    it(`below lg (${width}) there is one column and nothing is placed`, () => {
      const l = layout(full(), width)
      assert.deepEqual(l.cols, ['1fr'])
      assert.equal(l.dissolved, false)
      for (const s of Object.values(l.at)) assert.deepEqual(s, {})
    })
  }

  for (const width of ['lg', 'xl'] as Width[]) {
    it(`at ${width} head and rail stack left; story then details stack right`, () => {
      const l = layout(full(), width)
      assert.equal(l.cols.length, 2)
      assert.deepEqual(l.rows, ['auto', '1fr'], 'a long story grows the last row, not the gap under the head')
      assert.equal(l.dissolved, false)
      assert.deepEqual(l.cells(l.at.head), [1, 1, 1])
      assert.deepEqual(l.cells(l.at.rail), [1, 2, 2], 'the rail sits right under the head')
      assert.deepEqual(l.cells(l.at.main), [2, 1, 2])
      assert.deepEqual(l.at.story, {}, 'the story is not a grid item here')
      assert.deepEqual(l.at.details, {}, 'the details follow the story in the wide track')
    })
  }

  it('at lg the left track is capped by a share of the grid, so the story is never the only track that gives', () => {
    const l = layout(full(), 'lg')
    assert.match(l.cols[0], /^minmax\(0,min\(\d+px,\d+%\)\)$/)
    assert.equal(l.cols[1], 'minmax(0,1fr)')
  })

  it('at 2xl the wrapper dissolves: details under the head, story in the middle, rail in the third track', () => {
    const l = layout(full(), '2xl')
    assert.equal(l.cols.length, 3)
    assert.deepEqual(l.rows, ['auto', '1fr'])
    assert.equal(l.dissolved, true)
    assert.deepEqual(l.cells(l.at.head), [1, 1, 1])
    assert.deepEqual(l.cells(l.at.details), [1, 2, 2])
    assert.deepEqual(l.cells(l.at.story), [2, 1, 2])
    assert.deepEqual(l.cells(l.at.rail), [3, 1, 2])
  })

  for (const width of ['lg', 'xl', '2xl'] as Width[]) {
    it(`at ${width} every grid item is inside the explicit grid and none overlap`, () => {
      const l = layout(full(), width)
      const taken = new Set<string>()
      for (const name of l.items) {
        const [col, first, last] = l.cells(l.at[name])
        assert.ok(col <= l.cols.length, `${name} would open an implicit column`)
        assert.ok(last <= l.rows.length, `${name} would open an implicit row`)
        for (let r = first; r <= last; r++) {
          assert.ok(!taken.has(`${col}:${r}`), `${name} overlaps at column ${col}, row ${r}`)
          taken.add(`${col}:${r}`)
        }
      }
    })
  }

  it('story and details keep full width inside a flex-column stack and drop its spacing once they are grid items', () => {
    const d = draw(full({ slotClassName: 'space-y-4' }))
    for (const s of d.slots.filter((x) => x.name === 'story' || x.name === 'details')) {
      for (const width of ['base', 'sm', 'md', 'lg', 'xl'] as Width[]) {
        assert.ok(!active(s.cls, width).includes('self-start'), `${s.name} would shrink to its content at ${width}`)
      }
      assert.ok(active(s.cls, '2xl').includes('self-start'))
    }
    const spacing = active(d.main, '2xl').filter((u) => u.startsWith('space-y-'))
    assert.equal(spacing.at(-1), 'space-y-0', 'a dissolved stack would push the details down by its own spacing')
  })

  it('other tracks keep the same placement; a missing details slot draws nothing', () => {
    const l = layout(full({ className: 'gap-x-5 lg:grid-cols-[minmax(0,min(260px,38%))_minmax(0,1fr)]' }), 'lg')
    assert.deepEqual(l.cols, ['minmax(0,min(260px,38%))', 'minmax(0,1fr)'])
    assert.deepEqual(l.cells(l.at.rail), [1, 2, 2])
    const bare = draw(<ProfileGrid head={<i>head</i>} rail={<i>rail</i>} story={<i>story</i>} />)
    assert.deepEqual(bare.slots.map((s) => s.name), ['head', 'rail', 'story'])
  })
})

describe('the three-column pages draw through ProfileGrid', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  for (const page of [
    'src/pages/features/clients/ClientUniquePage.tsx',
    'src/pages/features/potclients/PotentialClientUniquePage.tsx',
    'src/pages/features/administration/AdministrationPage.tsx',
  ]) {
    it(page, () => {
      const src = readFileSync(resolve(root, page), 'utf8')
      assert.match(src, /import ProfileGrid from '@\/components\/shared\/ProfileGrid'/)
      assert.match(src, /<ProfileGrid\b/)
      assert.doesNotMatch(src, /<div[^>]*className="[^"]*\blg:grid-cols-\[[^"]*\b2xl:grid-cols-\[/, 'no hand-rolled two-then-three track grid')
      // a responsive grid with no base track sizes its one column to the longest unbroken value
      const open = /^( *)<ProfileGrid\b/m.exec(src)
      assert.ok(open)
      const close = src.indexOf(`\n${open[1]}/>`, open.index)
      assert.ok(close > open.index, 'the ProfileGrid element closes at its own indent')
      const body = src.slice(open.index, close)
      for (const [, cls] of body.matchAll(/className="([^"]*)"/g)) {
        const list = cls.split(/\s+/)
        if (!list.includes('grid') || !list.some((c) => /^\w+:grid-cols-/.test(c))) continue
        assert.ok(list.some((c) => c.startsWith('grid-cols-')), `"${cls}" needs a base grid-cols track`)
      }
    })
  }
})

/** every class list in a source: className="…" literals, and each cn(…) call's string literals joined */
function classLists(src: string): string[] {
  const out = [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1])
  for (let i = src.indexOf('cn('); i >= 0; i = src.indexOf('cn(', i + 3)) {
    if (/[\w$.]/.test(src[i - 1] ?? '')) continue
    let depth = 0
    let j = i + 2
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')' && --depth === 0) break
    }
    out.push([...src.slice(i, j + 1).matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]).join(' '))
  }
  return out
}

describe('what the record draws inside its profile keeps the same rule', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  const unique = 'src/pages/features/clients/unique'
  const files = [
    ...readdirSync(resolve(root, unique)).filter((f) => f.endsWith('.tsx')).map((f) => `${unique}/${f}`),
    'src/pages/features/finance/FinanceLedger.tsx',
    'src/pages/features/finance/FinanceAnalytics.tsx',
    'src/pages/features/wellbeing/SleepPage.tsx',
    'src/pages/features/wellbeing/HydrationPage.tsx',
    'src/pages/features/wellbeing/WorkoutPage.tsx',
    'src/pages/features/wellbeing/MealsPage.tsx',
  ]

  it('the scan reads cn() calls as well as literals', () => {
    const lists = classLists(`<div className="a b" /><p className={cn('grid gap-4', x && 'lg:grid-cols-2')} />`)
    assert.deepEqual(lists, ['a b', 'grid gap-4 lg:grid-cols-2'])
  })

  for (const file of files) {
    it(`${file}: a responsive grid has a base grid-cols track`, () => {
      const src = readFileSync(resolve(root, file), 'utf8')
      for (const cls of classLists(src)) {
        const list = cls.split(/\s+/)
        if (!list.includes('grid') || !list.some((c) => /^\w+:grid-cols-/.test(c))) continue
        assert.ok(list.some((c) => c.startsWith('grid-cols-')), `"${cls}" needs a base grid-cols track`)
      }
    })
  }
})
