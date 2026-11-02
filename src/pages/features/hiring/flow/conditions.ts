// THE CONDITION DICTIONARY — what a checklist item MEANS, in one place.
// The record already says which items a person owes and what state each is in (`talentChecklist_`: id · label ·…
export type ConditionFamily = 'asset' | 'decision' | 'report' | 'event' | 'action'

export type ConditionDef = {
  /** One sentence: what has to be TRUE for this to be resolved. */
  truth: string
  /** How it is resolved HERE — the real mechanics, in the order they happen. */
  how: string[]
  /** Where the thing lives or arrives. Words, not links, until a door exists. */
  resources: string[]
  family: ConditionFamily
  // Whether a PERSON resolves it at all.
  machine?: boolean
  // The working doors this condition has on the card, when it has any: 'upload' opens the document modal…
  affordances?: Array<'upload' | 'decide' | 'open-onboarding' | 'request'>
}

// Keyed by checklist id (Talent.gs `talentChecklist_`) — ALL SIXTEEN of them now.
export const CONDITIONS: Record<string, ConditionDef> = {
  application: {
    truth: 'They filled and signed the application form — the envelope that starts a candidacy.',
    how: [
      'The form goes out through Dropbox Sign and comes back signed; the platform mirrors every envelope into its own book, hourly.',
      'Nobody chases it here: an unsigned application is a person who has not finished applying, and the recruiting lane is what asks again.',
      'A signed application opens from the card, the matrix or the documents table: the platform fetches the PDF from Dropbox Sign on the first click, files it privately and reuses the link after that. An unsigned one has no PDF to open, and the square does not offer one.',
    ],
    resources: ['Dropbox Sign', 'The recruitment mirror (recruitment_contracts)'],
    family: 'asset',
    machine: true,
  },
  resume: {
    truth: 'A resume for this person is on file — a document, or an analysis that read one.',
    how: [
      'Look in the folders FIRST — the resume inbox and the two document folders are swept every pass, and a resume already there is collected without anybody being asked.',
      'If it is genuinely absent, the platform asks the candidate by text and letter; the return law says it comes back BY E-MAIL or into one of those folders.',
      'A recruiter can also upload it straight onto the card.',
    ],
    resources: ['The resume inbox folder', 'The two document folders', 'The card’s own Upload'],
    family: 'asset',
    affordances: ['upload'],
  },
  cjis: {
    truth: 'The background check is on file, and a person has read it — Clear or Verified with the report itself attached.',
    how: [
      'The platform never fetches this one. It watches the CJIS folder every half hour and attaches what matches exactly one person.',
      'It never writes Clear or Verified off a filename: those words are a person reading the report, and what they open is the onboarding LOGIN, not the ladder.',
      'Arthur is asked for it — folder first, and again right before the interview invite if it is still absent.',
    ],
    resources: ['The CJIS folder', 'The ask to Arthur (e-mail + text)'],
    // ASSET, not action.
    family: 'asset',
    machine: true,
    affordances: ['upload', 'request'],
  },
  'resume-decision': {
    truth: 'A recruiter has decided: Advance, or not.',
    how: [
      'This is the ONE thing the first gate waits for — since 2026-08-27 neither the resume nor the CJIS blocks the move.',
      'A recruiter records the decision on the card. Somebody screened by voice can be advanced with no document at all.',
    ],
    resources: ['The candidate card, on the Kanban'],
    family: 'decision',
    affordances: ['decide'],
  },
  transcript: {
    truth: 'The phone screening call happened and its transcript is on the record.',
    how: [
      'The candidate calls the evaluation line; the watcher sees their number, files the transcript and the reading chain runs by itself.',
      'A call with no goodbye is CUT and never scored — the platform asks them to call again, on its own clock.',
      'A recruiter who screened them by voice marks it a manual screen, and every checkpoint reads settled.',
    ],
    resources: ['The evaluation line', 'The transcript watcher'],
    family: 'report',
    machine: true,
  },
  'ai-report': {
    truth: 'The transcript has been read and scored, and the report is on the card.',
    how: ['The same analyzer the real lane runs reads the transcript and writes the report, the details and the score.'],
    resources: ['The candidate card — report, score, qualification'],
    family: 'report',
    machine: true,
  },
  'screen-details': {
    truth: 'What the call actually said is on the record — not only that it happened.',
    how: ['Filled by the same analysis pass that writes the report.'],
    resources: ['The candidate card'],
    family: 'report',
    machine: true,
  },
  'advance-decision': {
    truth: 'The deciders have released this person to the interview.',
    how: [
      'The hub writes to Ty and Arthur — letter and text together — when the evaluation is done.',
      'Their WORD is what moves the card; the ear reads the reply, even a late one. Nothing closes on a press.',
    ],
    resources: ['The deciders’ thread', 'The ask book (hiring_sim_asks)'],
    family: 'decision',
    affordances: ['decide'],
  },
  'interview-scheduled': {
    truth: 'An in-person interview is on the calendar for them.',
    how: [
      'The interviewer is asked for their days FIRST; the candidate then picks an hour from a page that is not the application, through their own signed link.',
      'Setting it by hand needs a location and an interviewer — the server refuses an interview without a room and somebody to hold it.',
    ],
    resources: ['The Calendar view', 'The candidate’s signed link'],
    family: 'event',
  },
  'interview-scorecard': {
    truth: 'The interviewer has signed: their name and a score are both on the record.',
    how: [
      'Only the interviewer’s own pen may sign it — it is an attestation that a person sat with the candidate.',
      'This and the recommendation are what the gate to onboarding reads. No scorecard, no move.',
    ],
    resources: ['The interviews app'],
    family: 'decision',
  },
  'interview-recommendation': {
    truth: 'The interviewer has recommended Advance — or said plainly that they do not.',
    how: ['Signed with the scorecard. Anything but Advance is named out loud on the card, in its own words.'],
    resources: ['The interviews app'],
    family: 'decision',
    affordances: ['decide'],
  },
  'new-hire-packet': {
    truth: 'The New Hire Package is signed — in Dropbox Sign, or attested by hand.',
    how: [
      'The envelope book (recruitment_contracts) is the mirror; the chip reads it.',
      'The packet does NOT block onboarding: it holds at graduation instead, and the card stands in amber until it lands.',
      'A green square is not proof of a FILE — the PDF often lives only in Dropbox Sign, so a card only offers to open what the platform really has.',
    ],
    resources: ['Dropbox Sign', 'The packet ask (text + letter)'],
    family: 'asset',
    affordances: ['upload', 'open-onboarding'],
  },
  'onboarding-complete': {
    truth: 'They finished the portal — the New Hire Questionnaire and the Tutorials are both done.',
    how: [
      'They do it themselves, in their own login, which is minted from the CJIS report and the signed packet together.',
      'When the sixth step turns green the platform asks Ty and Arthur one question: may I move them to Ready to Start?',
    ],
    resources: ['The onboarding portal', 'The deciders’ thread'],
    family: 'action',
  },

  // THE THREE OF THE LAST PHASE, and the reason they were the ones missing is the reason they had to be written.
  'staff-account': {
    truth: 'They have a staff account on the platform — the graduation created it.',
    how: [
      'Nobody makes this one by hand: the graduation sweep creates the account when a card reaches Hired with the paperwork behind it.',
      'It reads “creating” while that is still under way, and there is nothing to do but let the pass run.',
      'It reads “held” when the sweep TRIED and stopped — no e-mail address on the card, or that address is already somebody else on the platform. A hold never clears itself: fix the address on their card, or merge the person who already owns it.',
    ],
    resources: ['The graduation sweep (the hiring clock)', 'Users → the account that already owns the address'],
    family: 'action',
    machine: true,
  },
  'staff-account-armed': {
    truth: 'They can actually sign in — the account has a password set.',
    how: [
      'The account is created ACTIVE and with no password, deliberately: the platform never invents somebody’s first credential.',
      'An admin sets it in Users, and the person is told through the usual welcome.',
      'Until then the row reads “they cannot sign in”, which is the literal truth — the account exists and the door does not open.',
    ],
    resources: ['Settings → Users'],
    family: 'action',
  },
  'internal-docs-fill': {
    truth: 'The ASA Employee Database carries their origin details, filled from the signed packet.',
    how: [
      'The platform fills it from the packet by itself and stamps when it did.',
      'If somebody is already editing that row it stands back and says so — “someone is already filling it” is not a failure, it is two hands on one row.',
      'A fill that FAILED is stamped and never retried, so the row names what went wrong and waits for a person. That is why it reads red rather than “pending”: nothing is coming.',
    ],
    resources: ['ASA Employee Database', 'The signed New Hire packet'],
    family: 'action',
    machine: true,
  },
}

/** The dictionary entry, or the honest blank for an id nobody has defined. */
export function conditionDef(id: string): ConditionDef | null {
  return CONDITIONS[id] ?? null
}
