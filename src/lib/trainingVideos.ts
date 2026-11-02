// The new-hire videos, straight from the source Drive folders.
// NINE NOW, AND SIX OF THEM WERE MISSING — the folder holds all the content, and whatever was not already here had…

export type TrainingVideo = {
  id: string
  driveId: string
  title: string
  blurb: string
  seconds: number
  /** width / height, as reported by Drive — drives the player box */
  aspect: number
  // IS THIS ONE OF THE THREE A NEW HIRE MUST WATCH?
  newHire?: boolean
}

export const TRAINING_VIDEOS: TrainingVideo[] = [
  {
    id: 'tv-tracking-time',
    newHire: true,
    driveId: '1AoGMcUxTzphcKLTPzMMcj12c0O62J71E',
    title: 'Tracking Time',
    blurb: 'Clock in and out with PSI Anywhere, and fix a missed punch the right way.',
    seconds: 160,
    aspect: 1080 / 1920,
  },
  {
    id: 'tv-mui-portal',
    newHire: true,
    driveId: '1cPM87vLIqnzTsooKs6-Bm7bsiNe6y-9U',
    title: 'UI / MUI Portal',
    blurb: 'Walkthrough of the incident portal — where reports go and how to file one.',
    seconds: 281,
    aspect: 886 / 1920,
  },
  {
    id: 'tv-reporting-incidents',
    newHire: true,
    driveId: '1cOtGxl9yZXyhTLIlkOncNq4iT9DTxJfj',
    title: 'Reporting Incidents',
    blurb: 'What to do the moment something happens: keep everyone safe, then report before your shift ends.',
    seconds: 60,
    aspect: 750 / 1334,
  },
  /* ── the second folder (2026-08-23): six nobody could watch here ── */
  {
    id: 'tv-clock-in-1',
    driveId: '154x3Up7U2w2_uDwQ4s9R38zloiCUPB_S',
    title: 'Clocking In — part 1',
    blurb: 'The clock-in walkthrough, filmed on the phone people actually use.',
    seconds: 238,
    aspect: 1180 / 2556,
  },
  {
    id: 'tv-clock-in-2',
    driveId: '1Ab-YyiRH9cjX0o3ylHD3FGrF5GHEIdwp',
    title: 'Clocking In — part 2',
    blurb: 'The rest of it: what to do when the first attempt does not take.',
    seconds: 93,
    aspect: 1180 / 2556,
  },
  {
    id: 'tv-delivered-meds',
    driveId: '1Ft65MuItBlBSYKgx7zUcNNQd03n7g2Gk',
    title: 'Delivered Medications',
    blurb: 'Recording a medication delivery when the pharmacy brings it to the house.',
    seconds: 69,
    aspect: 1206 / 2622,
  },
  {
    id: 'tv-log-doc-appt',
    driveId: '1jH00YITYLxwj1ZafAjZ5KjekFxZrA_q-',
    title: 'Logging a Doctor Appointment',
    blurb: 'Where an appointment goes after the visit, so the next shift can see it.',
    seconds: 96,
    aspect: 1180 / 2556,
  },
  {
    id: 'tv-receipt-upload',
    driveId: '1-KK2UEBe5rBglGm_eSi8nHwp-iQGXdEF',
    title: 'Uploading a Receipt',
    blurb: 'Photographing a receipt and filing it against the right client.',
    seconds: 140,
    aspect: 1206 / 2622,
  },
  {
    id: 'tv-truelink-receipt',
    driveId: '17-zmzDvyttQUNv_eOatO71hLHFKaSX0c',
    title: 'Uploading a TrueLink Receipt',
    blurb: 'The same, for a TrueLink card purchase.',
    seconds: 58,
    aspect: 1206 / 2622,
  },
]

export const drivePreviewUrl = (driveId: string) => `https://drive.google.com/file/d/${driveId}/preview`

/** "2:40" — minutes:seconds, the way a person reads a video length. */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}


// THE TRAINING DOCUMENTS — the half of that folder that is not film.
export type TrainingDoc = {
  id: string
  driveId: string
  title: string
  blurb: string
  /** how Drive will open it — the viewer differs per kind */
  kind: 'document' | 'spreadsheet' | 'pdf'
}

export const TRAINING_DOCS: TrainingDoc[] = [
  {
    id: 'td-dsp-duties',
    driveId: '1bqNY62mGUPoTKnIAzYvAi7MPbwic4Zqv_zSQJB-xxOM',
    title: 'DSP Job Duties',
    blurb: 'What the job actually is, in the company\'s own words.',
    kind: 'document',
  },
  {
    id: 'td-manager-checklist',
    driveId: '1jxhaU5_y6I5lQOlYNLA7Apr9XZLCwSvztkSj0rBK_d4',
    title: 'Manager Training Checklist',
    blurb: 'The list a new manager is walked through, item by item.',
    kind: 'document',
  },
  {
    id: 'td-signoff',
    driveId: '1gh6-PXO8sW06AZIjhKwDHz2TaqY5vFCOhsZxbcWmZdw',
    title: 'Employee Sign-off Sheet',
    blurb: 'What a person signs to say they were trained on it.',
    kind: 'document',
  },
  {
    id: 'td-leadership-outline',
    driveId: '1_iLaf2V50k5UbXMFJXTTczsg87sXK7tlC9que3Yu6mY',
    title: 'Leadership Training Outline',
    blurb: 'The leadership programme, laid out session by session.',
    kind: 'spreadsheet',
  },
  {
    id: 'td-training-resources',
    driveId: '1Rdm6M_i5E8UVrZQ20mU_zBfYwGF5YEWt',
    title: 'Training Resources',
    blurb: 'The collected resources file the training folder is built around.',
    kind: 'document',
  },
]

export const driveDocUrl = (d: TrainingDoc) =>
  d.kind === 'spreadsheet'
    ? `https://docs.google.com/spreadsheets/d/${d.driveId}/preview`
    : `https://drive.google.com/file/d/${d.driveId}/preview`
