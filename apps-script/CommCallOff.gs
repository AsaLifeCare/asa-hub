// ------------------------------------------------------------------ COMM CALL OFF — the platform answers the…
// A DSP phones the Employee Support Hotline at six in the morning and says she cannot come in.


// ====================================================================== 1 — THE VOCABULARY, AND THE FOUR ARE NOT…

// THE FIVE SPELLINGS THE BOOKS USE, NORMALISED TO FOUR FACTS.
var COMM_CALLOFF_TYPES = {
  'call off': 'call_off',
  'call-off': 'call_off',
  'calloff': 'call_off',
  'schedule - call off': 'call_off',
  'no show no call': 'no_show',
  'no show / no call': 'no_show',
  'no-show no-call': 'no_show',
  'late show': 'late_show',
  'sent home': 'sent_home'
};

// WHAT EACH FACT DOES TO A PERSON'S DAY, and to this lane.
var COMM_CALLOFF_EFFECT = {
  call_off: { voids: true, holds: true, reach_anyway: false, acknowledge: true,
              tell_others: true, opens_shift: true, tell_directors: true,
              why: 'called off this shift — not getting ready, and not a free line for routine traffic today' },
  sent_home: { voids: false, holds: true, reach_anyway: false, acknowledge: true,
               tell_others: false, opens_shift: false,
               why: 'sent home mid-shift — the pre-shift moment already passed, the day is theirs' },
  no_show: { voids: true, holds: false, reach_anyway: true, acknowledge: true,
             tell_others: true, opens_shift: true,
             why: 'no show, no call — the house is uncovered and we are trying to find them' },
  late_show: { voids: false, holds: false, reach_anyway: false, acknowledge: false,
               tell_others: false, opens_shift: false,
               why: 'late show — they WORKED; this lane says nothing at all' }
};

// One spelling in, one fact out, or '' for a word this platform does not know.
function commCallOffKindOf_(raw) {
  var k = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return COMM_CALLOFF_TYPES[k] || '';
}

// Does this lane owe THIS audience anything for THIS kind?
function commCallOffSpeaksTo_(kind, audience) {
  var eff = COMM_CALLOFF_EFFECT[String(kind || '')];
  if (!eff) return false;
  var who = String(audience);
  if (who === 'subject') return !!eff.acknowledge;
  // THE HOUSE MANAGER OF THE SHIFT, AND THE PEOPLE WHO DECIDE WHO COVERS IT.
  if (who === 'house_manager' || who === 'cover_offer') return !!eff.tell_others;
  // EVERY MEMBER OF STAFF, AND ONLY FOR A HOLE.
  if (who === 'everyone') return !!eff.opens_shift;
  /* THE 5558 GROUP, AND ONLY FOR A REASON SOMEBODY GAVE (tell_directors). */
  if (who === 'directors') return !!eff.tell_directors;
  // `cover` is audience 2 — whoever would COVER the house, resolved from the roster.
  return false;
}


// ====================================================================== 2 — THE DATE, PARSED DEFENSIVELY BECAUSE…

// `date_received` HOLDS THREE SHAPES AT ONCE and a naive parse loses rows.
function commCallOffDate_(raw) {
  var s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return '';
  // A real Date object from a spreadsheet cell — the sheet reader hands these back whenever the column is formatted…
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    var d = raw;
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
           '-' + ('0' + d.getDate()).slice(-2);
  }
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return commCallOffYmd_(iso[1], iso[2], iso[3]);
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) return commCallOffYmd_(us[3], us[1], us[2]);
  // A two-digit year is a shape this column really does carry, and it is the one shape that must not be repaired.
  return '';
}

// Three numbers to one ISO day, or '' when they do not name a real day.
function commCallOffYmd_(y, m, d) {
  var yy = Number(y), mm = Number(m), dd = Number(d);
  if (!yy || !mm || !dd) return '';
  if (yy < 1900 || yy > 2999) return '';
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  var probe = new Date(yy, mm - 1, dd);
  if (probe.getFullYear() !== yy || probe.getMonth() !== mm - 1 || probe.getDate() !== dd) return '';
  return yy + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
}


// ====================================================================== 3 — WHAT MAY TRAVEL: AN ALLOW-LIST, NOT A…

// THE COLUMNS THAT MAY NEVER REACH A MESSAGE — named here so the self-test can hold the list up against what…
var COMM_CALLOFF_NEVER_TRAVELS = [
  // free prose about a person — a phone transcript, or a supervisor writing about somebody's health
  'notes', 'note', 'how_late', 'howlate', 'reported_by', 'reportedby',
  'your_name', 'yourname', 'description_of_request', 'descriptionofrequest',
  'description', 'reason', 'summary', 'response',
  // client identity — seventeen house codes stand 1:1 with seventeen addresses, so a code is an address
  'house', 'house_code', 'housecode', 'house_id', 'houseid', 'house_name',
  'housename', 'location', 'location_code', 'locationcode', 'address',
  'latitude', 'longitude', 'consumers', 'num_consumers', 'client',
  'client_name', 'clientname', 'manager'
];

// THE FACT AND THE CATEGORY, AND THE ROW IS NEVER COPIED.
function commCallOffFacts_(row) {
  var r = row || {};
  var name = String(r.employee_name || r.employee || r.requestor || r.name || '').trim();

  // FIVE FIELDS NOW, AND THE FIFTH IS HOW WE KNOW THE FOURTH.
  var from = String(r.name_from || '').trim();
  if (typeof contactNameFill_ === 'function') {
    var fill = contactNameFill_(name, r.caller_phone || r.requestor_phone || r.phone || '');
    name = fill.name;
    if (!from) from = fill.from;
  } else if (!from && name) {
    from = 'person';
  }

  return {
    kind: commCallOffKindOf_(r.kind || r.type || r.type_of_request || ''),
    date: commCallOffDate_(r.date || r.shift_date || r.date_received || ''),
    name: name,
    name_from: from,
    person_key: (from && typeof clientNameKey_ === 'function') ? clientNameKey_(name) : ''
  };
}

// THE PROOF, FOR ANYBODY WHO DOES NOT BELIEVE THE PARAGRAPH ABOVE.
function commCallOffProseIn_(obj) {
  var hit = [];
  if (!obj) return hit;
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    if (COMM_CALLOFF_NEVER_TRAVELS.indexOf(String(k).toLowerCase()) !== -1) hit.push(String(k));
  }
  return hit;
}


// ====================================================================== 4 — THE AUDIENCES, AND THE ONE THAT IS…

// Both purposes are ALREADY employment purposes (CommConsent.gs COMM_EMPLOYMENT_PURPOSES), which is why neither is…
var COMM_CALLOFF_SUBJECT_PURPOSE = 'shift';
var COMM_CALLOFF_OFFER_PURPOSE = 'roster';

// The words each audience travels in.
var COMM_CALLOFF_SUBJECT_SITUATION = 'call_off_acknowledged';
var COMM_CALLOFF_OFFER_SITUATION = 'call_off_cover_offer';
// The two that were named as required, and they now have a sender.
var COMM_CALLOFF_MANAGER_SITUATION = 'call_off_house_manager';
var COMM_CALLOFF_EVERYONE_SITUATION = 'call_off_everyone';
/** The reason, to the 5558 group alone (commCallOffTellDirectors_). */
var COMM_CALLOFF_DIRECTORS_SITUATION = 'call_off_reason_directors';

// At most this many earlier, still-owed acknowledgements are carried forward by one recording execution.
var COMM_CALLOFF_CARRY_MAX = 3;

// IS THE PURPOSE DECLARED?
function commCallOffPurposeOk_(purpose) {
  try {
    return (typeof COMM_EMPLOYMENT_PURPOSES !== 'undefined') &&
           COMM_EMPLOYMENT_PURPOSES.indexOf(String(purpose)) !== -1;
  } catch (e) { return false; }
}

// AUDIENCE 1 — CAN THE PERSON WHO CALLED OFF STILL BE SAID TO BE UNREACHED?
function commCallOffSubjectIsUnreached_() {
  try {
    if (typeof SMART_EVENTS === 'undefined') return { ok: false,
      why: 'the situation catalogue could not be read, so it cannot be shown that nothing ' +
           'else already reaches the caller — silence is the only safe answer' };
    var def = SMART_EVENTS.hotline_call_off;
    if (!def) return { ok: true,
      why: 'the hotline situation does not exist in this build, so nothing there can address the caller' };
    if (def.to_subject) return { ok: false,
      why: 'SMART_EVENTS.hotline_call_off now carries to_subject — the hotline lane can address ' +
           'the caller itself, and a second acknowledgement would be the duplication this lane exists ' +
           'to prevent. Nothing was said.' };
    return { ok: true,
      why: 'SMART_EVENTS.hotline_call_off carries no to_subject, so its sweep can only address a ' +
           'team — the caller is reached by nothing on this platform' };
  } catch (e) {
    return { ok: false, why: 'the situation catalogue threw while being read — nothing was said' };
  }
}

// AUDIENCE 2 — WHOEVER COVERS THE HOUSE.
function commCallOffCoverVerdict_(facts) {
  return {
    send: false,
    audience: 'cover',
    rung_if_ever: 'repair',
    why: 'REFUSED BY DESIGN. The hotline\'s Call Off Processor already texts the House Lead, and ' +
         'nothing the rest of the platform can read says whether THIS lead was told about THIS ' +
         'call-off' + (facts && facts.name ? ' (' + String(facts.name) + ')' : '') +
         (facts && facts.date ? ' on ' + String(facts.date) : '') +
         '. The queue\'s `processed` cell says a row was acted on, not who was told; the ' +
         'processor\'s own audit log is a book this workbook does not own and is not registered ' +
         'in asa_sheet_tables; `staff_alerts` records the mailbox lane and the Late Show ' +
         'recipient list, not this lead and not this absence. An unprovable "probably not sent" ' +
         'is how somebody gets two texts about one absence, so this audience is refused ' +
         'entirely rather than guessed at.',
    lifts_when: 'A per-call-off record of the hotline\'s own send — recipient, time and receipt, ' +
                'keyed by the same call id this lane uses — is readable by the platform (a ' +
                'registered mirror, or a tab in this workbook). Then this becomes a lookup ' +
                'instead of a guess, and the rung argued above applies.'
  };
}

// AUDIENCE 3 — THE HOUSE MANAGER ON THE CALENDAR.
function commCallOffHouseManagerAudience_(queued) {
  var out = { ok: false, name: '', phone: '', why: '' };
  var cell = String((queued && (queued.manager || queued.house_manager)) || '').trim();
  if (!cell) {
    out.why = 'the call-off row names no house manager — the location did not resolve to one, ' +
              'and a message to nobody in particular is not a message';
    return out;
  }
  var digits = cell.replace(/\D/g, '');
  out.name = cell.replace(/\+?\d[\d\s().-]{6,}\d/g, '').trim();
  out.phone = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(digits) : '';
  if (!out.phone) {
    out.why = 'the house manager is named (' + (out.name || cell.slice(0, 40)) +
              ') and carries no number we may text';
    return out;
  }
  out.ok = true;
  out.why = 'the manager the hotline resolved for this shift, from the queued call-off row';
  return out;
}

/** Who is on scheduled time off on one day, asked of the relay; unreadable is said, never an empty list. */
function commCallOffAway_(day) {
  var out = { asked: false, readable: true, keys: {}, why: '' };
  var d = String(day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || typeof staffRelayPost_ !== 'function') return out;
  out.asked = true;
  var r = null;
  // FAIL-OPEN: the blast still goes, and `missing` says who could not be left out
  try { r = staffRelayPost_('/erp-lanes/time-off/away', { from: d, to: d }); } catch (e) { r = null; }
  if (!r || r.status !== 200 || !r.data || !r.data.readable) {
    out.readable = false;
    out.why = String((r && r.message) || 'no answer');
    return out;
  }
  (r.data.keys || []).forEach(function (k) { out.keys[String(k)] = true; });
  return out;
}

// AUDIENCE 4 — EVERY ACTIVE MEMBER OF STAFF.
function commCallOffEveryoneAudience_(facts) {
  // `readable` AND `ok` ARE NOT THE SAME QUESTION, and the difference is the one that matters to whoever is about…
  var out = { ok: false, readable: false, people: [], why: '', missing: '',
              counted: { rows: 0, active: 0, no_phone: 0, refused: 0 } };
  out.missing = 'a readable roster — who is already ON SHIFT today is not knowable from here, ' +
                'so this list can include somebody who is at work right now';
  var rows = null;
  try {
    rows = withoutIspClients_(peopleMerged_(listRows_('people', {})));
  } catch (e) { rows = null; }
  if (!rows) {
    out.why = 'the People house could not be read at all — NOBODY was resolved, which is a ' +
              'refusal and not an empty company';
    return out;
  }
  out.readable = true;
  var onStaff = {};
  try {
    onStaff = (typeof cgBlockStatuses_ === 'function') ? cgBlockStatuses_() : {};
  } catch (eS) { onStaff = {}; }
  if (!Object.keys(onStaff).length) onStaff = { active: true, admin: true };

  var skip = String((facts && facts.person_key) || '');
  // HER HANDSET, FOUND BEFORE THE AUDIENCE IS BUILT.
  var skipNums = {};
  var noteSkip = function (v) {
    var key = commCallOffAddressKey_(v);
    if (key && String(key).length >= 10) skipNums[key] = true;
  };
  if (skip) {
    rows.forEach(function (p) {
      var pk = (typeof clientNameKey_ === 'function') ? clientNameKey_(p && p.name) : '';
      if (pk !== skip) return;
      var mine = (typeof packetSendableNumber_ === 'function')
        ? packetSendableNumber_(p && p.phone) : '';
      noteSkip(mine || (p && p.phone) || '');
    });
  }
  var seen = {};
  out.counted.rows = rows.length;
  out.counted.her_number = 0;
  out.counted.time_off = 0;
  var away = commCallOffAway_(facts && facts.date);
  if (away.asked && !away.readable) {
    out.missing += ' · who is on approved time off could not be read (' + away.why + '), so this list ' +
                   'can include somebody who is off that day';
  }
  rows.forEach(function (p) {
    if (!onStaff[String((p && p.status) || '').trim().toLowerCase()]) return;
    out.counted.active++;
    var k = (typeof clientNameKey_ === 'function') ? clientNameKey_(p && p.name) : '';
    if (!k || seen[k]) return;
    if (k === skip) return;                       // never the person who called off
    if (away.keys[k]) { out.counted.time_off++; return; }
    var phone = (typeof packetSendableNumber_ === 'function')
      ? packetSendableNumber_(p && p.phone) : String((p && p.phone) || '');
    if (!phone) { out.counted.no_phone++; return; }
    /* AND NEVER HER HANDSET UNDER SOMEBODY ELSE'S NAME. */
    if (skipNums[commCallOffAddressKey_(phone)]) { out.counted.her_number++; return; }
    var blocked = false;
    try { blocked = (typeof optOutBlocked_ === 'function') && optOutBlocked_(phone); }
    catch (eO) { blocked = true; }                // an unreadable list reads as a refusal
    if (blocked) { out.counted.refused++; return; }
    seen[k] = true;
    out.people.push({ person_key: k, name: String((p && p.name) || ''), phone: phone });
  });
  out.ok = out.people.length > 0;
  out.why = out.people.length + ' of ' + out.counted.active + ' people on staff can be texted' +
            (skip ? ', without the person who called off' : '') +
            ' (' + out.counted.no_phone + ' carry no number we may text, ' +
            out.counted.refused + ' have opted out' +
            (out.counted.time_off ? ', ' + out.counted.time_off + ' are on approved time off that day' : '') +
            (out.counted.her_number
              ? ', ' + out.counted.her_number + ' share the caller\'s own phone and are refused ' +
                'by NUMBER — that handset is hers and is never asked to cover her shift'
              : '') +
            '). "On staff" is the `status` column, read ' +
            'with the same allow-list the contact guard uses; being on staff is not the same ' +
            'as being free today.';
  return out;
}

// AUDIENCE 5 — THE HOUSE MANAGERS, ALL OF THEM.
function commCallOffHouseManagersAudience_() {
  var out = { ok: false, readable: false, people: [], why: '', missing: '',
              counted: { rows: 0, named: 0, no_phone: 0 } };
  out.missing = 'a house manager whose calendar row carries no number we may text is not in ' +
                'this list — the Desk counts phones, not names';
  var got = null;
  try {
    got = (typeof hotlineHouseManagers_ === 'function') ? hotlineHouseManagers_() : null;
  } catch (e) { got = null; }
  if (!got || !got.readable) {
    out.why = 'the hotline calendar could not be read, so the house managers were NOT resolved — ' +
              'that is "we cannot see", never "there are none"' +
              (got && got.why ? ': ' + String(got.why) : '');
    return out;
  }
  out.readable = true;
  out.counted.rows = Number(got.rows) || 0;
  var seen = {};
  (got.people || []).forEach(function (p) {
    var name = String((p && p.name) || '').trim();
    out.counted.named++;
    var phone = (typeof packetTeamCopyNumber_ === 'function')
      ? packetTeamCopyNumber_(String((p && p.phone) || '')) : String((p && p.phone) || '');
    if (!phone) { out.counted.no_phone++; return; }
    var k = phone.replace(/\D/g, '').slice(-10);
    if (!k || seen[k]) return;
    seen[k] = true;
    out.people.push({ person_key: '', name: name, phone: phone });
  });
  out.ok = out.people.length > 0;
  out.why = out.people.length + ' house manager(s) on the hotline calendar carry a number we may ' +
            'text, out of ' + out.counted.named + ' named on ' + out.counted.rows + ' row(s)' +
            (out.counted.no_phone ? ' (' + out.counted.no_phone + ' carry none)' : '');
  return out;
}

