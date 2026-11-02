import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Page title block used at the top of page-type templates (§11). */
export default function PageHeader({
  title,
  subtitle,
  actions,
  inset,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  // KEEP THE RIGHT CORNER CLEAR — the Views button was sitting on top of Add candidate.
  inset?: boolean
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[22px] font-bold leading-[30px] tracking-[-0.015em] text-text-1">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-2">{subtitle}</p>}
      </div>
      {actions && (
        <div className={cn('flex max-w-full flex-wrap items-center gap-2 [&>*]:shrink-0', inset && 'min-[1240px]:pr-[210px]')}>
          {actions}
        </div>
      )}
    </div>
  )
}
