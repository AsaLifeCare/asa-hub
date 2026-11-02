import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-3',
        'focus-within:border-border-strong',
        className,
      )}
    >
      <Search size={15} className="shrink-0 text-text-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
      />
    </div>
  )
}
