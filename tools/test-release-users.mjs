#!/usr/bin/env node
/**
 * RELEASE USERS, RUN RATHER THAN READ.
 *
 * WHAT WENT WRONG. The master picks a person and presses Release: the account
 * is rearmed to a fresh random temporary password and a letter and a text go out
 * naming that password. The lane destroyed the credential FIRST and asked the
 * send door afterwards, and the first fix asked only the test-mode dial before
 * the write — so every other brake (the invite's situation switched off, the
 * sending switch, an opt-out, a transport refusal, an unreadable switch read
 * as "off") was still found after the person's own password had stopped
 * working. Around it: a throw after the rearm answered 500 ("the release
 * failed") about a password already gone, an unreadable sessions tab read as
 * "no open session", the announcement was widened from the released accounts
 * to every account born with the default password and fired inside the badge
 * save's script lock, the button re-sent to people already told, and an
 * already-sent letter was counted as refused.
 *
 * WHAT THIS ASSERTS, against the real Apps Script source in a vm with the
 * sheets standing in as arrays and a send door that keeps the real brake
 * order (opt-out, test mode, sending switch; the `invitation` letter walks
 * past the last two by name):
 *
 *   door      the letter is asked for BEFORE the row is touched and every
 *             brake refuses with the password unchanged; `anyway` rearms
 *   switch    an unreadable test-mode read refuses and asks nothing
 *   letter    the invite claims `invitation` on its letter, never its text
 *   rearm     a write that throws puts every written cell back
 *   after     nothing after the rearm can turn it into a 500
 *   sessions  ended for this person only; unreadable is never zero
 *   marks     read for THIS person, cleared by rewriting, the blob stamped
 *   status    the card says what the letter would meet, before the press
 *   audience  released accounts only; the rest are counted
 *   once      the button skips everybody already told; `again` re-sends
 *   counting  one answer per person — sent, already sent, held, refused
 *   optout    an opt-out list nobody could read (the sentence optOutBlocked_
 *             RETURNS) is counted, refused and said as that, never as a stop,
 *             and keeps the once-per-app stamp unwritten
 *   secret    both legs name the press's temporary password for every book to withhold
 *   random    every press mints its own password and never reads the shared default
 *   fold      one morning entry per app holds every debt of the night
 *   unread    a book, a test-mode switch or a told-log that could not be read
 *             writes nobody and owes the app to the next pass, never drops it
 *   carry     the morning carry keeps a debt only while its pass settles
 *             (tells, or meets a stop it will not ask again) at least as many
 *             as it spends on held, refused or unchecked letters, and only
 *             once the told-log holds them; a read it could not make is
 *             `kept` and named, never "said"
 *   screen    the page reads the envelope and never re-sends a press
 *
 *   node tools/test-release-users.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import vm from 'node:vm'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const results = { ok: 0, failed: [] }
function check (name, cond, detail) {
  if (cond) { results.ok++; console.log(`  ok   ${name}`) } else {
    results.failed.push(name)
    console.log(`  FAIL ${name}${detail === undefined ? '' : '\n       ' + String(detail).slice(0, 500)}`)
  }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const RELEASE = read('apps-script/ReleaseUsers.gs')
const COMMREL = read('apps-script/CommRelease.gs')
const RPC = read('apps-script/Rpc.gs')
const GATE = read('apps-script/SmartGate.gs')
const PREFS = read('apps-script/Prefs.gs')
// the screen and the module that words its answers (releaseReport.ts), read as one
const PAGE = read('src/pages/features/releaseusers/ReleaseUsersPage.tsx') +
  read('src/pages/features/releaseusers/releaseReport.ts')
const PREFS_SYNC = read('src/lib/prefsSync.ts')
const TOUR = read('src/features/auth/FirstLoginTour.tsx')
const PG_INTRO = read('src/pages/features/playground/PlaygroundIntro.tsx')
const MW_INTRO = read('src/pages/worlds/MyWorldIntro.tsx')
const SEEN_ONCE = read('src/lib/seenOnce.ts')
const HEADER_TSX = read('src/components/shared/PageHeader.tsx')
const TECH = read('src/pages/features/technology/TechnologyPage.tsx')
const THEME = read('src/styles/theme.css')
const TAILWIND = read('tailwind.config.js')

/** One top-level `function name (` / `function name(` or `X.name = function`, brace-matched. */
function slice (text, head) {
  const at = text.indexOf(head)
  if (at < 0) throw new Error(`not in the source any more: ${head}`)
  let depth = 0
  for (let i = text.indexOf('{', at); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(at, i + 1) + ';' }
  }
  throw new Error(`${head} does not close`)
}

/** One top-level `var NAME = ...;` line. */
function varLine (text, name) {
  const m = new RegExp(`^var ${name} = [^\\n]*;$`, 'm').exec(text)
  if (!m) throw new Error(`no var ${name} any more`)
  return m[0]
}

/* ── the sheets, as arrays ────────────────────────────────────────────────── */
function makeSheet (grid, opts = {}) {
  const cells = grid.map((r) => r.slice())
  const width = () => cells.reduce((w, r) => Math.max(w, r.length), 0)
  const sheet = {
    getLastRow: () => cells.length,
    getLastColumn: () => width(),
    getDataRange: () => {
      if (opts.unreadable) throw new Error(opts.unreadable)
      return sheet.getRange(1, 1, Math.max(cells.length, 1), Math.max(width(), 1))
    },
    getRange: (row, col, rows = 1, cols = 1) => ({
      getValues: () => {
        const out = []
        for (let r = row; r < row + rows; r++) {
          const line = []
          for (let c = col; c < col + cols; c++) {
            const v = (cells[r - 1] || [])[c - 1]
            line.push(v === undefined ? '' : v)
          }
          out.push(line)
        }
        return out
      },
      getValue: () => {
        const v = (cells[row - 1] || [])[col - 1]
        return v === undefined ? '' : v
      },
      setValue: (v) => {
        if (row < 1 || col < 1) throw new Error(`getRange(${row}, ${col}) is out of bounds`)
        if (opts.failWrite && opts.failWrite(row, col, v)) throw new Error('Service Spreadsheets timed out')
        while (cells.length < row) cells.push([])
        cells[row - 1][col - 1] = v
      },
      setValues: (values) => {
        if (opts.failValues) throw new Error(opts.failValues)
        values.forEach((line, r) => {
          const at = row - 1 + r
          while (cells.length <= at) cells.push([])
          line.forEach((v, c) => { cells[at][col - 1 + c] = v })
        })
      }
    }),
    appendRow: (line) => { cells.push(line.slice()) },
    deleteRow: (r) => {
      if (opts.failDelete) throw new Error(opts.failDelete)
      cells.splice(r - 1, 1)
    }
  }
  return { sheet, cells }
}

const USERS_HDR = ['user_id', 'email', 'display_name', 'role', 'active', 'salt', 'pass_hash',
  'must_change', 'last_login', 'released_at', 'types', 'app_denials', 'phone', 'system_hidden']

function usersGrid (rows) {
  return [USERS_HDR.slice(), ...rows.map((r) => USERS_HDR.map((h) => (r[h] === undefined ? '' : r[h])))]
}

/** The two situations the lane speaks through, as the Smart Comms house holds them. */
const SITUATIONS = [
  {
    id: 'user_release_invite', enabled: 'yes', channels: 'sms, email',
    sms_text: 'Hi {first_name}, sign in as {login} with the temporary password {password}.',
    email_text: 'Hi {first_name}.\n\nSign in as {login}.\nTemporary password: {password}',
    email_subject: 'Your account is ready'
  },
  {
    id: 'app_release_announced', enabled: 'yes', channels: 'sms, email',
    sms_text: '{app_title} is now open to you.',
    email_text: '{app_title} is now open to you.\n\n{objective}',
    email_subject: '{app_title}'
  }
]

/**
 * optOutBlocked_ AS OptOut.gs ANSWERS: a person's stop is a sentence, and an
 * opt-out list that cannot be read is ALSO a returned sentence — optOutIndex_
 * catches the read and hands back its error, it never throws.
 */
const OPT_OUT_UNREAD = 'The opt-out list could not be read: Service Spreadsheets timed out'
function optOutSays (world, to) {
  if (world.optOutUnreadable) return OPT_OUT_UNREAD
  return world.optedOut.includes(String(to)) ? 'This person asked us to stop.' : ''
}

/**
 * THE SEND DOOR, IN THE ORDER rpcCall_ KEEPS: the person's opt-out first,
 * then test mode, then the sending switch — and a claimed `invitation` walks
 * past the last two, exactly as HUB_AUTH_LETTERS lets it. A case that needs
 * the transport itself to answer something else passes `answer`.
 */
function door (world, method, params) {
  const stopped = optOutSays(world, params.to)
  if (stopped) {
    return { ok: true, sent: false, gated: true, reason: 'opted_out', detail: stopped }
  }
  const auth = params.auth_letter === 'invitation'
  if (world.testMode === 'on' && !auth) {
    return { ok: true, sent: false, gated: true, rehearsed: true, reason: 'the dial is at the sheet' }
  }
  if (world.sendSwitch === 'off' && !auth) {
    return { ok: true, sent: false, gated: true, reason: 'HUB_RPC_SEND is off' }
  }
  return { ok: true, sent: true, receipt: 'r1' }
}

/**
 * The world the lane runs in. `world` carries the switches a case wants to
 * move and the books it wrote.
 */
