// THE WELCOME SEQUENCE, AS DATA (the Release Users work).
// The step list of the first-login tour, extracted from FirstLoginTour so a second screen can show the SAME words…
import { Building2, Boxes, Globe2, PartyPopper, RefreshCw, Users } from 'lucide-react'
import { badgeRuleAllows } from '@/lib/badgeAccess'

// Where a broken thing gets reported — named on the last step for everybody and on the franchise step for directors.
export const SUPPORT_CONTACT = '(330) 919-5558 · asatech@asalifecare.com'

export type TourStep = {
  id: string
  icon: typeof Boxes
  tint: string
  title: string
  body: string
}

// WHO HEARS ABOUT AKRON — the four named words, read as BADGES.
const AKRON_BADGES = ['DIRECTOR', 'ADMINISTRATOR', 'ADMIN', 'MANAGER']

type TourUser = { isMaster?: boolean; types?: string[]; role?: string; myWorld?: boolean } | null | undefined

// The steps one person will see, in order — the director step included only when the badge rule says so.
export function tourStepsFor(user: TourUser): TourStep[] {
  const worlds = Boolean(user?.isMaster) || user?.myWorld !== false
  const list: TourStep[] = []
  if (worlds) {
    list.push({
      id: 'build',
      icon: Boxes,
      tint: 'bg-tint-lavender text-tint-fg-lavender',
      title: 'You can build apps here',
      body:
        'The Playground turns a description into a working app — pages, columns, data and all — ' +
        'without anybody writing code. Build one inside YOUR WORLD for your own life, or inside ' +
        'YOUR WORK for what ASA LifeCare does. Same studio, two purposes.',
    })
  } else if (user?.role === 'admin') {
    list.push({
      id: 'build',
      icon: Boxes,
      tint: 'bg-tint-lavender text-tint-fg-lavender',
      title: 'You can build apps here',
      body:
        'The Playground turns a description into a working app — pages, columns, data and all — ' +
        'without anybody writing code, for what ASA LifeCare does.',
    })
  }
  list.push({
    id: 'stand-in',
    icon: Users,
    tint: 'bg-tint-blue text-tint-fg-blue',
    title: 'You can stand in another account',
    body:
      'If somebody puts you on their platform, you can open their workspace and work in it' +
      (worlds ? ' — with or without their world alongside' : '') + '. What you write lands in THEIR ' +
      'environment, not yours, and either of you can end it at any time.',
  })
  if (worlds) {
    list.push({
      id: 'world-is-a-place',
      icon: Globe2,
      tint: 'bg-tint-mint text-tint-fg-mint',
      title: 'Your world is a place, not a folder',
      body:
        'My world is a TENANT, exactly like ASA LifeCare Ohio is a tenant. At the level of the ' +
        'application they are equals — same standing, same machinery, different purpose. Yours ' +
        'holds your own data; the headquarters holds the company’s.',
    })
  }
  if (badgeRuleAllows(AKRON_BADGES, user)) {
    list.push({
      id: 'akron',
      icon: Building2,
      tint: 'bg-tint-amber text-tint-fg-amber',
      title: 'Akron is a simulation, and it has a date on it',
      // "a director" became "your badge": four words already opened this step before a fifth could reach it through…
      body:
        'Because of your badge, you also have access to FRANCHISE — the Asa Lifecare ' +
        'Franchise Akron tenant, a second place where the franchise machinery is tested against ' +
        'the real thing. It stays on for the next few days and will be switched off after that, ' +
        'so treat what you make there as a rehearsal, not a record. Explore it and test it as ' +
        'much as you like — that is what it is for. And if anything breaks or looks wrong, ' +
        `tell us: ${SUPPORT_CONTACT}.`,
    })
  }
  if (worlds) {
    list.push({
      id: 'update-apps',
      icon: RefreshCw,
      tint: 'bg-tint-peach text-tint-fg-peach',
      title: 'If your app list looks out of date',
      body:
        'Go to YOUR WORLD, open WORLD HOME, and press UPDATE APPS. The newest catalogue and the ' +
        'newest versions load into your account. Nothing you built is touched — an app you made ' +
        'stays yours, and one you removed stays removed.',
    })
  }
  list.push({
    id: 'enjoy',
    icon: PartyPopper,
    tint: 'bg-tint-pink text-tint-fg-pink',
    title: 'Enjoy it — and test it',
    body:
      'That is everything you need to start. Press below and the platform opens at the ' +
      'headquarters, ASA LifeCare Ohio. Use it and test it as much as you like — and if ' +
      'something looks wrong, it probably is, so say so: ' + SUPPORT_CONTACT + '.',
  })
  return list
}

// Kept for the preview's "the sequence ends here" marker — the real tour's last button caption.
export const TOUR_FINISH_LABEL = 'Open ASA LifeCare Ohio'
