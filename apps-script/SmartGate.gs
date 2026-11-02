// SMART GATE — the doors that touch the world outside this platform without saying a word, as situations; and the…
// WHY THIS FILE EXISTS.

/** The species. Inert to every sweep: nothing walks a `gate` row to send it. */
var HUB_GATE_KIND = 'gate';

// AND THE SPECIES FOR A LETTER A DOOR FIRES.
var HUB_LETTER_KIND = 'letter';

// THE CATALOGUE — one entry per door found by the sweep, each naming what it reaches and what holding it costs…
var HUB_GATES = [
  { id: 'gate_drive_grant_reader', person: true,
    label: 'Drive reader access handed to a person',
    reaches: 'a real Google account gets reader access on a real document — candidate uploads, ' +
             'task attachments, the signed application PDF that carries an SSN',
    costs: 'while this holds, an upload lane grants nobody anything; the row says who would have ' +
           'been given what' },
  { id: 'gate_screening_report_share', person: true,
    label: 'the phone-screen report handed to the administrators',
    reaches: 'every address the admin list answers gets reader access on a freshly minted document ' +
             'holding a candidate\'s score, concerns and background disclosure',
    costs: 'the report is still written; nobody is given access to it while this holds' },
  { id: 'gate_calendar_file_link', person: true,
    label: 'a calendar day file published to anyone with the link',
    reaches: 'anybody holding the link — it publishes a company calendar attachment, permanently',
    costs: 'the file is still made; it stays private while this holds' },
  { id: 'gate_wellbeing_image_link', person: true,
    label: 'a generated illustration published to anyone with the link',
    reaches: 'anybody holding the link — the same permanent link-sharing, on generated images',
    costs: 'the image is still made; it stays private while this holds' },
  { id: 'gate_book_write_funnel',
    label: 'every create, update and delete in an ASA DATA workbook',
    reaches: 'a live book — this is the funnel 106 call sites across 27 files pass through',
    costs: 'THE WIDEST GATE ON THE PLATFORM. While this holds, a rehearsal writes nothing to any ' +
           'workbook at all: every action that creates a row answers that the write was held, and an ' +
           'import or rebuild stops at the first held row and says how many landed before it. Arm it ' +
           'only for a rehearsal that is meant to leave no trace.',
    caveat: function () {
      return (typeof route === 'function' && String(route).indexOf('created.error') === -1)
        ? 'In this build the generic resource door still answers a held CREATE as saved: its refusal ' +
          'check lives in Main.gs, which is not published with this package. Updates and deletes ' +
          'answer the hold.'
        : '';
    } },
  { id: 'gate_resource_write_door',
    label: 'the generic resource door (create / update / delete)',
    reaches: 'a live book — roughly sixty declared resources, whichever workbook each one\'s tab is in',
    costs: 'while this holds, the screens\' save buttons answer held instead of writing',
    wired: function () {
      return typeof route === 'function' && String(route).indexOf('hubResourceGate_(') !== -1;
    },
    unwired: 'the route that must ask this gate is in Main.gs, which is not published with this package ' +
             '(hubResourceGate_ is ready; the route does not call it yet) — arming it changes nothing ' +
             'until that file ships' },
  { id: 'gate_psi_punches_ingest',
    label: 'the time clock\'s punches written into their house',
    reaches: 'a live book — the punches house, plus the two stamps beside it',
    costs: 'this door MIRRORS facts the time clock already recorded, so holding it makes the mirror ' +
           'stale rather than protecting anybody. Left off, the rows are stamped with the switch ' +
           'instead, which is the honest half of the fix.' },
  { id: 'gate_behavior_signals_ingest',
    label: 'behaviour signals written into their house',
    reaches: 'a live book — the behaviour signals house',
    costs: 'the relay keeps the signals and offers them again; nothing is lost, the house is behind' },
  { id: 'gate_recruit_book_ingest',
    label: 'the recruiters\' book written back',
    reaches: 'a live book — the recruiters\' house. Its SEND path already asks the dial; this is the ' +
             'write upstream of it, which never did.',
    costs: 'the relay keeps the rows and offers them again' },
  { id: 'gate_relay_ingest_lane', relay: true,
    label: 'the relay\'s own ingest lane, on its own clock',
    reaches: 'live books — every row the relay posts into an Apps Script ingest door: the feeds on its ' +
             'own clock, the call feed (its tick and its webhook door), the provider\'s webhook filing ' +
             'a call or a text, and the line directory push',
    costs: 'the sweeps keep computing and stop posting; every house they feed falls behind. A call the ' +
           'feed read stays parked and is not charged a refusal. A provider webhook held is answered ' +
           '"not filed", and the provider retries it only for as long as it retries' },
  { id: 'gate_digest_writes', relay: true, engine: true,
    label: 'the digest lane writing claim state and verdicts',
    reaches: 'live books — the form files and client files ledgers, and the words book the proposals ' +
             'and kinds tables live in',
    costs: 'the relay\'s digest worker and the engine\'s digester (Digest.gs, which runs only when the ' +
           'relay rings it) stop claiming and sealing rows, and the proposals and teach doors refuse; ' +
           'nothing is read twice, the queue waits' },
  { id: 'gate_ledger_drain_replay', relay: true,
    label: 'the parked-write drain replaying to the platform',
    reaches: 'whatever the queued write reached — a browser write parked minutes or hours ago',
    costs: 'the queue holds. A write is never dropped: the time it spent held does not count toward ' +
           'the day after which an undeliverable write is set aside' },
  { id: 'gate_mail_provision', relay: true, person: true,
    label: 'a mailbox created on the real mail server',
    reaches: 'a real account on the real mail server, and its password in the answer',
    costs: 'a first sign-in cannot provision a mailbox while this holds' },
  { id: 'gate_mail_mark_file', relay: true,
    label: 'a real mailbox flagged or refiled',
    reaches: 'a real mailbox — a message marked seen, or moved between real folders',
    costs: 'the mail rail reads but does not mutate while this holds' },
  { id: 'gate_chat_live_frame', relay: true,
    label: 'the live chat frame pushed to an open tab',
    reaches: 'a real colleague\'s screen, the moment a chat message lands',
    costs: 'THE STATED EXCEPTION. This is one person deliberately writing to another, not the ' +
           'platform notifying anybody, so it is delivered while the lane holds — the same reason ' +
           'the two authentication letters are. It is named here so the exception is a decision ' +
           'somebody can see and reverse, not an omission.' }
];