// THE `directors` KEYWORD — the 5558 group, the directors and the people responsible, on one shared line.
function commCallOffDirectorsAudience_() {
  var d = '';
  try {
    d = (typeof COMMS_OPERATOR_LINE_DIGITS !== 'undefined')
      ? String(COMMS_OPERATOR_LINE_DIGITS).replace(/\D/g, '').slice(-10) : '';
  } catch (e) { d = ''; }
  if (d.length !== 10) {
    return { ok: false, readable: false, people: [], missing: '',
             why: 'the 5558 group line is not declared in this build' };
  }
  return { ok: true, readable: true, missing: '',
           people: [{ person_key: '', name: 'the 5558 group', phone: '+1' + d }],
           why: 'one shared line: the 5558 group, the directors and the people responsible' };
}

// AUDIENCE 3, REFUSAL ONE — NEVER ASK SOMEBODY WHO IS OFF THAT DAY.
function commCallOffWorkingThatDay_(shifts, dayIso) {
  var day = String(dayIso || '');
  if (!day) return false;
  var rows = shifts || [];
  for (var i = 0; i < rows.length; i++) {
    if (commCallOffDate_((rows[i] || {}).date) !== day) continue;
    var who = String((rows[i] || {}).staff || '').trim().toUpperCase();
    // OPEN is an unfilled shift and WORKSHOP is not a person — the same two the IST reader drops, and for the same…
    if (who === 'OPEN' || who.indexOf('WORKSHOP') !== -1) continue;
    return true;
  }
  return false;
}

// AUDIENCE 3, REFUSAL TWO — NEVER ASK SOMEBODY INSIDE THEIR OWN PRE-SHIFT WINDOW.
var COMM_CALLOFF_PRESHIFT_MIN = 30;

function commCallOffPreShiftSetting_() {
  var floor = COMM_CALLOFF_PRESHIFT_MIN;
  try {
    if (typeof digestSetting_ === 'function') {
      return Number(digestSetting_('comm_call_off_preshift_min', floor, 0, 720));
    }
  } catch (e) { /* the floor is the answer */ }
  return Number(floor);
}

function commCallOffInsidePreShift_(nowMs, shiftStartMs) {
  var start = Number(shiftStartMs);
  var now = Number(nowMs);
  if (!start || !now || isNaN(start) || isNaN(now)) return null;   // unproven, not permitted
  var width = commCallOffPreShiftSetting_() * 60000;
  if (now > start) return null;                                     // the shift has begun
  if (start - now > width) return null;                             // still far off
  return { ok: false,
           why: 'inside their own pre-shift window — that window belongs to the shift they ' +
                'already have, and it is the only reason this platform may reach anybody at ' +
                'this hour at all' };
}

// WHO COULD BE ASKED — AND TODAY, NOBODY, WITH THE REASON SAID OUT LOUD.
function commCallOffCoverCandidates_(facts, nowMs) {
  var out = { ok: false, why: '', candidates: [], refused: [], roster_rows: 0 };
  var rows = null;
  try { rows = listRows_('shifts', {}); } catch (e) { rows = null; }
  if (rows === null) {
    out.why = 'the roster could not be read at all — nobody was asked. A read that failed is not ' +
              'a house with nobody in it.';
    return out;
  }
  out.roster_rows = rows.length;
  if (!rows.length) {
    out.why = 'the roster is not readable from here: the `shifts` tab in this workbook is empty by ' +
              'design, because the real roster lives in Postgres and reaches the browser as a live ' +
              'slice this backend cannot read back. NOBODY was asked, and that is a refusal rather ' +
              'than a finding — an empty list here would read as "nobody could cover it", which is a ' +
              'claim about seventeen houses full of people that this lane has no way to make.';
    return out;
  }

  /* From here down is the design, running on whatever the roster answered. */
  var byPerson = {};
  rows.forEach(function (s) {
    var key = (typeof clientNameKey_ === 'function') ? clientNameKey_((s || {}).staff) : '';
    if (!key) return;
    if (!byPerson[key]) byPerson[key] = { key: key, name: String((s || {}).staff || ''), rows: [] };
    byPerson[key].rows.push(s);
  });

  var day = String((facts && facts.date) || '');
  Object.keys(byPerson).forEach(function (key) {
    var person = byPerson[key];
    // NEVER THE PERSON WHO CALLED OFF.
    if (key === String((facts && facts.person_key) || '')) {
      out.refused.push({ person_key: key, why: 'this is the person who called off' });
      return;
    }
    if (!commCallOffWorkingThatDay_(person.rows, day)) {
      out.refused.push({ person_key: key,
                         why: 'off that day themselves — a day off is not spare capacity' });
      return;
    }
    var pre = null;
    for (var i = 0; i < person.rows.length; i++) {
      var startMs = Date.parse(String((person.rows[i] || {}).startsAt || ''));
      var verdict = isNaN(startMs) ? null : commCallOffInsidePreShift_(nowMs, startMs);
      if (verdict) { pre = verdict; break; }
    }
    if (pre) { out.refused.push({ person_key: key, why: pre.why }); return; }
    out.candidates.push({ person_key: key, name: person.name });
  });
  out.ok = true;
  out.why = out.candidates.length
    ? out.candidates.length + ' could be asked; ' + out.refused.length + ' were refused by the lane\'s own rules'
    : 'the roster answered and nobody on it passed both refusals';
  return out;
}


// ====================================================================== 5 — THE MARK: ONCE PER PERSON PER…

var COMM_CALLOFF_HOUSE = 'comm_call_offs';
// `subject_state` is the PRODUCTION memory and `test_state` is the rehearsal's own, kept apart for the reason…
var COMM_CALLOFF_HEADER = ['id', 'instance', 'person_key', 'person_name', 'name_from',
                           'kind', 'shift_date',
                           'source', 'recorded_at', 'subject_state', 'subject_at',
                           'subject_channel', 'subject_receipt', 'subject_why',
                           'cover_state', 'cover_why', 'offer_state', 'offer_why',
                           'test_state', 'test_mode',
                           'manager_state', 'manager_at', 'manager_why', 'manager_test_state',
                           'everyone_state', 'everyone_at', 'everyone_why', 'everyone_count',
                           'everyone_test_state',
                           'offer_send_state', 'offer_send_at', 'offer_send_why',
                           'offer_send_test_state',
                           'directors_state', 'directors_at', 'directors_why',
                           'directors_test_state',
                           /* who the URGENT OPEN SHIFT reached; the "covered" follow-up reuses it */
                           'everyone_audience',
                           'covered_state', 'covered_at', 'covered_why', 'covered_count',
                           'covered_test_state', 'covered_filled_at',
                           'createdAt', 'updatedAt'];

// WHICH CELL REMEMBERS WHICH AUDIENCE, and the rehearsal's own cell beside it.
var COMM_CALLOFF_STATE_COLS = {
  subject: { prod: 'subject_state', test: 'test_state', at: 'subject_at', why: 'subject_why' },
  house_manager: { prod: 'manager_state', test: 'manager_test_state', at: 'manager_at', why: 'manager_why' },
  everyone: { prod: 'everyone_state', test: 'everyone_test_state', at: 'everyone_at', why: 'everyone_why' },
  cover_offer: { prod: 'offer_send_state', test: 'offer_send_test_state', at: 'offer_send_at', why: 'offer_send_why' },
  directors: { prod: 'directors_state', test: 'directors_test_state', at: 'directors_at', why: 'directors_why' },
  /* its own cell, so it never shares the blast's turn */
  covered: { prod: 'covered_state', test: 'covered_test_state', at: 'covered_at', why: 'covered_why' }
};

/** The blast's audience as one cell — { day, house, to }; the follow-up reaches exactly these. */
function commCallOffAudienceCell_(entries, day, house) {
  var to = [];
  (entries || []).forEach(function (e) {
    var addr = String((e && e.to) || '').trim();
    if (addr) to.push([addr, String((e && e.name) || '').trim()]);
  });
  try {
    return JSON.stringify({ day: String(day || ''), house: String(house || ''), to: to });
  } catch (e) { return ''; }
}

/** The cell read back; a blank cell answers readable=false. */
function commCallOffAudienceRead_(cell) {
  var out = { day: '', house: '', to: [], readable: false };
  var raw = String(cell == null ? '' : cell).trim();
  if (!raw) return out;
  var got = null;
  try { got = JSON.parse(raw); } catch (e) { return out; }
  if (!got || typeof got !== 'object') return out;
  out.day = /^\d{4}-\d{2}-\d{2}$/.test(String(got.day || '')) ? String(got.day) : '';
  out.house = String(got.house || '');
  (Array.isArray(got.to) ? got.to : []).forEach(function (pair) {
    var addr = String((Array.isArray(pair) ? pair[0] : (pair && pair.to)) || '').trim();
    if (!addr) return;
    out.to.push({ to: addr, name: String((Array.isArray(pair) ? pair[1] : (pair && pair.name)) || '').trim() });
  });
  out.readable = true;
  return out;
}

/** The house, made through the one door like every other tab in this backend. */
function commCallOffSheet_() {
  var existed = !!hubTabSheet_(COMM_CALLOFF_HOUSE);
  var sheet = hubTabEnsure_(COMM_CALLOFF_HOUSE, COMM_CALLOFF_HEADER);
  // A house written before a column existed is WIDENED, never re-stamped — ensureHeader_ appends and never inserts…
  if (existed) ensureHeader_(sheet, COMM_CALLOFF_HEADER);
  else commCallOffDayColumnsAsText_(sheet);
  return sheet;
}

// THE DAY AND THE INSTANT ARE TEXT IN A NEW HOUSE, as CommWhen and CommCalls keep theirs: a "yyyy-MM-dd" left to…
function commCallOffDayColumnsAsText_(sheet) {
  try {
    // A house with a single row written is not new, whatever the caller thought.
    if (sheet.getLastRow() > 1) return;
    var rows = Math.max(1, sheet.getMaxRows() - 1);
    ['shift_date', 'recorded_at'].forEach(function (col) {
      var at = COMM_CALLOFF_HEADER.indexOf(col);
      if (at !== -1) sheet.getRange(2, at + 1, rows, 1).setNumberFormat('@');
    });
  } catch (e) { /* the runtime's shim has no grid; the readers normalise */ }
}

// One row per (call-off, person).
function commCallOffRowId_(instance, personKey) {
  return 'COF_' + commRecordId_(String(instance || '') + '|' +
                                String(personKey || '').trim().toLowerCase());
}

// The rows, by id.
function commCallOffRows_() {
  var out = {};
  try {
    commBoardRows_(COMM_CALLOFF_HOUSE).forEach(function (r) {
      var id = String(r.id || '');
      if (id) out[id] = r;
    });
  } catch (e) { /* a first pass has nothing to remember */ }
  return out;
}

// THE CLAIM — a compare-and-set on the person's row, under the script lock, taken BEFORE a word is rendered or sent.
function commCallOffClaim_(rowId, test, nowIso, audience) {
  var cols = COMM_CALLOFF_STATE_COLS[String(audience || 'subject')] ||
             COMM_CALLOFF_STATE_COLS.subject;
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (eL) { lock = null; }
  if (!lock) return false;       // no lock, no claim — sending on the assumption
                                 // that nobody else is running is the assumption this whole section exists to refuse
  try { if (!lock.tryLock(20000)) return false; } catch (eT) { return false; }
  try {
    var rows = commCallOffRows_();
    var row = rows[rowId];
    if (!row) return false;                       // nothing recorded for this person
    var col = test ? cols.test : cols.prod;
    var state = String(row[col] || '');
    // ONLY THESE STATES MAY BE CLAIMED, and they are named rather than excluded: a blank row nobody has touched, a…
    if (state !== '' && state !== 'planned' && state !== 'deferred' &&
        state !== 'recorded') return false;
    var next = { id: rowId };
    next[col] = 'claimed';
    next.test_mode = test ? 'yes' : 'no';
    // THE STAMP BELONGS TO THE AUDIENCE THAT WAS CLAIMED.
    if (!test) next[cols.at] = String(nowIso || new Date().toISOString());
    try { commRecordUpsert_(COMM_CALLOFF_HOUSE, next); return true; }
    catch (e) { return false; }
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* the execution ending releases it */ }
  }
}


// ====================================================================== 6 — THE EVENT: IT SPEAKS INSIDE THE WRITE…

// EVERYTHING ONE EXECUTION NEEDS IN ORDER TO SPEAK, READ ONCE.
function commCallOffContext_() {
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var ctx = {
    now: now, nowIso: now.toISOString(), nowMs: now.getTime(),
    localHour: Number(Utilities.formatDate(now, tz, 'H')),
    localDay: Number(Utilities.formatDate(now, tz, 'u')) % 7,   // Sunday = 0
    people: (typeof commRecordPeople_ === 'function') ? commRecordPeople_() : {},
    routes: (typeof commRecordRoutes_ === 'function') ? commRecordRoutes_() : {},
    consent: (typeof commRecordConsentRows_ === 'function') ? commRecordConsentRows_() : {},
    test: (typeof commTestMode_ === 'function') ? commTestMode_() : false,
    dial: (typeof commDial_ === 'function') ? commDial_() : 'off',
    purposeOk: commCallOffPurposeOk_(COMM_CALLOFF_SUBJECT_PURPOSE),
    unreached: commCallOffSubjectIsUnreached_()
  };
  ctx.hoursOk = (typeof commPolicy_ === 'function');
  ctx.quiet = ctx.hoursOk ? { from: commPolicy_('quiet_from'), to: commPolicy_('quiet_to') } : {};
  ctx.canSay = ctx.hoursOk && (typeof commRecordSend_ === 'function');
  ctx.situation = commCallOffSituation_(COMM_CALLOFF_SUBJECT_SITUATION);
  ctx.channels = (ctx.situation && typeof commRecordChannels_ === 'function')
    ? commRecordChannels_(ctx.situation) : ['sms', 'email'];
  return ctx;
}

// The words, from the catalogue, or null.
function commCallOffSituation_(id) {
  try {
    return (typeof smartSituationOn_ === 'function') ? smartSituationOn_(id) : null;
  } catch (e) { return null; }
}

// The thread, as the three fields every house in this lane reads, so an acknowledgement rides the evidence house…
function commCallOffLight_(facts, instance) {
  return {
    intent_key: 'CO|' + String(instance || '') + '|' + String(facts.person_key || ''),
    person_key: String(facts.person_key || ''),
    person_name: String(facts.name || ''),
    purpose: COMM_CALLOFF_SUBJECT_PURPOSE,
    bindings: []
  };
}

// THE SHAPE THE TRANSPORT ALREADY KNOWS, BUILT FROM THE FACTS AND NEVER FROM THE ROW.
function commCallOffItem_(facts, situation, person, instance) {
  return {
    situation: String((situation && situation.id) || ''),
    key: 'CO|' + String(instance || '') + '|' + String(facts.person_key || ''),
    name: String(facts.name || ''),
    name_key: String(facts.person_key || ''),
    phone: String((person && person.phone) || ''),
    email: String((person && person.email) || ''),
    credential: String((situation && situation.credential) || ''),
    expires: String(facts.date || ''),
    days_left: '',
    channels: (situation && situation.channels && situation.channels.length)
      ? situation.channels : ['sms', 'email'],
    rehearsal: false, rehearsed: false,
    config: situation,
    correction: '',
    intent_key: 'CO|' + String(instance || '') + '|' + String(facts.person_key || ''),
    bindings: [], binding_count: 0, raw_bindings: []
  };
}

// MAY WE SPEAK TO THIS PERSON, NOW?
function commCallOffVerdict_(light, ctx) {
  if (typeof commPlanVerdict_ !== 'function') {
    return { send: false, defer: true, policy: 'blocked',
             reasons: ['the priority ladder could not be asked — nothing is said without it'] };
  }
  var narrowed = null;
  try {
    narrowed = (typeof commCortexWindowFrom_ === 'function')
      ? commCortexWindowFrom_(ctx.routes[light.person_key] || null, ctx.quiet.from, ctx.quiet.to,
                              light.person_key)
      : null;
  } catch (e) { narrowed = null; }
  return commPlanVerdict_(light, {
    priority_id: COMM_CALLOFF_SUBJECT_SITUATION,
    situation: COMM_CALLOFF_SUBJECT_SITUATION,
    attempts: 0, lastAskedMs: 0, nowMs: ctx.nowMs,
    localHour: ctx.localHour, localDay: ctx.localDay,
    test: ctx.test, quiet: narrowed
  });
}

