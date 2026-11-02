// NOTIFICATION APPS — apps with no interface of their own.
// A notifications app is installed like any other and its instance is listed inside My asa., since there is no…
import type { AppManifest } from '@/engine/types'

export const notificationManifests: AppManifest[] = [
  {
    id: 'smartcomms',
    name: 'Smart Comms',
    tagline: 'Every reminder this platform sends, and the conditions that send it',
    icon: 'megaphone',
    accent: 'amber',
    category: 'Notifications',
    version: '1.1.0',
    isNew: true,
    enabled: true,
    // THE PLATFORM'S OWNER, AND NOBODY ELSE: the Comms app is seen by one account only.
    audience: ['admin'],
    notifications: ['reminder'],
    // IT HAS A FACE NOW — Smart Comms was an app with no interface at all, and it carries a proper one now.
    pages: [
      {
        id: 'overview', type: 'sheet', title: 'Desk', icon: 'megaphone',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['situation', 'situations'], customFeature: 'smartcomms/SmartCommsPage' },
      },
      // THE CATALOGUE — the list of every smart comm there is, shown somewhere in the interfaces, with the…
      {
        id: 'catalogue', type: 'sheet', title: 'Catalogue', icon: 'library',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['situation', 'situations'], customFeature: 'smartcomms/SmartCommsCataloguePage' },
      },
      // THE WORDS — the screen for changing the messages that live in the sheets, with the guidelines and…
      {
        id: 'words', type: 'sheet', title: 'Words', icon: 'message-square-quote',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['message', 'messages'], customFeature: 'smartcomms/SmartCommsWordsPage' },
      },
      // THE REHEARSAL.
      {
        id: 'rehearsal', type: 'sheet', title: 'Rehearsal', icon: 'clipboard-list',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['intent', 'intents'], customFeature: 'comms/CommsBoardPage' },
      },
      {
        id: 'activity', type: 'sheet', title: 'Activity', icon: 'history',
        dataSource: { resource: 'smartCommsActivity' },
        config: { entity: ['delivery', 'deliveries'], customFeature: 'smartcomms/SmartCommsActivityPage' },
      },
      // HOW IT WORKS — Smart Comms was too obscure to read from outside.
      {
        id: 'replies', type: 'sheet', title: 'Replies', icon: 'message-square-reply',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['reply', 'replies'], customFeature: 'smartcomms/SmartCommsRepliesPage' },
      },
      // STOPS.
      {
        id: 'stops', type: 'sheet', title: 'Stops', icon: 'ban',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['stop', 'stops'], customFeature: 'smartcomms/SmartCommsStopsPage' },
      },
      // WHEN — a person can be sent messages and e-mails in the fifteen minutes before their shift without being…
      {
        id: 'when', type: 'sheet', title: 'When', icon: 'alarm-clock',
        dataSource: { resource: 'commWhen' },
        config: { entity: ['moment', 'moments'], customFeature: 'smartcomms/SmartCommsWhenPage' },
      },
      // THE PUNCH BOARD.
      {
        id: 'punchboard', type: 'sheet', title: 'Punch board', icon: 'clipboard-check',
        dataSource: { resource: 'commPunchBoard' },
        config: { entity: ['shift', 'shifts'], customFeature: 'smartcomms/SmartCommsPunchBoardPage' },
      },
      // THE PUNCH RECORD — PsiAnywhere needs a screen of its own.
      {
        id: 'punches', type: 'sheet', title: 'Punches', icon: 'clock',
        // IT NAMED THE WRONG RESOURCE.
        dataSource: { resource: 'psiPunches' },
        config: { entity: ['punch', 'punches'], customFeature: 'psipunches/PsiPunchesPage' },
      },
      // THE TWO BOOKS, READ TOGETHER — PsiAnywhere and the call-off book on one combined page, the one that was…
      {
        id: 'attendance', type: 'sheet', title: 'Attendance', icon: 'user-x',
        dataSource: { resource: 'commAttendance' },
        config: { entity: ['person', 'people'], customFeature: 'smartcomms/SmartCommsAttendancePage' },
      },
      // THE TWO PHONE LINES, ON ONE SCREEN: the five modalities together, with the transcript, the summary, the…
      {
        id: 'hotline', type: 'sheet', title: 'Hotline', icon: 'phone',
        dataSource: { resource: 'commCalls' }, // nominal — the page reads /hub-lanes/hotline
        config: {
          entity: ['call', 'calls'],
          customFeature: 'smartcomms/SmartCommsHotlinePage',
          // not read by this page — see above: they are what a Smart Comms badge is handed for the widget tiles…
          reads: [{ resource: 'callOffs' }, { resource: 'supportQueue' }, { resource: 'uiIncidents' }],
        },
      },
      // Broadcast: nominal resource; the page uses its own badge-checked actions
      {
        id: 'broadcast', type: 'sheet', title: 'Broadcast', icon: 'send',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['broadcast', 'broadcasts'], customFeature: 'smartcomms/SmartCommsBroadcastPage' },
      },
      // Recruiting texts: reads `recruitBook` only, never writes or sends
      {
        id: 'recruiting', type: 'sheet', title: 'Recruiting texts', icon: 'calendar-clock',
        dataSource: { resource: 'recruitBook' },
        config: { entity: ['text', 'texts'], customFeature: 'smartcomms/SmartCommsRecruitingPage' },
      },
      // WHAT THE REPLIES TAUGHT: duplicate and copy, never share the same one — two writers on one sheet end badly.
      {
        id: 'proposals', type: 'sheet', title: 'Proposals', icon: 'sparkles',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['proposal', 'proposals'], customFeature: 'smartcomms/CommProposals' },
      },
      {
        id: 'guide', type: 'sheet', title: 'How it works', icon: 'book-open',
        dataSource: { resource: 'smartCommsDesk' },
        config: { entity: ['section', 'sections'], customFeature: 'smartcomms/SmartCommsGuidePage' },
      },
    ],
  },
]