function build (opts = {}) {
  const users = makeSheet(usersGrid(opts.users || []), { failWrite: opts.failUserWrite })
  const sessions = makeSheet([['token_hash', 'user_id', 'created_at', 'expires_at', 'last_seen'],
    ...(opts.sessions || [])], { unreadable: opts.sessionsUnreadable, failDelete: opts.sessionsFailDelete })
  const prefs = makeSheet([opts.prefsHeader || ['user_id', 'prefs', 'updated_at'], ...(opts.prefs || [])],
    { unreadable: opts.prefsUnreadable })
  // the access matrix's read can be made to fail, and to answer again, mid-case
  const badgeRead = { unreadable: opts.badgesUnreadable || '' }
  const badges = makeSheet([['app_id', 'badges', 'at', 'by'], ...(opts.badges || [])], badgeRead)
  // the told-log reads, and its writes can be made to fail and to land again, mid-case
  const logBook = { unreadable: opts.logUnreadable, failValues: opts.logWriteFails || '' }
  const relLog = makeSheet([['id', 'at', 'app_id', 'title', 'user_id', 'email', 'mode', 'sent'],
    ...(opts.log || [])], logBook)
  const world = {
    testMode: opts.testMode || 'off',            // 'on' | 'off' | 'throw'
    sendSwitch: opts.sendSwitch || 'on',
    optedOut: opts.optedOut || [],
    situations: opts.situations || SITUATIONS.map((s) => Object.assign({}, s)),
    situationsThrow: opts.situationsThrow === true,
    answer: opts.answer || null,
    /* the quiet window and its morning list, moved per case; the list is the
       real hubQuietOwe_ over the script properties below */
    quiet: opts.quiet === true,
    oweRefuses: opts.oweRefuses === true,
    optOutUnreadable: opts.optOutUnreadable === true,
    props: Object.assign({}, opts.props),
    cacheRemoved: [],
    logs: [],
    calls: [],
    bodiesAsWritten: [],
    /* every temporary password a press minted, in order — the stand-in for Auth.gs tempPassword_ */
    minted: [],
    propsAsked: [],
    badgeRead,
    logBook,
    users, sessions, prefs, badges, relLog
  }
  /* the morning list as it stands in the store: one entry per property */
  Object.defineProperty(world, 'owed', {
    get: () => Object.keys(world.props).filter((k) => k.indexOf('HUB_QUIET_OWED|') === 0)
      .map((k) => JSON.parse(world.props[k]))
  })
  const box = {
    console,
    USERS_TAB: 'users',
    SESSIONS_TAB: 'hub_sessions',
    HUB_POLICY: {},
    HUB_ACTIONS: {},
    SMART_SENDER_DEFAULT: 'ASA',
    Date,
    JSON,
    Math,
    String,
    Number,
    Array,
    Object,
    Error,
    Utilities: { getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    isNaN,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (world.props[k] === undefined ? null : world.props[k]),
        setProperty: (k, v) => {
          if (world.oweRefuses && String(k).indexOf('HUB_QUIET_OWED|') === 0) {
            throw new Error('the property store refused the write')
          }
          world.props[k] = String(v)
        },
        getKeys: () => Object.keys(world.props),
        deleteProperty: (k) => { delete world.props[k] }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => {},
        remove: (k) => { world.cacheRemoved.push(k) }
      })
    },
    str_: (v) => (v === null || v === undefined ? '' : String(v)).trim(),
    normKey_: (v) => String(v === null || v === undefined ? '' : v)
      .toLowerCase().replace(/[^a-z0-9]/g, ''),
    hubDenied_: () => ({ status: 403, message: 'no' }),
    hubIsMaster_: (email) => String(email) === 'master@asa',
    /* the shared default is still set on the project: a release must never reach for it */
    hubProp_: (k) => { world.propsAsked.push(k); return k === 'FIRST_USER_PASSWORD' ? 'Sw0rdf1sh!' : '' },
    tempPassword_: () => {
      const pw = `Tmp${world.minted.length + 2}PassWord`
      world.minted.push(pw)
      return pw
    },
    randomHex_: () => 'newsalt',
    hashPassword_: (pw, salt) => 'hash(' + pw + '|' + salt + ')',
    mailPlatformUrl_: () => 'https://hub',
    hubSheet_: (tab) => (tab === 'hub_sessions' ? sessions.sheet : users.sheet),
    prefsSheet_: () => prefs.sheet,
    appBadgeSheet_: () => badges.sheet,
    hubTabEnsure_: () => relLog.sheet,
    ensureHeader_: () => {},
    ensureUserProfileColumns_: () => {},
    userTypesFromRaw_: (raw) => ({
      types: String(raw || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    }),
    userBadgesWorn_: (raw) => String(raw || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
    hubSysLog_: (who, type, text, env) => { world.logs.push({ who, type, text, status: env && env.status }) },
    /* the one switch, read as the transport reads it: it THROWS when unreadable */
    hubTestModeOn_: () => {
      if (world.testMode === 'throw') throw new Error('the alerts config could not be read')
      return world.testMode === 'on'
    },
    /* the send door: it records what it was handed, and the words AS THE BOOKS
       WOULD KEEP THEM — through the real hubWithhold_ with what the call named */
    rpcCall_: (method, params, o) => {
      world.calls.push({ method, key: (o || {}).idempotency_key, reason: params.reason,
        to: params.to, auth: params.auth_letter, withhold: params.withhold })
      world.bodiesAsWritten.push(box.hubWithhold_(String(params.body || ''), params.withhold))
      return world.answer ? world.answer(method, params, o) : door(world, method, params)
    },
    optOutBlocked_: (to) => optOutSays(world, to),
    /* Smart Comms: the house as rows, and the switch word as the platform reads it */
    smartSituations_: () => {
      if (world.situationsThrow) throw new Error('the situations house timed out')
      return world.situations
    },
    smartOn_: (v) => ['yes', 'true', 'on', '1'].includes(String(v || '').trim().toLowerCase()),
    hubQuietAt_: () => world.quiet === true,
    hubQuietWords_: () => '21:31–07:59 New York',
    HUB_QUIET_TO: '08:00',
    hubQuietNow_: () => new Date(),
    smartList_: (v) => String(v || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
    smartRender_: (text, vars) => String(text || '')
      .replace(/\{(\w+)\}/g, (_m, k) => (vars[k] === undefined ? '' : String(vars[k]))),
    mailPara_: (s) => `<p>${s}</p>`,
    mailEsc_: (s) => String(s),
    mailFact_: (label, value) => `<b>${label}</b>: ${value}`,
    mailShell_: (o) => String(o.blocks.join('')),
    packetTeamCopyNumber_: (p) => String(p || ''),
    hubSharedLine_: () => false,
    smartRecord_: () => {},
    smartLedgerKey_: (...a) => a.join('|'),
    /* optOutIndex_ as OptOut.gs answers it: a list it could not read is an
       `error` beside an empty index, never a throw */
    optOutIndex_: () => (world.optOutUnreadable ? { by: {}, error: OPT_OUT_UNREAD } : { by: {}, error: '' })
  }
  box.global = box
  vm.createContext(box)
  /* from their own file: the withholding every book applies, and the morning
     list itself — its store doors over the properties above */
  vm.runInContext([
    varLine(RPC, 'HUB_WITHHELD_WORDS'),
    slice(RPC, 'function hubWithhold_'),
    varLine(RPC, 'HUB_QUIET_OWED_PREFIX'),
    varLine(RPC, 'HUB_QUIET_OWED_MAX'),
    varLine(RPC, 'HUB_QUIET_OWED_BYTES'),
    varLine(RPC, 'HUB_QUIET_OWED_HORIZON_MS'),
    slice(RPC, 'var HUB_QUIET_OWED_LANES'),
    varLine(RPC, 'HUB_QUIET_CARRY_BUDGET_MS'),
    slice(RPC, 'function hubQuietOwedLimits_'),
    slice(RPC, 'function hubQuietOwedKeys_'),
    slice(RPC, 'function hubQuietOwedGet_'),
    slice(RPC, 'function hubQuietOwedSet_'),
    slice(RPC, 'function hubQuietOwedDel_'),
    slice(RPC, 'function hubQuietLocked_'),
    slice(RPC, 'function hubQuietOwedName_'),
    slice(RPC, 'function hubQuietOwe_'),
    // the hotline's morning pass itself: it takes each entry before handing it to its lane
    slice(RPC, 'function hubQuietOwedCarry_'),
    varLine(PREFS, 'PREFS_RELEASED_KEY')
  ].join('\n'), box, { filename: 'Rpc.gs' })
  /* the invitation's own switch, read by the real SmartGate.gs readers over the same house */
  vm.runInContext([
    "var HUB_AUTH_SITUATIONS = { password_reset: 'auth_password_reset', invitation: 'auth_invitation' };",
    'var HUB_LETTER_UNREADABLE_SAID = {};',
    slice(GATE, 'function hubSituationRead_'),
    slice(GATE, 'function hubLetterUnreadableSay_'),
    slice(GATE, 'function hubAuthSituationId_'),
    slice(GATE, 'function hubAuthLetterAllowed_')
  ].join('\n'), box, { filename: 'SmartGate.gs' })
  vm.runInContext(COMMREL, box, { filename: 'CommRelease.gs' })
  vm.runInContext(RELEASE, box, { filename: 'ReleaseUsers.gs' })
  box.world = world
  return box
}

/* the entry the morning list holds for the app — an empty debt when none was kept */
const owedData = (env) => (env.world.owed[0] || { data: { app_id: 'cal', badges: [] } }).data

const MASTER = { role: 'admin', email: 'master@asa' }
const PERSON = {
  user_id: 'USR_1', email: 'rin@asa', display_name: 'Rin Okafor', role: 'admin', active: 'true',
  salt: 'oldsalt', pass_hash: 'theirownhash', must_change: 'false',
  last_login: '2020-01-01T00:00:00Z', types: 'DIRECTOR', phone: '+13305550101'
}
const ROW = (g, name) => g.cells[1][USERS_HDR.indexOf(name)]
const untouched = (env) => ROW(env.world.users, 'pass_hash') === 'theirownhash' &&
  ROW(env.world.users, 'salt') === 'oldsalt' && ROW(env.world.users, 'must_change') === 'false' &&
  ROW(env.world.users, 'last_login') === '2020-01-01T00:00:00Z' && ROW(env.world.users, 'released_at') === ''
/* rearmed with the password THIS press minted — never the shared default */
const rearmed = (env) => env.world.minted.length > 0 &&
  ROW(env.world.users, 'pass_hash') === `hash(${env.world.minted[env.world.minted.length - 1]}|newsalt)` &&
  ROW(env.world.users, 'must_change') === 'true' && ROW(env.world.users, 'last_login') === ''

/* ══ door: the letter first, the credential after ════════════════════════ */
console.log('THE LETTER IS ASKED FOR BEFORE THE CREDENTIAL IS DESTROYED')
{
  const env = build({ users: [PERSON], testMode: 'on' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('door: with test mode on the letter still leaves, so the release happens',
    out.status === 200 && out.data.emailed === true && out.data.outcome === 'sent' && rearmed(env),
    JSON.stringify(out))
  const mail = env.world.calls.find((c) => c.method === 'emailSend')
  const text = env.world.calls.find((c) => c.method === 'smsSend')
  check('letter: the e-mail claims the `invitation` authentication letter',
    mail && mail.auth === 'invitation', JSON.stringify(env.world.calls))
  check('letter: the text never claims it, and test mode holds it',
    text && text.auth === undefined && out.data.legs.includes('sms (held)'), JSON.stringify(out.data.legs))
  check('door: the letter left BEFORE the password was rewritten',
    env.world.calls.length === 2, env.world.calls.length)
  check('random: the press minted one password of its own and never read the shared default',
    env.world.minted.length === 1 && !env.world.propsAsked.includes('FIRST_USER_PASSWORD') &&
    !env.world.propsAsked.includes('ONBOARDING_USER_PASSWORD') &&
    !ROW(env.world.users, 'pass_hash').includes('Sw0rdf1sh!'), JSON.stringify(env.world.propsAsked))
  const again = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p2' }, MASTER)
  check('random: a second press mints a different password, and its letter names that one',
    again.status === 200 && env.world.minted.length === 2 && env.world.minted[0] !== env.world.minted[1] &&
    rearmed(env) && env.world.calls.slice(2).every((c) => c.withhold.join() === env.world.minted[1]),
    JSON.stringify(env.world.minted))
}
for (const [label, opts, brake] of [
  ['the invite situation switched off',
    { situations: SITUATIONS.map((s) => Object.assign({}, s, s.id === 'user_release_invite' ? { enabled: 'no' } : {})) },
    'situation_off'],
  ['the invite situation absent', { situations: [SITUATIONS[1]] }, 'situation_absent'],
  ['the invite situation with no words',
    { situations: SITUATIONS.map((s) => Object.assign({}, s, s.id === 'user_release_invite' ? { sms_text: '', email_text: '' } : {})) },
    'situation_wordless'],
  ['the Smart Comms house unreadable', { situationsThrow: true }, 'situation_unreadable'],
  ['the invitation situation switched off',
    { situations: SITUATIONS.concat([{ id: 'auth_invitation', enabled: 'no' }]) },
    'situation_invitation_off'],
  ['a text that leaves without naming the password, the letter refused',
    { situations: SITUATIONS.map((s) => Object.assign({}, s, s.id === 'user_release_invite'
        ? { sms_text: 'Hi {first_name}, check your e-mail for your login.' } : {})),
      answer: (method) => (method === 'emailSend'
        ? { ok: false, sent: false, error: 'transport', detail: 'the provider would not answer' }
        : { ok: true, sent: true, receipt: 'r1' }) },
    'password_not_named'],
  ['an opt-out on the address and the number', { optedOut: ['rin@asa', '+13305550101'] }, 'opted_out'],
  ['the transport refusing both legs',
    { answer: () => ({ ok: false, sent: false, error: 'transport', detail: 'the provider would not answer' }) },
    'not_delivered'],
  ['every leg gated by the sending switch',
    { answer: () => ({ ok: true, sent: false, gated: true, reason: 'HUB_RPC_SEND is off' }) },
    'send_switch_off'],
  ['a throw inside the invite', { answer: () => { throw new Error('the situations house is unreadable') } },
    'not_delivered']
]) {
  const env = build(Object.assign({ users: [PERSON] }, opts))
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check(`door: ${label} refuses with the password unchanged`,
    out.status === 409 && untouched(env) && out.data.cleared.length === 0,
    JSON.stringify(out) + ' | ' + env.world.users.cells[1].join(' | '))
  check(`door: ${label} is named as ${brake}`, out.data.blocked_by === brake, out.data.blocked_by)
  check(`door: ${label} — the refusal says their own password still works`,
    /Nothing was changed — their own password still works/.test(out.message), out.message)
}
{
  /* the sending switch off: the letter walks past it by name, the text does not */
  const env = build({ users: [PERSON], sendSwitch: 'off' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('door: with the sending switch off the sign-in letter still leaves, and only then is the row rearmed',
    out.status === 200 && out.data.emailed === true && rearmed(env), JSON.stringify(out))
}
{
  const env = build({ users: [PERSON], optedOut: ['rin@asa'] })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('door: an opt-out on the address alone, and the text reaches them, is a release',
    out.status === 200 && out.data.emailed === true && rearmed(env), JSON.stringify(out.data))
}
{
  const env = build({ users: [PERSON], optedOut: ['rin@asa', '+13305550101'] })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', anyway: true, press_id: 'p2' }, MASTER)
  check('door: `anyway` is a second, deliberate answer and it rearms', out.status === 200 && rearmed(env),
    JSON.stringify(out))
  check('door: and the answer says the master chose it and nobody was told',
    out.data.released_anyway === true && out.data.emailed === false &&
    out.data.held === true && out.data.held_reason === 'opted_out', JSON.stringify(out.data))
}

console.log('AN UNREADABLE SWITCH SENDS NOTHING')
{
  const env = build({ users: [PERSON], testMode: 'throw' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('switch: a test-mode read that throws refuses — never read as off',
    out.status === 409 && out.data.blocked_by === 'test_mode_unreadable' && untouched(env), JSON.stringify(out))
  check('switch: and nothing is even asked of the send door', env.world.calls.length === 0, env.world.calls)
  check('switch: the refusal names the switch', /test-mode switch could not be read/.test(out.message), out.message)
}
{
  const env = build({ users: [PERSON], testMode: 'throw' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', anyway: true, press_id: 'p1' }, MASTER)
  check('switch: `anyway` rearms without a word to anybody',
    out.status === 200 && rearmed(env) && env.world.calls.length === 0 && out.data.released_anyway === true,
    JSON.stringify(out))
}

console.log('ONE PRESS, ONE LETTER')
{
  const env = build({ users: [PERSON] })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'press-7' }, MASTER)
  check('answer: a sent invite answers sent', out.status === 200 && out.data.emailed === true, out.data)
  check('answer: the idempotency key names the press',
    env.world.calls.length === 2 && env.world.calls.every((c) => /^release_USR_1_press-7_(email|sms)$/.test(c.key)),
    env.world.calls.map((c) => c.key))
}
{
  /* the one re-send a lost answer allows: the same press, so the door says "already sent" — and that letter
     named the password the FIRST call minted, so this call's new one must not replace it */
  const env = build({ users: [PERSON], answer: () => ({ ok: true, sent: false, deduplicated: true,
    detail: 'This exact request was already made — not sent again.' }) })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'press-7' }, MASTER)
  check('answer: a re-sent press finds its letter already gone and rewrites nothing — the letter named the ' +
        'first call\'s password',
    out.status === 409 && out.data.blocked_by === 'already_sent' && untouched(env) &&
    /This press already went to/.test(out.message) && /Nothing was changed by this repeat/.test(out.message),
    JSON.stringify(out))
  const told = env.commReleaseInviteTell_({ email: 'rin@asa', phone: '+13305550101', name: 'Rin',
    login: 'rin@asa', password: 'Sw0rdf1sh!' }, 'k')
  check('answer: an already-sent letter is not a refusal',
    told.deduplicated === 2 && told.state === 'already' &&
    told.why.every((w) => !/refused/.test(w)), JSON.stringify(told))
}

console.log('THE REARM IS ALL OR NOTHING')
{
  const passCol = USERS_HDR.indexOf('pass_hash') + 1
  const env = build({ users: [PERSON], failUserWrite: (row, col, v) => col === passCol && v !== 'theirownhash' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('rearm: a write that throws answers the failure', out.status === 500 &&
    out.data.outcome === 'rearm_failed', JSON.stringify(out))
  check('rearm: and every cell already written is put back — the salt matches the hash again',
    untouched(env) && out.data.restored === true, env.world.users.cells[1].join(' | '))
  check('rearm: the answer says the letter left and their own password still works',
    /The invite reached/.test(out.message) && /own password still works/.test(out.message), out.message)
}

/* ══ after the rearm nothing may throw ═══════════════════════════════════ */
console.log('A RELEASE ENDS THE SESSIONS IT REARMS')
{
  const env = build({
    users: [PERSON, Object.assign({}, PERSON, { user_id: 'USR_2', email: 'ann@asa' })],
    sessions: [['hashA', 'USR_1', '', '', ''], ['hashB', 'USR_2', '', '', ''],
      ['hashC', 'USR_1', '', '', '']]
  })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  const left = env.world.sessions.cells.slice(1).map((r) => r[0])
  check('sessions: every session of the released person is ended', left.join(',') === 'hashB', left)
  check('sessions: the six-hour profile cache is dropped with them',
    env.world.cacheRemoved.sort().join(',') === 'sess_hashA,sess_hashC', env.world.cacheRemoved)
  check('sessions: the answer counts them for the screen', out.data.sessions_ended === 2, out.data)
  check('sessions: and says the relay may still hold a copy, rather than "signed out everywhere"',
    out.data.cleared.some((c) => /2 open session\(s\) ended at the backend/.test(c) && /relay/.test(c)) &&
    !out.data.cleared.some((c) => /signed out everywhere/.test(c)), out.data.cleared)
}
{
  const env = build({ users: [PERSON], sessionsUnreadable: 'Service Spreadsheets timed out' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('sessions: an unreadable sessions tab is a release, not a 500', out.status === 200 && rearmed(env),
    JSON.stringify(out))
  check('sessions: and it is never "no open session to end"',
    out.data.sessions_ended === null && !out.data.cleared.some((c) => /no open session/.test(c)), out.data)
  check('sessions: the warning says a session may still be live',
    out.data.warnings.some((w) => /could not be read/.test(w) && /may still be live/.test(w)), out.data.warnings)
}
{
  const env = build({ users: [PERSON], sessions: [['hashA', 'USR_1', '', '', '']], sessionsFailDelete: 'quota' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('sessions: a row that cannot be removed is unknown too', out.status === 200 &&
    out.data.sessions_ended === null && out.data.warnings.length === 1, JSON.stringify(out.data))
}
{
  const env = build({ users: [PERSON], prefsUnreadable: 'Service Spreadsheets timed out' })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('after: an unreadable preferences tab after the rearm is a warning, not "the release failed"',
    out.status === 200 && rearmed(env) &&
    out.data.warnings.some((w) => /welcome marks could not be cleared/.test(w)), JSON.stringify(out))
}
{
  const env = build({ users: [PERSON], prefsHeader: ['user_id', 'prefs'],
    prefs: [['USR_1', JSON.stringify({ 'asa-tour-seen': '["USR_1"]' })]] })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('after: a preferences tab with no updated_at column no longer throws at getRange(row, 0)',
    out.status === 200 && out.data.warnings.length === 0 &&
    JSON.parse(env.world.prefs.cells[1][1])['asa-tour-seen'] === '[]', JSON.stringify(out.data))
}

console.log('A MARK IS A LIST OF USER IDS, READ FOR THIS PERSON')
{
  const env = build({})
  const shared = { 'asa-tour-seen': '["USR_9","USR_1"]', 'asa-playground-intro-seen': '["USR_9"]' }
  const mine = env.releaseMarks_(shared, 'USR_1')
  check('marks: a list naming this person reads as seen', mine['asa-tour-seen'] === true)
  check('marks: somebody else on the same browser is not this person',
    mine['asa-playground-intro-seen'] === false, mine)
  check('marks: an unreadable value names nobody',
    env.releaseMarks_({ 'asa-tour-seen': 'mint' }, 'USR_1')['asa-tour-seen'] === false)
}
{
  const env = build({
    users: [PERSON],
    prefs: [['USR_1', JSON.stringify({
      'asa-tour-seen': '["USR_9","USR_1"]',
      'asa-myworld-intro-seen': '["USR_1"]',
      'asa-accent': 'mint'
    }), '']]
  })
  env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  const after = JSON.parse(env.world.prefs.cells[1][1])
  check('marks: the mark is REWRITTEN without this person, never deleted',
    after['asa-tour-seen'] === '["USR_9"]', after)
  check('marks: a key the deletion used to drop is still named, so the blob is the instruction',
    after['asa-myworld-intro-seen'] === '[]', after)
  check('marks: nothing else in the blob is touched', after['asa-accent'] === 'mint', after)
  check('marks: a mark this person never carried is not invented',
    after['asa-playground-intro-seen'] === undefined, after)
  check('marks: the blob carries the release stamp a stale browser stands down to',
    !Number.isNaN(Date.parse(after['asa-released-at'])), after)
}
{
  const env = build({ users: [PERSON], prefs: [['USR_1', '{not json', '']] })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('marks: a blob that does not parse is left exactly as it is, and said',
    out.status === 200 && env.world.prefs.cells[1][1] === '{not json' &&
    out.data.warnings.some((w) => /does not parse/.test(w)), JSON.stringify(out.data))
  const st = env.HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER)
  check('marks: and the card says unknown, not "not seen"', st.data.marks === null && !!st.data.marks_error, st.data)
}

console.log('THE TEMPORARY PASSWORD IS WITHHELD FROM THE COPY WRITTEN DOWN')
{
  const env = build({ users: [PERSON] })
  env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  const pw = env.world.minted[0]
  check('secret: both legs name the press\'s temporary password as the string no record may keep',
    env.world.calls.length === 2 && !!pw &&
    env.world.calls.every((c) => Array.isArray(c.withhold) && c.withhold.join() === pw),
    env.world.calls.map((c) => c.withhold))
  check('secret: the books get the words without the credential',
    env.world.bodiesAsWritten.length === 2 &&
    env.world.bodiesAsWritten.every((b) => /withheld/.test(b) && !b.includes(pw)),
    env.world.bodiesAsWritten)
  /* the announcement carries no credential, so it names nothing to withhold */
  const ann = build({ users: [Object.assign({}, PERSON, { released_at: '2026-08-24T00:00:00Z' })],
    badges: [['cal', 'DIRECTOR', '', '']] })
  ann.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('secret: the app letter names nothing to withhold',
    ann.world.calls.length > 0 && ann.world.calls.every((c) => c.withhold === undefined), ann.world.calls)
}
{
  /* a short first password is still withheld: a floor sized for links let it through */
  const env = build({ users: [PERSON] })
  const short = env.hubWithhold_('password Asa2026 here', ['Asa2026'])
  check('secret: a seven-character password is withheld too',
    /withheld/.test(short) && !short.includes('Asa2026'), short)
  check('secret: nothing is withheld when the call named nothing',
    env.hubWithhold_('use Sw0rdf1sh! to sign in') === 'use Sw0rdf1sh! to sign in')
  check('secret: a string too short to be a secret is never blanked out of every sentence',
    env.hubWithhold_('a b c', ['a']) === 'a b c')
}

console.log('WHICH BRAKE HELD IT — an opt-out is not the mockup')
{
  const env = build({})
  const word = env.commReleaseHeldReason_
  check('brake: the mockup is the mockup', word({ rehearsed: true }) === 'rehearsal')
  check('brake: an opt-out is an opt-out', word({ gated: true, reason: 'opted_out' }) === 'opted_out')
  check('brake: the quiet window is the quiet window',
    word({ gated: true, reason: 'quiet_hours' }) === 'quiet_hours')
  check('brake: the sending switch is the sending switch',
    word({ gated: true, reason: 'HUB_RPC_SEND is off' }) === 'send_switch_off')
  /* the door answers an unreadable list with reason opted_out, and only its sentence differs */
  check('brake: an opt-out list nobody could read is not a person who asked to stop',
    word({ gated: true, reason: 'opted_out', detail: OPT_OUT_UNREAD }) === 'opt_out_unreadable' &&
    word({ gated: true, reason: 'opted_out', detail: 'The opt-out list could not be checked: x' }) ===
      'opt_out_unreadable')
  check('brake: and its kind is unchecked, never declined',
    env.commReleaseHoldKind_({ gated: true, reason: 'opted_out', detail: OPT_OUT_UNREAD }) === 'unchecked' &&
    env.commReleaseHoldKind_({ gated: true, reason: 'opted_out', detail: 'This person asked us to stop.' }) ===
      'declined')
}
console.log('AN UNREADABLE OPT-OUT LIST REFUSES THE RELEASE IN ITS OWN WORDS')
{
  const env = build({ users: [PERSON], optOutUnreadable: true })
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('optout: the release is refused and the row untouched',
    out.status === 409 && untouched(env), JSON.stringify(out))
  check('optout: the refusal names a list nobody could read, never a person who asked to stop',
    out.data.blocked_by === 'opt_out_unreadable' && /could not be read/.test(out.message) &&
    !/asked us to stop/.test(out.message), JSON.stringify(out.data))
}

console.log('A TAB MISSING A COLUMN IS REFUSED BEFORE THE FIRST WRITE')
{
  const env = build({ users: [PERSON] })
  env.world.users.cells[0][USERS_HDR.indexOf('salt')] = 'something_else'
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('columns: the missing column is named', out.status === 500 && /salt/.test(out.message), out)
  check('columns: and nothing on the row was written, nobody was written to',
    ROW(env.world.users, 'pass_hash') === 'theirownhash' && env.world.calls.length === 0,
    env.world.users.cells[1].join(' | '))
}

/* ══ the card, before the press ══════════════════════════════════════════ */
console.log('THE CARD SAYS WHAT THE LETTER WOULD MEET')
{
  const env = build({ users: [Object.assign({}, PERSON, { active: 'false' })] })
  const st = env.HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER)
  check('status: a blocked account is told it will be reactivated, in the list the master reads',
    st.data.will_clear.some((w) => /reactivated/.test(w)), st.data.will_clear)
  check('status: all clear, the letter goes', st.data.sending_holds === false && st.data.test_mode === 'off', st.data)
  const out = env.HUB_ACTIONS.releaseUser({ user_id: 'USR_1', press_id: 'p1' }, MASTER)
  check('status: and the release says the reactivation happened',
    out.data.cleared.some((c) => /reactivated/.test(c)) && ROW(env.world.users, 'active') === 'true', out.data.cleared)
}
{
  const st = build({ users: [PERSON], testMode: 'throw' }).HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER)
  check('status: an unreadable switch is unknown and the letter would not go',
    st.data.test_mode === 'unknown' && st.data.sending_holds === true &&
    st.data.blocked_by === 'test_mode_unreadable', st.data)
}
{
  const st = build({ users: [PERSON], testMode: 'on' }).HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER)
  check('status: test mode on is not a hold for the sign-in letter',
    st.data.test_mode === 'on' && st.data.sending_holds === false, st.data)
}
{
  const off = SITUATIONS.map((s) => Object.assign({}, s, s.id === 'user_release_invite' ? { enabled: 'no' } : {}))
  const st = build({ users: [PERSON], situations: off }).HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER)
  check('status: the invite switched off is said before the press',
    st.data.sending_holds === true && st.data.blocked_by === 'situation_off', st.data)
  const env = build({ users: [PERSON], optOutUnreadable: true })
  const st2 = env.HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER)
  check('status: an unreadable opt-out list stops the letter as the door does, and says it could not be read',
    st2.data.sending_holds === true && st2.data.blocked_by === 'opt_out_unreadable' &&
    /could not be read/.test(st2.data.hold_why.join(' ')), st2.data)
  const env2 = build({ users: [PERSON], optedOut: ['rin@asa'] })
  const st3 = env2.HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER)
  check('status: a person who asked to stop is still named as that',
    st3.data.sending_holds === true && st3.data.blocked_by === 'opted_out', st3.data)
}
{
  const seen = (row) => build({ users: [Object.assign({}, PERSON, row)] })
    .HUB_ACTIONS.releaseUserStatus({ user_id: 'USR_1' }, MASTER).data.signed_in_before
  check('status: an account that has signed in owns its password', seen({}) === true)
  check('status: released and never signed in still has the shared default',
    seen({ last_login: '', must_change: 'true', released_at: '2026-01-01T00:00:00Z' }) === false)
  check('status: a password set with the gate down is theirs', seen({ last_login: '', must_change: 'false' }) === true)
}

/* ══ the announcement ════════════════════════════════════════════════════ */
console.log('THE ANNOUNCEMENT ADDRESSES THE RELEASED ACCOUNTS')
const CROWD = [
  { user_id: 'U1', email: 'a@asa', display_name: 'A', role: 'staff', active: 'true',
    pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-08-24T00:00:00Z' },
  /* born with the default password and never released — a guardian, a client, a new hire */
  { user_id: 'U2', email: 'b@asa', display_name: 'B', role: 'guardian', active: 'true',
    pass_hash: 'h', types: 'DIRECTOR' },
  { user_id: 'U3', email: 'c@asa', display_name: 'C', role: 'staff', active: 'true',
    pass_hash: '', types: 'DIRECTOR' },
  { user_id: 'U4', email: 'd@asa', display_name: 'D', role: 'staff', active: 'true',
    pass_hash: 'h', types: 'NURSE', released_at: '2026-08-24T00:00:00Z' },
  { user_id: 'U5', email: 'e@asa', display_name: 'E', role: 'staff', active: 'false',
    pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-08-24T00:00:00Z' },
  { user_id: 'U6', email: 'f@asa', display_name: 'F', role: 'staff', active: 'true',
    pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-09-01T00:00:00Z' }
]
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']] })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('audience: only a released badge holder hears it',
    out.data.sent === 2 && out.data.eligible === 2 &&
    env.world.calls.every((c) => ['a@asa', 'f@asa'].includes(c.to)), JSON.stringify(out.data))
  check('audience: an account born with the default password and never released is counted, not written to',
    out.data.matched === 4 && out.data.not_released === 2, out.data)
}
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    log: [['arl_1', '', 'cal', 'Calendar', 'U1', 'a@asa', 'auto', 'true']] })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('once: the button skips everybody a letter already reached',
    out.data.already_told === 1 && out.data.sent === 1 && env.world.calls.every((c) => c.to === 'f@asa'),
    JSON.stringify(out.data))
  const again = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    log: [['arl_1', '', 'cal', 'Calendar', 'U1', 'a@asa', 'auto', 'true']] })
  const out2 = again.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar', again: true }, MASTER)
  check('once: only an explicit `again` re-sends to them', out2.data.sent === 2 && out2.data.already_told === 0,
    JSON.stringify(out2.data))
}
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], logUnreadable: 'timed out' })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('once: an unreadable app_release_log refuses the button — never read as "nobody told"',
    out.status === 409 && env.world.calls.length === 0 && /could not be read/.test(out.message), JSON.stringify(out))
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('once: and the automatic pass writes to nobody, and says why',
    env.world.calls.length === 0 &&
    env.world.logs.some((l) => l.type === 'app_release_announce' && l.status === 503), env.world.logs)
}
{
  const env = build({
    users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], testMode: 'on'
  })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('counting: a held letter is held and NOT also refused',
    out.data.held === 2 && out.data.failed === 0 && out.data.sent === 0, out.data)
  check('counting: the app letter is a notification — it claims no authentication kind',
    env.world.calls.every((c) => c.auth === undefined), env.world.calls)
  check('counting: a rehearsal does not burn the once-per-app stamp',
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, env.world.props)
}
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: () => ({ ok: true, sent: false, deduplicated: true, detail: 'already made' }) })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('counting: an already-sent letter is counted as already sent, never as refused',
    out.data.already_sent === 2 && out.data.failed === 0, out.data)
}
{
  /* the letter leaves, the text is held by an opt-out on the number */
  const env = build({ users: [Object.assign({}, CROWD[0], { phone: '+13305550199' })],
    badges: [['cal', 'DIRECTOR', '', '']], optedOut: ['+13305550199'] })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('counting: one answer per person — a letter that left with its text held is sent, not also held',
    out.data.sent === 1 && out.data.held === 0, out.data)
}
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: (m) => (m === 'emailSend' ? { ok: false, sent: false, error: 'transport' }
      : { ok: false, sent: false, error: 'transport' }) })
  env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('counting: a run with refusals does not stamp the app as announced',
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, env.world.props)
}

