// ROWS BUILDER — Visual mode for the SAMPLE DATA editor: a plain data grid over the rows array.
// Columns are the union of row keys (`id` pinned first); cells edit in place and keep their JSON type (numbers stay…
import { useState } from 'react'
import { ImagePlus, Plus, X } from 'lucide-react'
import { checkRows } from '../validation'
import { pretty } from '../starters'
import LibraryPicker from './LibraryPicker'
import {
  AddRow,
  IconBtn,
  InvalidJsonNotice,
} from './shared'
import { inputCls } from './utils'

/** How many row keys the grid shows before pointing at Advanced mode. */
const MAX_GRID_COLS = 8

/** A cell that holds a picture: the key says so, or the value already does. */
const isImageCell = (key: string, v: unknown): boolean =>
  /avatar|photo|src|thumb|image|cover/i.test(key) ||
  (typeof v === 'string' && v.startsWith('/assets/'))

/** Cell display: scalars as themselves, arrays/objects as inline JSON. */
function display(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Cell parse: preserve the incumbent type; strings may opt into JSON. */
function parseCell(text: string, old: unknown): unknown {
  if (typeof old === 'number') {
    const n = Number(text)
    return text.trim() !== '' && isFinite(n) ? n : text
  }
  if (typeof old === 'boolean') return text === 'true' ? true : text === 'false' ? false : text
  if (typeof old === 'object' && old !== null) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const t = text.trim()
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      return JSON.parse(t)
    } catch {
      /* fall through — a string that merely looks like JSON */
    }
  }
  return text
}

export default function RowsBuilder({ rowsText, onChange }: { rowsText: string; onChange: (nextText: string) => void }) {
  const [newKey, setNewKey] = useState('')
  /** Cell the image-bank picker is open for, if any. */
  const [pickFor, setPickFor] = useState<{ ri: number; key: string } | null>(null)
  const check = checkRows(rowsText)
  if (!check.ok) return <InvalidJsonNotice message={check.message} line={check.line} />
  const rows = check.rows

  // union of keys in first-seen order, id pinned first
  const keys: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
  keys.sort((a, b) => (a === 'id' ? -1 : b === 'id' ? 1 : 0))
  const shown = keys.slice(0, MAX_GRID_COLS)
  const hidden = keys.length - shown.length

  const write = (next: Record<string, unknown>[]) => onChange(pretty(next))
  const setCell = (ri: number, key: string, raw: string) =>
    write(rows.map((r, i) => (i === ri ? { ...r, [key]: parseCell(raw, r[key]) } : r)))

  const addRow = () => {
    let n = rows.length + 1
    const ids = new Set(rows.map((r) => String(r.id)))
    while (ids.has(`row-${n}`)) n++
    const row: Record<string, unknown> = { id: `row-${n}` }
    for (const k of keys) if (k !== 'id') row[k] = ''
    write([...rows, row])
  }

  const addField = () => {
    const k = newKey.trim()
    if (!k || keys.includes(k)) return
    write(rows.map((r) => ({ ...r, [k]: '' })))
    setNewKey('')
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              {shown.map((k) => (
                <th key={k} className="whitespace-nowrap px-2 py-1.5 font-mono text-[10.5px] font-semibold text-text-3">
                  {k}
                </th>
              ))}
              <th className="w-8 px-1 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, ri) => (
              <tr key={ri}>
                {shown.map((k) => (
                  <td key={k} className="min-w-[110px] px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <input
                        value={display(r[k])}
                        onChange={(e) => setCell(ri, k, e.target.value)}
                        spellCheck={false}
                        className="h-7 w-full rounded-sm border border-transparent bg-transparent px-1.5 font-mono text-[11.5px] text-text-1 outline-none transition-colors hover:border-border focus:border-primary focus:bg-surface"
                      />
                      {isImageCell(k, r[k]) && (
                        <button
                          type="button"
                          onClick={() => setPickFor({ ri, key: k })}
                          title="Pick from the image bank"
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-primary"
                        >
                          <ImagePlus size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                ))}
                <td className="px-1 py-1">
                  <IconBtn title="Remove row" danger onClick={() => write(rows.filter((_, i) => i !== ri))} icon={<X size={12} />} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <p className="text-[11px] text-text-3">
          +{hidden} more field(s) not shown — nothing is lost; edit them in Advanced (JSON) mode.
        </p>
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <AddRow label="Add row" onClick={addRow} />
        </div>
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addField()}
          placeholder="new field name"
          className={`${inputCls} h-8 w-36 text-[12px]`}
        />
        <button
          type="button"
          onClick={addField}
          disabled={!newKey.trim() || keys.includes(newKey.trim())}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
        >
          <Plus size={12} /> Field
        </button>
      </div>

      {pickFor && (
        <LibraryPicker
          onPick={(src) => {
            setCell(pickFor.ri, pickFor.key, src)
            setPickFor(null)
          }}
          onClose={() => setPickFor(null)}
        />
      )}
    </div>
  )
}
