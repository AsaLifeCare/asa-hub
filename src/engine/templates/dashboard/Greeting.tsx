/** Animated greeting header with daypart icon + "New app" CTA (moved verbatim from DashboardTemplate.tsx). */
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Moon, Plus, Sun } from 'lucide-react'
import { motion } from 'framer-motion'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { ohioLongDay, ohioWall } from '@/lib/ohio'

export function Greeting({ name, subtitle, actions }: { name: string; subtitle: string; actions?: ReactNode }) {
  const navigate = useNavigate()
  // Good morning WHERE?
  const h = (ohioWall(new Date()) as Date).getHours()
  const daypart = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
  const DayIcon = h >= 19 || h < 7 ? Moon : Sun
  const words = `Good ${daypart}, ${name}`.split(' ')
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold leading-9 tracking-[-0.015em] text-text-1">
          <span className="flex flex-wrap">
            {words.slice(0, 8).map((w, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.025, duration: 0.28, ease: EASE_OUT_EXPO }}
                className="mr-[0.28em]"
              >
                {w}
              </motion.span>
            ))}
          </span>
          <DayIcon size={22} className="text-primary" />
        </h1>
        <p className="mt-1 text-[13px] text-text-2">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium text-text-3">{ohioLongDay(new Date())}</span>
        {actions}
        <button
          onClick={() => navigate('/apps')}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
        >
          <Plus size={15} /> New app
        </button>
      </div>
    </div>
  )
}
