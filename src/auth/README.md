# asa. — Auth & RBAC contract (for wave-2 page agents)

Everything you need to gate UI on the signed-in user. No backend: users are
seeded, sessions persist in `localStorage["asa-auth"]`.

## Files

| File | Exports |
|---|---|
| `src/auth/types.ts` | `Role`, `AuthUser`, `Permission`, `ROLE_LABEL` |
| `src/auth/permissions.ts` | `PERMISSIONS`, `PERMISSION_GROUPS`, `ROLE_PRESETS`, `useCan()`, `<Gate>` |
| `src/auth/useAuthStore.ts` | `useAuthStore` (zustand), `DEMO_USERS`, `AuthState`, `PermissionOverrides` |
| `src/auth/index.ts` | Barrel — every export above is also available from `'@/auth'` |

## The signed-in user

```ts
import { useAuthStore } from '@/auth/useAuthStore'

const user = useAuthStore((s) => s.user)        // AuthUser | null
// AuthUser: { id, name, email, role: 'admin'|'manager'|'staff', avatar, title }
```

Outside React (event handlers, api layer): `useAuthStore.getState().user`.

The app shell already guards routes — inside `Layout`, `user` is never null.
Only `/login` renders signed-out. `logout()` is wired in the Topbar avatar
menu, Sidebar footer and Settings → Profile.

## Permissions

Capability strings, `<area>.<action>`:

```
people.view/edit   clients.view/edit   schedule.view/edit
hiring.view/edit   knowledge.view/edit academy.view/edit
inventory.view/edit
expenses.edit      tags.edit           apps.manage
settings.api       settings.access
```

`.view` = read access to an area/app, `.edit` = mutations. The last four are
standalone specials. Always reference them as the `Permission` union type —
do not invent new strings; if your app needs one, ask the auth owner to add
it to `types.ts` + `PERMISSIONS` + `PERMISSION_GROUPS` + `ROLE_PRESETS`.

`ROLE_PRESETS` (defaults before admin overrides):

- **admin** — everything.
- **manager** — all `.view`; edit `schedule`, `hiring`, `knowledge`,
  `academy`, `tags.edit`. No `people/clients/inventory` edits, no
  `expenses.edit`, `apps.manage`, `settings.api`, `settings.access`.
- **staff** — all `.view`, nothing else.

Admins can grant/deny individual permissions per user in
Settings → Access control; those `overrides` beat the preset
(`override ?? ROLE_PRESETS[role]`).

## Checking access

### Hook — `useCan(perm)`

```tsx
import { useCan } from '@/auth/permissions'

const canEdit = useCan('schedule.edit')   // boolean, reactive, false when signed out
```

Use it for conditional logic: disabling buttons, choosing empty states,
filtering row actions.

### Component — `<Gate perm fallback?>`

```tsx
import { Gate } from '@/auth/permissions'

<Gate perm="hiring.edit">
  <MoveCandidateButton />
</Gate>

<Gate perm="settings.api" fallback={<RestrictedNote />}>
  <ApiForm />
</Gate>
```

Renders `children` when allowed, else `fallback` (default `null`).

### Non-React / one-off checks

```ts
const ok = useAuthStore.getState().can(user, 'people.edit')
```

## How gating should degrade UI — rules

1. **Hide** navigation, whole pages/sections and destructive one-off actions
   the user can never use (`<Gate>` with no fallback). A staff member should
   never see an "Access control" entry point.
2. **Disable + explain** contextual actions where discovering the feature is
   still valuable: render the control disabled with a `title`/tooltip like
   `"Requires schedule.edit — ask an admin"`, not a hidden gap.
   ```tsx
   const canEdit = useCan('schedule.edit')
   <button disabled={!canEdit} title={canEdit ? undefined : 'Requires schedule.edit — ask an admin'} …>
   ```
3. **Substitute** for whole regions the user is aware of (deep links,
   anchors): an `EmptyState`-style "Restricted — admins only" panel (see
   `SettingsPage` → `#api`).
4. Mutations must **also** be checked at the call site (`useCan` before
   `api.update/create/remove`) — UI gating is not a security layer, but keep
   the demo honest: never fire a mutation the user lacks permission for.

## Store surface (you rarely need these)

```ts
useAuthStore((s) => s.users)                 // directory: 6 demo users
useAuthStore((s) => s.overrides)             // userId → { perm: bool }
s.login(userId) / s.logout()
s.setOverride(userId, perm, value | null)    // null = back to role default
s.resetOverrides(userId)
s.can(user, perm)                            // effective check
```

Do not write `users`, `user` or `overrides` directly — use the actions so
persistence (`asa-auth`) stays consistent.
