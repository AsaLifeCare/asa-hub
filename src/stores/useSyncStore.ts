// Backend-sync store (zustand, persisted to localStorage["asa-sync"]).
// Configuration + last-run bookkeeping for the consolidated questionnaire response push (src/lib/responseSync.ts)…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SyncState = {
  /** Apps Script web app (/exec) URL that consolidated responses are POSTed to. */
  endpointUrl: string
  lastSyncAt: string | null // ISO
  lastSyncOk: number
  lastSyncFailed: number

  setEndpoint: (url: string) => void
  recordSync: (result: { ok: number; failed: number }) => void
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      endpointUrl: '',
      lastSyncAt: null,
      lastSyncOk: 0,
      lastSyncFailed: 0,

      setEndpoint: (url) => set({ endpointUrl: url.trim() }),

      recordSync: ({ ok, failed }) =>
        set({ lastSyncAt: new Date().toISOString(), lastSyncOk: ok, lastSyncFailed: failed }),
    }),
    { name: 'asa-sync' },
  ),
)
