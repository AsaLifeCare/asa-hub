/**
 * IS EVERY BADGE IN EVERY BADGE LIST?
 *
 * A badge is not one declaration. It is a word that has to appear in the
 * Apps Script vocabulary that validates a cell, in the SPA list that offers
 * the chip, in the colour table that paints it, in the order that ranks it,
 * in the two dialogs that grant it, in the ladder that compares seniority and
 * in the live-state auditor that recognises it. TEAMLEAD was added to eleven
 * such places at once; the twelfth would have been found in use, not by a build.
 *
 * So the lists are enumerated here BY NAME and every one of them is required
 * to carry every word the vocabulary declares. The vocabulary
 * (USER_TYPES, app/scope.py) is the single source: add a badge there, run
 * `npm run check`, and this names each list still missing it. MASTER is the
 * one word deliberately absent from the vocabulary — it is derived from
 * HUB_MASTER_EMAIL and never assigned — so lists that carry it carry it
 * extra, which is allowed; what is never allowed is a list carrying LESS.
 *
 * IT ALSO HOLDS THE COPIES OF `BADGE_FOLLOWS` TOGETHER. The equivalence
 * that makes SUPERVISOR currently reach what DIRECTOR reaches exists once per
 * runtime, because the runtimes ask the question and none of them can call
 * the others: src/lib/badgeFollows.ts, app/scope.py (the one the live app
 * runs), HUB_BADGE_FOLLOWS in apps-script/Profile.gs, and
 * server/badge_follows.py. Copies are only safe while something fails when
 * they disagree. This is that something. TEAMLEAD left the table on
 * 2026-10-29 (the operator's rule): a badge of its own, drawn over HM.
 *
 * THE DISPLAY ORDER IS HELD THE SAME WAY: RoleBadge.tsx BADGE_ORDER, its
 * Python copy app/scope.py BADGE_ORDER (which `wears_from` ranks by), and the
 * hand-written slice src/lib/editions.ts EDITION_BADGES that the editions
 * dropdown offers as "X and above".
 *
 * AND IT KEEPS THE EQUIVALENCE DELETABLE, which is the half a table check
 * cannot see. The standing promise is that ticking the new badge
 * on the rows it should keep and then emptying those four tables parts the
 * two badges — and that promise is broken by ANY other file spelling the
 * followed word, because that copy outlives the deletion. So the word is
 * hunted through the whole checkout (comments stripped: an explanation is not
 * a behaviour) and allowed only in the places listed under WORD_HOMES, each
 * with its reason. That is what makes "delete one line" true rather than
 * hopeful, and it is how the third finding of the review would have been a
 * failing build instead of a reading.
 *
 * AND THE RELAY IS PINNED BY ITS CALL SITES. The other two runtimes fold
 * inside a module this check reads; the relay folds at two call sites in
 * files this check has no literal to read out of, so those two lines are
 * pinned as source text. Without that, both could be deleted with every
 * verdict green and one badge would be a director on two lanes and nobody on
 * the third — the exact split the four-copy check exists to prevent.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: decide what a badge should REACH. Reach
 * lives in the master's own matrix and in the access configs, and a test that
 * asserted a reach would be asserting over a spreadsheet somebody may narrow
 * tomorrow — exactly the verdict-a-keystroke-can-fail this codebase bans.
 *
 * Run: node tools/check-badges.mjs [--strict]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

/** Evaluate one array/object literal out of a source file, by its declaration. */
function literal(text, declaration, where) {
  const i = text.indexOf(declaration)
  if (i === -1) fail(`${where}: \`${declaration}\` is gone — this check cannot see the list any more`)
  // the first bracket after the declaration opens the literal
  const start = Math.min(...['[', '{'].map((c) => {
    const at = text.indexOf(c, i)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }))
  if (start === Number.MAX_SAFE_INTEGER) fail(`${where}: \`${declaration}\` has no literal after it`)
  // walk to the matching bracket, skipping strings and comments
  let depth = 0, quote = '', line = false, block = false
  let end = -1
  for (let p = start; p < text.length; p++) {
    const c = text[p], n = text[p + 1]
    if (line) { if (c === '\n') line = false; continue }
    if (block) { if (c === '*' && n === '/') { block = false; p++ } continue }
    if (quote) {
      if (c === '\\') { p++; continue }
      if (c === quote) quote = ''
      continue
    }
    if (c === '/' && n === '/') { line = true; p++; continue }
    if (c === '/' && n === '*') { block = true; p++; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { end = p + 1; break } }
  }
  if (end === -1) fail(`${where}: \`${declaration}\` does not close`)
  const sandbox = { console, JSON, String, Number, Boolean, Array, Object, RegExp, Date, Math }
  vm.createContext(sandbox)
  try {
    return vm.runInContext(`(${text.slice(start, end)})`, sandbox)
  } catch (err) {
    fail(`${where}: \`${declaration}\` is not a plain literal any more (${err.message})`)
  }
}