// Can this person be reached at all, and by which channel?
function commCallOffReachable_(personKey, ctx) {
  var person = (typeof commRecordContact_ === 'function')
    ? commRecordContact_(ctx.people, ctx.routes, personKey) : null;
  if (!person || (!person.phone && !person.email)) {
    return { ok: false, why: 'no contact in the People house — a person has to find them' };
  }
  var refused = (typeof commRecordRefused_ === 'function') ? commRecordRefused_(person) : {};
  var route = (typeof commRouteFor_ === 'function')
    ? commRouteFor_((ctx.consent || {})[String(personKey || '').trim().toLowerCase()] || [],
                    refused, COMM_CALLOFF_SUBJECT_PURPOSE, ctx.channels, ctx.nowMs)
    : { ok: false, why: 'no consent reader' };
  if (!route.ok) return { ok: false, person: person, why: route.why };
  return { ok: true, person: person, channel: route.channel, why: route.why };
}

// AND THEN IT IS SAID — through the lane's one door, and written down three times because three different readers…
function commCallOffSay_(facts, instance, situation, person, route, ctx) {
  var light = commCallOffLight_(facts, instance);
  var item = commCallOffItem_(facts, situation, person, instance);
  var out;
  try {
    out = commRecordSend_(item, situation, person, route, 0, function () { return ''; });
  } catch (eS) {
    // A THROW IS A DOUBT: the provider may have taken it before the failure, and the one thing this must never do…
    out = { sent: false, gated: false, doubt: true, redirected: false,
            channel: String((route && route.channel) || ''), receipt: '',
            error: 'threw: ' + String((eS && eS.message) || eS) };
  }
  try { out.attempt_id = commRecordAttempt_(light, 1, out, ctx.test, ctx.nowIso); }
  catch (eA) { out.attempt_id = ''; }
  try {
    commObserve_(out.sent ? (out.redirected ? 'redirected' : 'sent')
                          : (out.doubt ? 'doubt' : 'held'),
                 light, { attempt: 1, attempt_id: out.attempt_id, channel: out.channel,
                          receipt: out.receipt, error: out.error,
                          kind: String(facts.kind || ''), shift_date: String(facts.date || ''),
                          purpose: COMM_CALLOFF_SUBJECT_PURPOSE, test_mode: !!ctx.test },
                 'call_off');
  } catch (eO) { /* the row carries the ending either way */ }
  if (out.sent) {
    try {
      if (typeof smartRecord_ === 'function') {
        var ledgerKey = (out.redirected && typeof smartRehearsalKey_ === 'function')
          ? smartRehearsalKey_(item.key) : item.key;
        smartRecord_(ledgerKey, String(situation.id || ''), item.name, String(facts.date || ''),
                     out.redirected ? 'rehearsal' : out.channel);
      }
    } catch (eL) { /* recorded on the row either way */ }
  }
  return out;
}

// ONE CALL-OFF, ANSWERED — the whole of audience 1 for one person, in the execution that recorded it.
function commCallOffAckRehearse_(res, facts, instance, ctx, reach, held) {
  if (typeof hubRehearsalHeld_ !== 'function' || !ctx.situation) return 0;
  var person = (reach && reach.person) || {};
  var channel = String((reach && reach.channel) || '');
  var to = channel === 'email' ? String(person.email || '') : String(person.phone || '');
  if (!to) return 0;
  var item = commCallOffItem_(facts, ctx.situation, person, instance);
  var vars = {};
  try {
    vars = (typeof commDispatchVars_ === 'function')
      ? commDispatchVars_(item, ctx.situation, function () { return ''; }) : {};
  } catch (eV) { vars = {}; }
  var isMail = channel === 'email';
  if (isMail && !String(ctx.situation.email_subject || '').trim()) return 0;
  if (!isMail && !String(ctx.situation.sms_text || '').trim()) return 0;
  try {
    hubRehearsalHeld_({
      channel: channel || 'sms',
      to: to,
      situation: String(ctx.situation.id || ''),
      intent_key: String(item.intent_key || item.key || ''),
      person_key: String(facts.person_key || ''),
      person_name: String(facts.name || ''),
      purpose: COMM_CALLOFF_SUBJECT_PURPOSE,
      sender_used: String(vars.sender || ''),
      verdict: String(res.state || ''),
      // THE ROW SAYS WHICH BRAKE HELD IT, AND SAYS BOTH WHEN BOTH DID.
      reasons: String(res.why || '') + (held ? (res.why ? ' · ' : '') + String(held) : ''),
      subject: isMail ? smartRender_(ctx.situation.email_subject, vars) : '',
      body: isMail ? smartRender_(ctx.situation.email_text || ctx.situation.sms_text, vars)
                   : smartRender_(ctx.situation.sms_text, vars),
      reason: 'call off: ' + String(ctx.situation.id || ''),
      pass_by: 'asa-hub:comm-call-off'
    });
    return 1;
  } catch (eB) { return 0; }
}

function commCallOffSpeakOne_(rowId, facts, instance, ctx) {
  var res = { id: rowId, said: false, state: 'held', why: '' };

  // THE KIND DECIDES FIRST, BEFORE ANY CONTACT IS EVEN LOOKED UP.
  if (!commCallOffSpeaksTo_(facts.kind, 'subject')) {
    res.state = 'not_owed';
    res.why = facts.kind
      ? (COMM_CALLOFF_EFFECT[facts.kind] || {}).why || 'this kind is owed nothing'
      : 'the type of day could not be recognised — nothing is said about a day we cannot name';
    return res;
  }
  // IS ANYBODY ELSE ALREADY SPEAKING TO THIS PERSON?
  if (!ctx.unreached.ok) { res.state = 'held'; res.why = ctx.unreached.why; return res; }
  if (!ctx.purposeOk) {
    res.state = 'held';
    res.why = COMM_CALLOFF_SUBJECT_PURPOSE + ' is not in COMM_EMPLOYMENT_PURPOSES — every person ' +
              'without an explicit consent row would be judged unreachable for a missing string';
    return res;
  }
  if (!ctx.canSay) { res.state = 'held'; res.why = 'the policy file or the send door is absent'; return res; }
  if (!ctx.situation) {
    res.state = 'held';
    res.why = 'the situation `' + COMM_CALLOFF_SUBJECT_SITUATION + '` is absent, switched off, or ' +
              'still has no words — a message with no words waits for somebody to write them';
    return res;
  }
  if (!facts.person_key) { res.state = 'held'; res.why = 'the row names nobody this lane can key'; return res; }

  // A NAME THE CALLER ID SUPPLIED IS A CANDIDATE, AND A CANDIDATE IS NOT WHO TO TEXT.
  if (String(facts.name_from || '') === 'phone') {
    res.state = 'held';
    res.why = 'who this was came from the caller ID, not from anybody saying it — the call-off is ' +
              'on the row and nothing is said to somebody we only think it was';
    return res;
  }

  var reach = commCallOffReachable_(facts.person_key, ctx);
  if (!reach.ok) { res.state = 'held'; res.why = reach.why; return res; }
  // THE ADDRESS THIS LEG RESOLVED, CARRIED OUT OF THE FUNCTION — not to be rendered anywhere and never written to a…
  res.to_key = commCallOffAddressKey_(
    String((reach.person && (reach.person.phone || reach.person.email)) || ''));

  var light = commCallOffLight_(facts, instance);
  var verdict = commCallOffVerdict_(light, ctx);
  if (!verdict.send) {
    // A QUIET HOUR DEFERS AND IS NOT A FAILURE, and the distinction is what makes the carry-forward in section 7…
    var ackDial = commCallOffDialWord_(ctx);
    res.state = verdict.defer ? 'deferred'
                              : (commDialHandsOver_(ackDial) ? 'held' : 'recorded');
    res.why = (verdict.reasons || []).join(' · ');
    // AND IT IS WRITTEN DOWN, WHICH IT WAS NOT.
    var ackPatch = { id: rowId,
                     subject_why: String(res.why || '').slice(0, COMM_CALLOFF_WHY_MAX),
                     subject_at: ctx.nowIso };
    if (res.state === 'deferred' || res.state === 'recorded') ackPatch.subject_state = res.state;
    try { commRecordUpsert_(COMM_CALLOFF_HOUSE, ackPatch); } catch (eD) { /* the value stands */ }
    // AND THE WORDS SHE WOULD HAVE READ GO INTO THE REHEARSAL BOOK, for the same reason the other three legs write…
    if (!commDialHandsOver_(ackDial)) {
      res.rehearsal_rows = commCallOffAckRehearse_(res, facts, instance, ctx, reach,
        (typeof commDialHeldWhy_ === 'function'
          ? commDialHeldWhy_(ackDial, 1, 'the person who called off')
          : 'the sending dial stands at `' + ackDial + '`, not `send`: NOBODY WAS CONTACTED') +
        (verdict.defer
          ? ' · AND THE QUIET HOURS DEFERRED IT TOO: the day the dial hands over, these words ' +
            'wait for the window to open and the next call-off carries them'
          : ''));
    }
    return res;
  }

  /* CLAIM FIRST, THEN SPEAK. Nothing is rendered before the claim is taken. */
  if (!commCallOffClaim_(rowId, ctx.test, ctx.nowIso)) {
    res.state = 'already';
    res.why = 'already claimed or told — one acknowledgement per person per call-off';
    return res;
  }

  var out = commCallOffSay_(facts, instance, ctx.situation, reach.person,
                            { channel: reach.channel }, ctx);
  res.said = !!out.sent;
  res.channel = String(out.channel || '');
  res.redirected = !!out.redirected;
  if (out.sent && !out.redirected) { res.state = 'told'; res.why = 'answered on ' + res.channel; }
  else if (out.sent && out.redirected) { res.state = 'rehearsed'; res.why = 'test mode — the testers heard it, the person is still owed'; }
  else if (out.doubt) { res.state = 'doubt'; res.why = 'the transport may have taken it: ' + String(out.error || ''); }
  else { res.state = 'held'; res.why = String(out.error || 'the send door refused'); }

  // THE STATE BELONGS TO THE MEMORY THE CLAIM WAS TAKEN IN — this line is past the claim, so test mode means a…
  var patch = { id: rowId };
  if (ctx.test) patch.test_state = res.state === 'rehearsed' ? 'told' : res.state;
  else patch.subject_state = res.state;
  patch.subject_channel = res.channel;
  patch.subject_receipt = String(out.receipt || '');
  patch.subject_why = (ctx.test ? COMM_CALLOFF_REHEARSAL_MARK : '') +
                      String(res.why || '').slice(0, COMM_CALLOFF_WHY_MAX);
  patch.subject_at = ctx.nowIso;
  try { commRecordUpsert_(COMM_CALLOFF_HOUSE, patch); } catch (eU) { /* the evidence row stands */ }
  return res;
}


// ====================================================================== 6B — THE OTHER THREE AUDIENCES, AND THEY…

// WHY THIS SECTION EXISTS, AND WHAT IT REPAIRS.

// THE PLACE THE SHIFT WAS, CARRIED BESIDE THE FACTS AND NEVER INSIDE THEM.
function commCallOffPlace_(queued) {
  var q = queued || {};
  var day = String(q.shift_day || '').trim();
  return {
    manager: String(q.manager || q.house_manager || '').trim(),
    house: String(q.house || q.location || '').trim(),
    // THE CALL-OFF'S OWN WORDS, for the one message that may carry them — the 5558 group's…
    reason: String(q.reason || '').trim(),
    // the night held this call-off and could not keep its reason beside the morning list (section 7B) — the…
    reason_lost: q.reason_lost === true,
    // THE DAY OF THE ABSENCE, when the caller's day is not it.
    shift_day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '',
    day_from_call: q.day_from_call === true,
    // THE SHIFT'S OWN START ("22:00"), set only by the morning carry of section 7B: the shift the call was about…
    shift_start: /^\d{1,2}:\d{2}$/.test(String(q.shift_start || '').trim()) ? String(q.shift_start).trim() : ''
  };
}

// THE DAY A HOTLINE CALL-OFF IS ABOUT, from the call's own description and the day it came in — 'yyyy-MM-dd', or ''…
function commCallOffShiftDayFrom_(words, callDayIso) {
  var call = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(callDayIso || '').trim());
  if (!call) return '';
  var text = String(words || '');
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var found = {};
  var iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g, m;
  while ((m = iso.exec(text)) !== null) found[m[1] + '-' + m[2] + '-' + m[3]] = true;
  var md = /(^|[^\d\/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d\/])/g;
  while ((m = md.exec(text)) !== null) {
    var mo = Number(m[2]), da = Number(m[3]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
    var yr = m[4] ? Number(m[4].length === 2 ? '20' + m[4] : m[4]) : Number(call[1]);
    // A December call about "1/2" is next year's January.
    if (!m[4] && mo < Number(call[2]) - 6) yr++;
    found[yr + '-' + pad(mo) + '-' + pad(da)] = true;
  }
  var days = Object.keys(found);
  if (days.length === 1) return days[0];
  if (days.length > 1) return '';
  var base = new Date(Date.UTC(Number(call[1]), Number(call[2]) - 1, Number(call[3]), 12));
  var said = function (re) { return re.test(text); };
  if (said(/\btomorrow\b/i) && !said(/\b(today|tonight)\b/i)) {
    var next = new Date(base.getTime() + 86400000);
    return next.getUTCFullYear() + '-' + pad(next.getUTCMonth() + 1) + '-' + pad(next.getUTCDate());
  }
  if (said(/\b(today|tonight|this (morning|afternoon|evening))\b/i) && !said(/\btomorrow\b/i)) {
    return call[1] + '-' + call[2] + '-' + call[3];
  }
  return '';
}

// A GAP READS AS A GAP, NOT AS A SENTENCE THAT HAPPENED TO END THERE.
var COMM_CALLOFF_HOUSE_UNKNOWN = '(the house was not named on the call)';

// And the same for the manager the calendar did not name — an empty gap in a sentence reads as a broken template…
var COMM_CALLOFF_MANAGER_UNKNOWN = '(the calendar names no manager for this house)';

function commCallOffHouseWord_(house) {
  return String(house || '').trim() || COMM_CALLOFF_HOUSE_UNKNOWN;
}

// WHAT `{house_manager}` RENDERS — her name, and never her number.
function commCallOffManagerWord_(place) {
  var who = commCallOffHouseManagerAudience_(place);
  return String((who && who.name) || '').trim() || COMM_CALLOFF_MANAGER_UNKNOWN;
}

// The CATEGORY in plain English — what `{kind}` renders.
var COMM_CALLOFF_KIND_WORDS = {
  call_off: 'called off',
  no_show: 'did not come in and did not call',
  sent_home: 'was sent home',
  late_show: 'arrived late'
};

// HAS A PERSON WRITTEN THIS CHANNEL'S WORDS?
function commCallOffChannelWords_(situation, channel) {
  if (!situation) return false;
  var unwritten = function (field) {
    try {
      return (typeof smartUnwrittenWords_ === 'function') && smartUnwrittenWords_(situation, field);
    } catch (eU) { return false; }
  };
  if (String(channel) === 'sms') {
    return !!String(situation.sms_text || '').trim() && !unwritten('sms_text');
  }
  if (String(channel) === 'email') {
    return !!String(situation.email_subject || '').trim() &&
           !unwritten('email_subject') && !unwritten('email_text');
  }
  return false;
}

// The channels this situation names AND has words on, in its own order.
function commCallOffChannelsWithWords_(situation) {
  var chans = (typeof commRecordChannels_ === 'function')
    ? commRecordChannels_(situation) : ['sms', 'email'];
  var out = [];
  for (var i = 0; i < chans.length; i++) {
    if (commCallOffChannelWords_(situation, chans[i])) out.push(chans[i]);
  }
  return out;
}

// The situation, if it is on AND somebody has written it.
function commCallOffOtherSituation_(id) {
  var sit = commCallOffSituation_(id);
  if (!sit) return null;
  return commCallOffChannelsWithWords_(sit).length ? sit : null;
}

/** What a template may fill in; an unknown placeholder stays visible so a rehearsal catches it. */
function commCallOffOtherVars_(facts, situation, over) {
  var name = String((facts && facts.name) || '');
  var vars = {
    employee: name,
    name: name,
    first_name: name.split(/\s+/)[0] || '',
    date: String((facts && facts.date) || ''),
    kind: COMM_CALLOFF_KIND_WORDS[String((facts && facts.kind) || '')] || '',
    sender: String((situation && situation.sender) ||
                   (typeof SMART_SENDER_DEFAULT !== 'undefined' ? SMART_SENDER_DEFAULT : ''))
  };
  var extra = over || {};
  for (var k in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, k)) vars[k] = extra[k];
  }
  return vars;
}

// ====================================================================== THE URGENT OPEN SHIFT — HOUSE, HOUR, DAY…

/** A value not found is never shown: its sentence is pruned first (commCallOffUrgentPrune_). */
var COMM_CALLOFF_URGENT_KEYS = ['house', 'time', 'day_word', 'location', 'reason', 'link', 'ref'];
/** The relay is asked only when the words name one of these. */
var COMM_CALLOFF_URGENT_RELAY_KEYS = ['house', 'time', 'location', 'link', 'ref'];
// The small words a missing value takes with it when the sentence can stand without it: " at {time}" goes, "Located…
var COMM_CALLOFF_URGENT_JOINS = ['at', 'for', 'on', 'in'];
/** How much of the call-off's own words the {reason} line carries. */
var COMM_CALLOFF_REASON_MAX = 200;

/** "14:00" → "2pm", "14:30" → "2:30pm", "00:00" → "12am"; '' for anything else. */
function commCallOffHourWord_(hhmm) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
  if (!m) return '';
  var h = Number(m[1]);
  if (h > 23) return '';
  return ((h % 12) || 12) + (m[2] === '00' ? '' : ':' + m[2]) + (h < 12 ? 'am' : 'pm');
}

