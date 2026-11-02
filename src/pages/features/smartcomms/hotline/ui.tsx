// THE SMALL PIECES of the Hotline screen — pills, section labels, the dashed "not on file" box and the caller's…
// Every one of them draws from the kit's tokens, so the dark theme needs nothing of its own.
import type { ReactNode } from 'react'
import { Building2, Phone } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { TINT_BG, TINT_FG, TINT_VAR, type ExtendedTintName } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { WhoSource } from './join'
import { MODALITY, type Modality } from './vocabulary'

/** A soft status pill — green, amber, red or neutral, and nothing else. */
export function Pill({ label, tint = 'slate', className }: { label: string; tint?: ExtendedTintName; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-4',
        TINT_BG[tint], TINT_FG[tint], className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  )
}

/** A kind of record: a neutral pill with the modality's dot. */
export function ModalityPill({ modality, label, className }: { modality: Modality; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-[2px] text-[11px] font-medium leading-4 text-text-2',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TINT_VAR[MODALITY[modality].tint] }} />
      <span className="truncate">{label ?? MODALITY[modality].one}</span>
    </span>
  )
}

/** A neutral fact pill — a type, a category, a client. */
export function QuietPill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full bg-surface-3 px-2 py-[3px] text-[11px] font-medium leading-4 text-text-2',
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  )
}

export function SectionLabel({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-3">{children}</h3>
      {extra}
    </div>
  )
}

/** UNKNOWN LOOKS LIKE UNKNOWN — a dashed outline and a sentence, never a zero. */
export function NotOnFile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('rounded-[12px] border border-dashed border-border px-3 py-2 text-[12.5px] leading-[1.55] text-text-3', className)}>
      {children}
    </p>
  )
}

// The caller's face: initials for a name, a building for a shared line, a handset for a number nobody could name.
export function WhoFace({ name, source, size = 'sm' }: { name: string; source: WhoSource | 'record'; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-10 w-10' : 'h-8 w-8'
  const icon = size === 'md' ? 17 : 14
  if (source === 'shared') {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-full bg-surface-3 text-text-2', box)}>
        <Building2 size={icon} />
      </span>
    )
  }
  if (source === 'unknown') {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-full bg-surface-3 text-text-3', box)}>
        <Phone size={icon} />
      </span>
    )
  }
  return <Avatar name={name} size={size} className="shrink-0" />
}