/** Every gate id, as a plain list. */
function hubGateIds_() {
  return HUB_GATES.map(function (g) { return g.id; });
}

/** The catalogue entry, or null. */
function hubGateSpec_(id) {
  var want = String(id || ''), hit = null;
  HUB_GATES.forEach(function (g) { if (g.id === want) hit = g; });
  return hit;
}

/** Is the code that asks this gate in the published build? — { wired, why }. */
function hubGateWired_(id) {
  var g = hubGateSpec_(id);
  if (!g || typeof g.wired !== 'function') return { wired: true, why: '' };
  var ok = false;
  try { ok = !!g.wired(); } catch (e) { ok = false; }
  return { wired: ok, why: ok ? '' : String(g.unwired || 'the door that asks this gate is not in this build') };
}

/** What this door still gets wrong in this build, or ''. */
function hubGateCaveat_(id) {
  var g = hubGateSpec_(id);
  if (!g || typeof g.caveat !== 'function') return '';
  try { return String(g.caveat() || ''); } catch (e) { return ''; }
}

// The seed rows for the situations tab.
function hubGateSeeds_() {
  return HUB_GATES.map(function (g) {
    return {
      id: g.id, enabled: 'no', kind: HUB_GATE_KIND,
      label: g.label, direction: 'out', channels: '', to: '',
      sms_text: '', email_subject: '', email_text: '',
      note: 'OFF. A gate, not a message: it sends nothing and says nothing. ON means this door ' +
            'HOLDS whenever the lane is holding. Reaches: ' + g.reaches + '. Holding it costs: ' +
            g.costs +
            (g.relay ? (g.engine ? ' Asked by the relay and by the engine.' : ' Asked by the relay, not by Apps Script.')
                     : '') +
            (g.person
              ? ' It hands something to a person that cannot be taken back, so a situations tab ' +
                'that cannot be read HOLDS it while the lane holds.'
              : '')
    };
  });
}

/** Re-entry guard: the gate reads the situations tab, and the tab is a book. */
var HUB_GATE_ASKING = false;

/** The armed map for this execution: { map: {id: bool}, unreadable: '' }, or null. */
var HUB_GATE_ARMED_MEMO = null;

/** Said once per gate per execution — a sweep holds a thousand rows, not a thousand facts. */
var HUB_GATE_SAID = {};

/** A person door's second read of an unreadable map is spent once per execution (hubGateHolds_). */
var HUB_GATE_REREAD_DONE = false;

// How long the armed map is kept.
var HUB_GATE_ARMED_TTL_S = 300;

/** The small cache entry every execution asks first, stamped with the build. */
function hubGatesArmedKey_() {
  var build = '';
  try { build = (typeof HUB_CODE_BUILD !== 'undefined') ? String(HUB_CODE_BUILD) : ''; }
  catch (e) { build = ''; }
  return 'hub_gates_armed_v1|' + build;
}

/** The store the armed map is kept in — one door, so a self-test never writes the real one. */
function hubGatesArmedCache_() {
  return CacheService.getScriptCache();
}

/** Forget the armed map: a save on the Desk (smartCacheBust_) changes it. */
function hubGatesArmedBust_() {
  HUB_GATE_ARMED_MEMO = null;
  try { hubGatesArmedCache_().remove(hubGatesArmedKey_()); }
  catch (e) { /* the entry expires on its own */ }
}

// WHICH GATES ARE ARMED — ONE SMALL READ PER EXECUTION, NOT ONE SITUATIONS READ.
function hubGatesArmedRead_() {
  if (HUB_GATE_ARMED_MEMO) return HUB_GATE_ARMED_MEMO;
  if (HUB_GATE_ASKING) return { map: {}, unreadable: '', reentrant: true };
  var cache = null;
  try {
    cache = hubGatesArmedCache_();
    var hit = cache.get(hubGatesArmedKey_());
    if (hit) {
      var parsed = JSON.parse(hit);
      if (parsed && typeof parsed.map === 'object') {
        HUB_GATE_ARMED_MEMO = { map: parsed.map, unreadable: '' };
        return HUB_GATE_ARMED_MEMO;
      }
    }
  } catch (eC) { cache = null; }
  HUB_GATE_ASKING = true;
  var got = { map: {}, unreadable: '' };
  try {
    if (typeof smartSituations_ !== 'function') throw new Error('the situations reader is not in this build');
    var ids = {};
    HUB_GATES.forEach(function (g) { ids[g.id] = true; });
    smartSituations_().forEach(function (s) {
      var id = String((s && s.id) || '');
      if (ids[id]) got.map[id] = (typeof smartOn_ === 'function') ? !!smartOn_(s.enabled) : false;
    });
    try { if (cache) cache.put(hubGatesArmedKey_(), JSON.stringify({ map: got.map }), HUB_GATE_ARMED_TTL_S); }
    catch (eP) { /* uncached: the next execution reads again */ }
  } catch (e) {
    got = { map: {}, unreadable: 'the situations tab could not be read (' +
                                 String((e && e.message) || e).slice(0, 160) + ')' };
  } finally {
    HUB_GATE_ASKING = false;
  }
  HUB_GATE_ARMED_MEMO = got;
  return got;
}

/** { armed, unreadable } for one gate. */
function hubGateState_(id) {
  var read = hubGatesArmedRead_();
  return { armed: !!(read.map && read.map[String(id || '')] === true), unreadable: String(read.unreadable || '') };
}

/** Is this gate armed? An unreadable read is not "armed" here — hubGateHolds_ decides what it costs. */
function hubGateArmed_(id) {
  return hubGateState_(id).armed;
}

