// Bookmarks store (zustand, persisted to localStorage key "asa-bookmarks").
// Any detail panel, sheet row or doc/video card can pin a record via <BookmarkButton bookmark={…} /> — the…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TintName } from '@/engine/types'

export type BookmarkType = 'person' | 'document' | 'video' | 'candidate' | 'page' | 'widget'

export type Bookmark = {
  /** stable id — `${type}:${refId}` */
  id: string
  type: BookmarkType
  /** id of the underlying record (person id, doc id, …) */
  refId: string
  title: string
  subtitle?: string
  /** photo avatar; falls back to a tinted icon tile when absent/broken */
  avatar?: string
  tint: TintName
  /** where "Open" navigates */
  href: string
  createdAt: string // ISO
}

/** What callers supply — id and createdAt are derived by the store. */
export type BookmarkInput = Omit<Bookmark, 'id' | 'createdAt'>

type BookmarksState = {
  bookmarks: Bookmark[]
  /** add when absent, remove when present */
  toggle: (bookmark: BookmarkInput) => void
  remove: (id: string) => void
  isBookmarked: (type: BookmarkType, refId: string) => boolean
}

export const bookmarkId = (type: BookmarkType, refId: string) => `${type}:${refId}`

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      bookmarks: [],
      toggle: (bookmark) =>
        set((s) => {
          const id = bookmarkId(bookmark.type, bookmark.refId)
          if (s.bookmarks.some((b) => b.id === id)) {
            return { bookmarks: s.bookmarks.filter((b) => b.id !== id) }
          }
          return { bookmarks: [{ ...bookmark, id, createdAt: new Date().toISOString() }, ...s.bookmarks] }
        }),
      remove: (id) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),
      isBookmarked: (type, refId) => get().bookmarks.some((b) => b.id === bookmarkId(type, refId)),
    }),
    { name: 'asa-bookmarks' },
  ),
)