const problems = []
function fail(message) {
  problems.push(message)
  throw new Error(message)
}

/* ---------- the vocabulary: the one source every list is held to --------- */
/* app/scope.py USER_TYPES, the vocabulary the live app validates a cell by (Apps Script is retired; the operator's
 * FIX BADGES sheet, 10-30, renamed GUARDIAN to FAMILY there alone) */
const profile = read('apps-script/Profile.gs')
let VOCABULARY = []
try {
  const types = read('app/scope.py').match(/^USER_TYPES = \(([^)]*)\)/m)
  if (!types) fail('app/scope.py: USER_TYPES is not a plain tuple literal any more')
  VOCABULARY = [...types[1].matchAll(/"([A-Z]+)"/g)].map((m) => m[1])
} catch { /* already recorded */ }

/* ---------- every list that must carry the whole vocabulary -------------- */
/** Each entry: where it lives, what it is called, and — when the list holds
 *  more than badge words — how to read the badge words out of it. */
const LISTS = [
  { file: 'src/components/shared/RoleBadge.tsx', name: 'const TYPE_TINT',
    keys: true,
    why: 'a badge with no colour draws the fallback chip, which is how two badges become one' },
  { file: 'src/components/shared/RoleBadge.tsx', name: 'export const BADGE_ORDER',
    why: 'not in the order = never the ONE chip a person\'s own corners draw, and no column in the matrix' },
  { file: 'src/features/profile/profilePanel.ts', name: 'const BADGE_PANEL_TINT',
    keys: true,
    why: 'the profile hero chip falls back to mint and stops saying which badge it is' },
  { file: 'src/pages/settings/UsersSection.tsx', name: 'const HUB_TYPES',
    why: 'Settings -> Users cannot GRANT a badge that is not offered in the dialog' },
  { file: 'src/pages/features/users/ProfilePage.tsx', name: 'const EDIT_TYPES',
    why: 'the master\'s own edit dialog cannot grant a badge that is not offered in it' },
]

/** The badge words a list holds, whatever shape it is. */
function wordsOf(entry) {
  const value = literal(read(entry.file), entry.name, `${entry.file} ${entry.name}`)
  const words = entry.keys ? Object.keys(value) : value
  return words.map((w) => String(w).toUpperCase())
}

/* ---------- and the label map, which is keyed lower-case ----------------- */
const LABELLED = { file: 'src/auth/types.ts', name: 'const EXTRA_TYPE_LABEL',
  why: 'roleBadge() falls through to the raw token, so the account reads TEAMLEAD instead of Team Lead' }

/**
 * THE DIGEST'S RANK, AND WHY IT IS ASKED A DIFFERENT QUESTION.
 *
 * `DIGEST_BADGE_RANK` puts badge words in order of SENIORITY for one Apps
 * Script function only — the digest's "whose upload do we believe". It is not
 * the platform ladder and must not be mistaken for one: the platform ladder is
 * BADGE_ORDER, which is both the display order and the server's "X or above"
 * (app/scope.py BADGE_ORDER, held equal to RoleBadge.tsx below, is what
 * `scope.wears_from` and the editions rank by). The two disagree on admin
 * against director because they answer different questions, and neither the
 * SPA nor the relay can call the digest's table at all.
 *
 * Absence in it is a DEFINED value — DIGEST_RANK_FLOOR, "rank this person
 * last" — not an omission. INTERVIEWER, ONBOARDING and ENTITY sit at that
 * floor today by the ranking table itself, and a check that demanded a number
 * for every word would be demanding this file invent three seniorities nobody
 * asked for.
 *
 * What is NOT allowed is a badge declared equivalent to another and then
 * ranked below it, or ranked below a house manager: that is the exact shape
 * of "a follower counts as above a house manager" quietly not being true.
 * So the table is held to the equivalence instead of to the whole vocabulary
 * — both sides of every arrow ranked, the follower never BELOW the badge it
 * follows (the same, or above when it outranks it), and both above hm.
 */