// DOES THIS DOOR HOLD RIGHT NOW?
function hubGateHolds_(id, what) {
  var out = { held: false, why: '' };
  var st = hubGateState_(id);
  var spec = hubGateSpec_(id);
  var unreadableHolds = !!(st.unreadable && spec && spec.person);
  if (!st.armed && !unreadableHolds) return out;
  // A reader missing from a partial push is a switch nobody can read: it holds.
  var holding = true;
  try { holding = (typeof hubRehearsalToSheet_ === 'function') ? !!hubRehearsalToSheet_() : true; }
  catch (e) { holding = true; }
  if (!holding) return out;
  // A PERSON DOOR READS THE MAP ONCE MORE BEFORE AN OUTAGE HOLDS IT.
  var readTwice = false;
  if (!st.armed && unreadableHolds && !HUB_GATE_REREAD_DONE) {
    HUB_GATE_REREAD_DONE = true;
    HUB_GATE_ARMED_MEMO = null;
    st = hubGateState_(id);
    readTwice = true;
    unreadableHolds = !!st.unreadable;
    if (!st.armed && !unreadableHolds) return out;
  }
  out.held = true;
  out.why = st.armed
    ? hubGateWhy_(id)
    : (st.unreadable + (readTwice ? ' (asked twice)' : '') + ' while the send switch is holding — ' +
       (spec ? spec.label : String(id)) +
       ' hands something to a person that cannot be taken back, so it is held rather than done');
  out.unreadable = !st.armed;
  hubGateSay_(id, what, out.why);
  return out;
}

/** Why this door is holding, in the words the row and the answer both carry. */
function hubGateWhy_(id) {
  var unreadable = '';
  try {
    unreadable = (typeof hubSwitchUnreadableWhy_ === 'function')
      ? String(hubSwitchUnreadableWhy_() || '') : '';
  } catch (e) { unreadable = ''; }
  var spec = hubGateSpec_(id);
  var what = spec ? spec.label : String(id || 'this door');
  return unreadable
    ? (unreadable + ' — ' + what + ' is held rather than done')
    : ('the send switch is on, and ' + what + ' is gated with it (' + String(id || '') + ')');
}

// THE ROW.
function hubGateSay_(id, what, why) {
  var w = what || {};
  var key = String(id || '');
  try {
    if (!HUB_GATE_SAID[key]) {
      HUB_GATE_SAID[key] = true;
      hubSysLog_('asa-hub:smartgate', 'gate_holds', key + ' — ' + String(why || ''), { status: 200 });
    }
  } catch (eL) { /* the hold stands */ }
  try {
    if (typeof commMockHeld_ === 'function') {
      commMockHeld_({
        channel: 'team',
        situation: key,
        to: String(w.to || ''),
        to_name: String(w.to_name || ''),
        person_name: String(w.person_name || ''),
        subject: String(w.subject || (hubGateSpec_(key) ? hubGateSpec_(key).label : key)),
        body: String(w.body || ''),
        purpose: String(w.purpose || 'a door this platform gated'),
        reason: String(why || ''),
        intent_key: String(w.intent_key || '')
      }, String(why || ''));
    }
  } catch (eM) { /* the book is never worth a decision */ }
}

// THE ANSWER A GATED DOOR GIVES BACK — the shape every caller on this platform already reads as "recorded, not…
function hubGateAnswer_(id, why) {
  return { ok: true, sent: false, gated: true, held: true, gate: String(id || ''),
           reason: 'gated', detail: String(why || '') };
}

// AN INGEST DOOR'S ANSWER WHEN ITS GATE HOLDS.
function hubIngestGate_(id, words) {
  if (typeof hubGateHolds_ !== 'function') return null;
  var gate = hubGateHolds_(id, {
    subject: String((words && words.subject) || id),
    body: String((words && words.body) || ''),
    purpose: 'a book write this platform gated'
  });
  return gate.held ? { status: 409, message: gate.why } : null;
}

// THE GENERIC RESOURCE DOOR'S OWN GATE — ready here, asked from Main.gs.
function hubResourceGate_(resource, action) {
  if (typeof hubGateHolds_ !== 'function') return null;
  var gate = hubGateHolds_('gate_resource_write_door', {
    subject: String(action || '') + ' on ' + String(resource || ''),
    body: 'the resource door held a ' + String(action || '') + ' on "' + String(resource || '') + '"',
    purpose: 'a book write this platform gated'
  });
  return gate.held ? { status: 409, message: gate.why } : null;
}

// The switch as one word, for a row or a stamp that has to say which it was.
function hubSwitchWord_() {
  try {
    var holding = (typeof hubRehearsalToSheet_ === 'function') ? !!hubRehearsalToSheet_() : true;
    if (typeof hubRehearsalToSheet_ !== 'function') return 'unreadable';
    if (typeof hubSwitchUnreadableWhy_ === 'function' && hubSwitchUnreadableWhy_()) return 'unreadable';
    return holding ? 'on' : 'off';
  } catch (e) { return 'unreadable'; }
}

// WHAT THE DESK IS TOLD.
function hubGateDesk_(rows) {
  var byId = {};
  (rows || []).forEach(function (r) { if (r && r.id) byId[String(r.id)] = r; });
  var word = hubSwitchWord_();
  var lane = word === 'unreadable' ? 'unreadable' : (word === 'on' ? 'holding' : 'off');
  var mins = Math.round(HUB_GATE_ARMED_TTL_S / 60);
  return {
    lane: lane,
    // WHEN A SWITCH ACTS, said beside the switches: the doors read a small armed map, not the tab, and the relay…
    lag: 'A switch saved on this desk reaches the Apps Script doors at once, and the relay\'s doors ' +
         'the next time the relay reads the configuration, within a few minutes. An `enabled` cell ' +
         'typed straight into the situations tab acts only when the armed map is rebuilt — up to ' +
         mins + ' minutes later, and longer for the relay\'s doors.',
    gates: HUB_GATES.map(function (g) {
      var row = byId[g.id];
      var armed = !!(row && typeof smartOn_ === 'function' && smartOn_(row.enabled));
      var wired = hubGateWired_(g.id);
      return {
        id: g.id, label: g.label, reaches: g.reaches, costs: g.costs,
        relay: !!g.relay,
        person: !!g.person,
        known: !!row,
        armed: armed,
        wired: wired.wired,
        wired_why: wired.why,
        caveat: hubGateCaveat_(g.id),
        holds_now: armed && wired.wired && lane !== 'off'
      };
    })
  };
}

