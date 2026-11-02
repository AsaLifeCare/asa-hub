// The one-time notifications card: its button is the click the browser's prompt needs (lib/osNotify).
// Not a modal; the answer is kept per person (lib/prefsSync) and never asked again, nor inside a visit.
import { useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BellRing, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'
import { toast } from '@/stores/useToastStore'
import { onPrefsSettled, prefsSettled } from '@/lib/prefsSync'
import { answerToast, askOsPermission, osPermission, recordAnswer, shouldOfferAsk } from '@/lib/osNotify'
import { ensurePush } from '@/lib/webPush'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

export default function NotificationAsk() {
  const user = useAuthStore((s) => s.user)
  const visiting = Boolean(useMemberStore((s) => s.currentMemberId))
  // wearing another account (Be Another): this device is never offered to them
  const acting = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const settled = useSyncExternalStore(onPrefsSettled, prefsSettled, () => false)
  // the card keeps clear of the person's own toast corner when it is on the left
  const corner = useUiPrefsStore((s) => s.toastPosition)
  /** Closed by a press for this account — the written answer does the rest. */
  const [closed, setClosed] = useState('')
  const [busy, setBusy] = useState(false)

  const uid = String(user?.id ?? '')
  const open = !acting && closed !== uid && shouldOfferAsk({
    uid,
    permission: osPermission(),
    mustChangePassword: Boolean(user?.mustChangePassword),
    visiting,
    settled,
  })

  const allow = async () => {
    setBusy(true)
    const got = await askOsPermission()
    recordAnswer(uid, got === 'granted' ? 'granted' : got === 'denied' ? 'denied' : 'later')
    setBusy(false)
    setClosed(uid)
    toast(answerToast(got))
    // allowed: keep this browser for pushes (lib/webPush)
    if (got === 'granted') void ensurePush({ force: true })
  }

  const later = () => {
    recordAnswer(uid, 'later')
    setClosed(uid)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="notification-ask"
          role="dialog"
          aria-labelledby="notification-ask-title"
          aria-describedby="notification-ask-body"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          className={cn(
            'fixed left-4 right-4 z-[70] rounded-lg border border-border bg-surface p-5 shadow-3 sm:left-5 sm:right-auto sm:w-[380px]',
            corner === 'bottom-left' ? 'top-[84px]' : 'bottom-5',
          )}
        >
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue">
              <BellRing size={20} />
            </span>
            <p id="notification-ask-title" className="font-display text-[16px] font-bold leading-tight text-text-1">
              Let urgent shifts reach you
            </p>
          </div>
          <p id="notification-ask-body" className="mb-4 text-[13px] leading-5 text-text-2">
            When a shift is called off or opens up, the platform can show it even while this tab is in
            the background. Your browser will ask you once; you can change it later in Settings.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={later}
              disabled={busy}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => void allow()}
              disabled={busy}
              className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
              Allow notifications
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
