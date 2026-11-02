// WHO ACTUALLY READ THIS DOCUMENT.
// The reader used to print "Read by 14" from `6 + hash(doc.id) % 14` under three faces picked out of the demo…
import { api } from '@/lib/api'
import { useAuthStore } from '@/auth/useAuthStore'

export type DocRead = { doc: string; name: string; at: string }

/** rows already loaded this session, by document title */
let cache: Map<string, DocRead[]> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const str = (v: unknown) => String(v ?? '').trim()

function announce() {
  for (const fn of listeners) fn()
}

export function onDocReads(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

async function load(): Promise<void> {
  if (cache) return
  if (!loading) {
    loading = api
      .list<Record<string, unknown>>('policyAcks' as never)
      .then((rows) => {
        const next = new Map<string, DocRead[]>()
        for (const r of Array.isArray(rows) ? rows : []) {
          const doc = str(r.policy)
          const name = str(r.staff)
          if (!doc || !name) continue
          const list = next.get(doc) ?? []
          if (!list.some((x) => x.name === name)) {
            list.push({ doc, name, at: str(r.signedAt) || str(r.effectiveDate) })
          }
          next.set(doc, list)
        }
        cache = next
        announce()
      })
      .catch(() => {
        cache = new Map()
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}

/** Everyone on record as having read this document. */
export function readersOf(docTitle: string): DocRead[] {
  void load()
  return cache?.get(docTitle) ?? []
}

// Record that the signed-in person opened this document — once.
export async function recordRead(docTitle: string): Promise<void> {
  const user = useAuthStore.getState().user
  const name = user?.name || user?.email
  if (!name || !docTitle) return
  await load()
  const already = (cache?.get(docTitle) ?? []).some((r) => r.name === name)
  if (already) return

  const at = new Date().toISOString()
  const list = cache?.get(docTitle) ?? []
  list.push({ doc: docTitle, name, at })
  cache?.set(docTitle, list)
  announce()

  try {
    await api.create('policyAcks' as never, {
      policy: docTitle,
      staff: name,
      status: 'read',
      effectiveDate: at,
    } as never)
  } catch {
    /* a read receipt is not worth interrupting a reader for */
  }
}
