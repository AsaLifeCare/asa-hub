// WHOSE GROUND AM I STANDING ON — one answer, for every surface that names it.
// THE PROBLEM THIS SOLVES: "Their world" rendered the viewer's OWN My world.
import { useMemberStore } from '@/stores/useMemberStore'
import { useWorldStore } from '@/stores/useWorldStore'

export type StandingKind =
  /** company ground, the signed-in account's own */
  | 'company'
  /** the signed-in account's own world */
  | 'my-world'
  /** somebody else's work, here on company ground */
  | 'their-work'
  /** somebody else's world */
  | 'their-world'

export type Standing = {
  kind: StandingKind
  /** the person whose ground this is — '' when it is the viewer's own */
  owner: string
  /** their FIRST name, which is what a chip has room for */
  ownerFirst: string
  /** false exactly while standing on somebody else's ground */
  mine: boolean
}

/** The first word of a name — chips and headers have no room for the rest. */
export function firstNameOf(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] ?? ''
}

// PURE: the two persisted axes in, the place out.
export function standingFrom(memberName: string, memberId: string, worldId: string): Standing {
  const visiting = Boolean(memberId)
  const inWorld = Boolean(worldId)
  const owner = visiting ? String(memberName ?? '') : ''
  const kind: StandingKind = visiting
    ? (inWorld ? 'their-world' : 'their-work')
    : (inWorld ? 'my-world' : 'company')
  return { kind, owner, ownerFirst: firstNameOf(owner), mine: !visiting }
}

/** Reactive: re-renders on every crossing. */
export function useStanding(): Standing {
  const memberName = useMemberStore((s) => s.memberName)
  const memberId = useMemberStore((s) => s.currentMemberId)
  const worldId = useWorldStore((s) => s.currentWorldId)
  return standingFrom(memberName, memberId, worldId)
}
