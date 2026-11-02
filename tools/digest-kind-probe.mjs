/**
 * WHAT WOULD THE DECODER CALL THIS? — without a publish, without an upload.
 *
 * The decode loop costs a publish and a five-minute sweep, so a wrong slug
 * used to take fifteen minutes to see and fifteen more to disprove. This runs
 * the REAL classifier — Digest.gs, evaluated as it is — against cases, and
 * says what it would answer. Every failure ever caught in the field lives
 * here as a case, so it cannot come back quietly:
 *
 *   2026-09-09  a CJIS background check filed as an "agreement" (the word
 *               CJIS was not in the vocabulary and "agreement" outscored it)
 *   2026-09-09  a 78-page ISP filed as an "incident report" (first needle
 *               wins, on a document that mentions everything)
 *   2026-09-09  "TB_Test_Corn_2026.pdf" read as a person called Test Corn
 *
 *   node tools/digest-kind-probe.mjs                 # the cases
 *   node tools/digest-kind-probe.mjs "<name>" file   # one real document
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(ROOT, 'apps-script/Digest.gs'), 'utf8')
// Digest.gs is Apps Script: the two registries it appends to at load time are
// the only globals it touches outside a function.
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {} }
vm.createContext(ctx)
vm.runInContext(src, ctx)

const CASES = [
  ['CJIS_Alanna_Corn_20260325 (1).pdf',
   'A Case Number: 04CRB23 A Last Name: "Smith" A First Name: "John" Common Pleas ' +
   'Court You can use the drop down A Filing Date: 1/1/2014 court record search',
   'background_check', 'Alanna Corn'],
  ['ISP - Sarina Bunting - 2025.pdf',
   'Individual Service Plan Outcomes and Supports Service and Support Administrator ' +
   'medication administration record physician order incident reporting behavior',
   'isp', 'Sarina Bunting'],
  ['ISP - Barbara Mayle - 2025.pdf',
   'INDIVIDUAL SERVICE PLAN person-centered plan. The team reviewed incidents and ' +
   'unusual incident reporting, medication administration record, physician orders.',
   'isp', 'Barbara Mayle'],
  ['cpr-card-test.pdf',
   'ASA LIFECARE - TRAINING RECORD CPR / First Aid Certification Name: Test Person ' +
   'Issued: 03/14/2026 Expires: 03/14/2027 Certificate No. 55810',
   'cpr_first_aid', ''],
  ['Screenshot 2026-09-08 at 17.43.37.png',
   'Walmart receipt subtotal 12.99 amount due total paid change due', 'receipt', ''],
  /* THE TITLE THAT SETTLES NOTHING, from a real filing: the person
     is found INSIDE the paper, by the label printed in front of the name. */
  ['TB_Test_Corn_2026.pdf',
   'Ohio Department of Health — Tuberculin skin test. Name: Alanna Corn. ' +
   'Mantoux PPD placed 03/02/2026 read 03/04/2026 result negative.',
   'tb_test', 'Alanna Corn'],
  ['scan0012.pdf',
   'AMERICAN HEART ASSOCIATION  Employee Name: Sarina Bunting  BLS CPR ' +
   'certification completed 01/10/2026 expires 01/10/2028',
   'cpr_first_aid', 'Sarina Bunting'],
  ['records.pdf',
   'Ohio Attorney General criminal records check. Last Name: "Corn" ' +
   'First Name: "Alanna" webcheck fingerprint results enclosed.',
   'background_check', 'Alanna Corn'],
  /* NOT EVERY FILE IS ABOUT SOMEBODY (2026-09-09): two capitalised words in
     a title made this an architecture note "about" a person. */
  ['ASA Hub — Arquitetura da Plataforma.pdf',
   'Arquitetura da plataforma: o motor em Apps Script, as planilhas como ' +
   'casas de dados, o relay em Python e as fatias servidas ao aplicativo.',
   '', ''],
  /* A MENTION IS NOT A SUBJECT (2026-09-09): a real service plan names
     prescriptions and physician orders on nearly every page. */
  ['ISP - Sarina Bunting - 2025.pdf (long)',
   'INDIVIDUAL SERVICE PLAN — outcomes and supports. ' +
   ('The team reviewed the prescription list; refills are handled by the ' +
    'pharmacy and each physician order is filed. Prescription changes need ' +
    'a new physician order. ').repeat(60),
   'isp', 'Sarina Bunting'],
  /* THIS PLATFORM'S OWN ARCHITECTURE PAPERS TALK ABOUT TENANTS. */
  ['ASA Hub — Arquitetura Detalhada.pdf',
   'Multi-tenant architecture: each tenant sees its own place. The engine ' +
   'runs in Apps Script, the houses are spreadsheets, the relay is Python.',
   '', ''],
  /* THE FILENAME LIED: a CV uploaded into the onboarding diploma slot
     (2026-09-09). Structure beats a filename and a single word. */
  ['onboarding-hsdiploma_2026-07-27_HSDiploma.pdf',
   'Amanda Huffman\nWaynesburg, OH 44688 | +12344587158\nProfessional Summary\n' +
   'Detail-oriented caregiver with 5+ years of experience.\nWork Experience\n' +
   'Delivery Driver, Spark Driver, Canton OH. In Home Caregiver, Mayle Homes.\n' +
   'Education\nHigh school diploma\nSkills\nCooking Bathing assistance\nCertifications',
   'application_resume', 'Amanda Huffman'],
  /* A NAME DOES NOT SPAN A DASH (2026-09-09). */
  ['Bethany Foster - Social Security Card _2026.pdf',
   'SOCIAL SECURITY  This number has been established for  BETHANY FOSTER',
   'ssn_card', 'Bethany Foster'],
  /* A SPREADSHEET IS A DATASET, not a card belonging to "Client Database". */
  ['Asa Client Database.xlsx',
   '# Sheet: Master\nClient | House | Status | Medicaid | DOB\n' +
   'Brandon Smith | BS4527 | Active | 1234567 | 1990-01-02',
   'dataset', ''],
  ['W-4 2026 signed.pdf',
   'Employee withholding certificate it-4 state of ohio', 'tax_form', ''],
  /* 2026-09-10: the real 78-page ISP tied 6-6 with `prescription` — a word a
     care plan says on nearly every page — and the first row in the book won.
     The title is what a paper IS. */
  ['ISP - Sarina Bunting - 2025.pdf',
   'prescription refill prescription pharmacy prescription '.repeat(3) + 'x'.repeat(30000),
   'isp', 'Sarina Bunting'],
  ['Alanna Corn DL.jpg',
   'OHIO DRIVER LICENSE DL NO XY123 class d exp 04/12/2028',
   'drivers_licence', 'Alanna Corn'],
  /* 2026-09-11, from photographs of real documents */
  ['Shaquita driving record.png',
   'ONLINE SERVICES myBMV OPLATES Unofficial 2-Year Driving Record\nThis Ohio driver ' +
   'abstract spans the previous two-year period.\nYour License Status as of 08/05/2026 Valid\n' +
   'Endorsements None Restrictions A',
   'driver_abstract', ''],
  ['Kwabena WASSCE result.jpg',
   'WAECDIRECT ONLINE INFORMATION SERVICE - RESULTS\nTHE WEST AFRICAN EXAMINATIONS COUNCIL\n' +
   'Result Checking\nIndex Number 0050109297\nCandidate Name APPIAH KWABENA TONTO\n' +
   'Type of Examination WASSCE SCHOOL 2021\nExamination Centre KNUST SENIOR HIGH SCHOOL\n' +
   'SOCIAL STUDIES A1 EXCELLENT ENGLISH LANG B3 GOOD',
   'diploma', ''],
  ['Deanna Williams annual training.pdf',
   'THIS CERTIFICATE IS PROUDLY PRESENTED TO\nDeanna Williams\nFor Completing\nAnnual Training\n' +
   'The following topics are covered in this module: The Bill of Rights for People with ' +
   'Developmental Disabilities and the NADSP Code of Ethics; Introduction to Empathy Based Care; ' +
   'The Ohio Individual Service Plan (OhioISP); Valued Roles\n08/11/2026 Brittco software',
   'training_transcript', 'Deanna Williams'],
  /* 2026-09-11: the way every official record writes a person — SURNAME
     first, comma, given names. The cut stopped at the comma, came back with
     one word, fell through, and the letter's own heading landed in the
     person column: "CRIMINAL HISTORY". */
  ['CJIS_Alanna_Corn_20260325.pdf',
   'OHIO ATTORNEY GENERAL Ohio Bureau of Criminal Investigation\n' +
   'CRIMINAL HISTORY RECORD CHECK\nNO BCI CONVICTIONS ON FILE\n' +
   'AUTHENTICATION 1234567\nName: CORN, ALANNA\nDate of Birth: 04/02/1988\n' +
   'BCI Completion Date: 03/25/2026',
   'background_check', 'Alanna Corn'],
  ['Deanna Williams red cross.pdf',
   'American Red Cross Training Services\nCertificate of Completion\nDeanna Williams\n' +
   'has successfully completed requirements for\nAdult First Aid/CPR/AED\n' +
   'Date Completed: 4/17/2026\nValid Until: 4/17/2028\nConducted by: Angels In Mission',
   'cpr_first_aid', 'Deanna Williams'],
  ['Bethany Foster diploma.jpg',
   'Louisville High School\nLouisville Public Schools\nBethany Rose Foster\n' +
   'having completed the Course of Study recommended by the State of Ohio and prescribed ' +
   'by the Louisville Board of Education for this First Grade High School, is entitled to this\n' +
   'Diploma\nIn Witness Whereof, we have hereunto affixed our signatures at Louisville, Ohio\n' +
   'May 22, 2025',
   'diploma', 'Bethany Foster'],
]

