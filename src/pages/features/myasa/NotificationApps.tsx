// The notification apps this person has installed, listed in My asa.
// Its instance is listed inside My asa., because it has no interface of its own; pressing it sends the reader to…
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { AppIcon } from '@/lib/icons'
import { TINT_PAIR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'

export default function NotificationApps() {
  const navigate = useNavigate()
  const apps = useRegistryStore((s) => s.apps)
  const mine = apps.filter((a) => a.interfaceless && a.enabled)
  if (!mine.length) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="mb-6"
    >
      <Card padded={false} className="p-5">
        <CardHeader
          title="Your notifications"
          sub="Apps that send rather than show. Open one to change what it says and when."
        />
        <div className="space-y-1.5">
          {mine.map((a) => {
            const pair = TINT_PAIR(a.accent)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate(a.settingsAnchor ? `/settings#${a.settingsAnchor}` : '/settings')}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${pair}`}>
                  <AppIcon name={a.icon} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-text-1">{a.name}</span>
                  <span className="clamp-1 block text-[11.5px] text-text-3">{a.tagline}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-text-3" />
              </button>
            )
          })}
        </div>
      </Card>
    </motion.div>
  )
}
