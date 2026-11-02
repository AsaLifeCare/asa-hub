// The three screens of Workforce Compliance, switchable from the header of any of them — a dropdown where Refresh…
// IT LIVES IN ITS OWN FILE because a switcher that exists on one of three screens is a one-way door: you can leave…
import { ChevronDown } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const SCREENS = [
  { id: 'certifications', label: 'Dashboard' },
  { id: 'roster', label: 'Employee Tracker' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'board', label: 'Staff Performance' },
] as const

export default function ScreenSwitcher() {
  const navigate = useNavigate()
  const { pageId } = useParams()
  // The button names where you ARE before it offers anywhere else — a control reading "Go to…" makes you look…
  const here = SCREENS.find((s) => s.id === pageId) ?? SCREENS[1]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Switch screen"
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
        >
          {here.label}
          <ChevronDown size={14} className="text-text-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {SCREENS.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onClick={() => navigate(`/app/employee-tracker/${s.id}`)}
            className={cn(s.id === here.id && 'font-semibold text-primary')}
          >
            {s.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