// "today", "tomorrow", or the weekday ("Friday") of a yyyy-MM-dd shift day, on the company's clock; '' when the day…
function commCallOffDayWord_(dayIso, nowMs) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayIso || '').trim());
  if (!m) return '';
  var now = new Date(Number(nowMs) || Date.now());
  var today = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  var tomorrow = Utilities.formatDate(new Date(now.getTime() + 86400000), 'America/New_York', 'yyyy-MM-dd');
  var day = m[1] + '-' + m[2] + '-' + m[3];
  if (day === today) return 'today';
  if (day === tomorrow) return 'tomorrow';
  return Utilities.formatDate(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)),
                              'UTC', 'EEEE');
}

/** The call-off's own words, one line, cut at a word under the cap. */
function commCallOffReasonWords_(raw) {
  var s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.length <= COMM_CALLOFF_REASON_MAX) return s;
  var cut = s.slice(0, COMM_CALLOFF_REASON_MAX);
  var sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '...';
}

// One person's shift on one day, from the relay (the roster's Postgres mirror and the houses directory, /shift/of).
function commCallOffShiftOf_(name, dayIso, house) {
  if (typeof staffRelayPost_ !== 'function') return null;
  var r = staffRelayPost_('/shift/of', { person: name, date: dayIso, house: house || '' });
  return (r && r.status === 200 && r.data) ? r.data : null;
}

/** "CAN - JH - ABD2704" → "JH"; a location without three parts is said whole. */
function commCallOffHouseLabel_(location) {
  var loc = String(location == null ? '' : location).trim();
  var parts = loc.split(' - ');
  return parts.length >= 3 ? parts.slice(1, -1).join(' - ').trim() : loc;
}

/** "CAN - JH - ABD2704" → "ABD2704"; '' for no location. */
function commCallOffHouseCode_(location) {
  var loc = String(location == null ? '' : location).trim();
  return loc ? loc.split(' - ').pop().trim().toUpperCase() : '';
}

/** The shift a call-off is about; `nowMs` is the call's own instant, never the morning carry's. */
function commCallOffFindShift_(facts, place, nowMs) {
  var out = { shift: null, day: '', house: {}, asked_days: 0, asked_any: false, open_shift: null };
  var f = facts || {};
  var p = place || {};
  var loc = String(p.house || '').trim();
  var code = commCallOffHouseCode_(loc);
  var fromCall = p.day_from_call === true;
  var day = fromCall ? String(p.shift_day || '') : String(f.date || '');
  var askDays = day ? [day] : [];
  if (fromCall && !day && /^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''))) {
    var c = String(f.date).split('-');
    var next = new Date(Date.UTC(Number(c[0]), Number(c[1]) - 1, Number(c[2]) + 1, 12));
    askDays = [String(f.date), Utilities.formatDate(next, 'UTC', 'yyyy-MM-dd')];
  }
  if (!f.name || !askDays.length) return out;
  out.asked_days = askDays.length;
  var at = new Date(Number(nowMs) || Date.now());
  var nowDay = Utilities.formatDate(at, 'America/New_York', 'yyyy-MM-dd');
  var nowHm = Utilities.formatDate(at, 'America/New_York', 'HH:mm');
  var pin = commCallOffHm_(p.shift_start);
  var openOf = {};
  for (var d = 0; d < askDays.length && !out.shift; d++) {
    var one = null;
    try { one = commCallOffShiftOf_(f.name, askDays[d], loc); } catch (eR) { one = null; }
    if (!one) continue;
    out.asked_any = true;
    openOf[askDays[d]] = (one.open_shift && one.open_shift.ref) ? one.open_shift : null;
    if (one.house && !out.house.name) out.house = one.house;
    var shifts = (one.shifts || []).filter(function (s) { return s && s.start; });
    // THE SHIFT AT THE HOUSE THE CALL NAMED; a call that named none takes the roster's first timed one.
    for (var i = 0; i < shifts.length && !out.shift; i++) {
      if (code && String(shifts[i].house_code || '').trim().toUpperCase() !== code) continue;
      if (pin && commCallOffHm_(shifts[i].start) !== pin) continue;
      // ASKED OVER TWO DAYS, the open shift is the one not begun yet.
      var hmStart = commCallOffHm_(shifts[i].start);
      if (askDays.length > 1 && (askDays[d] < nowDay || (askDays[d] === nowDay && hmStart <= nowHm))) {
        continue;
      }
      out.shift = shifts[i];
      out.day = askDays[d];
    }
  }
  // the shift's handle (/shift/of `open_shift`); none when two days were asked and no shift found
  out.open_shift = out.day ? (openOf[out.day] || null)
                           : (askDays.length === 1 ? (openOf[askDays[0]] || null) : null);
  return out;
}

/** "9:05" → "09:05"; '' for anything that is not an hour and minutes. */
function commCallOffHm_(s) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  return m ? ((m[1].length < 2 ? '0' : '') + m[1] + ':' + m[2]) : '';
}

/** The values for one call-off; the day is the absence's, never the call's; a reason naming the caller is dropped. */
function commCallOffUrgentVars_(facts, place, ctx, words) {
  /* `day` is not a placeholder; the "covered" follow-up finds the shift by it. */
  var out = { house: '', time: '', day_word: '', location: '', reason: '', link: '', ref: '', day: '', why: [] };
  var f = facts || {};
  var p = place || {};
  var loc = String(p.house || '').trim();
  var needsRelay = COMM_CALLOFF_URGENT_RELAY_KEYS.some(function (k) {
    return String(words || '').indexOf('{' + k + '}') !== -1;
  });
  var nowMs = Number(ctx && ctx.nowMs) || Date.now();
  var fromCall = p.day_from_call === true;
  var day = fromCall ? String(p.shift_day || '') : String(f.date || '');
  var mine = null, mineDay = '', asked = {};
  if (needsRelay) {
    var found = commCallOffFindShift_(f, p, nowMs);
    mine = found.shift;
    mineDay = found.day;
    asked = found.house;
    if (found.asked_days && !found.asked_any) out.why.push('the roster could not be asked for the shift');
    // the ref names the shift, never the caller; link and ref both or neither
    var os = found.open_shift;
    if (os && /^SP[0-9A-F]{10}$/.test(String(os.ref || '')) && /^\/#\/app\//.test(String(os.path || ''))) {
      out.ref = String(os.ref);
      out.link = mailPlatformUrl_() + String(os.path);
    }
  }
  // A CALL THAT NAMED A HOUSE the roster does not put the person in keeps the house it named and no hour — another…
  var label = commCallOffHouseLabel_(loc);
  out.house = (mine && (str_(mine.house_name) || (str_(mine.house) ? str_(mine.house) + ' home' : ''))) ||
              str_(asked.name) || (label ? label + ' home' : '');
  out.location = (mine && str_(mine.address)) || str_(asked.address);
  // THE DAY SAID IS THE DAY KNOWN: the absence's own, or the roster shift's found over the two days; with neither…
  var sayDay = day || mineDay;
  out.day = sayDay || '';
  out.day_word = sayDay ? commCallOffDayWord_(sayDay, nowMs) : '';
  out.time = sayDay ? commCallOffHourWord_(mine && mine.start) : '';
  if (fromCall && !sayDay) out.why.push('the call did not say which day, and the roster showed no open shift');
  // THE REASON NEVER GOES TO EVERYBODY — from the hotline or from the form: nobody needs to know the reason why a…
  out.reason = '';
  COMM_CALLOFF_URGENT_KEYS.forEach(function (k) {
    if (k === 'reason') {
      if (String(words || '').indexOf('{reason}') !== -1) {
        out.why.push('the reason is never sent to everybody — it goes to the 5558 group alone');
      }
      return;
    }
    if (!out[k] && String(words || '').indexOf('{' + k + '}') !== -1) out.why.push('no ' + k.replace('_', ' '));
  });
  return out;
}

// Does this text name the person — any word of three letters or more of their name, as a whole word, any case?
function commCallOffNamesPerson_(text, name) {
  var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  return String(name || '').toLowerCase().split(/[^a-z]+/).some(function (w) {
    return w.length >= 3 && t.indexOf(' ' + w + ' ') !== -1;
  });
}

/** Prunes sentences a missing URGENT value would break; untouched lines keep every character. */
var COMM_CALLOFF_URGENT_ABBREV = ['st', 'ave', 'dr', 'rd', 'apt', 'blvd', 'ln', 'ct', 'hwy', 'mr', 'mrs',
                                  'ms', 'jr', 'sr', 'no', 'ste', 'pkwy', 'mt', 'ft'];

/** One line cut into sentences, every character kept (joined, they are the line). */
function commCallOffSentences_(line) {
  var out = [], start = 0, re = /[.!?]+(?=\s|$)\s*/g, m;
  while ((m = re.exec(line)) !== null) {
    var before = /([A-Za-z]+)$/.exec(line.slice(start, m.index));
    var word = before ? before[1].toLowerCase() : '';
    if (m[0].charAt(0) === '.' && m[0].replace(/\s+$/, '') === '.' &&
        (word.length === 1 || COMM_CALLOFF_URGENT_ABBREV.indexOf(word) !== -1)) continue;
    out.push(line.slice(start, m.index + m[0].length));
    start = m.index + m[0].length;
    if (!m[0].length) re.lastIndex++;
  }
  if (start < line.length) out.push(line.slice(start));
  return out;
}

function commCallOffUrgentPrune_(template, vals) {
  var v = vals || {};
  var missing = function (k) { return !String(v[k] == null ? '' : v[k]).trim(); };
  var holds = function (s) {
    return COMM_CALLOFF_URGENT_KEYS.filter(function (k) { return s.indexOf('{' + k + '}') !== -1; });
  };
  var lines = String(template || '').split('\n');
  var out = [];
  lines.forEach(function (line) {
    // A LINE WITH NOTHING MISSING — the template's spacing, its blank lines, its words — travels untouched.
    if (!holds(line).filter(missing).length) { out.push(line); return; }
    var kept = [], dropped = false;
    commCallOffSentences_(line).forEach(function (s) {
      var here = holds(s);
      var gone = here.filter(missing);
      if (!gone.length) { kept.push(s); return; }
      if (gone.length === here.length) { dropped = true; return; }   // nothing left to stand on
      var t = s;
      gone.forEach(function (k) {
        var joined = new RegExp('\\s+(?:' + COMM_CALLOFF_URGENT_JOINS.join('|') + ')\\s+\\{' + k + '\\}', 'i');
        t = joined.test(t) ? t.replace(joined, '') : t.replace(new RegExp('\\s*\\{' + k + '\\}'), '');
      });
      kept.push(t);
    });
    var joinedLine = kept.join('');
    // Only what a dropped sentence leaves behind is tidied: the space it trailed at the end of the line.
    if (dropped) joinedLine = joinedLine.replace(/\s+$/, '');
    if (joinedLine.trim()) out.push(joinedLine);
  });
  return out.join('\n');
}

// The situation as this blast will render it: the same row, with its SMS words pruned for the values this call-off…
function commCallOffUrgentSituation_(sit, vals) {
  var copy = {};
  for (var k in (sit || {})) if (Object.prototype.hasOwnProperty.call(sit, k)) copy[k] = sit[k];
  copy.sms_text = commCallOffUrgentPrune_(sit && sit.sms_text, vals);
  return copy;
}

// ONE ADDRESS, ONE MESSAGE, AND THE ANSWER IS READ RATHER THAN ASSUMED.
function commCallOffCopyTo_(dest, situation, vars, reason, idem, chans) {
  var out = { sent: false, redirected: false, why: '' };
  var d = String(dest || '').trim();
  if (!d) { out.why = 'an empty entry'; return out; }
  var res = null;
  try {
    if (d.indexOf('@') !== -1) {
      if (chans.indexOf('email') === -1) {
        out.why = d.slice(0, 30) + ': an e-mail address, and this row has no written letter to send';
        return out;
      }
      res = rpcCall_('emailSend', {
        to: d,
        subject: smartRender_(situation.email_subject, vars),
        body: smartRender_(situation.email_text || situation.sms_text, vars),
        reason: reason
      }, { idempotency_key: idem });
    } else {
      if (chans.indexOf('sms') === -1) {
        out.why = d.slice(0, 20) + ': a number, and this row has no written text to send';
        return out;
      }
      var num = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(d) : '';
      if (!num) {
        out.why = d.slice(0, 20) + ' is neither an e-mail nor a number we may text';
        return out;
      }
      res = rpcCall_('smsSend', {
        to: num, body: smartRender_(situation.sms_text, vars), reason: reason
      }, { idempotency_key: idem });
    }
  } catch (eR) {
    out.why = d.slice(0, 20) + ': ' + String((eR && eR.message) || eR);
    return out;
  }
  if (res && res.redirected) {
    out.redirected = true;
    out.why = d.slice(0, 20) + ': test mode — the testers heard it, not this audience';
  } else if (res && res.ok && (res.sent || res.deduplicated)) {
    out.sent = true;
  } else if (res && res.ok && res.gated) {
    out.why = d.slice(0, 20) + ': held at the send door (' +
              String(res.reason || res.detail || 'gated') + ')';
  } else {
    out.why = d.slice(0, 20) + ': ' +
              String((res && (res.error || res.detail)) || 'the send door refused');
  }
  return out;
}

// THE ROW'S OWN `to` AND `cc`, WITH THE KEYWORDS RESOLVED.
function commCallOffAddressKey_(v) {
  var d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : String(v || '').trim().toLowerCase();
}

// WHAT A KEYWORD MEANS, IN THE WORDS OF THE PLACE THAT RESOLVES IT.
function commCallOffKeywordLabel_(word) {
  try {
    var def = (typeof SMART_TO_KEYWORDS !== 'undefined') ? SMART_TO_KEYWORDS[String(word || '')] : null;
    return String((def && def.label) || '');
  } catch (e) { return ''; }
}

// WHO HAS ALREADY HEARD ABOUT THIS CALL-OFF, as a set of address keys.
function commCallOffAlreadyHeard_(told, to) {
  var key = commCallOffAddressKey_(to);
  return (told && key && told[key]) ? String(told[key]) : '';
}

function commCallOffAudienceFrom_(situation, facts) {
  // `notes` ARE FOR THE ROW SOMEBODY READS, and they are not `why`.
  var out = { readable: true, entries: [], why: [], notes: [],
              counted: { keyword: 0, typed: 0 } };
  // THE FACTS TRAVEL INTO THE RESOLVER, and that is not decoration: `allstaff` refuses the person who just called…
  var known = facts || {};
  var cells = [];
  try {
    cells = (typeof smartList_ === 'function')
      ? smartList_(situation && situation.to).concat(smartList_(situation && situation.cc)) : [];
  } catch (eL) { cells = []; }
  if (!cells.length) {
    out.why.push('this row names nobody in `Goes to` — an empty audience is an answer, ' +
                 'and it means nobody has said who this row may reach');
    return out;
  }
  var seen = {};
  // One address, one key — the lane's own rule, so a person named twice in one cell is texted once and the ladder…
  var keyOf = commCallOffAddressKey_;
  for (var i = 0; i < cells.length; i++) {
    var entry = String(cells[i] || '').trim();
    if (!entry) continue;
    var word = (typeof smartToKeyword_ === 'function') ? smartToKeyword_(entry) : '';
    if (!word) {
      var k = keyOf(entry);
      if (seen[k]) continue;
      seen[k] = true;
      out.counted.typed++;
      out.entries.push({ to: entry, name: '' });
      continue;
    }
    var got = null;
    try { got = SMART_TO_KEYWORDS[word].resolve(known); } catch (eK) { got = null; }
    if (!got || (got.readable !== undefined ? !got.readable : !got.ok)) {
      out.readable = false;
      out.why.push('`' + word + '` could not be resolved: ' +
                   String((got && got.why) || 'the house behind it did not answer') +
                   ' — that is "we cannot see", never "this reaches nobody"');
      continue;
    }
    (got.people || []).forEach(function (p) {
      var to = String((p && (p.phone || p.email)) || '').trim();
      if (!to) return;
      var key = keyOf(to);
      if (seen[key]) return;
      seen[key] = true;
      out.counted.keyword++;
      out.entries.push({ to: to, name: String((p && p.name) || '') });
    });
    if (got.missing) out.why.push('`' + word + '`: ' + String(got.missing));
    if (got.counted && got.counted.her_number) {
      out.notes.push(String(got.counted.her_number) + ' member(s) of staff carry the caller\'s own ' +
                     'phone and are not in `' + word + '` — that handset is hers, and she is never ' +
                     'asked to cover the shift she has just called off from');
    }
  }
  return out;
}

// HOW MANY COPIES ONE RECORDING EXECUTION MAY SEND, AND FOR HOW LONG.
var COMM_CALLOFF_BLAST_MAX = 200;
var COMM_CALLOFF_BLAST_BUDGET_MS = 60000;

// The ending one audience came to, from the counters.
function commCallOffEnding_(sent, redirected, asked) {
  if (sent > 0) return 'told';
  if (redirected > 0) return 'rehearsed';
  if (asked > 0) return 'held';
  return 'nobody';
}

// THE SENDING DIAL, ASKED BY THESE THREE AUDIENCES TOO.
function commCallOffDialWord_(ctx) {
  return (typeof commSendDialWord_ === 'function')
    ? commSendDialWord_(ctx)
    : String((ctx && ctx.dial) || 'off') || 'off';
}

