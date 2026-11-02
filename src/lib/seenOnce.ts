// ONE EXPLAINER, ONCE PER PERSON — the shelf of ids an intro has been shown to.
// The id-lists ride prefsSync (whitelisted keys), so the mark follows the person to every browser, and a release…
import { useMemo, useState, useSyncExternalStore } from 'react'
import { onPrefsSettled, prefsSettled } from '@/lib/prefsSettled'

/** The ids on one shelf; an unreadable shelf is empty — the intro shows once more, the harmless way to fail. */
export function seenIdsOf(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

export type SeenOnce = {
  /** true while nobody is signed in, until the pull lands, and once this person has been shown it */
  seen: boolean
  /** writes the mark, carries it up, and closes the intro */
  markSeen: () => void
}

export function useSeenOnce(key: string, uid: string): SeenOnce {
  const settled = useSyncExternalStore(onPrefsSettled, prefsSettled, () => false)
  /** Only a press closes it — openness is derived from the shelf, never mirrored into state by an effect. */
  const [dismissed, setDismissed] = useState('')
  const onShelf = useMemo(
    () => (uid ? seenIdsOf(key).includes(uid) : true),
    // `dismissed` and `settled` are read only to re-run this
    [key, uid, dismissed, settled],
  )

  const markSeen = (): void => {
    try {
      const next = [...new Set([...seenIdsOf(key), uid])].slice(-40)
      localStorage.setItem(key, JSON.stringify(next))
      void import('@/lib/prefsSync').then((m) => m.schedulePrefsPush())
    } catch {
      /* storage unavailable — they see it once more, the harmless way to fail */
    }
    setDismissed(uid)
  }

  return { seen: !uid || !settled || dismissed === uid || onShelf, markSeen }
}