/**
 * The decoder's own person rule, minus the roster (which needs the live
 * sheets): the TITLE first — a name inside a document can be an example, as
 * the CJIS case proves — then what the document prints. A title-borne name
 * stands only where a person belongs, or where the paper says it too.
 */
function kindOf(name, text) {
  // the decoder's own short-circuit: our xlsx reader stamps every tab
  if (/^# Sheet:/.test(text)) return { kind: 'dataset', category: 'other', score: 0, alt: '' }
  return ctx.digestDocKind_(name, text)
}

function personOf(name, text, kind) {
  if (kind === 'dataset') return ''
  let person = ctx.digestNameFromTitle_(name)
  let source = person ? 'title' : ''
  if (!person) {
    person = ctx.digestNameFromText_(text) || ctx.digestNameFromPairs_(ctx.digestPairs_(text))
    source = person ? 'field' : ''
  }
  if (!person && kind === 'application_resume') {
    person = ctx.digestNameFromHead_(text)
    source = person ? 'head' : ''
  }
  if (person && source === 'title' && !ctx.DIGEST_PERSON_KINDS[kind] &&
      !text.toLowerCase().includes(person.toLowerCase())) return ''
  return person || ''
}

function report(name, text) {
  const kind = kindOf(name, text)
  const roles = ctx.digestDateRoles_(text)
  const pairs = ctx.digestPairs_(text)
  console.log(`  kind        ${kind.kind || '—'}  (score ${kind.score || 0}, runner-up ${kind.alt || '—'})`)
  console.log(`  category    ${kind.category || '—'}`)
  const person = personOf(name, text, kind.kind)
  const subject = ctx.digestSubject_(null, person, kind.kind, text, name)
  console.log(`  person      ${person || '—'}`)
  console.log(`  subject     ${subject.type || '—'} ${subject.subject || ''}`)
  console.log(`  issued      ${roles.issued || '—'}    expires ${roles.expires || '—'}`)
  console.log(`  dates       ${JSON.stringify(ctx.digestDates_(name, text))}`)
  console.log(`  issuer      ${ctx.digestIssuer_(text) || '—'}`)
  console.log(`  numbers     ${JSON.stringify(ctx.digestNumbers_(text))}`)
  console.log(`  pairs       ${pairs.slice(0, 6).map((p) => `${p.k}=${p.v.slice(0, 22)}`).join('; ') || '—'}`)
}

/**
 * THE MERGE, OFFLINE (2026-09-10). What a person typed against what the paper
 * says: which fact a question feeds, and whether the two agree. Each case is
 * [question label, typed answer, declared fact or '', what the paper found,
 *  wanted fact, wanted verdict].
 */
const MERGE = [
  ['Expiration date', '2027-03-14', '', { expires: '2027-03-14' }, 'expires_on', 'yes'],
  ['Expiration date', '03/14/2027', '', { expires: '2027-03-14' }, 'expires_on', 'yes'],
  ['Expiration date', '2027-03-14', '', { expires: '2026-01-02' }, 'expires_on', 'no'],
  ['Expiration date', '2027-03-14', '', {}, 'expires_on', ''],
  ['Date of issue', '2026-09-03', '', { issued: '2026-09-03' }, 'issued_on', 'yes'],
  ['When did you take it', '2026-09-03', 'issued_on', { issued: '2026-01-01' }, 'issued_on', 'no'],
  ['Any date on it', '2026-09-03', '', { dates: ['2026-09-03'] }, 'date', 'yes'],
  ['Document type', 'CPR card', '', { doc_kind: 'cpr_first_aid' }, 'doc_kind', 'yes'],
  ['Document type', 'CPR card', '', { doc_kind: 'drivers_licence' }, 'doc_kind', 'no'],
  ['Document type', 'TB test', '', { doc_kind: 'tb_test' }, 'doc_kind', 'yes'],
  ['Full name', 'Malik Conner', '', { person: 'Malik Conner' }, 'person', 'yes'],
  ['Full name', 'Malik Conner', '', { person: 'Toni Capeci' }, 'person', 'no'],
  ['Full name', 'Malik Conner', '', {}, 'person', ''],
  ['Issued by', 'Ohio DODD', '', { issuer: 'ohio department of developmental disabilities' }, 'issuer', 'yes'],
  ['Certificate number', 'C-4471-22', '', { numbers: ['4471'] }, 'number', 'yes'],
  ['Which house', 'Maple', '', {}, 'house', ''],
  ['Anything else you want to tell us', 'it was raining', '', {}, '', '']
]

function mergeRun() {
  let bad = 0
  for (const [label, value, declared, found, wantFact, wantAgree] of MERGE) {
    const fact = ctx.digestAnswerFactOf_('q_' + label.toLowerCase().replace(/\W+/g, '_'),
                                         label, declared)
    const said = [{ key: 'q', label, kind: 'text', fact,
                    value, dates: ctx.digestDatesIn_(value) }]
    const got = ctx.digestAnswerCheck_(said, {
      person: found.person || '', doc_kind: found.doc_kind || '',
      issuer: found.issuer || '', issued: found.issued || '',
      expires: found.expires || '', dates: found.dates || [],
      numbers: found.numbers || []
    })
    const agree = (got.items[0] && got.items[0].agree) || ''
    const okFact = fact === wantFact
    const okAgree = agree === wantAgree
    if (!okFact || !okAgree) bad++
    console.log(`${okFact && okAgree ? '✓' : '✗'} ${label.slice(0, 30).padEnd(32)}` +
      ` ${String(value).slice(0, 14).padEnd(16)} → ${String(fact || '—').padEnd(12)}` +
      ` ${agree || '—'}` +
      (okFact ? '' : `   WANTED FACT ${wantFact || '(none)'}`) +
      (okAgree ? '' : `   WANTED ${wantAgree || '(silence)'}`))
  }
  return bad
}

const [, , argName, argFile] = process.argv
if (argName && argFile) {
  const text = fs.readFileSync(argFile, 'utf8')
  console.log(`\n${argName}  (${text.length} chars)`)
  report(argName, text)
} else {
  let bad = 0
  for (const [name, text, wantKind, wantPerson] of CASES) {
    const kind = kindOf(name, text)
    const person = personOf(name, text, kind.kind)
    const okKind = kind.kind === wantKind
    const okName = person === wantPerson
    if (!okKind || !okName) bad++
    console.log(`${okKind && okName ? '✓' : '✗'} ${name.slice(0, 34).padEnd(36)}` +
      ` → ${String(kind.kind).padEnd(17)} ${person || '—'}` +
      (okKind ? '' : `   WANTED ${wantKind}`) +
      (okName ? '' : `   WANTED NAME "${wantPerson}"`))
  }
  console.log(bad ? `\n${bad} case(s) WRONG` : `\nall ${CASES.length} cases correct`)
  console.log('\nevery date on the page, whatever shape it came in:')
  const SHAPES = [
    ['7/29/2026', ['2026-07-29']],
    ['7/2028', ['2028-07-31']],
    ['September 3, 2026', ['2026-09-03']],
    ['July 2028', ['2028-07-31']],
    ['Jul-2028', ['2028-07-31']],
    ['2027-03-26', ['2027-03-26']],
    ['Exp 2/2028', ['2028-02-29']],
    ['7/29/2026 and 7/2028 on one card', ['2026-07-29', '2028-07-31']],
    ['no date here at all', []],
  ]
  let badShape = 0
  for (const [text, want] of SHAPES) {
    const got = ctx.digestDatesIn_(text)
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) badShape++
    console.log(`  ${ok ? '✓' : '✗'} ${text.padEnd(36)} → ${JSON.stringify(got)}` +
      (ok ? '' : `   WANTED ${JSON.stringify(want)}`))
  }

  const DATES = [
    ['a card: the caption sits UNDER the date',
     "Ja'Von Ogden\nHSI First Aid CPR AED\n7/29/2026\nClass Completion Date\n7/2028\nExpiration Date",
     '2026-07-29', '2028-07-31'],
    ['a letter: the label sits BEFORE it',
     'Expiration Date: 03/14/2027  Issue Date: 03/14/2026', '2026-03-14', '2027-03-14'],
    ['Red Cross wording', 'Date Completed: 03/26/2025 Valid Until: 03/26/2027',
     '2025-03-26', '2027-03-26'],
    ['month and year only, valid to the END of the month',
     'Exp 2/2028', '', '2028-02-29'],
    /* 2026-09-11: the bench card whose expiry came back EQUAL to its issue
       date — the backward reader took the issue date sitting in front of
       "Expires". The nearest candidate wins now. */
    ['a bench card: label, value, label, value',
     'CPR card\nIssue date: 03/12/2026 Expires: 03/2028', '2026-03-12', '2028-03-31'],
    ['an AHA card: caption row above the value row',
     'Issue Date        Renew By        eCard Code\n5/29/2025         05/2027         266012572263',
     '2025-05-29', '2027-05-31'],
    ['an AHA BLS card: both dates carry a day',
     'Issue Date Renew By\n01/21/2026 01/31/2028', '2026-01-21', '2028-01-31'],
    ['an Ohio licence: the BMV caption row, DOB claimed first',
     '4dNO VT033916\n3 DOB 01-27-2007\n4aISS 03-25-2025\n5 DD N41391906\nUNDER 21 UNTIL 01-27-2028\n9 CLASS 4b EXP 9a END\nD 01-27-2028\n12 REST B',
     '2025-03-25', '2028-01-27'],
    ['an Ohio interim licence: forward with colons',
     'DOB: 1/27/2007 License/ID No: VT033916 Issued On: 3/25/2025 Expires On: 1/27/2028 Class: D',
     '2025-03-25', '2028-01-27'],
    ['a Med Del certificate: one label, two dates',
     'Medication Administration Certification CATEGORY 1\nEffective from 10/3/2025 To 10/2/2026\nDate of Training 10/1/2025 to 10/3/2025\nDate 10/7/2025',
     '2025-10-03', '2026-10-02'],
    ['the HSI card as the OCR really flattens it, a phone number after the caption',
     '8/27/2026\nClass Completion Date: 330-415-4401\n4969522 Registry No.\n8/2028 Expiration Date: 43402 Training Center I.D.',
     '2026-08-27', '2028-08-31'],
    ['an insurance card, months written out',
     'EFFECTIVE DATE\nMay 23, 2026\nEXPIRATION DATE\nNovember 23, 2026', '2026-05-23', '2026-11-23'],
    ['a BCI letter: the completion date is the issue date',
     'Name: DOE, JOHN\nDate of Birth: 01/02/1990\nBCI Completion Date: 08/14/2026', '2026-08-14', ''],
    ['an AHA eCard PDF: caption above value, month-only renewal',
     'Issue Date                    Renew By\n7/29/2026                     07/2028', '2026-07-29', '2028-07-31'],
    /* 2026-09-11, the second batch of photographed documents. The
       birth dates in these were INVISIBLE until today: digestOneDate_'s own
       pattern only accepted 20xx, so every licence and every ID card came
       back with an empty born_on while the card printed it twice. */
    ['an Ohio ID card: the expiry wears a REG in front of it',
     '9 CLASS 4b EXP 9aEND 12 REST\nREG 11-28-2031 NONDRIVER\n4aISS 02-13-2024\n3 DOB 11-28-1976',
     '2024-02-13', '2031-11-28'],
    ['an auto policy: begins on, ends on',
     'POLICY PERIOD Coverage begins on 09/25/2026 12:01 AM. This policy period ends on 03/25/2027 at 12:01 a.m.',
     '2026-09-25', '2027-03-25'],
  ]

  /* THE DATES A SCAN DID NOT LEAVE A LABEL ON (2026-09-11). The same
     photograph OCR'd cleanly in the morning and as noise in the afternoon;
     these are the finisher's rules, over the kind that owns them. */
  console.log('\nwhen the labels did not survive the scan:')
  const FINISH = [
    ['a CPR card, two dates, no labels left', 'cpr_first_aid',
     ['2026-08-27', '2028-08-31'], '2026-08-27', '2028-08-31', 'pair'],
    ['a DODD certificate: one past date, and the catalog knows the period',
     'dodd_certification', ['2026-09-03'], '2026-09-03', '2027-09-03', 'derived:12m'],
    ['an SSN card: one date, and nothing expires', 'ssn_card',
     ['2014-08-29'], '2014-08-29', '', ''],
    ['a service plan is not a credential: two dates settle nothing', 'isp',
     ['2025-01-01', '2026-01-01'], '', '', ''],
  ]
  let badFin = 0
  for (const [label, kind, dates, wantIssued, wantExpires, wantSrc] of FINISH) {
    const got = ctx.digestRolesFinish_(kind, { issued: '', expires: '', born: '', how: {} }, dates, '2026-09-11')
    const ok = got.issued === wantIssued && got.expires === wantExpires && (got.source || '') === wantSrc
    if (!ok) badFin++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(56)} issued ${got.issued || '—'}  expires ${got.expires || '—'}  (${got.source || '—'})` +
      (ok ? '' : `   WANTED ${wantIssued || '—'} / ${wantExpires || '—'} (${wantSrc || '—'})`))
  }

  console.log('\na receipt with no end date is not a credential held:')
  const HOLD = [
    ['a CPR card filed with no expiry', 'javon', 'cpr', { decision: 'submitted', expires_on: '' }, 'owed'],
    ['the same card, read properly', 'zack', 'cpr', { decision: 'submitted', expires_on: '2027-03-26' }, 'held'],
    ['one that has run out', 'old', 'cpr', { decision: 'submitted', expires_on: '2020-01-01' }, 'owed'],
    ['a card that never expires', 'beth', 'ss_birth', { decision: 'submitted', expires_on: '' }, 'held'],
    ['revoked', 'gone', 'cpr', { decision: 'revoked', expires_on: '2030-01-01' }, 'owed'],
  ]
  let badHold = 0
  const realOverlay = ctx.clearanceOverlay_
  for (const [label, key, cred, rec, want] of HOLD) {
    ctx.clearanceOverlay_ = () => ({ [key]: { [cred]: rec } })
    const got = ctx.digestHoldsCredential_(key, cred)
    const ok = got === want
    if (!ok) badHold++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(56)} ${got || '—'}` + (ok ? '' : `   WANTED ${want}`))
  }
  ctx.clearanceOverlay_ = realOverlay

  console.log('\nwhat a background check actually said:')
  const CHECKS = [
    ['a BCI letter, no convictions', 'Ohio Bureau of Criminal Investigation NO BCI CONVICTIONS ON FILE', 'BCI', 'clear'],
    ['an FBI letter, spelled out', 'Federal Bureau of Investigation Identity History Summary NO ARREST RECORD', 'FBI', 'clear'],
    ['a record that is NOT clear', 'Ohio Bureau of Criminal Investigation The following convictions on file: THEFT', 'BCI', 'records'],
    ['a paper that says neither', 'Some other document entirely', '', ''],
  ]
  let badChk = 0
  for (const [label, text, wantAgency, wantResult] of CHECKS) {
    const got = ctx.digestCheckResult_(text)
    const ok = (got.agency || '') === wantAgency && (got.result || '') === wantResult
    if (!ok) badChk++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(56)} ${got.agency || '—'} ${got.result || '—'}` +
      (ok ? '' : `   WANTED ${wantAgency || '—'} ${wantResult || '—'}`))
  }

  console.log('\nthe date a person was born, which is never in this century:')
  const BORN = [
    ['an Ohio ID card', '3 DOB 11-28-1976', '1976-11-28'],
    ['a licence', '9 CLASS 4b EXP\nD 08-10-2029 A\n4aISS 09-10-2025\n3 DOB 08-10-1990', '1990-08-10'],
    ['an interim paper', 'DOB: 1/27/2007 Issued On: 3/25/2025 Expires On: 1/27/2028', '2007-01-27'],
  ]
  let badBorn = 0
  for (const [label, text, want] of BORN) {
    const got = ctx.digestDateRoles_(text).born || ''
    const ok = got === want
    if (!ok) badBorn++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(56)} born ${got || '—'}` + (ok ? '' : `   WANTED ${want}`))
  }

  console.log('\none paper, several credentials:')
  const GRID = 'Certification Type Effective Expiration RenewalCount Certification Status\n' +
    'Cat - I 12/27/2025 12/17/2026 1 Certified\nCat - I 12/18/2024 12/17/2025 Expired\n' +
    'Cat - II 6/11/2025 6/10/2026 0 Expired\nCat - III 6/11/2026 6/10/2027 0 Certified'
  const rowsGot = ctx.digestCertGrid_(GRID)
  const levelGot = ctx.digestMedLevel_(GRID)
  const gridOk = rowsGot.length === 4 && levelGot === '1,3' &&
    rowsGot[0].expires === '2026-12-17' && rowsGot[0].status === 'certified' &&
    rowsGot[2].status === 'expired'
  console.log(`  ${gridOk ? '✓' : '✗'} the DODD grid: four rows, two live` +
    `   read ${rowsGot.length} row(s), live categories ${levelGot || '—'}` +
    (gridOk ? '' : '   WANTED 4 rows and 1,3'))

  console.log('\nthe number that must never reach a spreadsheet:')
  const SECRETS = [
    ['the form shape', '', 'SSN: 287-13-4424', true, '4424'],
    ['the shape a scanner produced', 'ssn_card', 'THIS NUMBER HAS BEEN ESTABLISHED FOR\n287-139-4424', true, '4424'],
    ['a training centre telephone is not a number to hide', 'cpr_first_aid',
     'Training Center Phone Number 330-415-4401', false, ''],
    ['a card without separators', 'ssn_card', 'SOCIAL SECURITY 861836503', true, '6503'],
  ]
  let badSec = 0
  for (const [label, kind, text, wantMasked, wantLast4] of SECRETS) {
    const got = ctx.digestRedact_(text, kind)
    const masked = got.text.indexOf('***-**-') !== -1
    const ok = masked === wantMasked && (got.ssn_last4[0] || '') === wantLast4
    if (!ok) badSec++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(56)} ${masked ? 'masked ' + JSON.stringify(got.ssn_last4) : 'left alone'}` +
      (ok ? '' : `   WANTED ${wantMasked ? 'masked ' + wantLast4 : 'left alone'}`))
  }
  if (badFin + badSec) console.log(`\n${badFin + badSec} finisher/secret case(s) WRONG`)
  const extraBad = badFin + badSec + badBorn + badChk + badHold + (gridOk ? 0 : 1)
  console.log('\nwhich date is which:')
  let badDate = 0
  for (const [label, text, wantIssued, wantExpires] of DATES) {
    const got = ctx.digestDateRoles_(text)
    const ok = got.issued === wantIssued && got.expires === wantExpires
    if (!ok) badDate++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(58)} issued ${got.issued || '—'}  expires ${got.expires || '—'}` +
      (ok ? '' : `   WANTED ${wantIssued || '—'} / ${wantExpires || '—'}`))
  }
  console.log('\nthe seven papers, and the obligation each one settles:')
  const PAPERS = [
    ['DODD', 'dodd_certification'], ['CPR', 'cpr_first_aid'],
    ['OH ID', 'state_id'], ['Driver\u2019s licence', 'drivers_licence'],
    ['Social Security card', 'ssn_card'], ['Birth certificate', 'birth_certificate'],
    ['Med Del', 'med_admin_cert'], ['HS diploma', 'diploma'],
    ['(a MARS — not an obligation)', 'mar'],
  ]
  for (const [label, kind] of PAPERS) {
    const c = ctx.digestCredentialFor_(kind)
    console.log(`  ${label.padEnd(30)} ${kind.padEnd(20)} → ` +
      (c ? `${c.doc_id.padEnd(18)} ${c.credential ? 'matrix:' + c.credential : '(not a certification)'}`
         : 'settles nothing'))
  }
  console.log('\nthe merge — a person typed, the paper says:')
  const badMerge = mergeRun()
  console.log(badMerge ? `\n${badMerge} merge case(s) WRONG`
                       : `all ${MERGE.length} merge cases correct`)
  process.exit(bad + badMerge + badDate + badShape + extraBad ? 1 : 0)
}