// The ending a lane comes to when the dial is not handing anything over, and the sentence that goes with it — one…
function commCallOffDialHeld_(res, dial, resolvedCount, what) {
  res.state = 'recorded';
  res.why = (typeof commDialHeldWhy_ === 'function')
    ? commDialHeldWhy_(dial, resolvedCount, what)
    : 'the sending dial stands at `' + dial + '`, not `send`: NOBODY WAS CONTACTED';
  return res;
}

// THE MESSAGE THE DIAL HELD, WRITTEN INTO THE REHEARSAL BOOK.
function commCallOffRehearse_(res, sit, vars, dests, facts, instance, ctx) {
  if (typeof hubRehearsalHeld_ !== 'function' || !sit) return 0;
  var list = (dests || []).filter(function (d) { return !!String(d || '').trim(); });
  if (!list.length) return 0;
  var wrote = 0;
  var chans = commCallOffChannelsWithWords_(sit);
  for (var i = 0; i < chans.length; i++) {
    try {
      var isMail = chans[i] === 'email';
      hubRehearsalHeld_({
        channel: chans[i],
        to: list.join(', '),
        situation: String(sit.id || ''),
        intent_key: 'CO|' + String(instance || '') + '|' + String(res.audience || ''),
        person_key: String((facts && facts.person_key) || ''),
        person_name: String((facts && facts.name) || ''),
        purpose: COMM_CALLOFF_SUBJECT_PURPOSE,
        sender_used: String((vars && vars.sender) || ''),
        verdict: String(res.state || ''),
        reasons: String(res.why || ''),
        subject: isMail ? smartRender_(sit.email_subject, vars) : '',
        body: isMail ? smartRender_(sit.email_text || sit.sms_text, vars)
                     : smartRender_(sit.sms_text, vars),
        reason: 'call off: ' + String(sit.id || ''),
        pass_by: 'asa-hub:comm-call-off',
        window: (ctx && ctx.nowIso) ? 'not asked — the dial held it first; the send door\'s quiet ' +
                                      'window holds this leg 21:31–07:59 when the dial hands over' : ''
      });
      wrote++;
    } catch (eB) { /* the call-off row still carries the count and the reason */ }
  }
  return wrote;
}

// WHAT AN EARLIER LEG ACTUALLY DID for the people this one is dropping.
function commCallOffHeardVerb_(state) {
  var s = String(state || '');
  if (s === 'told' || s === 'partial') return 'was told by';
  if (s === 'rehearsed') return 'was rehearsed at the testers by';
  if (s === 'recorded') return 'was resolved and written down — nobody contacted — by';
  if (s === 'already') return 'was already spoken for by';
  // THE ACKNOWLEDGEMENT'S OWN TWO ENDINGS, because the caller is now on this ladder from the first rung.
  if (s === 'deferred') return 'is owed an answer the quiet hours deferred, from';
  if (s === 'held') return 'was spoken for — and nothing was sent — by';
  return 'was covered by';
}

// The skip sentence, built from who covered them and what that leg did.
function commCallOffSkippedWhy_(dropped, told, endings) {
  var keys = dropped || [];
  if (!keys.length) return '';
  var by = {}, order = [];
  keys.forEach(function (k) {
    var who = String((told && told[k]) || '');
    if (by[who] === undefined) { by[who] = 0; order.push(who); }
    by[who]++;
  });
  var parts = order.map(function (who) {
    var sit = who === 'house_manager' ? COMM_CALLOFF_MANAGER_SITUATION
            : (who === 'cover_offer' ? COMM_CALLOFF_OFFER_SITUATION
            : (who === 'everyone' ? COMM_CALLOFF_EVERYONE_SITUATION
            : (who === 'subject' ? COMM_CALLOFF_SUBJECT_SITUATION : who)));
    return String(by[who]) + ' ' + commCallOffHeardVerb_(endings && endings[who]) +
           (sit ? ' `' + sit + '`' : ' an earlier leg');
  });
  return keys.length + ' skipped: ' + parts.join(', ') +
         ' — one person hears about one call-off once';
}

// AUDIENCE 3 — THE HOUSE MANAGER OF THE SHIFT, TOLD ONCE.
function commCallOffLegacyClause_() {
  return 'ALSO SENT BY the hotline\'s own Call Off Processor v1.3, which finds the House Lead ' +
         'and texts her: she may hear about this absence twice. Its newest alert this platform ' +
         'can see is from 2026-03-20 and that log has been quiet since — a quiet log is never ' +
         'read as disarmed';
}

function commCallOffTellManager_(rowId, facts, instance, place, ctx) {
  var res = { audience: 'house_manager', situation: COMM_CALLOFF_MANAGER_SITUATION,
              sent: 0, redirected: 0, asked: 0, state: 'held', why: '', heard: [],
              // DID THIS LEG TAKE A CLAIM?
              claimed: false, rehearsal_rows: 0 };
  if (!commCallOffSpeaksTo_(facts.kind, 'house_manager')) {
    res.state = 'not_owed';
    res.why = facts.kind
      ? (COMM_CALLOFF_EFFECT[facts.kind] || {}).why || 'this kind is owed nothing'
      : 'the type of day could not be recognised — nothing is said about a day we cannot name';
    return res;
  }
  var sit = commCallOffOtherSituation_(COMM_CALLOFF_MANAGER_SITUATION);
  if (!sit) {
    res.state = 'wordless';
    res.why = 'the situation `' + COMM_CALLOFF_MANAGER_SITUATION + '` is absent, switched off, ' +
              'or has no written words on any channel it names — nothing was sent';
    return res;
  }
  if (typeof rpcCall_ !== 'function') { res.why = 'the send door is absent'; return res; }
  var who = commCallOffHouseManagerAudience_(place);
  if (!who.ok) {
    // NEVER A GUESS.
    res.state = 'nobody';
    res.why = who.why;
    return res;
  }
  // SHE IS ON THE LADDER FROM HERE ON, whatever the claim answers next.
  res.heard = [commCallOffAddressKey_(who.phone)];
  var chans = commCallOffChannelsWithWords_(sit);
  var vars = commCallOffOtherVars_(facts, sit,
    { house_manager: who.name, house: commCallOffHouseWord_(place && place.house) });
  var dial = commCallOffDialWord_(ctx);
  if (!commDialHandsOver_(dial)) {
    // THE WORDS ARE RENDERED ANYWAY AND WRITTEN WHERE THEY ARE READ.
    commCallOffDialHeld_(res, dial, 1, 'the house manager the hotline resolved for this shift');
    res.why += ' · ' + commCallOffLegacyClause_();
    res.rehearsal_rows = commCallOffRehearse_(res, sit, vars, [who.phone], facts, instance, ctx);
    return res;
  }
  // THE QUIET WINDOW, ASKED BEFORE THE CLAIM like the dial (section 7B): held for the morning, never spent on a…
  if (commCallOffQuietNow_()) {
    return commCallOffQuietHeld_(res, rowId, sit, vars, [who.phone], facts, instance, place,
                                 'the house manager the hotline resolved for this shift');
  }
  if (!commCallOffClaim_(rowId, ctx.test, ctx.nowIso, 'house_manager')) {
    res.state = 'already';
    res.claimed = true;
    res.why = 'already claimed or told — one telling per house manager per call-off';
    return res;
  }
  res.claimed = true;
  var one = commCallOffCopyTo_(who.phone, sit, vars, 'call off: ' + String(sit.id || ''),
                               'co_hm_' + String(instance || '').slice(0, 48), chans);
  res.asked = 1;
  if (one.sent) res.sent = 1;
  if (one.redirected) res.redirected = 1;
  res.state = commCallOffEnding_(res.sent, res.redirected, res.asked);
  res.why = (one.sent ? 'the house manager the hotline resolved for this shift was told'
                      : String(one.why || 'the send door refused')) +
            ' · ' + commCallOffLegacyClause_();
  return res;
}

// AUDIENCE 4 — EVERY ACTIVE MEMBER OF STAFF, ONCE, FOR AN OPEN SHIFT.
function commCallOffBlast_(rowId, facts, instance, ctx, told, endings, place) {
  var res = { audience: 'everyone', situation: COMM_CALLOFF_EVERYONE_SITUATION,
              sent: 0, redirected: 0, asked: 0, resolved: 0, not_asked: 0, skipped: 0,
              state: 'held', why: '', heard: [], claimed: false, rehearsal_rows: 0 };
  if (!commCallOffSpeaksTo_(facts.kind, 'everyone')) {
    res.state = 'not_owed';
    res.why = facts.kind
      ? 'this kind leaves no shift open: ' +
        ((COMM_CALLOFF_EFFECT[facts.kind] || {}).why || 'nothing is owed')
      : 'the type of day could not be recognised — nobody is texted about a day we cannot name';
    return res;
  }
  var sit = commCallOffOtherSituation_(COMM_CALLOFF_EVERYONE_SITUATION);
  if (!sit) {
    res.state = 'wordless';
    res.why = 'the situation `' + COMM_CALLOFF_EVERYONE_SITUATION + '` is absent, switched off, ' +
              'or has no written words on any channel it names — nobody was texted';
    return res;
  }
  if (typeof rpcCall_ !== 'function') { res.why = 'the send door is absent'; return res; }
  // THE PERSON WHO CALLED OFF IS NEVER ASKED TO COVER HER OWN SHIFT, and that refusal lives in the `allstaff`…
  var audience = commCallOffAudienceFrom_(sit, facts);
  if (!audience.readable) {
    res.state = 'unreadable';
    res.why = audience.why.join(' · ');
    return res;
  }
  // THE ONES WHO HAVE ALREADY HEARD COME OUT BEFORE THE COUNT IS TAKEN, so `resolved` is the number this blast…
  var people = [], dropped = [];
  for (var s = 0; s < audience.entries.length; s++) {
    if (commCallOffAlreadyHeard_(told, audience.entries[s].to)) {
      res.skipped++;
      dropped.push(commCallOffAddressKey_(audience.entries[s].to));
      continue;
    }
    people.push(audience.entries[s]);
  }
  // WHAT THE EARLIER LEG DID, NOT WHAT IT WOULD HAVE DONE.
  var skippedWhy = commCallOffSkippedWhy_(dropped, told, endings);
  // AND A COUNT THAT MOVED INSIDE THE RESOLVER SAYS WHY IT MOVED.
  if (audience.notes && audience.notes.length) {
    skippedWhy = (skippedWhy ? skippedWhy + ' · ' : '') + audience.notes.join(' · ');
  }
  res.resolved = people.length;
  if (!people.length) {
    res.state = res.skipped ? 'skipped' : 'nobody';
    res.why = skippedWhy || (audience.why.join(' · ') ||
               'the audience resolved to nobody this platform may text');
    return res;
  }
  /* Resolved once for the whole blast; missing values are pruned before rendering. */
  var urgent = commCallOffUrgentVars_(facts, place, ctx, sit.sms_text);
  var sitNow = commCallOffUrgentSituation_(sit, urgent);
  var withUrgent = function (over) {
    var o = { house: urgent.house, time: urgent.time, day_word: urgent.day_word,
              location: urgent.location, reason: urgent.reason, link: urgent.link, ref: urgent.ref };
    for (var k in (over || {})) if (Object.prototype.hasOwnProperty.call(over, k)) o[k] = over[k];
    return o;
  };
  if (urgent.why.length) {
    skippedWhy = (skippedWhy ? skippedWhy + ' · ' : '') + 'the URGENT OPEN SHIFT words left out what ' +
                 'could not be found (' + urgent.why.join(', ') + ') rather than show a gap';
  }
  var blastDial = commCallOffDialWord_(ctx);
  if (!commDialHandsOver_(blastDial)) {
    // THE COUNT IS THE POINT OF A RECORD RUN: this is about to be seventy-seven texts, and the row says so before…
    commCallOffDialHeld_(res, blastDial, res.resolved,
                         'every active member of staff this platform can text');
    if (skippedWhy) res.why += ' · ' + skippedWhy;
    var sample = commCallOffOtherVars_(facts, sit, withUrgent({
      name: String(people[0].name || ''),
      first_name: String(people[0].name || '').split(/\s+/)[0] || ''
    }));
    res.why += ' · the words below are rendered for the first of the ' + res.resolved +
               ', so a name placeholder reads as a sample rather than as a blank';
    res.rehearsal_rows = commCallOffRehearse_(res, sitNow, sample,
      people.map(function (p) { return p.to; }), facts, instance, ctx);
    res.audience_cell = commCallOffAudienceCell_(people, urgent.day, place && place.house);
    return res;
  }
  // THE QUIET WINDOW, BEFORE THE CLAIM (section 7B).
  if (commCallOffQuietNow_()) {
    var nightSample = commCallOffOtherVars_(facts, sit, withUrgent({
      name: String(people[0].name || ''),
      first_name: String(people[0].name || '').split(/\s+/)[0] || ''
    }));
    commCallOffQuietHeld_(res, rowId, sitNow, nightSample, people.map(function (p) { return p.to; }),
                          facts, instance, place, 'every active member of staff this platform can text');
    if (skippedWhy) res.why += ' · ' + skippedWhy;
    /* the carry overwrites this with who it really reached */
    res.audience_cell = commCallOffAudienceCell_(people, urgent.day, place && place.house);
    return res;
  }
  if (!commCallOffClaim_(rowId, ctx.test, ctx.nowIso, 'everyone')) {
    res.state = 'already';
    res.claimed = true;
    res.why = 'already claimed or sent — one blast per call-off';
    return res;
  }
  res.claimed = true;
  // THE CLAIM IS SPENT: from this line on the row must be able to say how far the pass got, even if this execution…
  commCallOffBlastMark_(rowId, ctx, 'sending', 0, res.resolved);
  var chans = commCallOffChannelsWithWords_(sit);
  var started = Date.now();
  var stopped = '';
  /* who it actually reached, a person or the testers in their place */
  var reached = [];
  for (var i = 0; i < people.length; i++) {
    if (i >= COMM_CALLOFF_BLAST_MAX) { stopped = 'the cap of ' + COMM_CALLOFF_BLAST_MAX + ' copies'; break; }
    if (Date.now() - started > COMM_CALLOFF_BLAST_BUDGET_MS) {
      stopped = 'the ' + Math.round(COMM_CALLOFF_BLAST_BUDGET_MS / 1000) + '-second budget';
      break;
    }
    var p = people[i];
    // `{first_name}` IS THE PERSON BEING TEXTED, not the person who called off — `{employee}` is her.
    var vars = commCallOffOtherVars_(facts, sit, withUrgent({
      name: String(p.name || ''), first_name: String(p.name || '').split(/\s+/)[0] || ''
    }));
    res.heard.push(commCallOffAddressKey_(p.to));
    var one = commCallOffCopyTo_(p.to, sitNow, vars, 'call off: ' + String(sit.id || ''),
                                 'co_all' + i + '_' + String(instance || '').slice(0, 40), chans);
    res.asked++;
    if (one.sent) res.sent++;
    if (one.sent || one.redirected) reached.push(p);
    if (one.redirected) res.redirected++;
    else if (!one.sent && res.why.length < 400) res.why += (res.why ? ' · ' : '') + String(one.why || '');
    // A NUMBER ON THE ROW WHILE THE LOOP IS STILL RUNNING.
    if (res.asked % COMM_CALLOFF_BLAST_MARK_EVERY === 0) {
      commCallOffBlastMark_(rowId, ctx, 'sending', res.sent, res.resolved);
    }
  }
  res.not_asked = people.length - res.asked;
  res.audience_cell = commCallOffAudienceCell_(reached, urgent.day, place && place.house);
  res.state = commCallOffEnding_(res.sent, res.redirected, res.asked);
  // A LANE THAT STOPPED EARLY SAYS SO.
  if (stopped) {
    res.state = 'partial';
    res.why = res.resolved + ' resolved, ' + res.asked + ' asked, ' + res.not_asked +
              ' NEVER ASKED — the pass stopped at ' + stopped +
              ' and a blast is never retried (the ones already texted would hear it twice)' +
              (skippedWhy ? ' · ' + skippedWhy : '') +
              (res.why ? ' · ' + res.why : '');
    try {
      hubSysLog_('asa-hub:comm', 'call_off_blast_stopped',
                 res.why, { status: 200 });
    } catch (eL) { /* the row carries it either way */ }
  } else {
    res.why = res.sent + ' of ' + res.resolved + ' reached' +
              (res.redirected ? ', ' + res.redirected + ' rehearsed at the testers' : '') +
              (skippedWhy ? ' · ' + skippedWhy : '') +
              (res.why ? ' · ' + res.why : '');
  }
  return res;
}

// AUDIENCE 5 — THE 5558 GROUP, TOLD WHY.
var COMM_CALLOFF_DIRECTORS_KEYS = ['employee', 'house', 'time', 'day_word', 'reason'];

