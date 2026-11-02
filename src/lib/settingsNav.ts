// THE SETTINGS SECTIONS — one declared list, two readers.
// The nav and the ⌘K palette both need to know which sections a given person actually has (some are admin-only…
import type { AppManifest } from '@/engine/types'
import { badgeRuleAllows } from '@/lib/badgeAccess'
import { selectAccessChecker } from '@/lib/appAccess'
import type { Role } from '@/auth/types'
import { activeWorldId } from '@/stores/useWorldStore'
import { activeMemberId } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { worldOffered } from '@/lib/worldOffered'

export type SettingsNavEntry = { id: string; icon: string; label: string; adminOnly?: boolean }

export const SETTINGS_NAV: SettingsNavEntry[] = [
  { id: 'appearance', icon: 'palette', label: 'Appearance' },
  { id: 'notifications', icon: 'bell', label: 'Notifications' },
  // The directors' and the master's own: the server answers whether this person has it (`alertReceive` below), so…
  { id: 'alertreceive', icon: 'bell-off', label: 'Alerts I receive' },
  // MY WORLD — and it is deliberately NOT adminOnly: the switch is born ENABLED, and the person whose world it is…
  { id: 'worldaccess', icon: 'globe', label: 'My world' },
  // YOUR APPS — and deliberately NOT adminOnly.
  { id: 'yourapps', icon: 'layout-grid', label: 'Your apps' },
  { id: 'api', icon: 'plug', label: 'API connection', adminOnly: true },
  { id: 'email', icon: 'mail', label: 'Email', adminOnly: true },
  { id: 'access', icon: 'shield-check', label: 'Access control', adminOnly: true },
  { id: 'appcontrol', icon: 'sliders-horizontal', label: 'App control', adminOnly: true },
  // Who else opens App Control, and on which apps — the master's word alone (MASTER_ONLY_SECTIONS).
  { id: 'appcontrolaccess', icon: 'user-check', label: 'App Control access', adminOnly: true },
  // Who else makes each app's delicate edits, edition by edition — the master's word alone (MASTER_ONLY_SECTIONS).
  { id: 'editions', icon: 'key-round', label: 'Editions', adminOnly: true },
  // Which engine answers each migrated app's reads, Apps Script or Python — the master's word alone (MASTER_ONLY_SECTIONS).
  { id: 'backends', icon: 'server', label: 'Back-end per app', adminOnly: true },
  // Every HTTP route the app answers or carries to the relay, on or off — the master's word alone (MASTER_ONLY_SECTIONS).
  { id: 'routes', icon: 'route', label: 'Routes', adminOnly: true },
  // Every signal a write or a clock raises, what answers it, on or off — the master's word alone (MASTER_ONLY_SECTIONS).
  { id: 'events', icon: 'zap', label: 'Events', adminOnly: true },
  // The sheets people still post to, swept into the Hub three times a day, and Sweep now — the master's alone
  // (MASTER_ONLY_SECTIONS).
  { id: 'essentialsheets', icon: 'refresh-cw', label: 'Essential sheets', adminOnly: true },
  // What My Work shows everybody else — the master's word, never a badge's (MASTER_ONLY_SECTIONS).
  { id: 'mywork', icon: 'list-checks', label: 'My Work', adminOnly: true },
  { id: 'dragdrop', icon: 'hand', label: 'Drag & drop', adminOnly: true },
  // only while the Docs app is installed — see the filter below
  { id: 'docslinks', icon: 'book-open', label: 'Docs', adminOnly: true },
  // Test mode governs every message the platform sends, so it sits beside the messages themselves and is admin-only…
  { id: 'hiringrules', icon: 'sliders-horizontal', label: 'Hiring rules', adminOnly: true },
  // THE ASKING RHYTHM (2026-08-29).
  { id: 'flowadmin', icon: 'repeat', label: 'Asking rhythm', adminOnly: true },
  // NEVER GATED ON AN APP.
  { id: 'testmode', icon: 'radio', label: 'Test mode', adminOnly: true },
  // Installed WITH the Client Care app, master-only — the word over everybody's three views and their toolbar (see…
  { id: 'clientsmaster', icon: 'heart-pulse', label: 'Client Care app', adminOnly: true },
  { id: 'hiringmaster', icon: 'git-branch', label: 'Hiring app', adminOnly: true },
  { id: 'potclientsmaster', icon: 'user-plus', label: 'Potential Clients app', adminOnly: true },
  // A NOTIFICATION APP'S CONFIGURATION IS THE APP.
  { id: 'suggestions', icon: 'lightbulb', label: 'Suggestions', adminOnly: true },
  { id: 'smartcomms', icon: 'megaphone', label: 'Smart Comms', adminOnly: true },
  // The 5558 line's machine.
  { id: 'hotline', icon: 'contact', label: 'Support Hotline', adminOnly: true },
  // THE SUPPRESSION LIST LEFT (Smart Comms → Stops).
  { id: 'leadscraper', icon: 'radar', label: 'Lead Scraper', adminOnly: true },
  // The contact clock (phones fill + Quo enrich) works the central users tab — platform data, not one app's — so it…
  { id: 'contactsync', icon: 'clock', label: 'Contact sync', adminOnly: true },
  // The card feed and the ledger's vocabulary — present only while the app is installed, like every other app's…
  { id: 'finance', icon: 'wallet', label: 'Client Finances', adminOnly: true },
  // Both appear only while their app is installed.
  { id: 'shopper', icon: 'shopping-cart', label: 'Smart Shopper', adminOnly: true },
  // A HOME for the category, not one app's section — the Meal Tracker falls into it, and the next wellbeing app…
  { id: 'wellbeing', icon: 'heart-pulse', label: 'Wellbeing', adminOnly: true },
  { id: 'learning', icon: 'graduation-cap', label: 'Learning', adminOnly: true },
  { id: 'travel', icon: 'plane', label: 'Company Travel', adminOnly: true },
  { id: 'ist', icon: 'graduation-cap', label: 'IST', adminOnly: true },
  { id: 'recon', icon: 'clock', label: 'Time Reconciliation', adminOnly: true },
  { id: 'timeoff', icon: 'calendar-off', label: 'Time Off', adminOnly: true },
  // 'System users' MOVED INTO THE USERS APP: one app, three sections — System / Inactive / General — Merge included.
  { id: 'usermenu', icon: 'square-menu', label: 'User menu links', adminOnly: true },
  // The asa-hub containers on the host, read by the status sidecar — the master's alone (MASTER_ONLY_SECTIONS).
  { id: 'hubcontainers', icon: 'container', label: 'Hub containers', adminOnly: true },
  { id: 'data', icon: 'database', label: 'Data', adminOnly: true },
  // ABOVE the company faces on purpose: a tenant is WHICH company you are looking at; this is WHO ELSE stands on…
  { id: 'members', icon: 'users', label: 'Platform users', adminOnly: true },
  { id: 'organization', icon: 'building-2', label: 'Organization' },
  { id: 'profile', icon: 'user', label: 'Profile' },
]

