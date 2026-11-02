/** Shared motion presets (§9.5). easeOutExpo + enter-stagger variants. */
import type { Variants } from 'framer-motion'

export const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number]

/** Container: stagger direct children 50ms (templates cap animated children at 8). */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}

/** Item: y 14→0 + fade, 280ms easeOutExpo. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } },
}