// ────────────────────────────────────────────────────────────────────────── THE LETTERS A DOOR FIRES…

// ONE SITUATION, READ WITH THE THREE ANSWERS KEPT APART — { row, on, unreadable }.
function hubSituationRead_(id) {
  var want = String(id || '');
  try {
    if (typeof smartSituations_ !== 'function') throw new Error('the situations reader is not in this build');
    var row = null;
    smartSituations_().forEach(function (s) { if (String((s && s.id) || '') === want) row = s; });
    return { row: row, on: !!(row && typeof smartOn_ === 'function' && smartOn_(row.enabled)),
             unreadable: '' };
  } catch (e) {
    return { row: null, on: false,
             unreadable: 'the situations tab could not be read (' +
                         String((e && e.message) || e).slice(0, 160) + ')' };
  }
}

/** Said once per situation per execution. */
var HUB_LETTER_UNREADABLE_SAID = {};

function hubLetterUnreadableSay_(id, why) {
  var key = String(id || '');
  if (HUB_LETTER_UNREADABLE_SAID[key]) return;
  HUB_LETTER_UNREADABLE_SAID[key] = true;
  try { hubSysLog_('asa-hub:smartgate', 'letter_switch_unreadable', key + ' — ' + String(why || ''), { status: 502 }); }
  catch (e) { /* the hold stands without its line */ }
}

/** {placeholder} substitution where an empty value is still a value. */
function hubLetterRender_(tpl, vars) {
  var v = vars || {};
  return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, function (m, k) {
    return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k] == null ? '' : v[k]) : m;
  });
}

// THE TWO AUTHENTICATION LETTERS, AS SITUATIONS.
var HUB_AUTH_SITUATIONS = {
  password_reset: 'auth_password_reset',
  invitation: 'auth_invitation'
};

/** Where each letter's e-mail words live: the row (a blank cell falls back to the designed template). */
var HUB_AUTH_LETTER_WORDS = {
  password_reset: 'row',
  invitation: 'row'
};

// THE OTHER SITUATIONS WHOSE LETTER CLAIMS A KIND.
var HUB_AUTH_ALSO_CLAIMED = {
  invitation: [
    { id: 'user_release_invite', label: 'the release invite (a first password)',
      door: 'Release Users (CommRelease.gs)' },
    { id: 'user_account_invite', label: 'the account invitation (a sign-in and a first password)',
      door: 'Settings → Users → Invite (HubCore.gs)' }
  ]
};

/** The situation id for an authentication letter kind, or ''. */
function hubAuthSituationId_(kind) {
  var k = String(kind || '');
  return Object.prototype.hasOwnProperty.call(HUB_AUTH_SITUATIONS, k) ? HUB_AUTH_SITUATIONS[k] : '';
}

// MAY THIS AUTHENTICATION LETTER BE SENT AT ALL?
function hubAuthLetterAllowed_(kind) {
  var id = hubAuthSituationId_(kind);
  if (!id) return { on: false, row: null, unreadable: false, why: 'not an authentication letter' };
  var got = hubSituationRead_(id);
  if (got.unreadable) {
    var why = got.unreadable + ', so this letter is HELD — nobody can say the situation ' + id +
              ' was not switched off, and an unreadable switch is never a yes. Asked again once the ' +
              'tab answers, it leaves.';
    hubLetterUnreadableSay_(id, why);
    return { on: false, row: null, unreadable: true, why: why };
  }
  if (!got.row) return { on: true, row: null, unreadable: false, why: '' };
  return { on: got.on, row: got.row, unreadable: false,
           why: got.on ? '' : ('the situation ' + id + ' is switched off on the Desk, so this letter ' +
                               'is not sent at all — the switch beats the exemption, the dial does not') };
}

/** The words of an authentication letter: the row's cell when filled, else the floor. */
function hubAuthLetterWords_(kind, field, floor, row) {
  var r = row;
  if (r === undefined) r = hubAuthLetterAllowed_(kind).row;
  var cell = r ? String(r[String(field)] || '').trim() : '';
  return cell || String(floor || '');
}

// THE LEDGER LINE.
function hubAuthLetterLedger_(kind, person, channel) {
  var id = hubAuthSituationId_(kind);
  if (!id || typeof smartRecord_ !== 'function') return false;
  var who = String(person || '').trim().toLowerCase();
  try {
    return smartRecord_(id + '|' + who + '|' + new Date().toISOString(), id, who, '',
                        String(channel || 'email'));
  } catch (e) { return false; }
}

// THE AUTHENTICATION LETTER'S ROW IN THE BOOK EVERYBODY READS.
function hubAuthLetterNote_(kind, what) {
  var w = what || {};
  var id = hubAuthSituationId_(kind);
  if (!id) return;
  if (w.sent) hubAuthLetterLedger_(kind, w.to, 'email');
  if (typeof commMockNote_ !== 'function') return;
  try {
    commMockNote_('emailSend', {
      to: String(w.to || ''), subject: String(w.subject || ''), body: String(w.body || ''),
      reason: 'smart comms: ' + id, auth_letter: String(kind || ''),
      withhold: w.withhold || ''
    }, {}, w.sent
      ? { ok: true, sent: true, method: 'emailSend', receipt: String(w.receipt || '') }
      : { ok: true, sent: false, gated: true, method: 'emailSend',
          reason: String(w.why || 'the letter did not leave'),
          held_by: String(w.why || 'the letter did not leave'),
          detail: String(w.why || '') });
  } catch (e) { /* the letter is the point; the row is the record of it */ }
}

