// The employee picker — the people PsiAnywhere holds entries for, searched by any part of the name.
// Sixty-odd names do not fit a plain select a reviewer can scan, and the same list serves the queue (one person, or
// everyone) and Overtime (any number of people, or everyone), so one popover does both: `multi` decides which.
// A popover beside its button, not a dialog — the page under it stays where it was.
import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search, UserRound, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ReconEmployee } from './reconTypes'

const LISTED = 200

type Common = { employees: ReconEmployee[]; className?: string; disabled?: boolean }
type Single = Common & { multi?: false; value: string; onChange: (key: string) => void }
type Multi = Common & { multi: true; value: string[]; onChange: (keys: string[]) => void }

export default function EmployeePicker(props: Single | Multi) {
  const { employees, className, disabled } = props
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const chosen = useMemo(
    () => new Set(props.multi ? props.value : props.value ? [props.value] : []),
    [props.multi, props.value],
  )
  const nameOf = useMemo(() => new Map(employees.map((e) => [e.key, e.name])), [employees])

  const sorted = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  )
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const hit = words.length ? sorted.filter((e) => words.every((w) => e.name.toLowerCase().includes(w))) : sorted
    // the chosen ones first, so a picked name never hides below the fold of a long list
    return [...hit.filter((e) => chosen.has(e.key)), ...hit.filter((e) => !chosen.has(e.key))]
  }, [sorted, q, chosen])

  const label = (() => {
    if (!props.multi) return props.value ? (nameOf.get(props.value) ?? props.value) : 'All employees'
    if (props.value.length === 0) return 'All employees'
    if (props.value.length === 1) return nameOf.get(props.value[0]) ?? props.value[0]
    return `${props.value.length} employees`
  })()

  const pick = (key: string) => {
    if (props.multi) {
      const next = chosen.has(key) ? props.value.filter((k) => k !== key) : [...props.value, key]
      props.onChange(next)
      return
    }
    props.onChange(key === props.value ? '' : key)
    setOpen(false)
  }
  const clear = () => {
    if (props.multi) props.onChange([])
    else props.onChange('')
  }
  const any = props.multi ? props.value.length > 0 : !!props.value

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ('') }}>
      <PopoverTrigger asChild>
        <button
          type="button" disabled={disabled}
          className={cn(
            'flex h-9 min-w-[180px] max-w-[260px] items-center gap-1.5 rounded-md border bg-surface px-3 text-left text-[13px] transition-colors hover:bg-surface-2 disabled:opacity-40',
            any ? 'border-primary/40 text-text-1' : 'border-border text-text-2',
            className,
          )}
        >
          <UserRound size={14} className="shrink-0 text-text-3" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown size={14} className="shrink-0 text-text-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] border-border bg-surface p-0">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={14} className="shrink-0 text-text-3" />
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name…"
            className="h-10 w-full bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
          />
        </div>
        <div className="scroll-thin max-h-[300px] overflow-y-auto py-1">
          <button
            type="button" onClick={() => { clear(); if (!props.multi) setOpen(false) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text-2 hover:bg-surface-2"
          >
            <span className="grid h-4 w-4 place-items-center">{!any && <Check size={13} className="text-primary" />}</span>
            All employees
          </button>
          {shown.slice(0, LISTED).map((e) => (
            <button
              key={e.key} type="button" onClick={() => pick(e.key)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text-1 hover:bg-surface-2"
            >
              <span className={cn(
                'grid h-4 w-4 shrink-0 place-items-center',
                props.multi && 'rounded-[4px] border',
                props.multi && (chosen.has(e.key) ? 'border-primary bg-primary text-on-primary' : 'border-border-strong'),
              )}>
                {chosen.has(e.key) && <Check size={props.multi ? 11 : 13} className={props.multi ? '' : 'text-primary'} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="px-3 py-4 text-center text-[13px] text-text-3">No name matches.</p>}
          {shown.length > LISTED && (
            <p className="px-3 py-2 text-[12px] text-text-3">{shown.length - LISTED} more — type to narrow.</p>
          )}
        </div>
        {props.multi && props.value.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px] text-text-3">
            <span>{props.value.length} picked</span>
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 font-semibold text-primary">
              <X size={12} /> Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