console.log('THE QUIET WINDOW IS NOT NOW, NEVER NO — AND THE STAMP NEVER REFUSES A PRESS')
{
  const quiet = () => ({ ok: true, sent: false, gated: true, quiet: true, reason: 'quiet_hours' })
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], answer: quiet })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('quiet: a letter the quiet window held is counted under that brake, not as test mode',
    out.data.held_quiet === 2 && out.data.held === 0 && out.data.held_by && !out.data.held_by.rehearsal,
    JSON.stringify(out.data))
  check('quiet: the app is kept on the morning list once, never once per person',
    out.data.quiet_owed === true && env.world.owed.length === 1 && env.world.owed[0].lane === 'app_release' &&
    env.world.owed[0].key === 'cal', JSON.stringify(env.world.owed))
  check('quiet: the log row says held_quiet, never rehearsal',
    env.world.relLog.cells.slice(1).every((r) => r[6] === 'held_quiet' && r[7] === 'false'),
    JSON.stringify(env.world.relLog.cells))
}
{
  /* a switch that held it is named by its own brake */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], testMode: 'on' })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('held by: each letter a switch held is counted under the switch that held it',
    out.data.held === 2 && out.data.held_by.rehearsal === 2 &&
    env.world.relLog.cells.slice(1).every((r) => r[6] === 'rehearsal'), JSON.stringify(out.data))
  const off = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], sendSwitch: 'off' })
  const out2 = off.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('held by: the sending switch is not test mode, in the answer or in the log',
    out2.data.held === 2 && out2.data.held_by.send_switch_off === 2 && !out2.data.held_by.rehearsal &&
    off.world.relLog.cells.slice(1).every((r) => r[6] === 'held_send_switch_off'), JSON.stringify(out2.data))
}
{
  /* nobody released: nothing addressed, nothing stamped */
  const nobody = CROWD.map((u) => Object.assign({}, u, { released_at: '' }))
  const env = build({ users: nobody, badges: [['cal', 'DIRECTOR', '', '']] })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('stamp: a press that addressed nobody does not stamp the app as announced',
    out.status === 200 && out.data.eligible === 0 && env.world.props.APP_RELEASE_ANNOUNCED === undefined,
    JSON.stringify([out.data, env.world.props]))
}
{
  /* stamped already, one person released since: the press writes to them alone */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    props: { APP_RELEASE_ANNOUNCED: JSON.stringify({ cal: '2026-09-01T00:00:00Z' }) },
    log: [['arl_1', '', 'cal', 'Calendar', 'U1', 'a@asa', 'manual', 'true']] })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('stamp: a stamped app still writes to a released badge holder the log does not name — no 409',
    out.status === 200 && out.data.sent === 1 && out.data.already_told === 1 &&
    env.world.calls.every((c) => c.to === 'f@asa') && out.data.announced_before === '2026-09-01T00:00:00Z',
    JSON.stringify(out))
}