// THE TEMPLATE WITH EVERY MISSING VALUE TAKEN OUT, per line.
function commCallOffDirectorsPrune_(template, vals) {
  var v = vals || {};
  var missing = function (k) { return !String(v[k] == null ? '' : v[k]).trim(); };
  var out = [];
  String(template || '').split('\n').forEach(function (line) {
    var here = COMM_CALLOFF_DIRECTORS_KEYS.filter(function (k) { return line.indexOf('{' + k + '}') !== -1; });
    var gone = here.filter(missing);
    if (!gone.length) { out.push(line); return; }
    if (gone.length === here.length) return;
    var t = line;
    gone.forEach(function (k) { t = t.replace(new RegExp('\\s*\\{' + k + '\\}', 'g'), ''); });
    t = t.replace(/\s+-\s*([.!?])/g, '$1')      // "Roe - ." → "Roe."
         .replace(/:\s*-\s+/g, ': ')             // "CALL OFF: - JH" → "CALL OFF: JH"
         .replace(/\s+-\s*$/, '')                 // a dash left at the end
         .replace(/[ \t]{2,}/g, ' ');
    if (t.trim()) out.push(t);
  });
  return out.join('\n');
}

function commCallOffTellDirectors_(rowId, facts, instance, place, ctx) {
  var res = { audience: 'directors', situation: COMM_CALLOFF_DIRECTORS_SITUATION,
              sent: 0, redirected: 0, asked: 0, state: 'held', why: '', heard: [],
              claimed: false, rehearsal_rows: 0 };
  if (!commCallOffSpeaksTo_(facts.kind, 'directors')) {
    res.state = 'not_owed';
    res.why = facts.kind
      ? 'only a Call Off carries a reason somebody gave — this kind is owed nothing here'
      : 'the type of day could not be recognised — nothing is said about a day we cannot name';
    return res;
  }
  var sit = commCallOffOtherSituation_(COMM_CALLOFF_DIRECTORS_SITUATION);
  if (!sit) {
    res.state = 'wordless';
    res.why = 'the situation `' + COMM_CALLOFF_DIRECTORS_SITUATION + '` is absent, switched off, ' +
              'or has no written words on any channel it names — nothing was sent';
    return res;
  }
  if (typeof rpcCall_ !== 'function') { res.why = 'the send door is absent'; return res; }
  var audience = commCallOffAudienceFrom_(sit, facts);
  if (!audience.readable) {
    res.state = 'unreadable';
    res.why = audience.why.join(' · ');
    return res;
  }
  var dests = audience.entries.map(function (e) { return String(e.to || ''); })
    .filter(function (d) { return !!d.trim(); });
  if (!dests.length) {
    res.state = 'nobody';
    res.why = audience.why.join(' · ') || 'the audience resolved to nobody this platform may text';
    return res;
  }
  res.heard = dests.map(commCallOffAddressKey_);
  // THE SHIFT, AS THE BLAST SAYS IT (house, hour, day — one relay call, only when the words name one of them), and…
  var urgent = commCallOffUrgentVars_(facts, place, ctx, sit.sms_text);
  var reason = String((place && place.reason) || '').trim();
  var vals = { employee: String((facts && facts.name) || ''), house: urgent.house, time: urgent.time,
               day_word: urgent.day_word, reason: reason };
  var sitNow = {};
  for (var sk in sit) if (Object.prototype.hasOwnProperty.call(sit, sk)) sitNow[sk] = sit[sk];
  sitNow.sms_text = commCallOffDirectorsPrune_(sit.sms_text, vals);
  var vars = commCallOffOtherVars_(facts, sit, { house: urgent.house, time: urgent.time,
                                                 day_word: urgent.day_word, location: urgent.location,
                                                 reason: reason });
  var left = COMM_CALLOFF_DIRECTORS_KEYS.filter(function (k) {
    return String(sit.sms_text || '').indexOf('{' + k + '}') !== -1 && !String(vals[k] || '').trim();
  });
  var what = 'the 5558 group (the directors and the people responsible)';
  var dial = commCallOffDialWord_(ctx);
  if (!commDialHandsOver_(dial)) {
    commCallOffDialHeld_(res, dial, dests.length, what);
    if (left.length) res.why += ' · left out, never shown as a gap: ' + left.join(', ');
    res.rehearsal_rows = commCallOffRehearse_(res, sitNow, vars, dests, facts, instance, ctx);
    return res;
  }
  if (commCallOffQuietNow_()) {
    return commCallOffQuietHeld_(res, rowId, sitNow, vars, dests, facts, instance, place, what);
  }
  if (!commCallOffClaim_(rowId, ctx.test, ctx.nowIso, 'directors')) {
    res.state = 'already';
    res.claimed = true;
    res.why = 'already claimed or told — one message to the 5558 group per call-off';
    return res;
  }
  res.claimed = true;
  var chans = commCallOffChannelsWithWords_(sit);
  var reasonLine = 'call off: ' + String(sit.id || '');
  var whys = [];
  for (var i = 0; i < dests.length; i++) {
    var d = dests[i], one = null;
    var idem = 'co_dir' + i + '_' + String(instance || '').slice(0, 40);
    try {
      if (d.indexOf('@') !== -1) {
        one = commCallOffCopyTo_(d, sitNow, vars, reasonLine, idem, chans);
      } else if (chans.indexOf('sms') === -1) {
        one = { sent: false, redirected: false, why: 'a number, and this row has no written text to send' };
      } else {
        var digits = d.replace(/\D/g, '').slice(-10);
        if (digits.length !== 10) {
          one = { sent: false, redirected: false, why: d.slice(0, 20) + ' is not a number we can text' };
        } else {
          // THE WORDS ARE NEVER CUT TO FIT ONE TEXT.
          var parts = commCallOffSmsParts_(smartRender_(sitNow.sms_text, vars), COMM_CALLOFF_SMS_MAX);
          if (parts.length > 1) res.parts = parts.length;
          one = { sent: true, redirected: false, why: '' };
          for (var pk = 0; pk < parts.length; pk++) {
            var r = rpcCall_('smsSend', { to: '+1' + digits, body: parts[pk], reason: reasonLine },
                             { idempotency_key: idem + (parts.length > 1 ? '_p' + (pk + 1) : '') });
            var partSent = !!(r && r.ok && (r.sent || r.deduplicated) && !r.redirected);
            if (r && r.redirected) one.redirected = true;
            if (!partSent) {
              one.sent = false;
              one.why = (parts.length > 1 ? 'text ' + (pk + 1) + ' of ' + parts.length + ': ' : '') +
                        ((r && r.ok && r.gated) ? 'held at the send door (' + String(r.reason || r.detail || 'gated') + ')'
                         : (r && !r.ok) ? String(r.error || r.detail || 'the send door refused') : '');
              break;
            }
          }
        }
      }
    } catch (eS) {
      one = { sent: false, redirected: false, why: String((eS && eS.message) || eS) };
    }
    res.asked++;
    if (one.sent) res.sent++;
    if (one.redirected) res.redirected++;
    if (!one.sent && one.why) whys.push(String(one.why));
  }
  res.state = commCallOffEnding_(res.sent, res.redirected, res.asked);
  res.why = (res.sent ? 'the 5558 group was told why' : (whys.join(' · ') || 'the send door refused')) +
            (res.parts ? ' · the reason was long, so it went in ' + res.parts + ' texts' : '') +
            (left.length ? ' · left out, never shown as a gap: ' + left.join(', ') : '') +
            (place && place.reason_lost ? ' · the night that held it could not keep the reason' : '');
  return res;
}

/** The provider's limit for one message's content (OpenPhone: 1,600). */
var COMM_CALLOFF_SMS_MAX = 1600;

// ONE BODY AS TEXTS THAT FIT — [body] when it fits whole; otherwise parts of at most `max` characters, each…
function commCallOffSmsParts_(body, max) {
  var text = String(body == null ? '' : body);
  var cap = Number(max) || COMM_CALLOFF_SMS_MAX;
  if (text.length <= cap) return [text];
  var budget = cap - 10;              // "(99/99) " and a little room
  var chunks = [];
  var rest = text;
  while (rest.length > budget) {
    var cut = Math.max(rest.lastIndexOf(' ', budget), rest.lastIndexOf('\n', budget));
    if (cut < budget / 2) cut = budget;
    chunks.push(rest.slice(0, cut).replace(/\s+$/, ''));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks.map(function (c, i) { return '(' + (i + 1) + '/' + chunks.length + ') ' + c; });
}

// THE ROW'S RUNNING ANSWER, WRITTEN WHILE THE BLAST IS STILL SENDING.
var COMM_CALLOFF_BLAST_MARK_EVERY = 25;

// What a `_why` cell wears when the pass that wrote it was a REHEARSAL — the copies went to the testers and the…
var COMM_CALLOFF_REHEARSAL_MARK = 'REHEARSAL (test mode — the testers heard it, not this ' +
                                  'audience; the turn is still owed) — ';

/** How much of a leg's sentence the row keeps. */
var COMM_CALLOFF_WHY_MAX = 900;

function commCallOffBlastMark_(rowId, ctx, state, sent, resolved) {
  var cols = COMM_CALLOFF_STATE_COLS.everyone;
  var patch = { id: rowId };
  // THE STATE BELONGS TO THE MEMORY THE CLAIM WAS TAKEN IN — this runs only after the claim, so test mode means a…
  patch[(ctx && ctx.test) ? cols.test : cols.prod] = state;
  patch.everyone_count = String(sent) + '/' + String(resolved);
  patch[cols.at] = String((ctx && ctx.nowIso) || new Date().toISOString());
  try { commRecordUpsert_(COMM_CALLOFF_HOUSE, patch); }
  catch (e) { /* the ending still tries; a lost progress write costs nothing */ }
}

// AUDIENCE 5 — THE COVER OFFER, TO THE HOUSE MANAGERS AND THE DIRECTOR.
function commCallOffOfferSend_(rowId, facts, instance, place, ctx, told, endings) {
  var res = { audience: 'cover_offer', situation: COMM_CALLOFF_OFFER_SITUATION,
              sent: 0, redirected: 0, asked: 0, skipped: 0, state: 'held', why: '', heard: [],
              claimed: false, rehearsal_rows: 0 };
  if (!commCallOffSpeaksTo_(facts.kind, 'cover_offer')) {
    res.state = 'not_owed';
    res.why = facts.kind
      ? (COMM_CALLOFF_EFFECT[facts.kind] || {}).why || 'this kind is owed nothing'
      : 'the type of day could not be recognised — nothing is offered about a day we cannot name';
    return res;
  }
  var sit = commCallOffOtherSituation_(COMM_CALLOFF_OFFER_SITUATION);
  if (!sit) {
    res.state = 'wordless';
    res.why = 'the situation `' + COMM_CALLOFF_OFFER_SITUATION + '` is absent, switched off, or ' +
              'has no written words on any channel it names — nothing was offered';
    return res;
  }
  if (typeof rpcCall_ !== 'function') { res.why = 'the send door is absent'; return res; }
  var audience = commCallOffAudienceFrom_(sit, facts);
  if (!audience.readable) {
    res.state = 'unreadable';
    res.why = audience.why.join(' · ');
    return res;
  }
  // WHOEVER HAS ALREADY HEARD ABOUT THIS CALL-OFF COMES OUT HERE, before the claim and before a word is rendered…
  var entries = [], dropped = [];
  for (var e = 0; e < audience.entries.length; e++) {
    if (commCallOffAlreadyHeard_(told, audience.entries[e].to)) {
      res.skipped++;
      dropped.push(commCallOffAddressKey_(audience.entries[e].to));
      continue;
    }
    entries.push(audience.entries[e]);
  }
  // AND THE SENTENCE SAYS WHAT THE EARLIER LEG DID.
  var skippedWhy = commCallOffSkippedWhy_(dropped, told, endings);
  if (!entries.length) {
    // `skipped` AND `nobody` ARE DIFFERENT ZEROS: one means everybody in this audience has already been told about…
    res.state = res.skipped ? 'skipped' : 'nobody';
    res.why = skippedWhy || audience.why.join(' · ') ||
              'this row names nobody — write the people, or the keyword `housemanagers`';
    return res;
  }
  var chans = commCallOffChannelsWithWords_(sit);
  var vars = commCallOffOtherVars_(facts, sit, {
    house: commCallOffHouseWord_(place && place.house),
    // THE NAME, NEVER THE NUMBER.
    house_manager: commCallOffManagerWord_(place)
  });
  var offerDial = commCallOffDialWord_(ctx);
  if (!commDialHandsOver_(offerDial)) {
    entries.forEach(function (x) { res.heard.push(commCallOffAddressKey_(x.to)); });
    commCallOffDialHeld_(res, offerDial, entries.length,
                         'the people who decide who covers the shift');
    if (skippedWhy) res.why += ' · ' + skippedWhy;
    res.rehearsal_rows = commCallOffRehearse_(res, sit, vars,
      entries.map(function (x) { return x.to; }), facts, instance, ctx);
    return res;
  }
  // THE QUIET WINDOW, BEFORE THE CLAIM (section 7B) — and they are on the ladder for this pass exactly as the…
  if (commCallOffQuietNow_()) {
    entries.forEach(function (x) { res.heard.push(commCallOffAddressKey_(x.to)); });
    commCallOffQuietHeld_(res, rowId, sit, vars, entries.map(function (x) { return x.to; }),
                          facts, instance, place, 'the people who decide who covers the shift');
    if (skippedWhy) res.why += ' · ' + skippedWhy;
    return res;
  }
  if (!commCallOffClaim_(rowId, ctx.test, ctx.nowIso, 'cover_offer')) {
    res.state = 'already';
    res.claimed = true;
    res.why = 'already claimed or sent — one offer per call-off';
    return res;
  }
  res.claimed = true;
  for (var i = 0; i < entries.length && i < COMM_CALLOFF_BLAST_MAX; i++) {
    res.heard.push(commCallOffAddressKey_(entries[i].to));
    var one = commCallOffCopyTo_(entries[i].to, sit, vars,
                                 'call off: ' + String(sit.id || ''),
                                 'co_offer' + i + '_' + String(instance || '').slice(0, 40), chans);
    res.asked++;
    if (one.sent) res.sent++;
    if (one.redirected) res.redirected++;
    else if (!one.sent && res.why.length < 400) res.why += (res.why ? ' · ' : '') + String(one.why || '');
  }
  res.state = commCallOffEnding_(res.sent, res.redirected, res.asked);
  res.why = res.sent + ' of ' + entries.length + ' reached' +
            (res.redirected ? ', ' + res.redirected + ' rehearsed at the testers' : '') +
            (skippedWhy ? ' · ' + skippedWhy : '') +
            ' · THE SUGGESTION IS NOT IN THIS BUILD: the cover ranking arrives with the ' +
            'cover-suggestion engine' + (res.why ? ' · ' + res.why : '');
  return res;
}

// THE THREE, IN ONE PASS, AND NONE OF THEM MAY THROW.
function commCallOffTellOthers_(rowId, facts, instance, place, ctx, ack, only) {
  var out = { house_manager: null, everyone: null, cover_offer: null, directors: null,
              sent: 0, rehearsal_rows: 0 };
  var wanted = function (name) { return !only || !!only[name]; };
  // WHO HAS HEARD, BY ADDRESS KEY — filled by each leg as it goes and read by the ones below it.
  var told = {};
  // AND WHAT EACH OF THEM DID ABOUT IT, by audience.
  var endings = {};
  if (ack && ack.to_key) {
    told[ack.to_key] = 'subject';
    endings.subject = String(ack.state || '');
  }
  var run = function (name, fn) {
    var r = null;
    try { r = fn(); }
    catch (e) {
      r = { audience: name, sent: 0, redirected: 0, asked: 0, state: 'held',
            why: 'the ' + name + ' leg threw and the recorded row stands: ' +
                 String((e && e.message) || e) };
    }
    out[name] = r;
    out.sent += Number(r && r.sent) || 0;
    out.rehearsal_rows += Number(r && r.rehearsal_rows) || 0;
    endings[name] = String((r && r.state) || '');
    ((r && r.heard) || []).forEach(function (k) { if (k && !told[k]) told[k] = name; });
    return r;
  };
  var hm = wanted('house_manager') ? run('house_manager', function () {
    return commCallOffTellManager_(rowId, facts, instance, place, ctx);
  }) : null;
  var offer = wanted('cover_offer') ? run('cover_offer', function () {
    return commCallOffOfferSend_(rowId, facts, instance, place, ctx, told, endings);
  }) : null;
  var all = wanted('everyone') ? run('everyone', function () {
    return commCallOffBlast_(rowId, facts, instance, ctx, told, endings, place);
  }) : null;
  // AND THE REASON, TO THE 5558 GROUP ALONE — after the blast, and apart from the ladder: the group's line is…
  var dirs = wanted('directors') ? run('directors', function () {
    return commCallOffTellDirectors_(rowId, facts, instance, place, ctx);
  }) : null;

  // THE HOUSE THAT WAS NEVER NAMED, SAID OUT LOUD ONCE PER CALL-OFF.
  if (wanted('house_manager') && commCallOffSpeaksTo_(facts.kind, 'house_manager') &&
      !String((place && place.house) || '').trim()) {
    try {
      hubSysLog_('asa-hub:comm', 'call_off_house_unresolved',
                 'a call-off was recorded with no house on it — the caller never named one the ' +
                 'hotline could match, so `' + COMM_CALLOFF_MANAGER_SITUATION + '` had nobody ' +
                 'to tell and the cover offer went out saying the house was not named. The ' +
                 'Desk carries the share of recent call-offs that did resolve a house.',
                 { status: 200 });
    } catch (eH) { /* the row's own why carries it too */ }
  }

  // THE ROW CARRIES ALL THREE ANSWERS, AND IT CARRIES THEM IN EVERY POSITION OF THE TWO BRAKES.
  var patch = { id: rowId };
  var put = function (audience, r, extra) {
    var cols = COMM_CALLOFF_STATE_COLS[audience];
    if (!cols || !r) return;
    var rehearsed = !!(ctx.test && r.claimed);
    patch[rehearsed ? cols.test : cols.prod] = r.state;
    // THE CELL IS THE AUDIT AND IT IS ALLOWED TO BE A PARAGRAPH.
    patch[cols.why] = (rehearsed ? COMM_CALLOFF_REHEARSAL_MARK : '') +
                      String(r.why || '').slice(0, COMM_CALLOFF_WHY_MAX);
    patch[cols.at] = ctx.nowIso;
    if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) patch[k] = extra[k]; }
  };
  put('house_manager', hm);
  var everyoneExtra = { everyone_count: String((all && all.sent) || 0) + '/' +
                                        String((all && all.resolved) || 0) };
  /* only when the leg resolved an audience, so an early stop never wipes the list */
  if (all && all.audience_cell) everyoneExtra.everyone_audience = all.audience_cell;
  put('everyone', all, everyoneExtra);
  put('cover_offer', offer);
  put('directors', dirs);
  try { commRecordUpsert_(COMM_CALLOFF_HOUSE, patch); } catch (eU) { /* the answers stand in the log */ }

  // AND THE LEDGER GETS ONE ROW PER AUDIENCE, not one per phone: "who has been told" is answerable from the same…
  [hm, all, offer, dirs].forEach(function (r) {
    if (!r || !(r.sent > 0 || r.redirected > 0)) return;
    try {
      if (typeof smartRecord_ !== 'function') return;
      var key = 'CO|' + String(instance || '') + '|' + String(r.audience || '');
      var rehearsed = !r.sent && r.redirected;
      var ledgerKey = (rehearsed && typeof smartRehearsalKey_ === 'function')
        ? smartRehearsalKey_(key) : key;
      smartRecord_(ledgerKey, String(r.situation || ''), String(facts.name || ''),
                   String(facts.date || ''), rehearsed ? 'rehearsal' : 'sms');
    } catch (eL) { /* the house row carries the proof either way */ }
  });
  return out;
}