/** The seed rows for the two letters — ON, because they already send. */
function hubAuthSeeds_() {
  return [
    {
      id: 'auth_password_reset', enabled: 'yes', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email, sms', label: 'the temporary password',
      to: '',
      sms_text: 'ASA MyLife: your temporary password is {password}. Sign in at {url} and choose a new one.',
      email_subject: 'ASA MyLife — your temporary password',
      email_text: 'ASA MyLife: your temporary password is {password}.\n\n' +
                  'Sign in at {url} and choose a new one.\n\n' +
                  'It works once, within {minutes} minutes. If you did not ask for it, ignore this message — ' +
                  'your current password still works.',
      note: 'ON, because it already sends. A fresh random temporary password, to the person who asked ' +
            'and to nobody else: by e-mail to the address on the account, and by text to the phone on ' +
            'the account when the letter cannot reach them (no address, a domain that takes no mail, a ' +
            'recorded bounce, or a send that failed). An AUTHENTICATION LETTER: both legs are delivered ' +
            'even while the lane is holding, because a person locked out of the platform cannot be ' +
            'helped by a message in a mockup, and the row says so out loud. {password}, {url}, ' +
            '{minutes} and {email} are filled in; a cell that does not name {password} is not used, and ' +
            'the text must keep "temporary password is {password}", which is how the copy of the line ' +
            'the platform files withholds it. The password never reaches the outbox row. Switch this OFF ' +
            'and nothing is sent; if this tab cannot be read nothing is sent and the log says so.'
    },
    {
      id: 'auth_invitation', enabled: 'yes', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email, sms', label: 'the registration invitation',
      to: '',
      sms_text: '{name}, your ASA invitation — create your account: {link}',
      email_subject: 'Your invitation to ASA LifeCare',
      email_text: 'Hi {name}, you have been invited to the ASA LifeCare platform{by_inviter}.\n\n' +
                  'Create your account here (you choose your own password):\n{link}\n\n' +
                  'The link is personal to you and stands for {days} days.',
      note: 'ON, because it already sends. Goes to the person being invited (the lane resolves the ' +
            'address; `to` stays blank). The subject and the letter are these cells, in both the ' +
            'plain and the designed part; {name}, {link}, {days}, {inviter} and {by_inviter} are ' +
            'filled in, and a blank cell falls back to the designed template. The letter is an ' +
            'AUTHENTICATION LETTER: delivered while the lane holds, said out loud on its row, silent ' +
            'altogether when this switch is off or unreadable — and this switch stops the release ' +
            'invite and the account invitation (Settings → Users → Invite) too. The SMS copy\'s words ' +
            'are the cell above; it is a text like any other, so the dial holds it.'
    }
  ];
}

// THE OTHER LETTERS A DOOR FIRES — each one was already sending before it had a row, which is why each carries its…
function hubLetterSeeds_() {
  return [
    {
      id: 'ai_keys_weekly_check', enabled: 'yes', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'sms, email', label: 'the weekly AI key check',
      to: '',
      sms_text: 'AI keys — {verdict}{retired_line}',
      email_subject: 'AI keys — weekly check{retired_count}',
      email_text: '{report}',
      note: 'ON, because it already sends. Goes to the hiring alert list in Settings. The weekly key ' +
            'sweep\'s notice, through the one door: the quiet window, the sending switch, a receipt ' +
            'and a row in the mock outbox. {verdict} is the one-line verdict, {retired_line} and ' +
            '{retired_count} say how many keys were retired (blank when none), and {report} is the ' +
            'measured report. Switch this off and the sweep still measures and retires keys; it only ' +
            'stops telling anybody.'
    },
    {
      id: 'form_answer_notice', enabled: 'yes', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email', label: 'a form answered — the notice to its notify address',
      to: '', sms_text: '',
      email_subject: '{form_title} — a new answer',
      email_text: '{answers}',
      note: 'ON, because it already sends. Goes to the address the form itself names in `notify_to` ' +
            '(Forms). {form_title} is the form, {answers} is who answered and what they wrote. Held ' +
            'by the quiet window at night; at 08:00 the answer is read again from its row and said, ' +
            'while the answer and the form\'s notify address still stand.'
    },
    {
      id: 'form_file_stalled', enabled: 'yes', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email', label: 'a file sent through a form could not be read',
      to: '', sms_text: '',
      email_subject: 'A file did not go through — {file_name}',
      email_text: 'A file sent through "{form_title}" could not be read: {file_name}.\n\n' +
                  'Please send it again. If it is a long video, a shorter clip works better — or send ' +
                  'the part that matters.\n\n' +
                  'Nothing else about the submission was lost.',
      note: 'ON, because it already sends. Goes to the address the form names in `notify_to`, when the ' +
            'digest gives up on a file. Held by the quiet window at night; at 08:00 the file\'s row is ' +
            'read again and the letter is said only while the file is still stalled.'
    },
    {
      id: 'calloff_mailbox_note', enabled: 'yes', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email', label: 'a call-off copied into the platform\'s own mailbox',
      to: '', sms_text: '',
      email_subject: '{type} — {employee}{date_part}',
      email_text: '{details}',
      note: 'ON, because it already sends. Goes to the platform\'s own mailbox (the account the Mail ' +
            'app reads), one letter per new call-off row. {type}, {employee} and {date_part} name the ' +
            'call-off; {details} is every filled cell of the row. Held by the quiet window at night: ' +
            'the sweep does not move past a held row, so it is asked again after 08:00. Switched off, ' +
            'the sweep moves past new rows without writing to the mailbox.'
    },
    {
      id: 'suggestion_mailbox_note', enabled: 'yes', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email', label: 'a suggestion copied into the platform\'s own mailbox',
      to: '', sms_text: '',
      email_subject: 'Suggestion — {who}',
      email_text: '{text}\n\n— {name} ({role}, {email})',
      note: 'ON, because it already sends. Goes to the platform\'s own mailbox when somebody sends a ' +
            'suggestion; the suggestion itself is saved first, whatever this letter does. {who}, ' +
            '{name}, {role}, {email} and {text} come from the saved row. Held by the quiet window at ' +
            'night; at 08:00 the row is read again and said.'
    }
  ];
}