const LADDER = { file: 'apps-script/Digest.gs', name: 'var DIGEST_BADGE_RANK' }

/**
 * WHERE A FOLLOWED BADGE WORD MAY BE SPELLED, and nowhere else.
 *
 * "Followed" means the left-hand side of BADGE_FOLLOWS: a badge whose reach
 * is currently somebody else's, and the standing promise is that the two can
 * be parted by emptying the four tables (badgeFollows.ts, app/scope.py,
 * Profile.gs, server/badge_follows.py). Every other spelling of
 * that word is a copy of the equivalence that survives the emptying, so each
 * one is named here with the reason it is allowed to exist — and each reason
 * is about the VOCABULARY (what the word is called, painted, offered as,
 * ranked at) rather than about what it reaches.
 *
 * Comments are stripped before the hunt: a paragraph explaining the fold is
 * not a second copy of it. A string, an array entry or an object key is.
 */
const WORD_HOMES = [
  ['src/lib/badgeFollows.ts', 'the table itself'],
  ['server/badge_follows.py', 'the relay\'s copy of the table'],
  ['apps-script/Profile.gs', 'the vocabulary that validates a cell, and Apps Script\'s copy of the table'],
  ['src/components/shared/RoleBadge.tsx', 'the colour, the drawn word and the display order'],
  ['src/lib/editions.ts', 'the badges an edition may be opened to: the display order, sliced, held to it by this check'],
  ['src/features/profile/profilePanel.ts', 'the profile hero chip\'s colour'],
  ['src/pages/settings/UsersSection.tsx', 'the dialog that GRANTS the badge'],
  ['src/pages/features/users/ProfilePage.tsx', 'the master\'s own edit dialog'],
  ['src/auth/types.ts', 'the label a person reads'],
  ['tools/check-live-state.py', 'the auditor\'s vocabulary'],
  ['apps-script/Digest.gs', 'the digest\'s rank, held to the table by this check'],
  ['apps-script/Scheduling.gs', 'the symbol Scheduling paints for the badge as worn — what it is drawn as, never what it reaches'],
  ['apps-script/SelfTest.gs', 'the Apps Script tests'],
  ['apps-script/SelfTestScheduling.gs', 'the Apps Script tests'],
  ['apps-script/SelfTestStaffProfiles.gs', 'the Apps Script tests'],
  ['apps-script/SelfTestSupportDesk.gs', 'the Apps Script tests'],
  ['tests/spa/badges.test.ts', 'the SPA tests'],
  ['src/pages/features/houses/houseModel.ts', 'the sources\' health is the master\'s and the platform lead\'s — the rank over the director, which outlives the table'],
  ['tests/spa/houses.test.tsx', 'the SPA tests'],
  ['src/pages/features/clientprofiles/clientModel.ts', 'a client\'s secrets are saved by the master, a Platform Lead or a Director — the platform lead by its own word (the operator\'s rule, 2026-10-28), which outlives the table'],
  ['server/time_off.py', 'every live Platform Lead is on the directors board, read off the accounts by its own word (the operator\'s rule, 2026-10-28), which outlives the table'],
  ['tests/spa/staff-tab-features.test.tsx', 'the SPA tests: the badges a fixture wears'],
  ['tests/spa/my-family.test.tsx', 'the SPA tests: the badges an App Control row names'],
  ['tools/test-hotline-fast.py', 'the relay tests'],
  ['tools/test-app-packs.py', 'the relay tests'],
  ['tools/test-client-secrets.py', 'the app tests: the badges a fixture wears'],
  ['tools/test-family-notes-floor.py', 'the app tests: the badges a fixture wears and an App Control row names'],
  ['tools/test-ssa-notes-floor.py', 'the app tests: the badges a fixture wears and an App Control row names'],
  ['tools/test-staff-team-cut.py', 'the app tests: the badges a fixture wears and an App Control row names'],
  ['tools/test-role-only-reads.py', 'the app tests: the badges a fixture wears and an App Control row names'],
  ['tools/test-hm-hiring-gate.py', 'the app tests: the badges a fixture wears and an App Control row names'],
  ['tools/test-support-incident-edit.py', 'the app tests: the badges a fixture wears and an App Control row names'],
  ['tests/spa/support-incident-edit.test.tsx', 'the SPA tests: the badges a fixture wears and an App Control row names'],
  ['tools/check-badges.mjs', 'this check'],
]

