// useDraftGuard — one call per editable surface: "there is typed, unsaved work here".
// While `dirty` is true the surface is registered in useDraftStore with the CURRENT location (pathname + search)…
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useDraftStore } from '@/stores/useDraftStore'
import { markLiveDraft } from '@/lib/typedWork'

const REGISTER_DELAY_MS = 350

export function useDraftGuard({ id, label, dirty }: { id: string; label: string; dirty: boolean }): void {
  const { pathname, search } = useLocation()
  const href = pathname + search

  // on screen and dirty, at once and only while mounted: a reload asks this before it would lose the typing…
  const [me] = useState(() => ({}))
  useEffect(() => {
    markLiveDraft(me, dirty)
    return () => markLiveDraft(me, false)
  }, [me, dirty])

  // Snapshot for the unmount cleanup — a route change unmounts the old page WITHOUT re-rendering it against the new…
  const latest = useRef({ id, label, href, dirty })
  useEffect(() => {
    latest.current = { id, label, href, dirty }
  })

  useEffect(() => {
    const { setDraft, clearDraft } = useDraftStore.getState()
    if (!dirty) {
      // Saved / cancelled / arrived back clean: the reminder's job is done.
      clearDraft(id)
      return
    }
    const t = setTimeout(() => setDraft(id, label, href), REGISTER_DELAY_MS)
    return () => clearTimeout(t)
  }, [dirty, id, label, href])

  useEffect(
    () => () => {
      // Unmounting while dirty: flush the (possibly still debounced) registration so the draft survives the…
      const { id, label, href, dirty } = latest.current
      if (dirty) useDraftStore.getState().setDraft(id, label, href)
    },
    [],
  )
}
