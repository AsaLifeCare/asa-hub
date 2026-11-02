// EMPLOYEE SUPPORT HOTLINE — the line's own sheets, shown inside the system assembled with the three divisions they…
// The desk over the 5558 line: the three divisions the old standalone platform kept (Call Off Tracker · Support…
import type { AppManifest, PageSchema } from '@/engine/types'
import { bookTabPage, type BookTab } from '@/registry/bookPages'

const deskPage: PageSchema = {
  id: 'desk',
  type: 'sheet',
  title: 'Employee Support Hotline',
  icon: 'contact',
  dataSource: { resource: 'supportQueue' },
  config: { entity: ['request', 'requests'], customFeature: 'hotline/HotlinePage' },
}

// The Voice Bot's employee support structure kept in Postgres (app/sheet_resources.py vb* houses): what the line's bot
// knows and follows, worked here behind App Control's hotline.voice-bot control — the master's alone until released.
const voiceBotPages: PageSchema[] = ([
  { id: 'bot-knowledge', title: 'Bot knowledge', icon: 'brain', resource: 'vbCategoryKnowledge',
    columns: ['Categories', 'Knowledge'], long: ['Knowledge'] },
  { id: 'bot-policies', title: 'Bot policies', icon: 'book-open', resource: 'vbPolicies',
    columns: ['Topic', 'Category', 'Domain', 'Summary', 'Key Details', 'Source Doc', 'Source Section'],
    long: ['Summary', 'Key Details'] },
  { id: 'bot-rules', title: 'Bot rules', icon: 'scale', resource: 'vbGeneralRules',
    columns: ['Area', 'Simplified rule'], long: ['Simplified rule'] },
  { id: 'bot-sub-process', title: 'Bot sub-processes', icon: 'git-branch', resource: 'vbSubProcess',
    columns: ['Request Type', 'Description / When Used'], long: ['Description / When Used'] },
  { id: 'bot-category-map', title: 'Bot category map', icon: 'map', resource: 'vbCategoryMap',
    columns: ['Bot Category', 'Policy Categories', 'Data Tabs'] },
  { id: 'bot-follow-ups', title: 'Bot follow-ups', icon: 'list-ordered', resource: 'vbFollowUpsMain',
    columns: ['Step', 'Categories', 'Example Scenario', 'Additional Instructions'],
    long: ['Example Scenario', 'Additional Instructions'] },
  { id: 'bot-incident-follow-ups', title: 'Bot incident follow-ups', icon: 'siren', resource: 'vbFollowUpsIncidents',
    columns: ['Category (Main)', 'Subcategory (Incident Type)', 'Additional Instructions'],
    long: ['Additional Instructions'] },
  { id: 'bot-homes', title: 'Bot homes', icon: 'home', resource: 'vbHomes', columns: ['Home Name', 'Address'] },
  { id: 'bot-clients', title: 'Bot clients', icon: 'users', resource: 'vbClientNames',
    columns: ['Customer', 'House', 'Age', 'Birthdate', 'Guardian', 'Guardian #', 'Guardian Relationship', 'SSA', 'SSA #',
      'SSA Email', 'Payee Rep', 'Payee Rep #', 'Payee Rep Email', 'Workshop', 'Workshop Phone', 'Workshop Address',
      'Transportation', 'Transportation - Phone', 'Address'] },
  { id: 'bot-staff', title: 'Bot staff', icon: 'id-card', resource: 'vbStaffNames',
    columns: ['Staff Names', 'Start Date', 'CPR /1st Aid Exp Date', 'D-O-D-D Expiration Date', 'Med Del 1 Exp Date',
      'Med Del 2 Exp Date', 'Med Del 3 Exp Date', 'Mandt Exp Date', 'Money Mgt Date', 'Drivers License Expiration Date',
      'Car Insurance Expiration Date'] },
  { id: 'bot-schedule', title: 'Bot schedule', icon: 'calendar', resource: 'vbSchedule',
    columns: ['Date', 'Employee', 'Location', 'Start Time', 'End Time', 'Designation', 'Phone'], shown: 7 },
] as BookTab[]).map((tab) => bookTabPage('hotline.voice-bot', tab))

export const hotlineManifests: AppManifest[] = [
  {
    id: 'hotline',
    name: 'Employee Support Hotline',
    tagline: 'The 5558 line — call offs, requests and daily notes, heard and filed',
    icon: 'contact',
    accent: 'peach',
    category: 'Manage',
    version: '1.0.0',
    // Management material: the divisions carry client names and HR matter.
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [deskPage, ...voiceBotPages],
    notifications: ['app'],
  },
]
