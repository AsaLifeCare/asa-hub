// Shared full-screen detail modal for wellbeing cards (meals, workout, sleep, hydration).
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { AppIcon } from '@/lib/icons'
import SafeImg, { type FallbackTint } from '@/components/shared/SafeImg'

export default function DetailModal({
  open,
  onClose,
  title,
  ariaLabel,
  image,
  imageIcon,
  imageTint,
  imageAlt,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  ariaLabel: string
  image?: string
  imageIcon: string
  imageTint?: FallbackTint
  imageAlt: string
  children: ReactNode
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            className="scroll-thin relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface shadow-3"
            onClick={(e) => e.stopPropagation()}
          >
            {image !== undefined && (
              <SafeImg
                src={image}
                icon={imageIcon}
                tint={imageTint}
                shape="square"
                size="aspect-[16/9] w-full rounded-none"
                alt={imageAlt}
              />
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 shadow-1 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <AppIcon name="x" size={15} />
            </button>
            <div className="p-5 sm:p-6">
              <p className="font-mono text-[12px] font-semibold uppercase tracking-wide text-tint-fg-info">{title}</p>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
