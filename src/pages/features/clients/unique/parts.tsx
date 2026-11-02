/** The Unique view's small pieces — the page and its tab modules draw with the same ones. */
import DragPerson from '@/components/shared/DragPerson'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import type { FocusType } from '@/stores/useContextStore'
import { cn } from '@/lib/utils'

export function SectionHead({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 border-b border-border pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-3">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      {children}
      {action ? <span className="ml-auto">{action}</span> : null}
    </p>
  )
}

// label · value line, the prototype's contact-row.
export function Row({ label, value, href, person }: {
  label: string
  value?: string
  href?: string
  person?: { name?: string; type?: FocusType; id?: string; subtitle?: string }
}) {
  const v = String(value ?? '').trim()
  const personName = String(person?.name ?? '').trim()
  const body = v ? (
    href ? (
      <a href={href} className="min-w-0 break-words text-right font-semibold text-primary hover:underline">{v}</a>
    ) : (
      <span className="min-w-0 break-words text-right font-medium leading-5 text-text-1">{v}</span>
    )
  ) : (
    <span className="text-right text-text-3">Not on file</span>
  )
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[13px]">
      <span className="shrink-0 font-medium text-text-3">{label}</span>
      {v && personName ? (
        <DragPerson name={personName} id={person?.id} type={person?.type ?? 'client'} subtitle={person?.subtitle} className="min-w-0">
          {body}
        </DragPerson>
      ) : (
        body
      )}
    </div>
  )
}

export function Chip({ children, tint = 'slate' }: { children: React.ReactNode; tint?: TintName | 'slate' }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
      TINT_BG[tint as TintName], TINT_FG[tint as TintName])}>
      {children}
    </span>
  )
}

/** A read that failed, said as such — never drawn as an empty tab. */
export function ReadError({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-3">{children}</p>
  )
}