/** The trees the word is hunted through, and what is never source. */
const HUNT_DIRS = ['src', 'server', 'apps-script', 'tools', 'tests']
const HUNT_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.gs', '.py']
const HUNT_SKIP = new Set(['node_modules', 'dist', 'build', '.git', '__pycache__', 'public'])

/** Paths git does not track, so nothing here can be part of the answer: the
 *  relay keeps a local copy of Digest.gs beside its engine, ignored on
 *  purpose, and a hunt that reads it reports the same table twice — once as
 *  the source it really is, once as a second seniority table nobody wrote. */
const HUNT_SKIP_PATHS = new Set(['server/engine'])

/* ---------- the relay, which folds at call sites rather than in a table --- */
/** Each file, the unguarded import it must keep, and the call that does the
 *  folding. Source-text pins, the same shape the Apps Script self-test uses
 *  for the helpers it cannot execute. */
const RELAY_CALLS = [
  { file: 'server/snapshot_service.py', call: 'badge_follows.with_followed(',
    why: 'the snapshot lane stops folding and every slice narrows for the badge, silently' },
  { file: 'server/hotline_desk.py', call: 'badge_follows.with_followed(',
    why: 'the App Access gate stops folding and the badge opens nothing on the desk lane' },
  { file: 'server/shift_requests.py', call: 'badge_follows.with_followed(',
    why: 'the Requests list, the House Calendars law and the company notices stop folding, and a supervisor reaches no house calendar, no company list and no company notice' },
]

/* ---------- the live-state auditor --------------------------------------- */
const LIVE = { file: 'tools/check-live-state.py', name: 'KNOWN_BADGES',
  why: 'the auditor would report a real, granted badge as an off-vocabulary word typed by hand' }

/* ---------- the copies of the equivalence -------------------------------- */
/** A Python `{"WORN": "STANDS", …}` dict, read as text. */
function pyFollows(file, pattern) {
  const block = read(file).match(pattern)
  if (!block) fail(`${file}: BADGE_FOLLOWS is not a plain dict literal any more`)
  const out = {}
  for (const pair of block[1].split(',')) {
    const m = pair.match(/"([A-Z]+)"\s*:\s*"([A-Z]+)"/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function followsOf() {
  const spa = literal(read('src/lib/badgeFollows.ts'),
                      'export const BADGE_FOLLOWS: Readonly<Record<string, string>> = Object.freeze',
                      'src/lib/badgeFollows.ts')
  const gas = literal(profile, 'var HUB_BADGE_FOLLOWS', 'apps-script/Profile.gs')
  const py = pyFollows('server/badge_follows.py', /BADGE_FOLLOWS: dict\[str, str\] = \{([^}]*)\}/)
  const app = pyFollows('app/scope.py', /^BADGE_FOLLOWS = \{([^}]*)\}/m)
  return { spa, gas, py, app }
}

/** Every source file under one tree, repo-relative, newest-first order
 *  irrelevant — this is a hunt, not a listing. */
function sourceFiles(dir) {
  const out = []
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      if (HUNT_SKIP.has(name)) continue
      const full = join(abs, name)
      if (HUNT_SKIP_PATHS.has(relative(root, full))) continue
      if (statSync(full).isDirectory()) walk(full)
      else if (HUNT_EXT.some((e) => name.endsWith(e))) out.push(relative(root, full))
    }
  }
  try { walk(resolve(root, dir)) } catch { /* a tree that is not there is not a problem */ }
  return out
}

/**
 * THE CODE, WITHOUT THE PROSE. An explanation of the equivalence is not a
 * second copy of it, so line comments, block comments and Python's
 * triple-quoted blocks all go — the last of those is where this codebase
 * writes its paragraphs. What is left is strings, keys and identifiers: the
 * places a word can actually decide something.
 *
 * Deliberately conservative in one direction only: a stripper that missed a
 * comment would report a finding that is not one, which a person reads and
 * dismisses. One that swallowed code would hide the thing it is here to find,
 * so nothing is removed that is not unambiguously prose.
 */