console.log('THE AUTOMATIC PASS — released only, once per person, a budget')
{
  const env = build({ users: CROWD, testMode: 'on' })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  const line = env.world.logs.find((l) => l.type === 'app_release_announce')
  check('auto: a held letter is not logged as a refusal', line && line.status === 200 &&
    /0 letter\(s\), 2 held/.test(line.text), line)
  check('auto: and the stamp is not written for a pass that told nobody',
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, env.world.props)
}
{
  const env = build({ users: CROWD })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('auto: it writes only to the released badge holders',
    env.world.calls.length === 2 && env.world.calls.every((c) => ['a@asa', 'f@asa'].includes(c.to)),
    env.world.calls.map((c) => c.to))
  check('auto: a real pass writes the once-per-app stamp the button reads',
    /"cal"/.test(String(env.world.props.APP_RELEASE_ANNOUNCED || '')), env.world.props)
  const again = build({ users: CROWD, log: env.world.relLog.cells.slice(1).map((r) => r.slice()) })
  again.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('once: nobody hears the same app announcement a second time', again.world.calls.length === 0,
    again.world.calls)
}
{
  const many = []
  for (let i = 0; i < 120; i++) {
    many.push({ user_id: 'U' + i, email: `u${i}@asa`, display_name: 'U', role: 'staff',
      active: 'true', pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-09-01T00:00:00Z' })
  }
  const env = build({ users: many, badges: [['cal', 'DIRECTOR', '', '']] })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  const line = env.world.logs.find((l) => l.type === 'app_release_announce')
  check('budget: the pass riding the badge save stops instead of taking it down',
    env.world.calls.length === 40, env.world.calls.length)
  check('budget: and says how many were not written to, and how to finish — not "still owed"',
    line && line.status === 206 && /80 not written to/.test(line.text) && /press Announce/.test(line.text) &&
    !/owed/.test(line.text), line)
  check('budget: an unfinished pass does not claim the app has announced itself',
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, env.world.props)
  env.world.calls.length = 0
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('budget: the button finishes exactly the rest, writing nobody twice',
    out.data.sent === 80 && out.data.already_told === 40 && env.world.calls.length === 80, JSON.stringify(out.data))
}

/* ══ the announcement: each hold its own number ═════════════════════════ */
const APP_OFF = () => SITUATIONS.map((s) => Object.assign({}, s,
  s.id === 'app_release_announced' ? { enabled: 'no' } : {}))
console.log('A SWITCHED-OFF SITUATION IS ONE ANSWER, NOT ONE REFUSAL PER PERSON')
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], situations: APP_OFF() })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('off: the run answers 409 with the sentence, before anybody is written to',
    out.status === 409 && /switched off/.test(out.message) && /nobody was written to/.test(out.message),
    JSON.stringify(out))
  check('off: no letter, no per-person log row',
    env.world.calls.length === 0 && env.world.relLog.cells.length === 1,
    { calls: env.world.calls.length, rows: env.world.relLog.cells.length - 1 })
  check('off: nothing is counted as refused by the transport',
    !env.world.logs.some((l) => /refused/.test(l.text)), env.world.logs.map((l) => l.text))
}
{
  const env = build({ users: CROWD, situations: APP_OFF() })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  const line = env.world.logs.find((l) => l.type === 'app_release_announce')
  check('off: the automatic pass writes nobody and logs one line at 200, not 502',
    env.world.calls.length === 0 && line && line.status === 200 && /switched off/.test(line.text), line)
}

