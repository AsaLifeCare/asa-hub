/** The current route for code outside React: the app is a HashRouter, so it lives after the `#`. */
export type Route = { pathname: string; search: string }

export function routeNow(loc: Pick<Location, 'hash' | 'pathname' | 'search'> | undefined =
  typeof window !== 'undefined' ? window.location : undefined): Route {
  if (!loc) return { pathname: '', search: '' }
  const hash = String(loc.hash || '')
  if (hash.startsWith('#/')) {
    const body = hash.slice(1)
    const at = body.indexOf('?')
    return at === -1
      ? { pathname: body, search: '' }
      : { pathname: body.slice(0, at), search: body.slice(at) }
  }
  // Only a build served without the hash router has its route in the path.
  return { pathname: String(loc.pathname || ''), search: String(loc.search || '') }
}

/** Whether the conversation with `fromUser` is on screen: the chat screen's `viewing` first, else the address. */
export function lookingAtConversation(fromUser: string, viewing: string | null | undefined,
  route: Route = routeNow()): boolean {
  if (!fromUser) return false
  if (viewing !== undefined) return viewing === fromUser
  return route.pathname.startsWith('/app/chat/') &&
    new URLSearchParams(route.search).get('with') === fromUser
}