function stripComments(text, file) {
  const py = file.endsWith('.py')
  let out = ''
  let quote = ''        // '' | "'" | '"' | "'''" | '"""' | '`'
  for (let p = 0; p < text.length; p++) {
    const c = text[p], n = text[p + 1]
    if (quote) {
      if (c === '\\') { out += '  '; p++; continue }
      if (quote.length === 3 && text.startsWith(quote, p)) { quote = ''; out += '   '; p += 2; continue }
      if (quote.length === 1 && c === quote) quote = ''
      out += c
      continue
    }
    if (py && (text.startsWith('"""', p) || text.startsWith("'''", p))) {
      // a triple-quoted block: prose in this codebase, always
      const mark = text.slice(p, p + 3)
      const end = text.indexOf(mark, p + 3)
      const stop = end === -1 ? text.length : end + 3
      for (let q = p; q < stop; q++) out += text[q] === '\n' ? '\n' : ' '
      p = stop - 1
      continue
    }
    if (py && c === '#') { while (p < text.length && text[p] !== '\n') { out += ' '; p++ } out += '\n'; continue }
    if (!py && c === '/' && n === '/') { while (p < text.length && text[p] !== '\n') { out += ' '; p++ } out += '\n'; continue }
    if (!py && c === '/' && n === '*') {
      const end = text.indexOf('*/', p + 2)
      const stop = end === -1 ? text.length : end + 2
      for (let q = p; q < stop; q++) out += text[q] === '\n' ? '\n' : ' '
      p = stop - 1
      continue
    }
    if (c === '"' || c === "'" || (!py && c === '`')) { quote = c; out += c; continue }
    out += c
  }
  return out
}

/* ======================================================================== */
let checked = 0

if (VOCABULARY.length) {
  for (const entry of [...LISTS]) {
    try {
      const words = wordsOf(entry)
      const missing = VOCABULARY.filter((b) => !words.includes(b))
      checked++
      if (missing.length) {
        problems.push(`${entry.file} — ${entry.name} is missing ${missing.join(', ')}: ${entry.why}`)
      }
    } catch { /* already recorded */ }
  }

  // the label map is keyed lower-case and spelled for a human
  try {
    const labels = Object.keys(literal(read(LABELLED.file), LABELLED.name, LABELLED.file))
      .map((k) => k.toUpperCase())
    checked++
    // the six ROLE words carry their labels in ROLE_LABEL instead, so only
    // the words that are types are required here
    const ROLE_WORDS = ['ADMIN', 'MANAGER', 'STAFF', 'CLIENT', 'ONBOARDING', 'INTERVIEWER']
    const missing = VOCABULARY.filter((b) => !ROLE_WORDS.includes(b) && !labels.includes(b))
    if (missing.length) {
      problems.push(`${LABELLED.file} — ${LABELLED.name} is missing ${missing.join(', ')}: ${LABELLED.why}`)
    }
  } catch { /* already recorded */ }

  // the python set, read as text
  try {
    const text = read(LIVE.file)
    const at = text.indexOf(LIVE.name)
    if (at === -1) fail(`${LIVE.file}: ${LIVE.name} is gone`)
    const body = text.slice(at, text.indexOf('}', at))
    checked++
    const missing = VOCABULARY.filter((b) => !body.includes(`"${b}"`))
    if (missing.length) {
      problems.push(`${LIVE.file} — ${LIVE.name} is missing ${missing.join(', ')}: ${LIVE.why}`)
    }
  } catch { /* already recorded */ }
}