console.log('AN OPT-OUT IS NOT A HOLD, AND DOES NOT KEEP THE APP OPEN FOREVER')
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], optedOut: ['f@asa'] })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('declined: the opt-out is its own number — not held, not refused',
    out.data.sent === 1 && out.data.declined === 1 && out.data.held === 0 && out.data.failed === 0,
    JSON.stringify(out.data))
  check('declined: the log row says declined, not rehearsal',
    env.world.relLog.cells.slice(1).some((r) => r[4] === 'U6' && r[6] === 'declined'),
    env.world.relLog.cells.slice(1))
  check('declined: a person\'s own stop does not keep the stamp from being written',
    /"cal"/.test(String(env.world.props.APP_RELEASE_ANNOUNCED || '')), env.world.props)
}
{
  /* the door's ordinary answer for a list it could not read: optOutIndex_'s own sentence */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: (m, p) => (p.to === 'f@asa'
      ? { ok: true, sent: false, gated: true, reason: 'opted_out', detail: OPT_OUT_UNREAD }
      : { ok: true, sent: true, receipt: 'r' }) })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('unchecked: an unreadable opt-out list is not "they opted out"',
    out.data.unchecked === 1 && out.data.declined === 0, JSON.stringify(out.data))
  check('unchecked: its log row says unchecked, never declined',
    env.world.relLog.cells.slice(1).some((r) => r[4] === 'U6' && r[6] === 'unchecked' && r[7] === 'false'),
    env.world.relLog.cells.slice(1))
  check('unchecked: and the app is not marked announced — that person is still owed',
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, env.world.props)
}
{
  /* the whole list unreadable on the last page of a run whose earlier pages told people */
  const env = build({ users: [CROWD[0]], badges: [['cal', 'DIRECTOR', '', '']], optOutUnreadable: true })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar', resume: 1, told_before: 2 }, MASTER)
  check('unchecked: a list nobody could read keeps the stamp unwritten even after earlier pages told people',
    out.data.unchecked === 1 && out.data.declined === 0 &&
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, JSON.stringify(out.data))
  check('unchecked: and the log line says the list was unreadable, not that anybody opted out',
    env.world.logs.some((l) => l.type === 'app_release_announce' && /opt-out list unreadable/.test(l.text) &&
      !/declined/.test(l.text)), env.world.logs.map((l) => l.text))
}
{
  /* a badge save that meets a list it cannot read writes nobody and keeps the app for the next pass */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], optOutUnreadable: true })
  const sum = env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('unchecked: the automatic pass asks the list once, writes nobody, and keeps the app instead of dropping it',
    sum.cal.deferred === true && sum.cal.kept_for_later === true && /opt-out list could not be read/.test(sum.cal.why) &&
    env.world.calls.length === 0 && env.world.relLog.cells.length === 1 && env.world.owed.length === 1 &&
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, JSON.stringify(sum))
  const line = env.world.logs.find((l) => l.type === 'app_release_announce')
  check('unchecked: its one log line names the list, not an opt-out, and says it was kept',
    line && line.status === 503 && /opt-out list could not be read/.test(line.text) &&
    /kept for the next pass/.test(line.text) && !/declined/.test(line.text), line)
  const again = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('unchecked: a morning pass while the list stays unreadable writes nobody again, and keeps it as a read that did not land',
    env.world.calls.length === 0 && env.world.relLog.cells.length === 1 && env.world.owed.length === 1 &&
    again.kept === 1 && again.carried === 0 && again.why.some((w) => /opt-out list could not be read/.test(w)),
    JSON.stringify(again))
  env.world.optOutUnreadable = false
  const said = env.appReleaseQuietCarry_(owedData(env))
  check('unchecked: and the next pass, with the list readable, tells them',
    said.state === 'carried' && env.world.calls.filter((c) => c.method === 'emailSend').length === 2,
    JSON.stringify(said))
}

console.log('THE QUIET WINDOW HOLDS IT UNTIL THE MORNING — AND THE MORNING COMES')
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], quiet: true })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar', objective: 'o' }, MASTER)
  check('night: the button answers that it is owed for the morning, and nobody is written to',
    out.status === 200 && out.data.quiet_owed === true && env.world.calls.length === 0, JSON.stringify(out))
  check('night: one entry for the app on the morning list, carrying its badges and words',
    env.world.owed.length === 1 && env.world.owed[0].lane === 'app_release' &&
    env.world.owed[0].key === 'cal' && env.world.owed[0].data.badges.join() === 'DIRECTOR' &&
    env.world.owed[0].data.tagline === 'o' && env.world.owed[0].data.whole === true &&
    !!env.world.owed[0].data.since, env.world.owed)
  const again = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar', again: true }, MASTER)
  check('night: a second sending to everybody cannot wait for the morning, so it is refused',
    again.status === 409 && /after 08:00/.test(again.message), JSON.stringify(again))
  /* the morning: the same books, the window closed */
  env.world.quiet = false
  const carried = env.appReleaseQuietCarry_(owedData(env))
  check('morning: the carry tells whoever the badges still open it to',
    carried.state === 'carried' && env.world.calls.length === 2, JSON.stringify(carried))
  /* the button's debt is the whole matrix as it stands in the morning */
  env.world.badges.cells[1][1] = 'NURSE'
  const moved = env.appReleaseQuietCarry_(owedData(env))
  check('morning: the button\'s debt reaches whoever the matrix opens the app to by then',
    moved.state === 'carried' && env.world.calls.length === 3 && env.world.calls[2].to === 'd@asa',
    JSON.stringify(moved))
  env.world.badges.cells[1][1] = ''
  const gone = env.appReleaseQuietCarry_(owedData(env))
  check('morning: an app that no longer opens to anybody is let go, not said',
    gone.state === 'stale' && env.world.calls.length === 3, JSON.stringify(gone))
}
{
  /* a badge save's debt is its own badges: one taken off the matrix is let go */
  const env = build({ users: CROWD, badges: [['cal', 'NURSE', '', '']] })
  const gone = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar',
    since: new Date().toISOString() })
  check('morning: a badge save\'s debt to badges no longer on the matrix is let go, not said',
    gone.state === 'stale' && env.world.calls.length === 0, JSON.stringify(gone))
  const old = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['NURSE'], name: 'Calendar',
    since: new Date(Date.now() - 40 * 3600 * 1000).toISOString() })
  check('morning: a debt owed more than a day and a half ago is let go, however often it was kept',
    old.state === 'stale' && /day and a half/.test(old.why) && env.world.calls.length === 0, JSON.stringify(old))
}

console.log('ONE ENTRY PER APP HOLDS EVERY DEBT OF THE NIGHT')
{
  /* a badge save at night owes its one badge; the button later that night owes everybody */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR, NURSE', '', '']], quiet: true })
  env.appReleaseAutoAnnounce_({ cal: ['NURSE'] }, { cal: { name: 'Calendar' } })
  check('fold: the badge save owes its own badge',
    env.world.owed.length === 1 && env.world.owed[0].data.badges.join() === 'NURSE' &&
    env.world.owed[0].data.whole === false, env.world.owed)
  const firstSince = env.world.owed[0].data.since
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('fold: the button\'s owe is folded into the same entry, never dropped as "already there"',
    out.data.quiet_owed === true && env.world.owed.length === 1 && env.world.owed[0].data.whole === true &&
    env.world.owed[0].data.badges.slice().sort().join() === 'DIRECTOR,NURSE' &&
    env.world.owed[0].data.since === firstSince, env.world.owed)
  env.world.quiet = false
  env.appReleaseQuietCarry_(owedData(env))
  check('fold: the morning tells everybody the button promised, not only the badge save\'s holders',
    env.world.calls.map((c) => c.to).sort().join() === 'a@asa,d@asa,f@asa', env.world.calls.map((c) => c.to))
}