// ====================================================================== 7 — THE DOOR THE WRITE CALLS.

// THE PLATFORM HAS JUST RECORDED A CALL-OFF.
function commCallOffRecorded_(row, instance, source, queued) {
  var out = { recorded: false, said: 0, others_sent: 0, carried: 0, rehearsed_rows: 0,
              state: '', why: '', others: null };
  try {
    var facts = commCallOffFacts_(row);
    var inst = String(instance || '');
    if (!inst) { out.why = 'no instance — "never twice" cannot be kept without a stable identity'; return out; }
    if (!facts.person_key) { out.why = 'the recorded row names nobody this lane can key'; return out; }

    var ctx = commCallOffContext_();
    var rowId = commCallOffRowId_(inst, facts.person_key);

    // THE ROW IS WRITTEN BEFORE ANYTHING IS SAID, and it carries both refusals.
    var cover = commCallOffCoverVerdict_(facts);
    var offer = commCallOffCoverCandidates_(facts, ctx.nowMs);
    try {
      commCallOffSheet_();
      var patch = {
        id: rowId, instance: inst,
        person_key: facts.person_key, person_name: facts.name,
        name_from: facts.name_from,
        kind: facts.kind, shift_date: facts.date,
        source: String(source || ''),
        cover_state: 'refused', cover_why: cover.why.slice(0, 500),
        offer_state: offer.ok ? (offer.candidates.length ? 'possible' : 'nobody_passed') : 'unreadable',
        offer_why: String(offer.why || '').slice(0, 500)
      };
      // THE MARK IS NEVER RE-STAMPED, AND THIS IS THE LINE THAT MAKES "NEVER TWICE" TRUE ACROSS EXECUTIONS.
      var known = commCallOffRows_()[rowId];
      if (!known) { patch.subject_state = 'planned'; patch.recorded_at = ctx.nowIso; }
      commRecordUpsert_(COMM_CALLOFF_HOUSE, patch);
      out.recorded = true;
    } catch (eW) {
      out.why = 'the lane\'s own row could not be written: ' + String((eW && eW.message) || eW);
      return out;
    }

    var said = commCallOffSpeakOne_(rowId, facts, inst, ctx);
    out.state = said.state;
    out.why = said.why;
    if (said.said) out.said++;
    out.rehearsed_rows += Number(said.rehearsal_rows) || 0;

    // AND THE THREE OTHER AUDIENCES, IN THIS SAME EXECUTION (section 6B).
    var place = commCallOffPlace_(queued);
    // AND THE ACKNOWLEDGEMENT'S ANSWER TRAVELS WITH THEM — only the address it resolved and the ending it took, so…
    out.others = commCallOffTellOthers_(rowId, facts, inst, place, ctx, said);
    // COUNTED APART FROM `said`, which has always meant "the person who called off was answered".
    out.others_sent = Number(out.others && out.others.sent) || 0;
    // AND WHERE THE WORDS WENT WHEN NOTHING LEFT.
    out.rehearsed_rows += Number(out.others && out.others.rehearsal_rows) || 0;

    // AND THE ONES THAT WERE DEFERRED EARLIER, now that somebody is awake.
    out.carried = commCallOffCarryForward_(ctx, rowId);
  } catch (e) {
    out.why = 'the lane threw and the recorded row stands: ' + String((e && e.message) || e);
    try {
      hubSysLog_('asa-hub:comm', 'comm_call_off_threw',
                 'a call-off was recorded and the lane could not answer it: ' +
                 String((e && e.message) || e), { status: 500 });
    } catch (eL) { /* nothing left to tell */ }
  }
  return out;
}

// WHAT QUIET HOURS DEFERRED, SPOKEN NOW — carried by the next event and by nothing else.
var COMM_CALLOFF_CARRY_HORIZON_MS = 36 * 3600 * 1000;

function commCallOffCarryForward_(ctx, exceptId) {
  var n = 0;
  var rows;
  try { rows = commCallOffRows_(); } catch (e) { return 0; }
  var ids = Object.keys(rows);
  for (var i = 0; i < ids.length && n < COMM_CALLOFF_CARRY_MAX; i++) {
    var id = ids[i];
    if (id === exceptId) continue;
    var r = rows[id];
    if (String(r.subject_state || '') !== 'deferred') continue;
    var recordedMs = commCallOffInstantMs_(r.recorded_at);
    if (isNaN(recordedMs)) continue;
    if (ctx.nowMs - recordedMs > COMM_CALLOFF_CARRY_HORIZON_MS) {
      try {
        commRecordUpsert_(COMM_CALLOFF_HOUSE, { id: id, subject_state: 'stale',
          subject_why: 'deferred past the carry horizon — an acknowledgement this late is a ' +
                       'machine waking up, not reassurance. Left for a person.' });
      } catch (eS) { /* the next event tries again */ }
      continue;
    }
    // `name_from` comes back off the row with everything else.
    var facts = { kind: String(r.kind || ''), date: commCallOffDate_(r.shift_date),
                  name: String(r.person_name || ''), name_from: String(r.name_from || ''),
                  person_key: String(r.person_key || '') };
    var said = commCallOffSpeakOne_(id, facts, String(r.instance || ''), ctx);
    if (said.said) n++;
  }
  return n;
}


// ====================================================================== 7B — WHAT THE QUIET WINDOW HELD, SAID AT…

// THE THREE OTHER AUDIENCES WERE WRITTEN NOT TO WAIT FOR QUIET HOURS — an open shift is now.
var COMM_CALLOFF_QUIET_PROP = 'HUB_CALLOFF_QUIET_HELD';
/** A night's held call-offs. Past it a leg is dropped and its row says so. */
var COMM_CALLOFF_QUIET_MAX = 15;
// THE PLACE'S OWN WORDS DO NOT RIDE THE LIST.
var COMM_CALLOFF_QUIET_REASON_PROP = 'HUB_CALLOFF_QUIET_REASON|';
// A reason is kept whole up to this many characters — at most three bytes each in UTF-8, so 9,000 bytes, inside one…
var COMM_CALLOFF_QUIET_REASON_MAX = 3000;
var COMM_CALLOFF_QUIET_LEGS = ['house_manager', 'cover_offer', 'everyone', 'directors'];

// The store the morning list and its reasons live in — one function, so the self-test can stand in a store with…
function commCallOffQuietProps_() {
  return PropertiesService.getScriptProperties();
}

// One call-off's reason, beside the list.
function commCallOffQuietReasonKeep_(rowId, reason) {
  var r = String(reason == null ? '' : reason).trim();
  if (!r) return true;
  if (r.length > COMM_CALLOFF_QUIET_REASON_MAX) r = r.slice(0, COMM_CALLOFF_QUIET_REASON_MAX - 6) + ' (cut)';
  try {
    commCallOffQuietProps_().setProperty(COMM_CALLOFF_QUIET_REASON_PROP + String(rowId), r);
    return true;
  } catch (e) { return false; }
}

// The reason kept for one call-off, and gone from the store — '' when none was kept or it cannot be read.
function commCallOffQuietReasonTake_(rowId) {
  var key = COMM_CALLOFF_QUIET_REASON_PROP + String(rowId);
  var got = '';
  try {
    var props = commCallOffQuietProps_();
    got = String(props.getProperty(key) || '');
    if (got) props.deleteProperty(key);
  } catch (e) { /* an unreadable reason is a missing line, never a missing leg */ }
  return got;
}

/** Is it inside the send door's quiet window now? The door's own answer. */
function commCallOffQuietNow_() {
  try { return (typeof hubQuietAt_ === 'function') && hubQuietAt_(); }
  catch (e) { return false; }
}

function commCallOffQuietWords_() {
  try { if (typeof hubQuietWords_ === 'function') return hubQuietWords_(); } catch (e) { /* the floor */ }
  return '21:31–07:59 New York';
}

// The morning list, or {} — an unreadable one is an empty one: nothing to carry is the quiet direction.
function commCallOffQuietRead_() {
  try {
    var raw = String(commCallOffQuietProps_().getProperty(COMM_CALLOFF_QUIET_PROP) || '');
    if (!raw) return {};
    var got = JSON.parse(raw);
    return (got && typeof got === 'object' && !Array.isArray(got)) ? got : {};
  } catch (e) { return {}; }
}

function commCallOffQuietWrite_(map) {
  var props = commCallOffQuietProps_();
  if (!Object.keys(map || {}).length) props.deleteProperty(COMM_CALLOFF_QUIET_PROP);
  else props.setProperty(COMM_CALLOFF_QUIET_PROP, JSON.stringify(map));
}

// Runs `fn` under the script lock when it can be had, and without it when it cannot: a lost race costs one entry, a…
function commCallOffQuietLocked_(fn) {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) lock = null;
  } catch (eL) { lock = null; }
  try { return fn(); }
  finally { if (lock) { try { lock.releaseLock(); } catch (eR) { /* the execution releases it */ } } }
}

/** The window's clock: the door's own instant (the self-test names its hour). */
function commCallOffQuietNowMs_() {
  try { if (typeof hubQuietNow_ === 'function') return hubQuietNow_().getTime(); } catch (e) { /* the wall */ }
  return Date.now();
}

// THE SHIFT, AS THE ROSTER ANSWERS IT FOR THE CALL'S OWN INSTANT — { day, start, end } or null.
function commCallOffQuietShiftAt_(facts, place, atMs) {
  var found = null;
  try { found = commCallOffFindShift_(facts, place, atMs); } catch (e) { found = null; }
  if (!found || !found.shift || !found.day) return null;
  return { day: String(found.day), start: commCallOffHm_(found.shift.start),
           end: commCallOffHm_(found.shift.end) };
}

// One leg of one call-off onto the morning list.
function commCallOffQuietKeep_(rowId, audience, place, shift) {
  return commCallOffQuietLocked_(function () {
    try {
      var map = commCallOffQuietRead_();
      var entry = map[rowId];
      var fresh = false;
      if (!entry) {
        if (Object.keys(map).length >= COMM_CALLOFF_QUIET_MAX) return false;
        var p = place || {};
        fresh = true;
        /* THE REASON GOES BESIDE THE LIST, never inside it (the 9 KB value). */
        var hasReason = !!String(p.reason || '').trim();
        var reasonKept = hasReason ? commCallOffQuietReasonKeep_(rowId, p.reason) : false;
        entry = { legs: [], at: new Date(commCallOffQuietNowMs_()).toISOString(),
                  place: { house: String(p.house || ''), manager: String(p.manager || ''),
                           shift_day: String(p.shift_day || ''), day_from_call: p.day_from_call === true } };
        if (hasReason && !reasonKept) entry.place.reason_lost = true;
      }
      if (!Array.isArray(entry.legs)) entry.legs = [];
      if (entry.legs.indexOf(audience) === -1) entry.legs.push(String(audience));
      if (!entry.shift && shift && shift.day && shift.start) entry.shift = shift;
      map[rowId] = entry;
      try {
        commCallOffQuietWrite_(map);
      } catch (eW) {
        /* the entry is not on the list, so its reason must not outlive it */
        if (fresh) commCallOffQuietReasonTake_(rowId);
        throw eW;
      }
      return true;
    } catch (e) {
      return false;
    }
  });
}

// ONE LEG, HELD FOR THE MORNING.
function commCallOffQuietHeld_(res, rowId, sit, vars, dests, facts, instance, place, what) {
  var list = (dests || []).filter(function (d) { return !!String(d || '').trim(); });
  // THE SHIFT, FOUND NOW — the night is the call's own instant — and only by the first leg held for this call-off…
  var shift = null;
  if (!(commCallOffQuietRead_()[rowId] || {}).shift) {
    shift = commCallOffQuietShiftAt_(facts, place, commCallOffQuietNowMs_());
  }
  var kept = commCallOffQuietKeep_(rowId, String(res.audience || ''), place, shift);
  var words = commCallOffQuietWords_();
  res.state = kept ? 'deferred' : 'held';
  res.why = 'held by the quiet window (' + words + '): ' + what + ' resolved (' + list.length +
            ') and NOBODY WAS CONTACTED — ' +
            (kept ? 'the first hotline pass after ' + ((typeof HUB_QUIET_TO !== 'undefined') ? HUB_QUIET_TO : '08:00') +
                    ' says it, if the shift it is about has not ended by then'
                  : 'and it is NOT carried to the morning: the list of held call-offs could not take ' +
                    'it (full at ' + COMM_CALLOFF_QUIET_MAX + ', or out of room), so this one ends here');
  if (typeof commMockHeld_ === 'function' && sit) {
    commCallOffChannelsWithWords_(sit).forEach(function (ch) {
      var isMail = ch === 'email';
      try {
        commMockHeld_({
          channel: ch, to: list.join(', '),
          situation: String(sit.id || ''),
          intent_key: 'CO|' + String(instance || '') + '|' + String(res.audience || ''),
          person_name: String((facts && facts.name) || ''),
          purpose: COMM_CALLOFF_SUBJECT_PURPOSE, to_name: what, reasons: res.why,
          subject: isMail ? smartRender_(sit.email_subject, vars) : '',
          body: isMail ? smartRender_(sit.email_text || sit.sms_text, vars) : smartRender_(sit.sms_text, vars),
          reason: 'call off: ' + String(sit.id || '')
        }, 'the quiet window (' + words + ')', true);
      } catch (eM) { /* the call-off row carries the count and the reason */ }
    });
  }
  return res;
}

/** The day after an ISO day, as an ISO day. */
function commCallOffQuietNextDay_(iso) {
  var t = Date.parse(String(iso || '') + 'T12:00:00Z');
  return isNaN(t) ? '' : new Date(t + 86400000).toISOString().slice(0, 10);
}

// An instant a cell holds, in ms — a Date the grid handed back, or text; NaN for anything else.
function commCallOffInstantMs_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
  var s = String(v == null ? '' : v).trim();
  return s ? Date.parse(s) : NaN;
}

// The New York wall clock at the moment the shift ends, "yyyy-MM-dd HH:mm" — compared as text with the wall clock…
function commCallOffShiftEndWall_(shift) {
  var start = commCallOffHm_(shift.start), end = commCallOffHm_(shift.end);
  if (!end) return String(shift.day) + ' 24:00';
  return (end <= start ? commCallOffQuietNextDay_(shift.day) : String(shift.day)) + ' ' + end;
}