// WHICH APP EACH SETTINGS SECTION BELONGS TO — the pairing, written once.
export const SECTION_APP: Record<string, string> = {
  hiringrules: 'hiring',
  flowadmin: 'hiring',
  clientsmaster: 'clients',
  hiringmaster: 'hiring',
  docslinks: 'docs',
  suggestions: 'suggestions',
  smartcomms: 'smartcomms',
  hotline: 'hotline',
  leadscraper: 'potential-clients',
  // INSTALLED WITH THE APP: tied to the app id, so it appears for whoever can open Potential Clients and disappears…
  potclientsmaster: 'potential-clients',
  finance: 'finance',
  shopper: 'shopper',
  learning: 'learning',
  travel: 'travel',
  // IST Records was ABSORBED into Workforce Compliance and the `ist` app put away (2026-08-29).
  ist: 'employee-tracker',
  recon: 'time-recon',
  timeoff: 'timeoff',
}

// THE SECTIONS THE MASTER HOLDS OUTRIGHT — and no badge rule reaches them.
export const MASTER_ONLY_SECTIONS = ['members', 'appcontrol', 'mywork', 'appcontrolaccess', 'editions', 'hubcontainers',
  'backends', 'routes', 'events', 'essentialsheets']

// An admin-only section an edition also opens: the people Settings › Editions lists only add to the admins.
export const EDITION_SECTIONS: Record<string, string> = {
  docslinks: 'docs.library', learning: 'learning.skills', recon: 'recon.settings',
}
/** The apps whose editions open a section here (editionsMine is asked per app). */
export const EDITION_SECTION_APPS = ['docs', 'learning', 'time-recon']