// the copies of the equivalence must be the same table
try {
  const { spa, gas, py, app } = followsOf()
  checked++
  const shape = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
  if (shape(spa) !== shape(gas) || shape(spa) !== shape(py) || shape(spa) !== shape(app)) {
    problems.push(
      'BADGE_FOLLOWS disagrees between the runtimes — ' +
      `SPA ${shape(spa)}, app ${shape(app)}, Apps Script ${shape(gas)}, relay ${shape(py)}. ` +
      'A badge that is a director on one lane and nobody on another is worse than a badge nobody has.')
  }
  // and every word in it must be a real badge on both sides of the arrow,
  // and must sit at the same rung of the digest's rank
  const ladder = literal(read(LADDER.file), LADDER.name, LADDER.file)
  const rankOf = (word) => ladder[String(word).toLowerCase()]
  const hmRank = rankOf('hm')
  for (const [worn, stands] of Object.entries(spa)) {
    if (VOCABULARY.length && !VOCABULARY.includes(worn)) {
      problems.push(`BADGE_FOLLOWS: "${worn}" is not in HUB_USER_TYPES — nobody can be granted it`)
    }
    if (VOCABULARY.length && !VOCABULARY.includes(stands)) {
      problems.push(`BADGE_FOLLOWS: "${worn}" follows "${stands}", which is not a badge`)
    }
    const mine = rankOf(worn), theirs = rankOf(stands)
    if (theirs === undefined) {
      problems.push(`${LADDER.file}: "${stands}" is followed by "${worn}" but is not ranked — ` +
                    'the ladder cannot say the two are equals')
    } else if (mine === undefined) {
      problems.push(`${LADDER.file}: "${worn}" is equivalent to "${stands}" but is unranked, ` +
                    `which puts it at the floor — below a house manager, not above one`)
    } else if (mine < theirs) {
      // ranked ABOVE is allowed: a badge may outrank the one whose reach it carries
      problems.push(`${LADDER.file}: "${worn}" ranks ${mine} while the badge it currently ` +
                    `equals ("${stands}") ranks ${theirs} — equivalent everywhere and junior here`)
    } else if (hmRank !== undefined && mine <= hmRank) {
      problems.push(`${LADDER.file}: "${worn}" ranks ${mine} against a house manager's ${hmRank} ` +
                    '— the one thing that must stay true is that it counts as ABOVE one')
    }
  }
  checked++
} catch { /* already recorded */ }

// the display order: the SPA's, the app's copy that `wears_from` ranks by, and the editions' hand-written slice
try {
  checked++
  const spa = literal(read('src/components/shared/RoleBadge.tsx'), 'export const BADGE_ORDER',
                      'src/components/shared/RoleBadge.tsx')
  const tuple = (read('app/scope.py').match(/^BADGE_ORDER = \(([^)]*)\)/m) || [])[1]
  const app = tuple === undefined ? null : [...tuple.matchAll(/"([A-Z]+)"/g)].map((m) => m[1])
  const editions = literal(read('src/lib/editions.ts'), 'export const EDITION_BADGES', 'src/lib/editions.ts')
  const slice = spa.slice(1, spa.indexOf('STAFF') + 1)
  if (!app) {
    problems.push('app/scope.py BADGE_ORDER is not a plain tuple any more — this check cannot see it')
  } else if (JSON.stringify(app) !== JSON.stringify(spa)) {
    problems.push(`app/scope.py BADGE_ORDER (${app.join(', ')}) disagrees with RoleBadge.tsx BADGE_ORDER ` +
                  `(${spa.join(', ')}) — a corner draws one badge while the server ranks "X or above" by another`)
  }
  if (JSON.stringify(editions) !== JSON.stringify(slice)) {
    problems.push(`src/lib/editions.ts EDITION_BADGES (${editions.join(', ')}) is not BADGE_ORDER from ` +
                  `PLATFORMLEAD to STAFF (${slice.join(', ')}) — app/editions.py open_badges derives it, and ` +
                  'the dropdown would offer an "X and above" the server reads differently')
  }
} catch { /* already recorded */ }

/**
 * THE DIGEST'S RANK HAS ONE RUNTIME, and a copy of it elsewhere would be a
 * second answer to "which badge is senior" that nothing holds in step. The
 * SPA and the relay have no ladder at all today — deliberately, and said so
 * over the table — so a USE of its name under src/ or server/ means somebody
 * either copied the numbers or reached for a global they cannot call. A
 * comment pointing at it is how a reader finds the explanation, so comments
 * are stripped first, exactly as they are for the word hunt below.
 */
try {
  checked++
  for (const dir of ['src', 'server']) {
    for (const file of sourceFiles(dir)) {
      if (stripComments(read(file), file).includes('DIGEST_BADGE_RANK')) {
        problems.push(`${file} names DIGEST_BADGE_RANK, which is an Apps Script global the SPA ` +
                      'and the relay cannot call — a second seniority table is a second answer')
      }
    }
  }
} catch { /* already recorded */ }

