// ImageLightbox — one picture, full size, over the page.
// Closes on Esc, on a click outside the picture, or on X; "Open original" is the only way out of the platform, and…
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, X } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'

export default function ImageLightbox({
  src,
  alt,
  caption,
  onClose,
}: {
  /** the full-size original; null or '' keeps the lightbox closed */
  src: string | null
  alt?: string
  caption?: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, onClose])

  return (
    <AnimatePresence>
      {src && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={caption || alt || 'Picture'}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/80 p-4 backdrop-blur-[2px]"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+16px)] grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X size={18} />
          </button>
          <motion.img
            src={src}
            alt={alt ?? caption ?? ''}
            referrerPolicy="no-referrer"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-3"
          />
          <div className="flex flex-wrap items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
            {caption && <p className="font-display text-[14px] font-semibold text-white">{caption}</p>}
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-white/20"
            >
              <ExternalLink size={13} /> Open original
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
