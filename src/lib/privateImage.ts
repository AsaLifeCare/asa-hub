// PRIVATE PICTURES — a house photo the relay keeps (server/house_images.py) opens only for a session that sees the house,
// a person's photo (server/person_photos.py) only for one an app showing that person is open to. Each is fetched with
// the session's own bearer and drawn from a blob; every other source is drawn as it is.
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'

const PRIVATE_PATH = new RegExp('^/hub-lanes/(?:locations/image/[A-Z]{2,4}\\d{3,6}'
  + '|photos/(?:clients|staff|ssa|families|staff-candidates|client-candidates)/(?!.*\\.\\.)[A-Za-z0-9_][A-Za-z0-9_.\\-]{0,119})'
  + '/\\d{8}T\\d{9}Z\\.(jpg|png|webp)$')

/** The relay path a picture names when it is a private one, whatever origin it was stored with; '' otherwise. */
export function privatePath(src: string | null | undefined): string {
  const s = String(src ?? '').trim()
  if (!s || !/^(https?:\/\/[^/]+)?\/hub-lanes\//i.test(s)) return ''
  try {
    const u = new URL(s, 'https://relay.invalid')
    return !u.search && !u.hash && PRIVATE_PATH.test(u.pathname) ? u.pathname : ''
  } catch {
    return ''
  }
}

// token|path -> the blob URL on its way; a refusal is forgotten, so the next draw asks again
const held = new Map<string, Promise<string>>()
let heldFor: string | null = null

function forgetAll(): void {
  for (const p of held.values()) p.then((url) => URL.revokeObjectURL(url)).catch(() => {})
  held.clear()
}

/** The picture's blob URL, asked of this origin's relay with the session's own bearer; one request per picture. */
function blobOf(path: string, token: string | null): Promise<string> {
  if (token !== heldFor) {
    forgetAll()
    heldFor = token
  }
  const key = `${token ?? ''}|${path}`
  const got = held.get(key)
  if (got) return got
  const p = fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(async (res) => {
      const type = String(res.headers.get('content-type') || '')
      if (!res.ok || !type.startsWith('image/')) throw new Error(`the server answered ${res.status}`)
      return URL.createObjectURL(await res.blob())
    })
  p.catch(() => { if (held.get(key) === p) held.delete(key) })
  held.set(key, p)
  return p
}

export type PrivateSrc = { src: string | null | undefined; pending: boolean; refused: boolean }

/** What an <img> draws for `src`: a private picture's blob once it is read; any other source untouched. */
export function usePrivateSrc(src: string | null | undefined): PrivateSrc {
  const path = privatePath(src)
  const token = useAuthStore((s) => s.token)
  const key = path ? `${token ?? ''}|${path}` : ''
  const [got, setGot] = useState<{ key: string; url: string; refused: boolean }>({ key: '', url: '', refused: false })
  useEffect(() => {
    if (!key) return
    let live = true
    blobOf(path, token)
      .then((url) => { if (live) setGot({ key, url, refused: false }) })
      .catch(() => { if (live) setGot({ key, url: '', refused: true }) })
    return () => { live = false }
  }, [key, path, token])
  if (!path) return { src, pending: false, refused: false }
  if (got.key !== key) return { src: '', pending: true, refused: false }
  return { src: got.url, pending: false, refused: got.refused }
}
