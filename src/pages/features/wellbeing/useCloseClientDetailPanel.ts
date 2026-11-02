// Shared page bits for wellbeing feature pages.
import { useEffect } from 'react'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'

/** Wellbeing pages use their own modals — close the global client detail panel. */
export function useCloseClientDetailPanel() {
  useEffect(() => {
    useDetailPanelStore.getState().closeDetail()
  }, [])
}