/**
 * THE RELAY FOLDS AT CALL SITES, so the call sites are the pin.
 *
 * A hard import as well as the call: the guarded kind would promise a
 * degraded mode that no relay can reach (snapshot_service imports the module
 * at module scope, so an absent file has already refused the process a start)
 * and that nobody would see when it did.
 */
for (const entry of RELAY_CALLS) {
  try {
    const text = read(entry.file)
    checked++
    if (!/^import badge_follows$/m.test(text)) {
      problems.push(`${entry.file} no longer imports badge_follows at module scope — ` +
                    'the access law is not an optional dependency')
    }
    if (!text.includes(entry.call)) {
      problems.push(`${entry.file} no longer calls ${entry.call}…) — ${entry.why}`)
    }
  } catch (err) { problems.push(`${entry.file}: ${err.message}`) }
}

/**
 * AND THE WORD ITSELF, HUNTED — the check that makes "empty the four tables
 * and the two badges part company" a fact rather than a hope.
 */
try {
  const { spa } = followsOf()
  const followed = Object.keys(spa).map((w) => w.toUpperCase())
  if (followed.length) {
    const homes = new Map(WORD_HOMES)
    checked++
    for (const dir of HUNT_DIRS) {
      for (const file of sourceFiles(dir)) {
        if (homes.has(file)) continue
        const code = stripComments(read(file), file)
        // the stored token is upper case; a lower-case "supervisor" is English copy, not a badge
        const found = followed.filter((w) => new RegExp(`\\b${w}\\b`).test(code))
        if (found.length) {
          problems.push(`${file} spells ${found.join(', ')} outside a comment. That word is ` +
                        'currently equivalent to another badge, and the two must be able to ' +
                        'part company when BADGE_FOLLOWS is emptied — this copy would ' +
                        'outlive it. Read the equivalence (withFollowedBadges / ' +
                        'userBadgesWorn_ / badge_follows.with_followed) instead, or add the ' +
                        'file to WORD_HOMES in tools/check-badges.mjs with its reason.')
        }
      }
    }
  }
} catch { /* already recorded */ }

// the ** manager badge is derived by the relay and by Apps Script: same word, a grantable badge
try {
  checked++
  const py = (read('server/shift_requests.py').match(/^CALENDAR_BADGE = "([A-Z]+)"$/m) || [])[1]
  const gas = (read('apps-script/Profile.gs').match(/^var HUB_CALENDAR_BADGE = '([A-Z]+)';$/m) || [])[1]
  if (!py || !gas) {
    problems.push('the calendar badge (shift_requests.CALENDAR_BADGE / Profile.gs HUB_CALENDAR_BADGE) ' +
                  'is not a plain literal any more — this check cannot see it')
  } else if (py !== gas) {
    problems.push(`the calendar badge disagrees: the relay derives ${py}, Apps Script ${gas} — a house ` +
                  'manager would open one set of apps and be refused their doors')
  } else if (VOCABULARY.length && !VOCABULARY.includes(py)) {
    problems.push(`the calendar badge ${py} is not in HUB_USER_TYPES`)
  }
} catch { /* already recorded */ }

