// The section a page is showing, named in the topbar's breadcrumb: an app whose sections are tabs on one route
// (Locations › Staff, Clients › Care & Support) says which one is open, instead of the route's own page title.
import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { create } from 'zustand'

type Crumb = { path: string; label: string }

const useCrumbStore = create<{ crumb: Crumb | null }>(() => ({ crumb: null }))

/** Names the open section while the page shows it; the breadcrumb falls back to the route's title once it leaves. */
export function useSectionCrumb(label: string | null | undefined): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const said = (label ?? '').trim()
    if (!said) return
    useCrumbStore.setState({ crumb: { path: pathname, label: said } })
    return () => {
      const held = useCrumbStore.getState().crumb
      if (held && held.path === pathname && held.label === said) useCrumbStore.setState({ crumb: null })
    }
  }, [pathname, label])
}

/** The section the page at `pathname` named; '' when none did. */
export function useSectionCrumbFor(pathname: string): string {
  return useCrumbStore((s) => (s.crumb && s.crumb.path === pathname ? s.crumb.label : ''))
}
