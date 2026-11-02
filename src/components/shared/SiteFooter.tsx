import { cn } from '@/lib/utils'

// THE LINE EVERY PAGE ENDS WITH.
export const COPYRIGHT = '© 2026 Asa LifeCare. All rights reserved.'

// Small, in the flow — the last thing on the page, never over it.
export default function SiteFooter({ className, as: Tag = 'footer' }: { className?: string; as?: 'footer' | 'p' }) {
  return (
    <Tag className={cn('shrink-0 py-4 text-center text-[11px] leading-4 text-text-2', className)}>
      {COPYRIGHT}
    </Tag>
  )
}