// THE LETTERS THAT ARRIVE DISABLED.
function hubDisabledLetterSeeds_() {
  return [
    {
      id: 'user_account_invite', enabled: 'no', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email, sms', label: 'the account invitation sent from Settings → Users',
      to: '',
      sms_text: 'You have an account on the ASA LifeCare platform. Sign in with {login}{password_line} {url}',
      email_subject: 'Your ASA LifeCare account',
      email_text: 'Hi {first_name}, you have an account on the ASA LifeCare platform{by_inviter}.\n\n' +
                  'Sign in at {url} with the details below.',
      note: 'OFF until switched on here — a new message arrives disabled. Goes to the account the ' +
            'administrator picked in Settings → Users → Invite (the lane resolves the address and the ' +
            'number; `to` stays blank). {first_name}, {login}, {url}, {inviter} and {by_inviter} are ' +
            'filled in; {password_line} is " — first-time password: …" while the account is still on ' +
            'the shared default. The letter adds the sign-in and the password as facts. It is THE ' +
            'INVITATION: its letter claims the invitation\'s exemption, so it is delivered while the ' +
            'lane holds and its outbox row says so, and it sends only while this row and ' +
            'auth_invitation are both on. Its text is a text like any other — test mode and the ' +
            'sending switch hold it. The password never reaches a book.'
    },
    {
      id: 'mailbox_credentials', enabled: 'no', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'email', label: 'a personal mailbox\'s password, to its owner',
      to: '', sms_text: '', exclude_column: '', exclude_values: '',
      email_subject: 'Your own ASA mailbox is ready',
      email_text: 'Hello {first_name},\n\nYour personal company mailbox exists now:\n\n' +
                  '  Address:  {account}\n  Password: {password}\n\n' +
                  'It is yours alone - change the password in the webmail the first time you open it.',
      note: 'OFF until switched on here — a new message arrives disabled. While it is off, no personal ' +
            'mailbox is created at sign-in: the mail server hands a new password over exactly once, so a ' +
            'box is minted only when this letter can carry that password — this row on, test mode off, ' +
            'the sending switch on and the owner not opted out. Goes to the person signing in (`to` stays ' +
            'blank). `exclude_values` lists sign-in addresses that keep the mail they already have; no box ' +
            'is minted for them. {first_name}, {account} and {password} are filled in, and the password ' +
            'never reaches a book.'
    }
  ];
}

// THE HIRING AND BACK-OFFICE LANES THAT BECAME SITUATIONS.
function hubLaneSeeds_() {
  var lane = function (id, label, channels, words, note) {
    return {
      id: id, enabled: 'no', kind: HUB_LETTER_KIND, direction: 'out', channels: channels,
      label: label, to: '',
      sms_text: words.sms || '', email_subject: words.subject || '', email_text: words.email || '',
      note: 'OFF until switched on here — a new message arrives disabled, and while it is off this ' +
            'lane says nothing (a sweep waits; a button answers that the situation is off). ' + note +
            ' A blank word cell leaves the lane\'s own words in its place; `to` stays blank because ' +
            'the lane resolves its audience.'
    };
  };
  return [
    lane('hiring_ready_parked', 'a candidate parked at Ready to Start, to the deciders', 'email, sms',
         { subject: '{name} has been at Ready to Start for {days} days',
           email: '{name} reached Ready to Start on {since} and nobody has scheduled them yet — {days} days.\n\n' +
                  'Nothing to answer: this stops when they are on the Shift Board.\n\n{link}',
           sms: '{name} has been at Ready to Start for {days} days with nobody scheduling them. Nothing to ' +
                'answer — this stops when they are on the Shift Board.' },
         'Goes to the hiring team and the deciders\' numbers. {name}, {days}, {since} and {link}.'),
    lane('hiring_ready_ask', 'onboarding finished — may they move to Ready to Start?', 'email, sms',
         { subject: '{name} finished onboarding — may I move them to Ready to Start?',
           email: '{name} finished onboarding: {notes}.\n\nMay I move them to Ready to Start? A YES moves ' +
                  'them; a NO archives the profile.\n\n{link}',
           sms: '{name} finished onboarding — may I move them to Ready to Start? A YES here does it.' },
         'Goes to the hiring team and the deciders\' numbers; their YES or NO is read back. {name}, ' +
         '{notes} and {link}.'),
    lane('hiring_referral_relay', 'the referrer asked for a candidate nobody could reach', 'sms, email',
         { subject: 'Your referral — {name}',
           email: 'Hi {referrer},\n\nYou referred {name} to ASA LifeCare, and we have not been able to reach ' +
                  'them.\n\nCould you reply with a phone number or a resume for them? Any contact you hold helps.',
           sms: 'Hi {referrer}, this is ASA LifeCare. You referred {name} and we could not reach them — could ' +
                'you reply with a phone number or a resume for them?' },
         'Goes to the person who made the referral. {name}, {first_name} and {referrer}.'),
    lane('hiring_referral_discarded', 'a referral nobody could reach left the process', 'email',
         { subject: '{name} was discarded from our selection processes',
           email: '{name} left the process: the referral could not be reached — nobody had a phone or a resume.' },
         'Goes to the hiring team, once. The candidate is archived whatever this row says. {name}.'),
    lane('hiring_manual_adder_ask', 'whoever added a candidate asked to withdraw or reach them', 'email, sms',
         { subject: 'Can you reach {name}?',
           email: 'Hi {adder},\n\nYou added {name}, and nobody here has been able to reach them.\n\nEither ' +
                  'withdraw them, or reach them yourself — the screening line is {screen_line}.\n\n{data}',
           sms: 'ASA LifeCare hiring — nobody could reach {name}. Withdraw them, or reach them yourself; the ' +
                'screening line is {screen_line}.' },
         'Goes to the person whose stamp added the card. {name}, {first_name}, {adder}, {data} and ' +
         '{screen_line}.'),
    lane('hiring_director_docs_missing', 'the director fast lane is missing documents', 'email, sms',
         { subject: '{name} is missing {missing}',
           email: '{name} entered onboarding on the director fast lane and we are missing {missing}.\n\nReply to ' +
                  'this e-mail with the file(s), or drop them in the special folder — the folder is instant.',
           sms: 'ASA LifeCare hiring — {name} entered onboarding on the director fast lane and we are missing ' +
                '{missing}. Reply to the e-mail with the file(s), or drop them in the special folder.' },
         'Goes to the hiring team and the deciders\' numbers. {name} and {missing}.'),
    lane('hiring_interest_thanks', 'the team thanked for choosing who to proceed with', 'email',
         { subject: 'Thank you — we proceed with {about}',
           email: 'Hi {who},\n\nThank you for choosing. We proceed with {about} from here.' },
         'Goes to the team member who chose (or the rehearsal mailbox). {who} and {about}.'),
    lane('hiring_candidate_accepted', 'a candidate accepted — the team is told', 'email, sms',
         { subject: '{name} accepted',
           email: '{name} accepted: "{reply}".\n\nPhone: {phone}. The background check and the signatures ' +
                  'come next.',
           sms: '{name} accepted — the background check and the signatures come next. {phone}' },
         'Goes to the hiring team and the deciders\' numbers. {name}, {reply} and {phone}.'),
    lane('hiring_candidate_left', 'a candidate left the process — the team is told', 'email',
         { subject: '{name} left the selection process',
           email: '{name} left the process at {stage}: {reason}.' },
         'Goes to the hiring team. The candidate is archived whatever this row says. {name}, {stage} ' +
         'and {reason}.'),
    lane('hiring_manual_resume_ask', 'a manually added candidate asked for a resume', 'sms, email',
         { subject: 'Your resume for ASA LifeCare',
           email: 'Hi {first_name},\n\nThe next step is your resume — please reply to this e-mail with it ' +
                  'and we take it from there.',
           sms: 'Great to hear from you, {first_name}! The next step is your resume — please e-mail it to ' +
                'asa-hub@asaop.org (replying to our letter works) and we take it from there.' },
         'Goes to the candidate. {name} and {first_name}.'),
    lane('hiring_cjis_report_arrived', 'a background check arrived in the folder', 'email',
         { subject: 'A background check arrived — {count} candidate(s)',
           email: 'The background check turned up in the folder for {count} candidate(s), and it is on their ' +
                  'card:\n\n{lines}\n\nIt is marked ON FILE and nothing stronger — somebody still reads the ' +
                  'report.{orphans_line}' },
         'Goes to the hiring team, one letter per pass. {count}, {lines} and {orphans_line}.'),
    lane('talent_authorization_ask', 'the leaders asked to authorise the top candidates', 'email, sms',
         { subject: 'Authorise the top {count} candidates',
           email: 'The top {count} candidates are ready for a decision:\n\n{list}\n\nReply with the names you ' +
                  'authorise.',
           sms: 'asamylife need help in one decision. thanks and check your email' },
         'Goes to the alert recipients in Settings. The designed letter keeps its table; {count} and ' +
         '{list} fill the words.'),
    lane('med_del_skills_check', 'the trainer asked to schedule a Med Del skills check', 'email',
         { subject: 'Med Del Skills Check — {employee} ({level})',
           email: 'Hi,\n\nWe need to schedule an in-person Med Del skills check for {employee} ({level}).\n\n' +
                  'Location: {address}\n\nPlease reply with available dates.\n\nThank you,\n{employer}' },
         'Goes to the skills-check address in the Med Del settings. {employee}, {level}, {address} and ' +
         '{employer}. Off, the flow waits at the scheduling step.'),
    lane('lead_alert', 'a high-value lead, texted to the lead recipients', 'sms',
         { sms: '{notes}' },
         'Goes to the numbers in the scraper settings, and only while notify_enabled is yes there. ' +
         '{notes}, {client}, {rating} and {lead_id}.')
  ];
}