console.log('THE MORNING CARRY KEEPS A DEBT ONLY WHILE IT MOVES — A SWITCH NEVER LOOPS IT')
{
  /* more released holders than one pass may write to, and a switch that holds every letter */
  const crowd45 = []
  for (let i = 1; i <= 45; i++) {
    crowd45.push({ user_id: 'P' + i, email: `p${i}@asa`, display_name: 'P' + i, role: 'staff',
      active: 'true', pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-09-01T00:00:00Z' })
  }
  const env = build({ users: crowd45, badges: [['cal', 'DIRECTOR', '', '']], testMode: 'on', quiet: true })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('loop: the night owes the app to the morning list, and writes nobody',
    env.world.owed.length === 1 && env.world.calls.length === 0, env.world.owed)
  env.world.quiet = false
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  const rowsAfterFirst = env.world.relLog.cells.length
  check('loop: the first morning pass writes its budget, every letter held by the switch',
    env.world.calls.length === 40 && rowsAfterFirst - 1 === 40 &&
    env.world.relLog.cells.slice(1).every((r) => r[6] === 'rehearsal' && r[7] === 'false'),
    { calls: env.world.calls.length, rows: rowsAfterFirst - 1 })
  check('loop: a pass that told nobody lets the debt go and says the switch held it — no entry is left',
    env.world.owed.length === 0 && first.stale === 1 && first.carried === 0 &&
    first.why.some((w) => /held by a switch — press Announce once it is off/.test(w)),
    JSON.stringify([first, env.world.owed]))
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('loop: the second pass writes nothing and leaves no entry',
    env.world.calls.length === 40 && env.world.relLog.cells.length === rowsAfterFirst &&
    env.world.owed.length === 0 && second.carried === 0 && second.stale === 0,
    JSON.stringify({ second, calls: env.world.calls.length, rows: env.world.relLog.cells.length - 1 }))
}
{
  /* the same crowd with nothing holding: each pass moves, so the debt is kept until everybody is told */
  const crowd45 = []
  for (let i = 1; i <= 45; i++) {
    crowd45.push({ user_id: 'P' + i, email: `p${i}@asa`, display_name: 'P' + i, role: 'staff',
      active: 'true', pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-09-01T00:00:00Z' })
  }
  const env = build({ users: crowd45, badges: [['cal', 'DIRECTOR', '', '']], quiet: true })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  env.world.quiet = false
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('progress: a pass that told people and ran out of budget keeps the rest for the next pass',
    env.world.calls.length === 40 && env.world.owed.length === 1 && first.carried === 1,
    JSON.stringify({ first, calls: env.world.calls.length }))
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  const told = new Set(env.world.calls.map((c) => c.to))
  check('progress: the next pass starts past them, tells the other five, and leaves no entry',
    env.world.calls.length === 45 && told.size === 45 && env.world.owed.length === 0 && second.carried === 1,
    JSON.stringify({ second, calls: env.world.calls.length }))
}
{
  /* every letter refused by the transport: no progress, so the debt goes with the press that finishes it */
  const crowd45 = []
  for (let i = 1; i <= 45; i++) {
    crowd45.push({ user_id: 'P' + i, email: `p${i}@asa`, display_name: 'P' + i, role: 'staff',
      active: 'true', pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-09-01T00:00:00Z' })
  }
  const env = build({ users: crowd45, badges: [['cal', 'DIRECTOR', '', '']],
    answer: () => ({ ok: false, sent: false, error: 'transport', detail: 'the provider would not answer' }) })
  const out = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar',
    since: new Date().toISOString() })
  check('refused: a pass the transport refused throughout is let go with the way to finish, not kept to repeat',
    out.state === 'stale' && /40 refused/.test(out.why) && /press Announce on Release Users to finish/.test(out.why) &&
    env.world.owed.length === 0, JSON.stringify(out))
}
/* forty-five released DIRECTOR holders, p1..p45 */
const crowdOf = (n) => Array.from({ length: n }, (_x, i) => ({
  user_id: 'P' + (i + 1), email: `p${i + 1}@asa`, display_name: 'P' + (i + 1), role: 'staff',
  active: 'true', pass_hash: 'h', types: 'DIRECTOR', released_at: '2026-09-01T00:00:00Z'
}))
const CHECK_FAILED = { ok: true, sent: false, gated: true, reason: 'opted_out',
  detail: 'The opt-out list could not be checked: Service Spreadsheets timed out' }
{
  /* the list reads before the pass, and the door's own check fails for every letter */
  const env = build({ users: crowdOf(45), badges: [['cal', 'DIRECTOR', '', '']], testMode: 'on',
    answer: () => CHECK_FAILED })
  const day = env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('unchecked door: a badge save the door could not check still owes the app to the next pass',
    env.world.calls.length === 40 && day.cal.unchecked === 40 && day.cal.kept_for_later === true &&
    env.world.owed.length === 1, JSON.stringify(day))
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  const rows = env.world.relLog.cells.length
  check('unchecked door: the carry\'s pass that told nobody lets the debt go and names the list',
    env.world.calls.length === 80 && env.world.owed.length === 0 && first.stale === 1 && first.carried === 0 &&
    first.why.some((w) => /opt-out list could not be read/.test(w) && /press Announce on Release Users to finish/.test(w)),
    JSON.stringify([first, env.world.owed]))
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('unchecked door: the next pass writes nothing and leaves no entry',
    env.world.calls.length === 80 && env.world.relLog.cells.length === rows && env.world.owed.length === 0 &&
    second.carried === 0 && second.stale === 0 && second.kept === 0,
    JSON.stringify({ second, calls: env.world.calls.length }))
}
{
  /* the door's check fails part-way through a pass that has already told most */
  let asked = 0
  const env = build({ users: crowdOf(45), badges: [['cal', 'DIRECTOR', '', '']],
    answer: () => (++asked <= 30 ? { ok: true, sent: true, receipt: 'r' } : CHECK_FAILED) })
  env.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('unchecked door: a pass that told most before the check failed keeps the rest',
    env.world.calls.length === 40 && env.world.owed.length === 1 && first.carried === 1,
    JSON.stringify({ first, calls: env.world.calls.length }))
  env.world.answer = null
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('unchecked door: and the next pass tells the ten it could not check and the five it did not reach',
    env.world.calls.length === 55 && new Set(env.world.calls.map((c) => c.to)).size === 45 &&
    env.world.owed.length === 0 && second.carried === 1, JSON.stringify({ second, calls: env.world.calls.length }))
}
{
  /* the transport refuses thirty-nine of the first forty every time */
  const refused = new Set(Array.from({ length: 39 }, (_x, i) => `p${i + 2}@asa`))
  const env = build({ users: crowdOf(45), badges: [['cal', 'DIRECTOR', '', '']],
    answer: (m, p) => (refused.has(p.to)
      ? { ok: false, sent: false, error: 'transport', detail: 'the provider would not answer' }
      : { ok: true, sent: true, receipt: 'r' }) })
  env.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('refusals: one told and thirty-nine refused is not a pass that moves — the debt goes with the way to finish',
    env.world.calls.length === 40 && env.world.owed.length === 0 && first.stale === 1 &&
    first.why.some((w) => /1 told/.test(w) && /39 refused/.test(w) && /press Announce on Release Users to finish/.test(w)),
    JSON.stringify(first))
  env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('refusals: the same thirty-nine are not written to again on the next pass',
    env.world.calls.length === 40, env.world.calls.length)
}
{
  /* the window begins during the carry's pass: the pass owes the app to the next morning itself */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: (m, p) => (p.to === 'f@asa'
      ? { ok: true, sent: false, gated: true, quiet: true, redirected: false, reason: 'quiet_hours' }
      : { ok: true, sent: true, receipt: 'r' }) })
  const some = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar',
    since: new Date().toISOString() })
  check('window: a pass that told some before the window held the rest is carried and owed again',
    some.state === 'carried' && /owed to the morning list again/.test(some.why) && env.world.owed.length === 1,
    JSON.stringify(some))
  const none = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: () => ({ ok: true, sent: false, gated: true, quiet: true, redirected: false, reason: 'quiet_hours' }) })
  const held = none.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar',
    since: new Date().toISOString() })
  check('window: one the window held throughout told nobody — kept, never counted as said',
    held.state === 'kept' && none.world.owed.length === 1, JSON.stringify(held))
  /* the same hold through the morning list: its line is not a read that failed */
  const list = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: () => ({ ok: true, sent: false, gated: true, quiet: true, redirected: false, reason: 'quiet_hours' }) })
  list.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const out = list.hubQuietOwedCarry_({ app_release: list.appReleaseQuietCarry_ })
  const line = list.world.logs.filter((l) => l.type === 'quiet_owed_carried').pop()
  check('window: the morning list counts a quiet-window hold as kept, and never words it as a read that failed',
    out.kept === 1 && line && /1 kept for the next pass/.test(line.text) &&
    /held by the quiet window/.test(line.text) && !/could not be read/.test(line.text),
    JSON.stringify([out, line && line.text]))
}

console.log('A TOLD-LOG THAT DOES NOT LAND IS NO PROGRESS — THE CARRY LETS GO INSTEAD OF WRITING THE SAME PEOPLE')
{
  /* forty-five released holders, nothing holding, and every write to the told-log throws */
  const env = build({ users: crowdOf(45), badges: [['cal', 'DIRECTOR', '', '']],
    logWriteFails: 'the workbook is at its cell limit' })
  env.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('log lost: the pass reaches its budget, and with none of it recorded the debt goes with the way to finish',
    env.world.calls.length === 40 && env.world.relLog.cells.length === 1 && env.world.owed.length === 0 &&
    first.stale === 1 && first.carried === 0 &&
    first.why.some((w) => /40 told/.test(w) && /the told-log could not be written/.test(w) &&
      /press Announce on Release Users once it writes/.test(w)),
    JSON.stringify({ first, calls: env.world.calls.length, owed: env.world.owed }))
  const lost = env.world.logs.find((l) => l.type === 'app_release_log_unwritten')
  check('log lost: the write that did not land is logged, never swallowed',
    lost && lost.status === 500 && /40 row\(s\) of app_release_log could NOT be written/.test(lost.text) &&
    /cell limit/.test(lost.text), lost)
  const auto = env.world.logs.filter((l) => l.type === 'app_release_announce').pop()
  check('log lost: the pass\'s own line says the told-log could not be written',
    auto && auto.status === 500 && /the told-log could NOT be written/.test(auto.text), auto)
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('log lost: the next pass writes to nobody — p1..p40 are not written to a second time',
    env.world.calls.length === 40 && env.world.owed.length === 0 &&
    second.carried === 0 && second.stale === 0 && second.kept === 0,
    JSON.stringify({ second, calls: env.world.calls.length }))
}
{
  /* the window begins during a carry whose told-log does not land: nothing is re-owed to repeat */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], logWriteFails: 'timed out',
    answer: (m, p) => (p.to === 'f@asa'
      ? { ok: true, sent: false, gated: true, quiet: true, redirected: false, reason: 'quiet_hours' }
      : { ok: true, sent: true, receipt: 'r' }) })
  const out = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar',
    since: new Date().toISOString() })
  check('log lost: a carry the window interrupted is let go, not owed to write the same people again',
    out.state === 'stale' && env.world.owed.length === 0 && /the told-log could not be written/.test(out.why) &&
    /press Announce on Release Users once it writes/.test(out.why) &&
    !/morning list could not keep them/.test(out.why), JSON.stringify(out))
}
{
  /* the badge save's own pass and the button, with the told-log refusing its write */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], logWriteFails: 'timed out' })
  const sum = env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('log lost: the automatic pass answers that its rows did not land',
    sum.cal.sent === 2 && sum.cal.log_written === false, JSON.stringify(sum))
  const press = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('log lost: so does the button, for the screen to say',
    press.status === 200 && press.data.log_written === false, JSON.stringify(press.data))
  env.world.logBook.failValues = ''
  const ok = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('log lost: once it writes, the answer says so',
    ok.status === 200 && ok.data.log_written === true && env.world.relLog.cells.length > 1, JSON.stringify(ok.data))
}

