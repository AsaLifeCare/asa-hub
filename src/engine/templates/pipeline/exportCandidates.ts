// Export the pipeline — everyone on the board, with where they are and what is known about them.
// Three formats because three different things are done with them: a CSV for whatever tool comes next, an Excel…
import type { ChecklistItem } from './types'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

type Row = Record<string, unknown>
type Stage = { id: string; label: string }

/** What goes in the file, in the order a human reads it. */
const COLUMNS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: '__stage', label: 'Stage' },
  { key: 'role', label: 'Role' },
  { key: 'source', label: 'Source' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'daysInStage', label: 'Days in stage' },
  { key: 'appliedAt', label: 'Applied' },
  { key: 'owner', label: 'Owner' },
  { key: 'score', label: 'Score' },
  { key: '__packet', label: 'New Hire packet' },
  { key: '__checklistDone', label: 'Checklist done' },
  { key: '__checklistTotal', label: 'Checklist total' },
  { key: '__missing', label: 'Still missing' },
  { key: 'resumeLink', label: 'Resume' },
  { key: 'id', label: 'Candidate ID' },
]

function cell(rec: Row, key: string, stageLabel: string): string {
  if (key === '__stage') return stageLabel
  if (key === '__packet') {
    const p = rec.packet as { label?: string } | undefined
    return p?.label ?? ''
  }
  const list = Array.isArray(rec.checklist) ? (rec.checklist as ChecklistItem[]) : []
  if (key === '__checklistDone') return String(list.filter((i) => i.status === 'done' || i.status === 'auto').length)
  if (key === '__checklistTotal') return String(list.length)
  if (key === '__missing') {
    return list
      .filter((i) => i.status !== 'done' && i.status !== 'auto')
      .map((i) => i.label)
      .join('; ')
  }
  const v = rec[key]
  if (v == null) return ''
  if (typeof v === 'object') return ''
  // One phone grammar in the deliverable too — the file reads like the screen.
  if (key === 'phone') return formatPhoneDisplay(String(v))
  return String(v)
}

function matrix(records: Row[], stages: Stage[], stageField: string): string[][] {
  const labelOf = new Map(stages.map((s) => [s.id, s.label]))
  // Board order, then name — the same order the person sees on screen, so the file and the board can be read side…
  const rank = new Map(stages.map((s, i) => [s.id, i]))
  const sorted = [...records].sort((a, b) => {
    const ra = rank.get(String(a[stageField])) ?? 99
    const rb = rank.get(String(b[stageField])) ?? 99
    return ra - rb || String(a.name ?? '').localeCompare(String(b.name ?? ''))
  })
  return [
    COLUMNS.map((c) => c.label),
    ...sorted.map((r) => COLUMNS.map((c) => cell(r, c.key, labelOf.get(String(r[stageField])) ?? String(r[stageField] ?? '')))),
  ]
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick: revoking synchronously races the download in Safari and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function csvEscape(v: string): string {
  // A cell must never be read as a FORMULA.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function exportPipelineCSV(records: Row[], stages: Stage[], stageField: string) {
  const rows = matrix(records, stages, stageField)
  const body = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
  // BOM so Excel reads UTF-8 — without it, accented names arrive mangled.
  download(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }), `pipeline-${stamp()}.csv`)
}

const htmlEscape = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function exportPipelineExcel(records: Row[], stages: Stage[], stageField: string) {
  const [head, ...body] = matrix(records, stages, stageField)
  const html =
    '<html><head><meta charset="utf-8"></head><body><table border="1">' +
    '<thead><tr>' + head.map((h) => `<th>${htmlEscape(h)}</th>`).join('') + '</tr></thead>' +
    '<tbody>' +
    body.map((r) => '<tr>' + r.map((c) => `<td>${htmlEscape(c)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table></body></html>'
  download(new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }), `pipeline-${stamp()}.xls`)
}

export function exportPipelineText(records: Row[], stages: Stage[], stageField: string) {
  const labelOf = new Map(stages.map((s) => [s.id, s.label]))
  const lines: string[] = [`ASA Hub — Hiring Pipeline — ${stamp()}`, '']
  stages.forEach((s) => {
    const inStage = records.filter((r) => String(r[stageField]) === s.id)
    lines.push(`${s.label.toUpperCase()} (${inStage.length})`)
    if (!inStage.length) lines.push('  —')
    inStage
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
      .forEach((r) => {
        const bits = [String(r.email ?? ''), formatPhoneDisplay(String(r.phone ?? ''))].filter(Boolean).join(' · ')
        const pk = (r.packet as { label?: string } | undefined)?.label
        lines.push(`  ${String(r.name ?? '(unnamed)')}${bits ? ` — ${bits}` : ''}`)
        const detail = [
          `${r.daysInStage ?? 0}d in stage`,
          cell(r, '__checklistDone', '') + '/' + cell(r, '__checklistTotal', '') + ' checklist',
          pk,
        ].filter(Boolean).join(' · ')
        lines.push(`    ${detail}`)
        const missing = cell(r, '__missing', '')
        if (missing) lines.push(`    missing: ${missing}`)
      })
    lines.push('')
  })
  lines.push(`${records.length} candidate(s) across ${stages.length} stages.`)
  void labelOf
  download(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `pipeline-${stamp()}.txt`)
}