/** Said once per situation per execution: a lane its switch keeps silent says so once. */
var HUB_LANE_OFF_SAID = {};

function hubLaneOffSay_(id, why) {
  var key = String(id || '');
  if (HUB_LANE_OFF_SAID[key]) return;
  HUB_LANE_OFF_SAID[key] = true;
  try { hubSysLog_('asa-hub:smartgate', 'lane_situation_off', key + ' — ' + String(why || ''), { status: 200 }); }
  catch (e) { /* the silence stands without its line */ }
}

// A LANE THAT BECAME A SITUATION — { id, on, why, row, word(field, floor, vars), leg(channel) }.
function hubLaneSituation_(id) {
  var gate = (typeof hubSituationGate_ === 'function') ? hubSituationGate_(id)
    : { on: false, row: null, why: 'the situations reader is not in this build' };
  var row = gate.row || null;
  var chans = (row && str_(row.channels)) ? smartList_(row.channels) : null;
  if (!gate.on) hubLaneOffSay_(id, gate.why);
  return {
    id: String(id || ''), on: !!gate.on, why: String(gate.why || ''), unreadable: !!gate.unreadable, row: row,
    word: function (field, floor, vars) {
      var cell = row ? str_(row[field]) : '';
      return cell ? hubLetterRender_(cell, vars || {}) : String(floor == null ? '' : floor);
    },
    leg: function (channel) { return !chans || chans.indexOf(String(channel)) !== -1; }
  };
}

// MAY A LETTER THAT ARRIVED DISABLED BE SENT?
function hubSituationGate_(id) {
  var sid = String(id || '');
  var got = hubSituationRead_(sid);
  if (got.unreadable) {
    var why = got.unreadable + ' — ' + sid + ' is held, not sent: an unreadable switch is never a yes';
    hubLetterUnreadableSay_(sid, why);
    return { on: false, row: null, unreadable: true, why: why };
  }
  if (!got.row) {
    return { on: false, row: null, unreadable: false,
             why: 'the situation ' + sid + ' is not in the situations tab yet — nothing was sent' };
  }
  if (!got.on) {
    return { on: false, row: got.row, unreadable: false,
             why: 'the situation ' + sid + ' is switched off in Smart Comms — nothing was sent' };
  }
  return { on: true, row: got.row, unreadable: false, why: '' };
}