console.log('A PERSON\'S OWN STOP SETTLES THEM FOR THE DEBT — THE CARRY DOES NOT SPEND ITS LETTERS ON THEM AGAIN')
{
  /* a hundred released holders, the first twenty-five opted out */
  const env = build({ users: crowdOf(100), badges: [['cal', 'DIRECTOR', '', '']],
    optedOut: Array.from({ length: 25 }, (_x, i) => `p${i + 1}@asa`) })
  env.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('declined: the first pass meets the twenty-five stops and tells fifteen, and keeps the rest',
    env.world.calls.length === 40 && env.world.owed.length === 1 && first.carried === 1,
    JSON.stringify({ first, calls: env.world.calls.length }))
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  const secondCalls = env.world.calls.slice(40)
  check('declined: the next pass does not ask the twenty-five again, and spends its letters on forty new people',
    secondCalls.length === 40 && secondCalls.every((c) => Number(String(c.to).replace(/\D/g, '')) > 40) &&
    env.world.owed.length === 1 && second.carried === 1,
    JSON.stringify({ second, calls: secondCalls.map((c) => c.to) }))
  const auto = env.world.logs.filter((l) => l.type === 'app_release_announce').pop()
  check('declined: its line counts them as not asked again, never as refused',
    auto && /25 not asked again \(opted out since it was owed\)/.test(auto.text) && !/refused/.test(auto.text), auto)
  const third = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  const reached = new Set(env.world.calls.map((c) => c.to))
  check('declined: the third pass tells the last twenty — seventy-five told, each stop asked once, no entry left',
    env.world.calls.length === 100 && reached.size === 100 && env.world.owed.length === 0 && third.carried === 1,
    JSON.stringify({ third, calls: env.world.calls.length }))
  const press = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('declined: the button still asks whoever declined — a stop lifted since is reached by a press',
    press.status === 200 && press.data.declined === 25 && press.data.already_told === 75 &&
    env.world.calls.length === 125, JSON.stringify(press.data))
}
{
  /* the first forty opted out: a pass that told nobody still settled forty, so it is kept */
  const env = build({ users: crowdOf(50), badges: [['cal', 'DIRECTOR', '', '']],
    optedOut: Array.from({ length: 40 }, (_x, i) => `p${i + 1}@asa`) })
  env.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('declined: forty stops and nobody told is kept, never counted as said',
    env.world.calls.length === 40 && env.world.owed.length === 1 && first.kept === 1 && first.carried === 0,
    JSON.stringify(first))
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('declined: and the next pass tells the ten after them',
    env.world.calls.length === 50 && env.world.owed.length === 0 && second.carried === 1,
    JSON.stringify({ second, calls: env.world.calls.length }))
}
{
  /* a stop older than the debt is not this debt's: the person is asked again */
  const env = build({ users: crowdOf(2), badges: [['cal', 'DIRECTOR', '', '']],
    log: [['arl_old', '2026-01-01T00:00:00.000Z', 'cal', 'Calendar', 'P1', 'p1@asa', 'declined', 'false']] })
  const out = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar',
    since: new Date().toISOString() })
  check('declined: a stop recorded before the debt was owed does not settle the person for it',
    out.state === 'carried' && env.world.calls.map((c) => c.to).sort().join() === 'p1@asa,p2@asa',
    JSON.stringify({ out, calls: env.world.calls.map((c) => c.to) }))
  /* a badge save carries no debt: its own pass asks everybody not yet told, a recent stop included */
  const day = build({ users: crowdOf(2), badges: [['cal', 'DIRECTOR', '', '']],
    log: [['arl_now', new Date().toISOString(), 'cal', 'Calendar', 'P1', 'p1@asa', 'declined', 'false']] })
  const sum = day.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('declined: nor does a badge save\'s own pass skip anybody by it',
    sum.cal.declined_before === 0 && day.world.calls.map((c) => c.to).sort().join() === 'p1@asa,p2@asa',
    JSON.stringify(sum))
}

console.log('A READ THE MORNING CARRY COULD NOT MAKE IS KEPT, AND THE LOG SAYS WHICH')
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    badgesUnreadable: 'Service Spreadsheets timed out' })
  env.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const first = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  const line = env.world.logs.filter((l) => l.type === 'quiet_owed_carried').pop()
  check('matrix: an access matrix that cannot be read writes nobody and keeps the debt as kept, not carried',
    env.world.calls.length === 0 && env.world.owed.length === 1 && first.kept === 1 && first.carried === 0,
    JSON.stringify(first))
  check('matrix: the morning list\'s line names the read, and never counts the entry as said this morning',
    line && /^0 page\(s\)/.test(line.text) && /1 kept for the next pass/.test(line.text) &&
    /access matrix could not be read \(Service Spreadsheets timed out\)/.test(line.text), line && line.text)
  env.world.badgeRead.unreadable = ''
  const second = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  check('matrix: once it reads, the next pass tells them and the entry is gone',
    env.world.calls.length === 2 && env.world.owed.length === 0 && second.carried === 1, JSON.stringify(second))
}
{
  /* the test-mode switch unreadable at the morning pass: the pass's own 503 and the list's line agree */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], testMode: 'throw' })
  env.appReleaseOweMorning_('cal', ['DIRECTOR'], 'Calendar', '', false)
  const out = env.hubQuietOwedCarry_({ app_release: env.appReleaseQuietCarry_ })
  const line = env.world.logs.filter((l) => l.type === 'quiet_owed_carried').pop()
  check('switch: the morning list keeps it as a read that did not land and says the switch',
    env.world.calls.length === 0 && env.world.owed.length === 1 && out.kept === 1 && out.carried === 0 &&
    line && /^0 page\(s\)/.test(line.text) && /test-mode switch could not be read/.test(line.text),
    JSON.stringify([out, line && line.text]))
}

console.log('A READ THAT DID NOT LAND IS NOT "OFF" — THE ANNOUNCEMENT WAITS FOR IT')
{
  /* the book unreadable during the day: the badge save owes it instead of dropping it */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], situationsThrow: true })
  const sum = env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('unread book: the automatic pass writes nobody and owes the app',
    env.world.calls.length === 0 && sum.cal.deferred === true && sum.cal.kept_for_later === true &&
    !sum.cal.silenced && env.world.owed.length === 1, JSON.stringify(sum))
  const line = env.world.logs.find((l) => l.type === 'app_release_announce')
  check('unread book: its one log line says the book could not be read, and that it was kept',
    line && line.status === 503 && /could not be read/.test(line.text) && /kept for the next pass/.test(line.text) &&
    !/switched off/.test(line.text), line)
  /* the next pass: still unreadable, it is kept again; readable, it is said */
  const kept = env.appReleaseQuietCarry_(owedData(env))
  check('unread book: the carry keeps it while the book stays unreadable',
    kept.state === 'kept' && /kept for the next pass/.test(kept.why) && env.world.calls.length === 0,
    JSON.stringify(kept))
  env.world.situationsThrow = false
  const said = env.appReleaseQuietCarry_(owedData(env))
  check('unread book: and says it once the book reads',
    said.state === 'carried' && env.world.calls.length === 2, JSON.stringify(said))
}
{
  /* at 08:00 the book fails: the night's announcement is kept, never let go */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], situationsThrow: true })
  const out = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], whole: true, name: 'Calendar',
    since: new Date().toISOString() })
  check('unread book: a morning read that fails keeps the night\'s announcement',
    out.state === 'kept' && env.world.owed.length === 1 && env.world.calls.length === 0, JSON.stringify(out))
}
{
  /* a badge save at night while the book is unreadable still owes the morning */
  const env = build({ users: CROWD, quiet: true, situationsThrow: true })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('unread book: at night it is owed to the morning like any other',
    env.world.owed.length === 1 && env.world.calls.length === 0, env.world.owed)
  const btn = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], quiet: true, situationsThrow: true })
  const night = btn.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('unread book: so is the button pressed at night',
    night.status === 200 && night.data.quiet_owed === true && btn.world.owed.length === 1, JSON.stringify(night))
  const day = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], situationsThrow: true })
  const press = day.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('unread book: by day the button refuses and says the book could not be read',
    press.status === 409 && /could not be read/.test(press.message) && day.world.calls.length === 0 &&
    press.data.blocked_by === 'situation_unreadable', JSON.stringify(press))
}
{
  /* the switched-off book is still a decision: nothing is owed */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], situations: APP_OFF() })
  const out = env.appReleaseQuietCarry_({ app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar',
    since: new Date().toISOString() })
  check('off book: a morning with the situation switched off lets the entry go',
    out.state === 'stale' && /switched off/.test(out.why) && env.world.owed.length === 0, JSON.stringify(out))
}

console.log('AN UNREADABLE TEST-MODE SWITCH WRITES NOBODY')
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], testMode: 'throw' })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('switch: the button refuses before the first letter',
    out.status === 409 && env.world.calls.length === 0 && /test-mode switch could not be read/.test(out.message) &&
    out.data.blocked_by === 'test_mode_unreadable', JSON.stringify(out))
  const sum = env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('switch: the automatic pass writes nobody and owes the app for the next pass',
    env.world.calls.length === 0 && sum.cal.deferred === true && env.world.owed.length === 1, JSON.stringify(sum))
  const kept = env.appReleaseQuietCarry_(owedData(env))
  check('switch: the carry keeps it while the switch stays unreadable',
    kept.state === 'kept' && env.world.calls.length === 0 && env.world.owed.length === 1, JSON.stringify(kept))
  env.world.testMode = 'off'
  env.appReleaseQuietCarry_(owedData(env))
  check('switch: and says it once the switch reads', env.world.calls.length === 2, env.world.calls.length)
}
{
  /* a told-log that cannot be read by day: owed too, never dropped */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], logUnreadable: 'timed out' })
  const sum = env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('told-log: an unreadable record of who was told writes nobody and keeps the app for the next pass',
    env.world.calls.length === 0 && sum.cal.deferred === true && env.world.owed.length === 1, JSON.stringify(sum))
}
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']], quiet: true, oweRefuses: true })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('night: a morning list that cannot keep it says so, and nobody is written to',
    out.status === 409 && /could not keep/.test(out.message) && env.world.calls.length === 0, JSON.stringify(out))
}
{
  const env = build({ users: CROWD, quiet: true })
  env.appReleaseAutoAnnounce_({ cal: ['DIRECTOR'] }, { cal: { name: 'Calendar' } })
  check('night: the automatic pass owes it instead of losing it',
    env.world.calls.length === 0 && env.world.owed.length === 1 && env.world.owed[0].key === 'cal',
    env.world.owed)
}
{
  /* a run that crosses into the window: the door answers quiet for one person */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: (m, p) => (p.to === 'f@asa'
      ? { ok: true, sent: false, gated: true, quiet: true, redirected: false, reason: 'quiet_hours' }
      : { ok: true, sent: true, receipt: 'r' }) })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('quiet: a quiet hold is its own number, and owed for the morning',
    out.data.held_quiet === 1 && out.data.held === 0 && out.data.quiet_owed === true &&
    env.world.owed.length === 1, JSON.stringify(out.data))
  check('quiet: and the app is not marked announced while somebody is owed',
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, env.world.props)
}
{
  /* the letter stopped by the person, the text held by the window: the morning can still send one */
  const env = build({ users: [Object.assign({}, CROWD[0], { phone: '+13305550101' })],
    badges: [['cal', 'DIRECTOR', '', '']],
    answer: (m) => (m === 'emailSend'
      ? { ok: true, sent: false, gated: true, reason: 'opted_out', detail: 'stop' }
      : { ok: true, sent: false, gated: true, quiet: true, reason: 'quiet_hours' }) })
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('legs: a letter with a leg the morning can still send is held, not declined',
    out.data.held_quiet === 1 && out.data.declined === 0, JSON.stringify(out.data))
}

