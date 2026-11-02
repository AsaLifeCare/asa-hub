// THE MEMBER BEING VISITED.
// They come in with their current badge and their own authorisations and limitations — as though the user were…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type MemberState = {
  currentMemberId: string
  memberName: string
  memberRole: string
  // THE BADGES THEY WEAR (2026-08-19, the sixth round).
  memberTypes: string[]
  // WHAT THEIR OWN CARD SHOWS.
  memberAvatar: string
  memberEmail: string
  memberTitle: string
  memberScope: 'work' | 'work_world' | ''
  memberEpoch: number
  enterMember: (m: {
    member_id: string; name: string; role: string; scope: string
    types?: string[]; avatar?: string; email?: string; title?: string
  }) => void
  leaveMember: () => void
}

export const useMemberStore = create<MemberState>()(
  persist(
    (set, get) => ({
      currentMemberId: '',
      memberName: '',
      memberRole: '',
      memberTypes: [],
      memberAvatar: '',
      memberEmail: '',
      memberTitle: '',
      memberScope: '',
      memberEpoch: 0,
      enterMember: (m) => {
        set({
          currentMemberId: String(m.member_id || ''),
          memberName: String(m.name || ''),
          memberRole: String(m.role || ''),
          memberTypes: (m.types ?? []).map((t) => String(t)).filter(Boolean),
          memberAvatar: String(m.avatar || ''),
          memberEmail: String(m.email || ''),
          memberTitle: String(m.title || ''),
          memberScope: m.scope === 'work_world' ? 'work_world' : 'work',
          memberEpoch: get().memberEpoch + 1,
        })
      },
      leaveMember: () => set({
        currentMemberId: '', memberName: '', memberRole: '', memberTypes: [],
        memberAvatar: '', memberEmail: '', memberTitle: '', memberScope: '',
        memberEpoch: get().memberEpoch + 1,
      }),
    }),
    { name: 'asa-member' },
  ),
)

/** The member id on the wire ('' = nobody) — activeWorldId()'s sibling. */
export function activeMemberId(): string {
  return useMemberStore.getState().currentMemberId
}