// ONE LETTER, THROUGH THE ONE DOOR, IN THE ROW'S WORDS — { state, why, owed }.
function hubLetterSend_(o) {
  var sit = String((o && o.situation) || '');
  // A carrier that has just read the row hands it over (`sit_read`) rather than reading it again.
  var got = (o && o.sit_read && String(o.sit_read.id || sit) === sit) ? o.sit_read : hubSituationRead_(sit);
  if (got.unreadable) {
    var whyU = got.unreadable + ' — the letter ' + sit + ' is held, not sent: an unreadable switch is never a yes';
    hubLetterUnreadableSay_(sit, whyU);
    return { state: 'unreadable', why: whyU };
  }
  if (got.row && !got.on) return { state: 'off', why: 'the situation ' + sit + ' is switched off' };
  var row = got.row || {};
  // THE ROW'S CHANNELS ARE OBEYED: this door writes a letter, so a row whose `channels` names no e-mail sends…
  var chans = (typeof smartList_ === 'function' && str_(row.channels)) ? smartList_(row.channels) : null;
  if (chans && chans.indexOf('email') === -1) {
    return { state: 'off', why: 'the situation ' + sit + ' names no e-mail channel, and this door writes only a letter' };
  }
  var subject = hubLetterRender_(str_(row.email_subject) || str_(o.subject_floor), o.vars);
  var body = hubLetterRender_(str_(row.email_text) || str_(o.text_floor), o.vars);
  var res = null;
  try {
    res = rpcCall_('emailSend', { to: str_(o.to), subject: subject, body: body,
                                  reason: 'smart comms: ' + sit + (str_(o.reason_tail) ? ' ' + str_(o.reason_tail) : '') },
                   { idempotency_key: str_(o.key) });
  } catch (e) {
    return { state: 'failed', why: String((e && e.message) || e).slice(0, 200) };
  }
  return hubLetterOutcome_(res, o);
}

/** What the door answered, as a letter's state — and a quiet hold kept for the morning as facts. */
function hubLetterOutcome_(res, o) {
  var r = res || {};
  var w = o || {};
  var sit = String(w.situation || '');
  if (r.ok && r.sent && !r.redirected) return { state: 'told', why: '' };
  if (r.deduplicated) return { state: 'deduplicated', why: 'the same letter already left' };
  if (r.quiet) {
    if (w.asks_again) {
      return { state: 'quiet', owed: false, asks_again: true,
               why: 'held by the quiet window; the sweep asks again after ' + HUB_QUIET_TO };
    }
    if (!w.facts || typeof w.facts !== 'object') {
      try {
        hubSysLog_('asa-hub:smartgate', 'letter_quiet_not_kept',
                   sit + ' — held by the quiet window with nothing to read it again from; it will not be said',
                   { status: 500 });
      } catch (eL) { /* the answer says it too */ }
      return { state: 'quiet', owed: false,
               why: 'held by the quiet window, and the lane gave nothing to read it again from at 08:00' };
    }
    var owed = false;
    try {
      owed = (typeof hubQuietOwe_ === 'function') &&
             hubQuietOwe_('letter', str_(w.key) || sit, { situation: sit, key: str_(w.key), facts: w.facts },
                          str_(w.owed_at));
    } catch (eO) { owed = false; }
    return { state: 'quiet', owed: !!owed,
             why: owed ? 'held by the quiet window and kept for ' + HUB_QUIET_TO
                       : 'held by the quiet window, and the morning list could NOT keep it' };
  }
  if (r.ok) return { state: 'held', why: str_(r.detail || r.reason) || 'held by a brake' };
  return { state: 'failed', why: str_(r.detail || r.error) || 'the door refused it' };
}

// THE LANE THAT READS A HELD LETTER AGAIN, by situation.
function hubLetterRebuilder_(situation) {
  switch (String(situation || '')) {
    case 'form_answer_notice':
      return (typeof formNoticeRebuild_ === 'function') ? formNoticeRebuild_ : null;
    case 'form_file_stalled':
      return (typeof digestStalledRebuild_ === 'function') ? digestStalledRebuild_ : null;
    case 'suggestion_mailbox_note':
      return (typeof suggestionNoteRebuild_ === 'function') ? suggestionNoteRebuild_ : null;
    default:
      return null;
  }
}

/** Put a letter back on the morning list, keeping the instant it was first held. */
function hubLetterKeep_(d, entry, why) {
  var kept = false;
  try {
    kept = hubQuietOwe_('letter', str_(d.key) || str_(d.situation), d, str_(entry && entry.at));
  } catch (eK) { kept = false; }
  return kept ? { state: 'kept', why: why + ' — kept for the next pass' }
              : { state: 'stale', why: why + ' — and it could not be kept' };
}

// THE MORNING, FOR A LETTER THE QUIET WINDOW HELD (Rpc.gs hubQuietOwedCarry_).
function hubLetterQuietCarry_(data, entry) {
  var d = data || {};
  var sit = String(d.situation || '');
  if (!d.facts || typeof d.facts !== 'object') {
    return { state: 'stale', why: sit + ' carries no facts to read the letter again from' };
  }
  var got = hubSituationRead_(sit);
  if (got.unreadable) return hubLetterKeep_(d, entry, got.unreadable);
  if (got.row && !got.on) return { state: 'stale', why: 'the situation ' + sit + ' was switched off overnight' };
  var rebuild = hubLetterRebuilder_(sit);
  if (!rebuild) return { state: 'stale', why: 'no lane in this build reads ' + sit + ' again' };
  var built = null;
  try { built = rebuild(d.facts) || {}; }
  catch (eB) { built = { unreadable: 'the lane could not read it again (' + String((eB && eB.message) || eB).slice(0, 120) + ')' }; }
  if (built.unreadable) return hubLetterKeep_(d, entry, String(built.unreadable));
  if (!built.letter) return { state: 'stale', why: String(built.stale || 'no longer true') };
  var o = {};
  for (var k in built.letter) if (Object.prototype.hasOwnProperty.call(built.letter, k)) o[k] = built.letter[k];
  o.key = str_(d.key) || str_(o.key);
  o.facts = d.facts;
  o.owed_at = str_(entry && entry.at);
  o.reason_tail = '(held overnight by the quiet window)';
  o.sit_read = { id: sit, row: got.row, on: got.on, unreadable: got.unreadable };
  var said = hubLetterSend_(o);
  if (said.state === 'told' || said.state === 'deduplicated' || said.state === 'held') {
    return { state: 'carried', why: said.state + (said.why ? ': ' + said.why : '') };
  }
  if (said.state === 'unreadable') return hubLetterKeep_(d, entry, said.why);
  if (said.state === 'quiet') {
    return said.owed ? { state: 'kept', why: said.why } : { state: 'stale', why: said.why };
  }
  return { state: 'stale', why: said.state + ': ' + String(said.why || '') };
}