console.log('A SECOND PRESS WRITES ONLY THOSE STILL OWED, AND THE STAMP CLOSES THE RUN')
{
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']],
    answer: (m, p) => (p.to === 'f@asa'
      ? { ok: true, sent: false, gated: true, rehearsed: true, reason: 'the dial is at the sheet' }
      : { ok: true, sent: true, receipt: 'r' }) })
  const first = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('again: a run the dial partly held is not stamped', first.data.held === 1 &&
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, JSON.stringify(first.data))
  env.world.answer = () => ({ ok: true, sent: true, receipt: 'r2' })
  const before = env.world.calls.length
  const second = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('again: the second press writes only the one the dial held',
    env.world.calls.length - before === 1 && second.data.sent === 1 && second.data.already_told === 1,
    JSON.stringify(second.data))
  check('again: and now that everybody is told, the app is stamped',
    /"cal"/.test(String(env.world.props.APP_RELEASE_ANNOUNCED || '')), env.world.props)
}
{
  /* the book answers "on" up front and the row is switched off mid-run */
  const env = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']] })
  env.world.answer = () => { env.world.situations = APP_OFF(); return { ok: true, sent: true, receipt: 'r' } }
  const out = env.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('silenced: a situation switched off mid-run stops it, and is not counted as refusals',
    out.data.sent === 1 && out.data.failed === 0 && /switched off/.test(out.data.stopped) &&
    env.world.props.APP_RELEASE_ANNOUNCED === undefined, JSON.stringify(out.data))
}
{
  const nobody = build({ users: [CROWD[0]], badges: [['cal', 'DIRECTOR', '', '']], optedOut: ['a@asa'] })
  nobody.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('stamp: a run that told nobody at all is not announced',
    nobody.world.props.APP_RELEASE_ANNOUNCED === undefined, nobody.world.props)
  const released = CROWD.filter((u) => u.released_at && u.types === 'DIRECTOR' && u.active === 'true')
  const empty = build({ users: CROWD.filter((u) => !released.includes(u)), badges: [['cal', 'DIRECTOR', '', '']] })
  const none = empty.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar' }, MASTER)
  check('stamp: nor is a run with nobody released to address',
    none.data.eligible === 0 && empty.world.props.APP_RELEASE_ANNOUNCED === undefined, JSON.stringify(none.data))
  const owedEarlier = build({ users: CROWD, badges: [['cal', 'DIRECTOR', '', '']] })
  owedEarlier.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar', resume: 1, outstanding: 3 }, MASTER)
  check('pages: the last page of a run whose earlier pages left people owed does not stamp',
    owedEarlier.world.props.APP_RELEASE_ANNOUNCED === undefined, owedEarlier.world.props)
  const last = build({ users: [CROWD[0]], badges: [['cal', 'DIRECTOR', '', '']], optedOut: ['a@asa'] })
  last.HUB_ACTIONS.appReleaseAnnounce({ app_id: 'cal', title: 'Calendar', resume: 1, told_before: 2 }, MASTER)
  check('pages: a last page of stops, after earlier pages told people, closes the run',
    /"cal"/.test(String(last.world.props.APP_RELEASE_ANNOUNCED || '')), last.world.props)
}

console.log('THE AUTOMATIC PASS IS PYTHON\'S, TOLD BY THE RELAY ONCE THE BADGE SAVE LANDS')
{
  const bulk = slice(PREFS, 'HUB_ACTIONS.appAccessSetBulk = function')
  const one = slice(PREFS, 'HUB_ACTIONS.appBadgeAccessSet = function')
  check('release: neither badge save announces from Apps Script — inside its lock or after it',
    bulk.indexOf('appReleaseAutoAnnounce_(') === -1 && one.indexOf('appReleaseAutoAnnounce_(') === -1, '')
}

console.log('THE MOCK OUTBOX CAN FIND THE APP LETTER BY ITS SITUATION')
{
  const env = build({ users: CROWD })
  env.commReleaseAppTell_({ email: 'a@asa', name: 'A', uid: 'U1' }, { id: 'cal', title: 'Calendar' }, 'k')
  const tail = /:\s*([A-Za-z0-9_-]+)\s*$/.exec(env.world.calls[0].reason)
  check('situation: the reason ends at the situation id, with no app in brackets after it',
    tail && tail[1] === 'app_release_announced', env.world.calls[0].reason)
}

/* ══ the screen ══════════════════════════════════════════════════════════ */
console.log('THE SCREEN NEVER LIES TO THE MASTER')
check('screen: the refusal envelope is read off the thrown error, not printed as a bare red',
  /envelope\?: \{ data\?: ReleaseResult/.test(PAGE) && /env\?\.status === 409/.test(PAGE), '')
check('screen: a press is never re-sent by the transport, and carries its own id',
  /gasAction<ReleaseResult>\('releaseUser', payload, \{ retry: false \}\)/.test(PAGE) &&
  /press_id: newPressId\(\)/.test(PAGE), '')
check('screen: `anyway` is asked for in words, never sent by default',
  /anyway: true, press_id/.test(PAGE) && /Rearm anyway/.test(PAGE), '')
check('screen: the refusal names the brake from the word the backend gave',
  /blockedSentence\(data\.blocked_by\)/.test(PAGE) && /situation_off: /.test(PAGE) &&
  /test_mode_unreadable: /.test(PAGE), '')
check('screen: after a release the card is read again',
  /await refreshStatus\(userId\)/.test(PAGE), '')
check('screen: the warnings a release could not finish are drawn',
  /report\.warnings\.map/.test(PAGE), '')
check('screen: sessions that could not be counted are a dash, never zero',
  /report\.sessions_ended === null/.test(PAGE) && /Sessions ended: —/.test(PAGE), '')
check('screen: unreadable marks are a dash, never "not seen"',
  /status\.marks \? \(/.test(PAGE) && /welcome marks: —/.test(PAGE), '')
check('screen: the confirmation says the password they chose stops working',
  /STOPS WORKING the moment the letter leaves/.test(PAGE), '')
/* the run itself is driven page by page in tests/spa/black-headers.test.tsx */
check('screen: the page runs the one paged run the tests drive',
  /runAnnouncement\(\s*\(payload\) => gasAction<AnnounceResult>\('appReleaseAnnounce', payload\)/.test(PAGE) &&
  /failed \+= out\.failed \|\| 0/.test(PAGE) && /told \+= out\.already_told \|\| 0/.test(PAGE) &&
  /already \+= out\.already_sent \|\| 0/.test(PAGE), '')
check('screen: the addressed count is never printed as "people can open this app"',
  !/\{annReport\.eligible\} people can open/.test(PAGE) && !/\$\{out\.eligible\} people can open/.test(PAGE) &&
  /released person\/people were addressed/.test(PAGE), '')
check('screen: and the badge holders not yet released are printed beside it',
  /badge holder\(s\) not yet released were not written to/.test(PAGE), '')
check('screen: no browser dialog anywhere on this page',
  !/window\.(confirm|alert)/.test(PAGE), '')

console.log('THE BROWSER STANDS DOWN TO A RELEASE')
check('prefs: a stale unsynced copy drops the released person before it is pushed',
  /dropReleasedMarks\(blob, uid, dirtySince\(\)\)\s*\n\s*schedulePrefsPush\(\)/.test(PREFS_SYNC), '')
check('prefs: the dirty stamp keeps the OLDEST unsynced change (held by tests/spa/release-users.test.ts)',
  /nextDirtyStamp\(localStorage\.getItem\(DIRTY_KEY\), uid, Date\.now\(\)\)/.test(PREFS_SYNC), '')
check('prefs: the tour is read again when the pull lands',
  /useSyncExternalStore\(onPrefsSettled, prefsSettled/.test(TOUR) && /dismissed, settled\]/.test(TOUR), '')
check('prefs: the playground intro and the world welcome stay closed until the pull lands, and are read again ' +
      'when it does (held by tests/spa/seen-once.test.ts)',
  /useSeenOnce\(SEEN_KEY, uid\)/.test(PG_INTRO) && /useSeenOnce\(SEEN_KEY, uid\)/.test(MW_INTRO) &&
  /useSyncExternalStore\(onPrefsSettled, prefsSettled/.test(SEEN_ONCE) && /dismissed, settled\]/.test(SEEN_ONCE) &&
  /!settled/.test(SEEN_ONCE), '')

/* ONE DARK SURFACE. Both screens open on the kit's `bg-detail-hero` band that
   carries their own figures (TechnologyHero, ReleaseUsersHero), like every other
   app with a black header. A second black band inside PageHeader stacked two
   dark bands on the same screen and gave the kit a second dark surface. */
console.log('THE BLACK HEADER, ON THE TWO SCREENS IT WAS ASKED FOR')
const REL_HERO = read('src/pages/features/releaseusers/ReleaseUsersHero.tsx')
const TECH_HERO = read('src/pages/features/technology/TechnologyHero.tsx')
check('header: Release Users opens on the kit\'s dark surface with its own figures',
  /<ReleaseUsersHero/.test(PAGE) && /bg-detail-hero/.test(REL_HERO), '')
check('header: Technology Command Center does too',
  /<TechnologyHero/.test(TECH) && /bg-detail-hero/.test(TECH_HERO), '')
check('header: and neither stacks a second black band in its title block',
  !/tone="black"/.test(PAGE) && !/tone="black"/.test(TECH) && !/header-band/.test(HEADER_TSX) &&
  !/--header-band/.test(THEME) && !/header-band/.test(TAILWIND), '')

console.log('ONE RULE FOR THE PREFERENCES ROW: THE LAST ONE IS THE PERSON’S, AND THE STAMP IS THE SERVER’S')
{
  const src = [varLine(PREFS, 'PREFS_RELEASED_KEY'), slice(PREFS, 'function prefsKeepReleased_'),
    slice(PREFS, 'HUB_ACTIONS.prefsSet = function')].join('\n')
  const box = { str_: (v) => String(v == null ? '' : v).trim(), JSON, Date, String, Number, Object,
    normKey_: (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    PREFS_MAX_BYTES: 20000, HUB_ACTIONS: {} }
  const two = makeSheet([['user_id', 'prefs', 'updated_at'],
    ['USR_1', '{"a":1}', ''], ['USR_1', JSON.stringify({ b: 2, 'asa-released-at': '2030-01-02T00:00:00.000Z' }), '']])
  box.prefsSheet_ = () => two.sheet
  vm.createContext(box)
  vm.runInContext(src, box, { filename: 'Prefs.gs' })
  box.HUB_ACTIONS.prefsSet({ prefs: { c: 3, 'asa-tour-seen': '["USR_1"]' } }, { id: 'USR_1' })
  const stored = JSON.parse(two.cells[2][1])
  check('prefs: the write lands on the row the read and the release both use — the last',
    stored.c === 3 && two.cells[1][1] === '{"a":1}', two.cells.slice(1).map((r) => r[1]))
  check('prefs: a push without the release stamp keeps it — the browser cannot erase it',
    stored['asa-released-at'] === '2030-01-02T00:00:00.000Z', stored)
  box.HUB_ACTIONS.prefsSet({ prefs: { 'asa-released-at': '1999-01-01T00:00:00.000Z' } }, { id: 'USR_1' })
  check('prefs: nor move it backwards',
    JSON.parse(two.cells[2][1])['asa-released-at'] === '2030-01-02T00:00:00.000Z', two.cells[2][1])
}

console.log(`\n${results.ok} ok, ${results.failed.length} failed`)
if (results.failed.length) {
  results.failed.forEach((f) => console.log(`  FAILED: ${f}`))
  process.exit(1)
}