// THE SECTIONS ONLY THE MASTER AND THE PLATFORM LEAD SEE (the operator, 10-30: hidden "de diretores para baixo
// incluindo os diretores", the master and the Platform Lead kept exactly as they were). Each still needs its own gate
// besides; an edition that opens an admin-only section keeps adding its people.
export const LEAD_SECTIONS = ['api', 'email', 'access', 'appcontrol', 'appcontrolaccess', 'editions', 'backends', 'routes',
  'events', 'essentialsheets', 'mywork', 'testmode', 'clientsmaster', 'hiringmaster', 'potclientsmaster', 'contactsync',
  'usermenu', 'hubcontainers', 'data', 'members', 'worldaccess', 'yourapps', 'docslinks', 'hiringrules', 'suggestions',
  'hotline', 'leadscraper', 'finance', 'wellbeing', 'learning', 'ist', 'recon', 'timeoff']

/** The master, or an account whose ticked badges hold PLATFORMLEAD (never the role word, never a badge it follows). */
export function settingsLead(user: { types?: readonly string[] } | null | undefined, isMaster: boolean): boolean {
  return isMaster || (user?.types ?? []).some((t) => String(t).trim().toUpperCase() === 'PLATFORMLEAD')
}

// The sections THIS person has.
export function settingsNavFor(
  apps: AppManifest[],
  {
    isAdmin,
    isMaster,
    configRules,
    user,
    alertReceive,
    editions,
  }: {
    isAdmin: boolean
    isMaster: boolean
    /** sectionId → badges. Absent = the section's own gate decides alone. */
    configRules?: Record<string, string[]>
    user?: { isMaster?: boolean; types?: string[]; role?: Role } | null
    /** the server answered Settings → Alerts I receive for this person (a director, or the master) */
    alertReceive?: boolean
    /** the editions this person makes (editionsMine): an admin-only section an edition names opens to them too */
    editions?: string[]
  },
): SettingsNavEntry[] {
  const edited = (id: string) => EDITION_SECTIONS[id] !== undefined && (editions ?? []).includes(EDITION_SECTIONS[id])
  // no user handed in (a caller that only wants the shape of the list): the lead's sections stay in the shape
  const lead = !user || settingsLead(user, isMaster)
  const adminHere = (n: SettingsNavEntry) =>
    (!n.adminOnly || isAdmin || edited(n.id)) && (lead || !LEAD_SECTIONS.includes(n.id) || edited(n.id))
  // USER WORLDS: inside a world there is no "My world" section to reach, and the company's machinery is not the…
  const offered = worldOffered()
  if (activeWorldId()) {
    const keep = (id: string) => SETTINGS_NAV.find((n) => n.id === id)!
    // the world's own card is the OWNER's; a visitor gets the personal sections and nothing that configures a world…
    const own = !activeMemberId() && offered
    return [
      keep('appearance'),
      keep('notifications'),
      ...(own ? [{ id: 'myworld', icon: 'sparkles', label: 'My world' }] : []),
      keep('profile'),
    ]
  }
  // INSTALLED HERE, NOT INSTALLED ANYWHERE.
  const allowedHere = selectAccessChecker(apps, (user as { role?: Role } | null | undefined)?.role ?? null)
  const on = (id: string) => {
    if (!apps.some((a) => a.id === id && a.enabled)) return false
    // No user handed in (a caller that only wants the SHAPE of the list — Access control builds its matrix that…
    if (!user) return true
    return allowedHere(id)
  }
  // The Wellbeing section stands while ANY wellbeing app is installed — it is the category's home, so it must not…
  const wellbeing = apps.some((a) => a.category === 'Wellbeing' && a.enabled)
  const gate: Record<string, boolean> = {}
  for (const [section, appId] of Object.entries(SECTION_APP)) gate[section] = on(appId)
  // The master's three: that account's own roster, and the two app policies — each still travelling with its app…
  for (const id of MASTER_ONLY_SECTIONS) {
    const appId = SECTION_APP[id]
    gate[id] = isMaster && (appId ? on(appId) : true)
  }
  gate.mywork = gate.mywork && on('my-work')
  // The category home: it stands while ANY wellbeing app is installed, which is the one gate that cannot be…
  gate.wellbeing = wellbeing
  // the IST settings also hold the first-shift rules Requests runs on, so they stand while either app does
  gate.ist = gate.ist || on('requests')
  gate.alertreceive = alertReceive === true
  const badgeOk = (id: string) => {
    const rule = configRules?.[id]
    if (!rule || rule.length === 0) return true
    // No user handed in (a caller that only wants the shape of the list): rules cannot be applied, so nothing is…
    if (!user) return true
    return badgeRuleAllows(rule, isMaster ? { ...user, isMaster: true } : user)
  }
  // SETTINGS TRAVEL WITH THE APPS: installing an app installs its settings along with it, so a place that holds no…
  const { currentTenantId, homeTenantId, tenantsLoaded } = useTenantStore.getState()
  if (tenantsLoaded && homeTenantId && currentTenantId && currentTenantId !== homeTenantId) {
    // AN APP BRINGS ITS SETTINGS WHEREVER IT IS INSTALLED.
    const HOME_ONLY = ['members', 'clientsmaster', 'hiringmaster', 'appcontrol', 'mywork', 'alertreceive', 'appcontrolaccess',
      'editions', 'hubcontainers', 'backends', 'routes', 'events', 'essentialsheets']
    return SETTINGS_NAV.filter((n) => {
      // `yourapps` rides with the personal three: it describes the apps that reach you HERE, and the access checker…
      if (['appearance', 'notifications', 'profile', 'worldaccess', 'yourapps'].includes(n.id)) {
        return (n.id !== 'worldaccess' || offered) && adminHere(n)
      }
      if (HOME_ONLY.includes(n.id)) return false
      // gated on an app = travels with it; ungated = platform machinery
      if (!(n.id in gate)) return false
      return gate[n.id] && badgeOk(n.id) && adminHere(n)
    })
  }
  return SETTINGS_NAV.filter(
    (n) => adminHere(n) && (!(n.id in gate) || gate[n.id]) && badgeOk(n.id) &&
           (n.id !== 'worldaccess' || offered),
  )
}

// The sections Access control's config-access list offers a rule for: every section the platform has, not the…
export function configAccessSections(apps: AppManifest[], isMaster: boolean): SettingsNavEntry[] {
  return settingsNavFor(apps, { isAdmin: true, isMaster: true })
    .filter((n) => isMaster || (n.id !== 'mywork' && n.id !== 'appcontrolaccess' && n.id !== 'editions' &&
      n.id !== 'hubcontainers' && n.id !== 'backends' && n.id !== 'routes' && n.id !== 'events' &&
      n.id !== 'essentialsheets'))
}