// IS WHAT THE NIGHT HELD STILL TRUE THIS MORNING?
function commCallOffQuietTruth_(entry, r, ctx) {
  var place = commCallOffPlace_((entry && entry.place) || {});
  var facts = { kind: String(r.kind || ''), date: commCallOffDate_(r.shift_date),
                name: String(r.person_name || ''), name_from: String(r.name_from || ''),
                person_key: String(r.person_key || '') };
  var out = { why: '', facts: facts, place: place };
  var recordedMs = commCallOffInstantMs_(r.recorded_at);
  if (isNaN(recordedMs)) recordedMs = commCallOffInstantMs_(entry && entry.at);
  if (!isNaN(recordedMs) && ctx.nowMs - recordedMs > COMM_CALLOFF_CARRY_HORIZON_MS) {
    out.why = 'it was recorded more than a day and a half ago';
    return out;
  }
  var nowAt = new Date(ctx.nowMs);
  var today = Utilities.formatDate(nowAt, 'America/New_York', 'yyyy-MM-dd');
  var nowWall = today + ' ' + Utilities.formatDate(nowAt, 'America/New_York', 'HH:mm');
  // THE SHIFT: the one found the night it was held, else the roster's answer AS OF THE CALL.
  var shift = (entry && entry.shift && entry.shift.day && entry.shift.start) ? entry.shift : null;
  if (!shift) shift = commCallOffQuietShiftAt_(facts, place, isNaN(recordedMs) ? ctx.nowMs : recordedMs);
  if (shift) {
    var endWall = commCallOffShiftEndWall_(shift);
    if (nowWall >= endWall) {
      out.why = 'the shift it was about (' + shift.day + ' ' + commCallOffHm_(shift.start) +
                (shift.end ? '–' + commCallOffHm_(shift.end) : '') + ') is over';
      return out;
    }
    place.shift_day = String(shift.day);
    place.shift_start = commCallOffHm_(shift.start);
    return out;
  }
  // NO SHIFT ON THE ROSTER: only a day somebody NAMED can stand in for it, and only while that day lasts.
  var named = place.day_from_call ? place.shift_day : facts.date;
  if (!named) {
    out.why = 'the call did not say which day, and the roster shows no shift it could have been about';
  } else if (named < today) {
    out.why = 'the day of the shift (' + named + ') is over';
  }
  return out;
}

// THE MORNING.
function commCallOffQuietCarry_() {
  var out = { carried: 0, stale: 0, waiting: 0 };
  var first = commCallOffQuietRead_();
  if (!Object.keys(first).length) return out;
  if (commCallOffQuietNow_()) { out.waiting = Object.keys(first).length; return out; }
  var map = commCallOffQuietLocked_(function () {
    var m = commCallOffQuietRead_();
    try { commCallOffQuietWrite_({}); } catch (eW) { /* carried below either way; a re-run meets the claims */ }
    return m;
  }) || {};
  var ids = Object.keys(map);
  if (!ids.length) return out;
  // EACH REASON COMES BACK FROM BESIDE THE LIST — and leaves the store — for every entry, carried or stale, so none…
  ids.forEach(function (id) {
    var e = map[id];
    if (!e || typeof e !== 'object') return;
    if (!e.place || typeof e.place !== 'object') e.place = {};
    var taken = commCallOffQuietReasonTake_(id);
    if (taken) e.place.reason = taken;
  });
  var ctx = commCallOffContext_();
  var rows = {};
  try { rows = commCallOffRows_() || {}; } catch (eR) { rows = {}; }
  ids.forEach(function (id) {
    var entry = map[id] || {};
    var legs = {};
    (entry.legs || []).forEach(function (l) {
      if (COMM_CALLOFF_QUIET_LEGS.indexOf(String(l)) !== -1) legs[String(l)] = true;
    });
    if (!Object.keys(legs).length) return;
    var r = rows[id];
    var truth = null;
    if (r) {
      // A TRUTH THAT CANNOT BE CHECKED IS NOT A YES — and one entry's throw must not cost the others their morning.
      try { truth = commCallOffQuietTruth_(entry, r, ctx); }
      catch (eTr) { truth = { why: 'its shift could not be checked (' + String((eTr && eTr.message) || eTr) + ')' }; }
    }
    var why = r ? truth.why : 'the call-off row is no longer in the house';
    if (why) {
      out.stale++;
      if (!r) return;
      var patch = { id: id };
      Object.keys(legs).forEach(function (leg) {
        var cols = COMM_CALLOFF_STATE_COLS[leg];
        if (!cols) return;
        patch[cols.prod] = 'stale';
        patch[cols.why] = 'the quiet window (' + commCallOffQuietWords_() + ') held this, and by the ' +
                          'morning it was no longer true — ' + why + ' — so nobody was told';
        patch[cols.at] = ctx.nowIso;
      });
      try { commRecordUpsert_(COMM_CALLOFF_HOUSE, patch); } catch (eS) { /* the log says it below */ }
      return;
    }
    /* A shift filled overnight is not asked about at eight; the manager's and 5558 legs still go. */
    if (String(r.covered_filled_at || '').trim()) {
      var gone = { id: id };
      ['everyone', 'cover_offer'].forEach(function (leg) {
        if (!legs[leg]) return;
        delete legs[leg];
        var colsG = COMM_CALLOFF_STATE_COLS[leg];
        gone[colsG.prod] = 'stopped';
        gone[colsG.why] = 'the quiet window (' + commCallOffQuietWords_() + ') held this, and the shift was ' +
                          'covered before the morning (' + String(r.covered_filled_at) + ') — nobody is ' +
                          'asked to take a shift that is gone, so nobody was told';
        gone[colsG.at] = ctx.nowIso;
      });
      if (Object.keys(gone).length > 1) {
        try { commRecordUpsert_(COMM_CALLOFF_HOUSE, gone); } catch (eG) { /* the log says it below */ }
      }
      if (!Object.keys(legs).length) { out.stale++; return; }
    }
    try {
      commCallOffTellOthers_(id, truth.facts, String(r.instance || ''), truth.place, ctx, null, legs);
      out.carried++;
    } catch (eT) { /* commCallOffTellOthers_ never throws; a row that did is left for a person */ }
  });
  try {
    hubSysLog_('asa-hub:comm', 'call_off_quiet_carried',
               out.carried + ' call-off(s) the quiet window held were said this morning · ' + out.stale +
               ' no longer true and let go', { status: 200 });
  } catch (eL) { /* the rows carry it */ }
  return out;
}


// ====================================================================== 8 — THE HONEST READING: A ZERO IS NEVER A…

// "NOTHING HAS ARRIVED SINCE <THE SOURCE'S NEWEST DATE>", NEVER "NOTHING HAS ARRIVED".
function commCallOffNewest_() {
  var out = { rows: 0, newest: '', unreadable: 0, kinds: {}, read: false, why: '' };
  var rows;
  try { rows = listRows_('callOffs', {}); } catch (e) {
    out.why = 'the call-off house could not be read — this is "we cannot see", never "nobody called off"';
    return out;
  }
  if (rows === null || rows === undefined) {
    out.why = 'the call-off house answered nothing at all — a read that failed is not an empty book';
    return out;
  }
  out.read = true;
  out.rows = rows.length;
  rows.forEach(function (r) {
    var facts = commCallOffFacts_(r);
    if (!facts.date) { out.unreadable++; return; }
    if (!out.newest || facts.date > out.newest) out.newest = facts.date;
    var k = facts.kind || 'unrecognised';
    out.kinds[k] = (out.kinds[k] || 0) + 1;
  });
  out.why = out.rows
    ? (out.newest
        ? 'nothing has arrived since ' + out.newest +
          (out.unreadable ? ' — and ' + out.unreadable + ' row(s) carry a date this lane could not read, ' +
                            'so the real newest may be later than that' : '')
        : 'the house holds ' + out.rows + ' row(s) and NOT ONE of them carries a date this lane ' +
          'can read — the freshness of this source is unknown, which is not the same as old')
    : 'the call-off house is empty. That is a statement about the HOUSE, not about the world: ' +
      'a call-off arrives by telephone through the Employee Support Hotline, and if the hotline ' +
      'port is not running, people are calling off into a book nothing writes.';
  return out;
}

// WHAT THIS LANE CAN AND CANNOT DO RIGHT NOW, in one answer — built so that anybody can tell "nobody called off"…
var COMM_CALLOFF_REACH_KEY = 'comm_call_off_manager_reach:v1';
var COMM_CALLOFF_REACH_TTL = 600;

function commCallOffManagerReach_(each) {
  // HELD FOR A FEW MINUTES WHEN NOBODY IS WALKING THE ROWS ANYWAY.
  if (typeof each !== 'function') {
    try {
      var hit = CacheService.getScriptCache().get(COMM_CALLOFF_REACH_KEY);
      if (hit) return JSON.parse(hit);
    } catch (eC) { /* unreadable: count it now */ }
  }
  var seen = 0, resolved = 0, nobody = 0;
  try {
    var rows = commCallOffRows_();
    Object.keys(rows).forEach(function (k) {
      if (typeof each === 'function') { try { each(rows[k]); } catch (eE) { /* one row */ } }
      var m = String(rows[k].manager_state || rows[k].manager_test_state || '');
      if (!m || m === 'not_owed') return;
      seen++;
      if (m === 'nobody') nobody++;
      else resolved++;
    });
  } catch (e) { /* the house may not exist yet — that is a state, not an error */ }
  var answer = {
    call_offs: seen, resolved: resolved, no_house_manager: nobody,
    at: new Date().toISOString(),
    why: seen
      ? resolved + ' of ' + seen + ' recorded call-off(s) resolved a house manager this row ' +
        'could tell; the other ' + nobody + ' named no house the hotline could match, and ' +
        'nothing was sent about them'
      : 'no call-off has reached this row yet, so its reach is not yet measured — the house is ' +
        'matched from the caller\'s own description of the request'
  };
  try {
    CacheService.getScriptCache().put(COMM_CALLOFF_REACH_KEY, JSON.stringify(answer),
                                      COMM_CALLOFF_REACH_TTL);
  } catch (eP) { /* unremembered is only slower */ }
  return answer;
}

// THE OTHER SENDER, NAMED, BECAUSE THIS PLATFORM DOES NOT OWN THE PHONE.
var COMM_CALLOFF_LEGACY_SENDER = {
  name: 'the hotline\'s own Call Off Processor v1.3',
  what: 'it detects the call-off in the transcript, fuzzy-matches the employee, finds the ' +
        'House Lead and texts her through OpenPhone — the same woman this row texts, about ' +
        'the same absence',
  words: 'CALL OFF ALERT: <name> called off <date> at <house>. Reason: <the caller\'s own ' +
         'words> — it carries the reason, which this lane refuses to send',
  last_seen: 'the newest CALL OFF ALERT the platform can see is from 2026-03-20, delivered to ' +
             'three destinations; that message log has recorded nothing since, while the legacy ' +
             'project itself still runs',
  proved: 'the sender, its wording and its delivery',
  unknown: 'whether it spoke this week — the log that would say went quiet, and a quiet log is ' +
           'NOT a disarmed sender',
  risk: 'arming this row means the House Lead may hear about one absence twice, from two ' +
        'systems that cannot see each other\'s ledger',
  lifts_when: 'the legacy processor is retired, or its per-call-off send becomes readable from ' +
              'here'
};

function commCallOffLegacySender_() {
  return COMM_CALLOFF_LEGACY_SENDER;
}

function commCallOffLaneState_() {
  var source = commCallOffNewest_();
  var sit = commCallOffSituation_(COMM_CALLOFF_SUBJECT_SITUATION);
  var offerSit = commCallOffSituation_(COMM_CALLOFF_OFFER_SITUATION);
  var unreached = commCallOffSubjectIsUnreached_();
  var roster = commCallOffCoverCandidates_({ person_key: '', date: '' }, Date.now());
  var told = 0, deferred = 0, held = 0, notOwed = 0;
  // THE REACH OF THE HOUSE-MANAGER ROW, MEASURED RATHER THAN ASSUMED.
  var reach = commCallOffManagerReach_(function (row) {
    var s = String(row.subject_state || '');
    if (s === 'told') told++;
    else if (s === 'deferred') deferred++;
    else if (s === 'not_owed') notOwed++;
    else if (s) held++;
  });
  return {
    source: source,
    can_fire: !!(sit && unreached.ok && commCallOffPurposeOk_(COMM_CALLOFF_SUBJECT_PURPOSE)),
    subject: {
      situation: COMM_CALLOFF_SUBJECT_SITUATION,
      declared: !!sit,
      why: sit ? 'the situation is on and carries words'
               : 'the situation is absent, switched off, or still wordless — nothing can be said',
      nothing_else_reaches_them: unreached.ok, nothing_else_why: unreached.why,
      purpose: COMM_CALLOFF_SUBJECT_PURPOSE,
      purpose_declared: commCallOffPurposeOk_(COMM_CALLOFF_SUBJECT_PURPOSE),
      told: told, deferred: deferred, held: held, not_owed: notOwed
    },
    cover: commCallOffCoverVerdict_(null),
    // THE THREE THAT NOW HAVE A SENDER, each answering the one question worth asking of a switch: would anything…
    others: {
      house_manager: {
        situation: COMM_CALLOFF_MANAGER_SITUATION,
        declared: !!commCallOffOtherSituation_(COMM_CALLOFF_MANAGER_SITUATION),
        sender: 'CommCallOff.gs commCallOffTellManager_',
        audience: 'the manager the hotline resolves for that shift — no cell, and no guess',
        // THE MATCH RATE IS THE REACH, and it is published as a number rather than as an adjective: a lane that…
        reach: reach,
        // AND THE SENDER THE PLATFORM DOES NOT OWN.
        also_sent_by: commCallOffLegacySender_(),
        why: 'fired by the write that records the call-off, once per call-off; wordless means ' +
             'silent; the send door\'s quiet window (' + commCallOffQuietWords_() + ') holds it ' +
             'to 08:00, when it goes if the shift has not ended; and the shift\'s own manager ' +
             'hears about a call-off from this row rather than from the cover offer'
      },
      everyone: {
        situation: COMM_CALLOFF_EVERYONE_SITUATION,
        declared: !!commCallOffOtherSituation_(COMM_CALLOFF_EVERYONE_SITUATION),
        sender: 'CommCallOff.gs commCallOffBlast_',
        // ONE SENTENCE ABOUT THIS AUDIENCE, AND IT IS THE RESOLVER'S OWN.
        audience: 'the row\'s own `Goes to`, where `allstaff` resolves to ' +
                  commCallOffKeywordLabel_('allstaff'),
        why: 'fires only for a kind that leaves a shift with nobody in it; never retried once ' +
             'it starts; the row records how many were reached AS IT GOES; the send door\'s ' +
             'quiet window (' + commCallOffQuietWords_() + ') holds it before it starts and it ' +
             'goes at 08:00 if the shift has not ended; and anybody already told about this ' +
             'call-off as the house manager or as a decider is not asked again here'
      },
      cover_offer: {
        situation: COMM_CALLOFF_OFFER_SITUATION,
        declared: !!commCallOffOtherSituation_(COMM_CALLOFF_OFFER_SITUATION),
        sender: 'CommCallOff.gs commCallOffOfferSend_',
        audience: 'the row\'s own `Goes to`, where `housemanagers` resolves to ' +
                  commCallOffKeywordLabel_('housemanagers') +
                  ' — minus the manager of that shift, who is told by `' +
                  COMM_CALLOFF_MANAGER_SITUATION + '` instead',
        suggestion: 'NOT IN THIS BUILD — the cover ranking arrives with the cover-suggestion ' +
                    'engine, and there is no {suggestion} placeholder until it does',
        why: 'fired by the write that records the call-off, once per call-off; the send door\'s ' +
             'quiet window (' + commCallOffQuietWords_() + ') holds it to 08:00, when it goes if ' +
             'the shift has not ended — the same law the blast is under'
      }
    },
    offer: {
      situation: COMM_CALLOFF_OFFER_SITUATION,
      declared: !!offerSit,
      purpose: COMM_CALLOFF_OFFER_PURPOSE,
      roster_readable: roster.ok, roster_rows: roster.roster_rows,
      // THE READABILITY OF THE ROSTER, NOT A COUNT OF CANDIDATES.
      why: roster.ok
        ? 'the roster answered with ' + roster.roster_rows + ' row(s); who could be asked is ' +
          'computed per call-off, against that call-off\'s own day'
        : roster.why
    },
    dial: (typeof commDial_ === 'function') ? commDial_() : 'off',
    test_mode: (typeof commTestMode_ === 'function') ? commTestMode_() : false
  };
}


// ====================================================================== 9 — THE DOORS…

// THE READING.
HUB_POLICY.callOffLaneState = {
  file: 'CommCallOff.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.callOffLaneState = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && ['admin', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  return { status: 200, data: commCallOffLaneState_() };
};

// THE REPLAY.
HUB_POLICY.callOffSpeak = {
  file: 'CommCallOff.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { instance: { type: 'string' }, employee_name: { type: 'string' },
            type: { type: 'string' }, date: { type: 'string' } },
  invalidates: [], emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.callOffSpeak = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && String(user.role) !== 'admin') return hubDenied_();
  var p = payload || {};
  var instance = String(p.instance || '').trim();
  if (!instance) {
    return { status: 400, message:
      'This door needs `instance` — the stable identity of ONE call-off. Without it the ' +
      '"one acknowledgement per person per call-off" mark has nothing to hold on to, and a ' +
      'second press would be a second message to somebody who already heard from us.' };
  }
  var facts = commCallOffFacts_({ employee_name: p.employee_name, type: p.type, date: p.date });
  if (!facts.person_key) return { status: 400, message: 'No employee_name this lane can key.' };
  if (!facts.kind) {
    return { status: 400, message:
      'The type "' + String(p.type || '') + '" is not one this platform declares. The four are ' +
      'Call Off, No Show No Call, Late Show and Sent Home — and they are not one fact.' };
  }
  var out = commCallOffRecorded_({ employee_name: p.employee_name, type: p.type, date: p.date },
                                 instance, 'door:' + String(user.email || 'admin'));
  return { status: 200, data: out };
};