// lib/pageGate must agree with the relay's gate (shift_requests.edits_every_house, CALENDAR_BADGE)
try {
  checked++
  const py = read('server/shift_requests.py')
  const ts = read('src/lib/pageGate.ts')
  const pyList = (name, fallback) => {
    const m = py.match(new RegExp(`^${name} = frozenset\\([\\s\\S]*?"([A-Za-z ,]+)"\\)`, 'm'))
    return (m ? m[1] : fallback).split(',').map((w) => w.trim()).filter(Boolean)
  }
  const tsList = (name) => {
    const m = ts.match(new RegExp(`export const ${name}: readonly string\\[\\] = \\[([^\\]]*)\\]`))
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
  }
  const same = (a, b) => JSON.stringify([...a].map((w) => w.toUpperCase()).sort()) ===
                         JSON.stringify([...b].map((w) => w.toUpperCase()).sort())
  const pairs = [
    ['EVERY_HOUSE_BADGES', pyList('REASON_BADGES', ''), 'shift_requests.REASON_BADGES'],
    ['EVERY_HOUSE_ROLES', pyList('CALENDAR_EDIT_ROLES', ''), 'shift_requests.CALENDAR_EDIT_ROLES'],
    ['GATE_REFUSED_ROLES', pyList('CALENDAR_REFUSED_ROLES', ''), 'shift_requests.CALENDAR_REFUSED_ROLES'],
  ]
  for (const [name, want, where] of pairs) {
    const got = tsList(name)
    if (!got || !want.length) {
      problems.push(`the page gates cannot be compared: ${name} in src/lib/pageGate.ts or ${where} ` +
                    'is not a plain list any more')
    } else if (!same(got, want)) {
      problems.push(`src/lib/pageGate.ts ${name} (${got.join(', ')}) disagrees with ${where} ` +
                    `(${want.join(', ')}) — the menu would offer a Calendar Builder screen the relay ` +
                    'refuses, or hide one it would open')
    }
  }
  const hm = (ts.match(/^export const HOUSE_MANAGER_BADGE = '([A-Z]+)'$/m) || [])[1]
  const cal = (py.match(/^CALENDAR_BADGE = "([A-Z]+)"$/m) || [])[1]
  if (!hm || hm !== cal) {
    problems.push(`src/lib/pageGate.ts HOUSE_MANAGER_BADGE (${hm || 'unreadable'}) is not the relay's ` +
                  `CALENDAR_BADGE (${cal || 'unreadable'})`)
  }
} catch { /* already recorded */ }

// lib/badgeAccess's containment of the four My apps must be the relay's (hotline_desk.CONTAINED_ROLES)
try {
  checked++
  const py = (read('server/hotline_desk.py').match(/^CONTAINED_ROLES = frozenset\(\{([^}]*)\}\)/m) || [])[1]
  const ts = (read('src/lib/badgeAccess.ts').match(/export const RELAY_CONTAINED_ROLES: readonly string\[\] = \[([^\]]*)\]/) || [])[1]
  const words = (text, q) => [...String(text).matchAll(q)].map((m) => m[1]).sort()
  if (py === undefined || ts === undefined) {
    problems.push('the containment of the My apps cannot be compared: hotline_desk.CONTAINED_ROLES or ' +
                  'src/lib/badgeAccess.ts RELAY_CONTAINED_ROLES is not a plain list any more')
  } else if (JSON.stringify(words(py, /"([a-z]+)"/g)) !== JSON.stringify(words(ts, /'([a-z]+)'/g))) {
    problems.push(`src/lib/badgeAccess.ts RELAY_CONTAINED_ROLES (${words(ts, /'([a-z]+)'/g).join(', ')}) disagrees ` +
                  `with hotline_desk.CONTAINED_ROLES (${words(py, /"([a-z]+)"/g).join(', ')}) — a tile would be ` +
                  'drawn that the door refuses, or hidden where it would open')
  }
} catch { /* already recorded */ }

// the badges only the master grants: the dialog that locks the chip and the door that refuses the write agree
try {
  checked++
  const gas = literal(profile, 'var HUB_MASTER_GRANTED_BADGES', 'apps-script/Profile.gs')
  const spa = literal(read('src/pages/settings/UsersSection.tsx'), 'const MASTER_GRANTED_TYPES',
                      'src/pages/settings/UsersSection.tsx')
  const norm = (l) => JSON.stringify([...l].map((w) => String(w).toUpperCase()).sort())
  if (norm(gas) !== norm(spa)) {
    problems.push(`the master-granted badges disagree: Profile.gs HUB_MASTER_GRANTED_BADGES ${norm(gas)}, ` +
                  `UsersSection.tsx MASTER_GRANTED_TYPES ${norm(spa)} — a chip offered that the door refuses, ` +
                  'or locked where it would be taken')
  }
  for (const w of gas) {
    if (VOCABULARY.length && !VOCABULARY.includes(String(w).toUpperCase())) {
      problems.push(`HUB_MASTER_GRANTED_BADGES names "${w}", which is not in HUB_USER_TYPES`)
    }
  }
} catch { /* already recorded */ }

if (!VOCABULARY.length) problems.push('apps-script/Profile.gs: HUB_USER_TYPES could not be read')

if (problems.length) {
  console.error(`check-badges — ${problems.length} problem(s):`)
  for (const p of problems) console.error(`  · ${p}`)
  if (strict) process.exit(1)
} else {
  console.log(`check-badges — ${VOCABULARY.length} badges, ${checked} list(s), all complete`)
}
