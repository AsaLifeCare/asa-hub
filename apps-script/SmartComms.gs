/** SMART COMMS — every message this platform sends, as configuration. */

var SMART_TAB = 'smart_comms';
var SMART_LEDGER_TAB = 'smart_comms_sent';
// THE CACHE KEY CARRIES THE CODE BUILD, because software has to be able to force the read again when the problem is…
function smartCacheKey_() {
  var build = '';
  try { build = (typeof HUB_CODE_BUILD !== 'undefined') ? String(HUB_CODE_BUILD) : ''; }
  catch (e) { build = ''; }
  return 'smart_comms_cfg_v1|' + build;
}

/** The old constant, kept because several places bust the cache by name. */
var SMART_CACHE_KEY = 'smart_comms_cfg_v1';

// Drop the cached config.
function smartCacheBust_() {
  SMART_SITUATIONS_MEMO = null;
  try {
    var c = CacheService.getScriptCache();
    c.remove(smartCacheKey_());
    c.remove(smartCacheKey_() + ':n');
    c.remove(SMART_CACHE_KEY);
  } catch (e) { /* the 300s TTL still expires it */ }
  // The gates' armed map is read from these rows (SmartGate.gs), so it goes with them.
  try { if (typeof hubGatesArmedBust_ === 'function') hubGatesArmedBust_(); }
  catch (eG) { /* its own 300s TTL expires it */ }
}

/** One row per situation. */
var SMART_HEADER = ['id', 'enabled', 'credential', 'days_before', 'statuses',
                    'kind', 'direction', 'to', 'exclude_column', 'exclude_values',
                    'channels', 'cc', 'label', 'sender', 'sms_text', 'email_subject', 'email_text',
                    'note',
                    // The third species: fires on a funnel event, not a date.
                    'event',
                    // Delivery pacing: how many times one key may be told, and how often it may be told again.
                    'max_attempts', 'frequency',
                    // The designed letter a situation wears on the e-mail leg: names a letter in MailTemplates.gs…
                    'email_design',
                    // THE FIFTH SPECIES — the prompt stays outside, only the request lives here, as a new kind…
                    'ai_model', 'ai_providers',
                    // THE HOURS OF THE DAY THIS ROW MAY SPEAK.
                    'send_at',
                    // A ROW'S OWN SHEET.
                    'record_to',
                    // the line this row's texts leave from (Rpc.gs rpcSituationLine_); blank = Automations
                    'from_line'];

// THE HEADER MAY BE EXTENDED FROM THE BOOK — AND ONLY EXTENDED.
function smartHeader_() {
  if (typeof hubBookRows_ !== 'function') return SMART_HEADER;
  var rows = hubBookRows_('Smart Header');
  if (!rows.length) return SMART_HEADER;
  var want = [];
  for (var i = 0; i < rows.length; i++) {
    var c = String(rows[i].column || '').trim();
    if (c) want.push(c);
  }
  if (want.length < SMART_HEADER.length) return SMART_HEADER;
  for (var n = 0; n < SMART_HEADER.length; n++) {
    if (want[n] !== SMART_HEADER[n]) {
      try {
        hubSysLog_('asa-hub:smart', 'smart_header_refused',
                   'the book\'s column ' + (n + 1) + ' is "' + want[n] +
                   '" where the engine has "' + SMART_HEADER[n] +
                   '" — this header is POSITIONAL against a live sheet, so it ' +
                   'may only be appended to. The compiled header answers.',
                   { status: 409 });
      } catch (eL) { /* the floor answers either way */ }
      return SMART_HEADER;
    }
  }
  return want;
}

// The pacing vocabulary — word → days between tells.
var SMART_FREQUENCIES = {
  once: 0,
  daily: 1,
  every_other_day: 2,
  weekly: 7,
  monthly: 30
};

// ---- THE HOURS A ROW MAY SPEAK ------------------------------------------- `frequency` could only ever say how…

// How late an hour may still be kept.
var SMART_SLOT_GRACE_MIN = 60;

/** More hours than this on one row is a cell somebody pasted by accident. */
var SMART_SLOTS_MAX = 24;

/** `09:00` from 540. */
function smartSlotLabel_(min) {
  var h = Math.floor(min / 60), m = min % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// READ THE CELL.
function smartSlotsParse_(value) {
  var out = { slots: [], labels: [], bad: [], over: 0 };
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return out;
  var seen = {};
  raw.split(/[,;\n|]+/).forEach(function (piece) {
    var t = String(piece).trim().toLowerCase();
    if (!t) return;
    var m = /^(\d{1,2})\s*(?::|h)?\s*(\d{2})?\s*(am|pm|a|p)?\.?$/.exec(t);
    if (!m) { out.bad.push(String(piece).trim()); return; }
    var h = parseInt(m[1], 10);
    var mi = m[2] ? parseInt(m[2], 10) : 0;
    var ap = m[3] ? m[3].charAt(0) : '';
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    if (isNaN(h) || isNaN(mi) || h > 23 || mi > 59) { out.bad.push(String(piece).trim()); return; }
    var min = h * 60 + mi;
    if (seen[min]) return;
    seen[min] = true;
    out.slots.push(min);
  });
  out.slots.sort(function (a, b) { return a - b; });
  if (out.slots.length > SMART_SLOTS_MAX) {
    out.over = out.slots.length - SMART_SLOTS_MAX;
    out.slots = out.slots.slice(0, SMART_SLOTS_MAX);
  }
  out.labels = out.slots.map(smartSlotLabel_);
  return out;
}

/** Now, on the server's clock: the day it is, and how far into it we are. */
function smartClockNow_(nowMs) {
  var when = new Date(nowMs || Date.now());
  var tz = '';
  try { tz = Session.getScriptTimeZone(); } catch (eTz) { tz = ''; }
  var day = '', hm = '';
  if (tz) {
    try {
      day = Utilities.formatDate(when, tz, 'yyyy-MM-dd');
      hm = Utilities.formatDate(when, tz, 'HH:mm');
    } catch (eF) { day = ''; hm = ''; }
  }
  if (!day || !hm) {
    var iso = when.toISOString();
    day = iso.slice(0, 10);
    hm = iso.slice(11, 16);
  }
  return { day: day, hm: hm,
           min: parseInt(hm.slice(0, 2), 10) * 60 + parseInt(hm.slice(3, 5), 10) };
}

// IS THIS ROW'S HOUR STANDING RIGHT NOW?
function smartScheduleNow_(situation, nowMs) {
  var parsed = smartSlotsParse_(situation && situation.send_at);
  if (!parsed.slots.length) {
    return { scheduled: false, holds: false, slot: '', labels: [] };
  }
  var now = smartClockNow_(nowMs);
  var standing = -1;
  parsed.slots.forEach(function (min) {
    var late = now.min - min;
    if (late >= 0 && late <= SMART_SLOT_GRACE_MIN) standing = min;   // the newest wins
  });
  if (standing < 0) {
    var next = '';
    for (var n = 0; n < parsed.slots.length; n++) {
      if (parsed.slots[n] > now.min) { next = parsed.labels[n]; break; }
    }
    return { scheduled: true, holds: true, slot: '', labels: parsed.labels,
             next: next || (parsed.labels[0] + ' tomorrow') };
  }
  return { scheduled: true, holds: false, labels: parsed.labels,
           label: smartSlotLabel_(standing),
           slot: now.day + 'T' + smartSlotLabel_(standing) };
}

// DOES A SCHEDULED ROW NEED THE REMINDER SWEEP RUN NOW?
function smartScheduleWaiting_() {
  var waiting = [];
  try {
    smartSituations_().forEach(function (s) {
      if (!smartOn_(s.enabled)) return;
      var sched = smartScheduleNow_(s, Date.now());
      if (!sched.scheduled || sched.holds) return;
      waiting.push({ id: String(s.id || ''), slot: sched.slot });
    });
  } catch (e) { return []; }
  if (!waiting.length) return [];
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (!cache) return waiting;
  return waiting.filter(function (w) {
    return !cache.get('smart_slot_' + w.id + '_' + w.slot);
  });
}

// This hour has been run.
function smartScheduleMarkRun_(waiting) {
  try {
    var cache = CacheService.getScriptCache();
    (waiting || []).forEach(function (w) {
      cache.put('smart_slot_' + w.id + '_' + w.slot, '1', 7200);
    });
  } catch (e) { /* the ledger is still the memory that matters */ }
}

/** THE EVENTS — what can happen that is worth telling somebody about. */
var SMART_EVENTS = {
  // A CALL OFF HEARD BY THE HOTLINE (the Employee Support Hotline port).
  hotline_call_off: {
    label: 'A DSP called off through the hotline',
    subject: 'hotline',
    applies: function (r) {
      if (!r || !r.id || !r.employee) return { fires: false };
      return { fires: true, instance: str_(r.instance),
               vars: { employee: str_(r.employee), date: str_(r.date),
                       reason: str_(r.reason), location: str_(r.location),
                       manager: str_(r.manager) } };
    }
  },
  // A TRIP THAT CAME HOME WITHOUT ITS STORY ("de vida ao Business Travel de verdade").
  travel_outcome_missing: {
    label: 'A business trip ended and its outcome is still unwritten',
    subject: 'travel',
 // to_subject: the header always promised "at traveller"; the subject rows now carry email/phone so it can be kept.
    to_subject: true,
    applies: function (r) {
      if (!r || !r.id || !r.destination) return { fires: false };
      return { fires: true, instance: str_(r.id) + ':' + str_(r.endDate),
               vars: { name: str_(r.name), destination: str_(r.destination),
                       days: str_(r.days), end_date: str_(r.endDate) } };
    }
  },
  // A WATCHED ITEM WORTH CHECKING (same day — "de vida ao Smart Shopper").
  shopper_worth_checking: {
    label: "Smart Shopper — an item's estimate beat its target",
    subject: 'shopperOwners',
    to_subject: true,
    applies: function (r) {
      if (!r || !r.ownerId || !r.count) return { fires: false };
      return { fires: true, instance: str_(r.ownerId) + ':' + str_(r.count) + ':' + str_(r.first),
               vars: { name: str_(r.name), first_name: str_(r.name).split(' ')[0],
                       count: str_(r.count), first: str_(r.first),
                       best: str_(r.bestText) } };
    }
  },
  /** A card sync that finished. Subject `sync`: the rows are runs, not people. */
  truelink_run: {
    label: 'A TrueLink sync finished',
    subject: 'sync',
    applies: function (r) {
      if (!r || !r.id) return { fires: false };
      return { fires: true, instance: str_(r.id),
               vars: { mode: str_(r.mode), verb: str_(r.verb),
                       found: str_(r.found), skipped: str_(r.skipped),
                       unreadable: str_(r.unreadable), tail: str_(r.tail) } };
    }
  },
  /** An IST the employee owes. */
  ist_due: {
    label: 'An employee owes an IST for a client',
    subject: 'staff',
    to_subject: true,
    applies: function (r) {
      if (!r || !r.id || !r.client) return { fires: false };
      return { fires: true, instance: str_(r.instance),
               vars: { client: str_(r.client), house: str_(r.house),
                       due: str_(r.due), cert_note: str_(r.certNote) } };
    }
  },
  // A questionnaire somebody still owes — the questionnaires belong in the smart comms too.
  questionnaire_due: {
    label: 'A questionnaire somebody has not answered yet',
    subject: 'staff',
    to_subject: true,
    applies: function (r) {
      if (!r || !r.id || !r.questionnaire) return { fires: false };
      return { fires: true, instance: str_(r.instance),
               vars: { questionnaire: str_(r.questionnaire), questions: str_(r.questions),
                       minutes: str_(r.minutes), link: str_(r.link), period: str_(r.period) } };
    }
  },
  /** A finished onboarding. */
  onboarding_report: {
    label: 'Somebody finished their onboarding',
    subject: 'onboarding',
    applies: function (r) {
      if (!r || !r.id) return { fires: false };
      return { fires: true, instance: str_(r.instance),
               vars: { name: str_(r.name), phone: hubPhoneE164_(str_(r.phone)), email: str_(r.email),
                       step1: str_(r.step1), step2: str_(r.step2), step3: str_(r.step3),
                       step4: str_(r.step4), step5: str_(r.step5), step6: str_(r.step6),
                       report: str_(r.report) } };
    }
  },
  /** The receipt chase — the first situation whose subject is a CLIENT. */
  finance_receipts_missing: {
    label: 'Receipts still owed on a client ledger',
    subject: 'client',
    applies: function (c) {
      if (!c || !c.missing) return { fires: false };
      return { fires: true,
               // The month IS the instance: a new month is a new chase, and the ledger key must not suppress it…
               instance: str_(c.month),
               vars: { count: String(c.missing), month: str_(c.month),
                       oldest: str_(c.oldest), total: str_(c.total) } };
    }
  },
 /** A recon run with errors (Recon.gs). */
  recon_errors_found: {
    label: 'A time reconciliation run found errors',
    subject: 'recon',
    applies: function (r) {
      if (!r || !r.id || !r.total) return { fires: false };
      return { fires: true, instance: str_(r.id),
               vars: { runId: str_(r.id), total: str_(r.total),
                       missing: str_(r.missing), noEnd: str_(r.noEnd),
                       dupe: str_(r.dupe), gap: str_(r.gap),
                       overlap: str_(r.overlap), period: str_(r.period) } };
    }
  },
 /** A punch reminder to the employee (Recon.gs). */
  recon_punch_reminder: {
    label: 'A punch reminder to an employee',
    subject: 'staff',
    to_subject: true,
    applies: function (r) {
      if (!r || !r.id || !r.reminderQueuedAt) return { fires: false };
      return { fires: true, instance: str_(r.reminderQueuedAt),
               vars: { date: str_(r.date), location: str_(r.location),
                       hours: str_(r.hours), what: str_(r.what) } };
    }
  },
  /** New Hire packet still missing while the card is held at Onboarding. */
  packet_missing: {
    label: 'New Hire packet not on file',
    // The legacy column that already recorded this alert.
    legacy: 'packetamberalertedat',
    applies: function (c) {
      var h = null;
      try { h = packetHold_(c); } catch (e) { h = null; }
      if (!h) return { fires: false };
      return { fires: true, instance: str_(h.since),
               vars: { since: str_(h.since).slice(0, 10), day: str_(h.until).slice(0, 10) } };
    }
  },
  /** The candidate's day to produce the signed packet ran out. */
  packet_day_elapsed: {
    label: 'New Hire packet — their day ran out',
    legacy: 'packetoverduealertedat',
    applies: function (c) {
      var h = null;
      try { h = packetHold_(c); } catch (e) { h = null; }
      if (!h || h.escalate !== true) return { fires: false };
      return { fires: true, instance: str_(h.until),
               vars: { since: str_(h.since).slice(0, 10), day: str_(h.until).slice(0, 10) } };
    }
  },
  /** An extension somebody granted has run out — the card is RED. */
  deadline_extended_expired: {
    label: 'An extended deadline expired (the card is RED)',
    legacy: 'packetredalertedat',
    applies: function (c) {
      var u = null;
      try { u = hubCardUrgency_(c); } catch (e) { u = null; }
      if (!u || u.level !== 'red') return { fires: false };
      // The extension's own end date is the occurrence: extend again, and a second expiry is a second event.
      return { fires: true, instance: str_(c.onboardingaccessuntil) || str_(u.why),
               vars: { why: str_(u.why) } };
    }
  },
  // The Flow calendar's scheduling e-mail (HiringFlow.gs).
  hiring_event_scheduled: {
    label: 'An appointment was scheduled (fired by the action, never the clock)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  // THE HIRING MESSAGES, MOVED HOME.
  hiring_date_accepted: {
    label: 'Date Accepted could not be read (fired by the screening, never the clock)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  hiring_hired_complete: {
    label: 'Hired — everything green (fired by the graduation sweep)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  hiring_hired_missing: {
    label: 'Hired — items missing (fired by the graduation sweep)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  hiring_packet_request: {
    label: 'New Hire packet request to the candidate (fired by the packet sweep)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  hiring_ready_to_start: {
    label: 'Ready to start — hiring finished (fired by the becoming-staff sweep)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  hiring_phone_collect: {
    label: 'An e-mail-only candidate asked for a phone number (fired by the collect ladder)',
    legacy: 'hiring_sim_asks:phone_collect',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  hiring_phone_confirm: {
    label: 'A collected phone confirmed by a YES text (fired by the confirm ladder)',
    legacy: 'hiring_sim_asks:phone_confirm',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  hiring_contact_failed: {
    label: 'The team told a candidate could not be reached for their phone',
    legacy: 'hiring_sim_asks:phone_* settled once the team is told',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  hiring_referral_contact: {
    label: 'The referrer asked for the candidate\'s contact (fired by the referral relay)',
    subject: 'sync', legacy: 'hiring_sim_asks:referral_relay',
    applies: function () { return { fires: false }; }
  },
  hiring_screen_report: {
    label: 'The AI screening report to the team (fired when the analysis completes)',
    legacy: 'hiring_journey:screen_report (once per candidate)',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  interview_slots_ask: {
    label: 'The interviewer asked for slots, date and time (fired by the interview-start sweep)',
    subject: 'sync', legacy: 'interview_asks:slots_requested',
    applies: function () { return { fires: false }; }
  },
  hiring_scorecard_report: {
    label: 'The signed scorecard to the team (fired on save)',
    legacy: 'hiring_journey:interview_scored (once per scorecard)',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  hiring_cjis_gate: {
    label: 'The missing-CJIS question at the onboarding door',
    legacy: 'hiring_journey:cjis_gate (once per candidate)',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  hiring_onboarding_finish: {
    label: 'Finish-your-onboarding letters with the login inside (fired by the abandon ladder)',
    legacy: 'hiring_sim_asks:onboarding_finish',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  hiring_onboarding_stalled: {
    label: 'The team told an onboarding began and stopped',
    legacy: 'hiring_sim_asks:onboarding_finish settled once the team is told',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  hiring_hired_congrats: {
    label: 'The candidate congratulated on reaching Hired',
    legacy: 'hiring_journey:hired_congrats (once per candidate)',
    subject: 'sync', applies: function () { return { fires: false }; }
  },
  interview_days_ask: {
    label: 'Asking the interviewer which days she can take (fired by the interview-start sweep)',
    subject: 'sync',
    legacy: 'interview_asks:days_asked_at',
    applies: function () { return { fires: false }; }
  },
  hiring_welcome: {
    label: 'The welcome message (a person\'s press)',
    subject: 'sync', legacy: 'sending for weeks as a config-worded call',
    applies: function () { return { fires: false }; }
  },
  hiring_ask: {
    label: 'The are-we-hiring ask to the deciders (store lane, step 0)',
    subject: 'sync', legacy: 'sending for weeks as a config-worded call',
    applies: function () { return { fires: false }; }
  },
  hiring_shortlist: {
    label: 'The ranked shortlist to the deciders',
    subject: 'sync', legacy: 'sending for weeks as a config-worded call',
    applies: function () { return { fires: false }; }
  },
  hiring_outreach: {
    label: 'The store-lane outreach to a candidate (a press, retried by the book)',
    subject: 'sync', legacy: 'sending for weeks as a config-worded call',
    applies: function () { return { fires: false }; }
  },
  hiring_cjis_request: {
    label: 'The CJIS asked from the team (folder-first)',
    subject: 'sync', legacy: 'sending for weeks as a config-worded call',
    applies: function () { return { fires: false }; }
  },
  hiring_decision_ask: {
    label: 'The deciders asked to release after the screening',
    subject: 'sync', legacy: 'sending for weeks as a config-worded call',
    applies: function () { return { fires: false }; }
  },
  hiring_resume_request: {
    label: 'The resume-and-phone ask to a referred person (a press, retried by the book)',
    subject: 'sync', legacy: 'sending for weeks as a config-worded call',
    applies: function () { return { fires: false }; }
  },
  interview_candidate_confirmed: {
    label: 'The booking confirmed to the candidate (fired the moment the pick lands)',
    subject: 'sync',
    legacy: 'hiring_journey:interview_booked (once per booking)',
    applies: function () { return { fires: false }; }
  },
  hiring_screen_redo: {
    label: 'A cut screening call asked for one more try (fired by the redo loop)',
    subject: 'sync',
    legacy: 'hiring_sim_asks:screen_call + the per-call nudge memo',
    applies: function () { return { fires: false }; }
  },
  hiring_screen_call: {
    label: 'Asking a candidate to call for the phone screening (fired by the screen-call ladder)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  hiring_first_contact: {
    label: 'The first contact with a new candidate (fired by the manual ladder)',
    subject: 'sync',
    // The stamp its hardcoded predecessor left: one open/answered/exhausted row per card in hiring_sim_asks, which…
    legacy: 'hiring_sim_asks:manual_contact',
    applies: function () { return { fires: false }; }
  },
  hiring_unreachable_archived: {
    label: 'Nobody could reach them — archived (fired by the outreach ladder)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  // The public referral door's WARNING WORDS: shown ON the login page when a referral carries no reachable contact…
  referral_no_contact: {
    label: 'Referral needs a contact (login-page warning copy, never sent)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  // The sibling screen copy: the referred person is already in the hiring records — the referrer is told so, kindly.
  referral_already_known: {
    label: 'Referral already in our records (login-page copy, never sent)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  // THE INTERVIEW SCHEDULER'S FIVE.
  interview_invite: {
    label: 'Interview invite link (fired by the action, never the clock)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  interview_supervisor_ask: {
    label: 'Interview pick → ask the supervisor (fired by the public submit)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  interview_supervisor_slots_request: {
    label: 'Supervisor said NO → ask for three slots (fired by the ask sweep)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  interview_slots_offer: {
    label: 'Three slots offered to the candidate (fired by the ask sweep)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  interview_confirmed: {
    label: 'Interview booked — the supervisor\'s receipt (fired by the flow)',
    subject: 'sync',
    applies: function () { return { fires: false }; }
  },
  // THE ENVIRONMENT CALLING THE OWNER — the feedback has to come back proactively.
  guardian_alert: {
    label: 'The environment needs a person',
    subject: 'guardian',
    applies: function (r) {
      if (!r || !r.id) return { fires: false };
      return { fires: true, instance: str_(r.instance),
               vars: { issues: str_(r.issues), name: 'Guardian' } };
    }
  },
  // THE TWO PSI ANYWHERE ANSWERS — DECLARED HERE, FIRED SOMEWHERE ELSE.
  psyanywhere_false_message: {
    label: 'PSI Anywhere answers — the caller is told so',
    subject: 'psi',
    applies: function () { return { fires: false }; }
  },
  psyanywhere_true_message: {
    label: 'PSI Anywhere is not answering — the caller and the escalation list are told',
    subject: 'psi',
    applies: function () { return { fires: false }; }
  },
  // AN INCIDENT WAS FILED BY THE HOTLINE.
  hotline_incident: {
    label: 'An incident was reported through the hotline',
    subject: 'incident',
    applies: function () { return { fires: false }; }
  },
  // A REQUEST SOMEBODY IS WAITING ON (package 3).
  hotline_support_request: {
    label: 'A new support request came in through the hotline',
    subject: 'incident',
    applies: function () { return { fires: false }; }
  },
  // THE DAILY PATTERN MATCH.
  pattern_scan_daily: {
    label: 'The daily pattern match over the accounts',
    subject: 'incident',
    applies: function () { return { fires: false }; }
  },
  // AN ACCOUNT RELEASED INTO ITS FIRST LOGIN.
  user_release_invite: {
    label: 'An account was released into its first login',
    subject: 'user',
    applies: function () { return { fires: false }; }
  },
  // AN APP OPENED TO MORE PEOPLE.
  app_release_announced: {
    label: 'An app was opened to more people',
    subject: 'user',
    applies: function () { return { fires: false }; }
  },
  /** Sent by CommBroadcast.gs on Send, never by this sweep. */
  staff_broadcast: {
    label: 'A person wrote a broadcast to a group of staff',
    subject: 'broadcast',
    applies: function () { return { fires: false }; }
  },
  /** Sent by CommOpenShiftCovered.gs when the relay hands over the fill, never by this sweep. */
  open_shift_covered: {
    label: 'A call-off\'s open shift was covered',
    subject: 'open_shift',
    applies: function () { return { fires: false }; }
  },
  /** Recruiters' book rows, planned by server/recruit_book.py and sent by CommRecruit.gs, never by this sweep. */
  hiring_screen_day_reminder: {
    label: 'A candidate\'s in-person screen is today (the recruiters\' book)',
    subject: 'recruit_book',
    applies: function () { return { fires: false }; }
  },
  hiring_onboarding_start: {
    label: 'A candidate passed the screen (the recruiters\' book)',
    subject: 'recruit_book',
    applies: function () { return { fires: false }; }
  },
  hiring_bci_howto: {
    label: 'A new hire has not done the BCI background check (the recruiters\' book)',
    subject: 'recruit_book',
    applies: function () { return { fires: false }; }
  }
};

// THE EVENTS THAT ARE NOT SENT BY THE SWEEP, AND WHO SENDS THEM INSTEAD.
var SMART_EVENT_SENDERS = {
  // The hotline's own outage answers — the caller's copy and the escalation, both addressed from the situation's…
  psyanywhere_true_message: 'CommPsi.gs',
  psyanywhere_false_message: 'CommPsi.gs',
  // The incident page — Ty by text and letter, the house manager of that house by text, at the moment the rows land.
  hotline_incident: 'CommIncident.gs',
  // And the request somebody is waiting on, at the moment its queue row lands.
  hotline_support_request: 'CommSupport.gs',
  /* The daily pattern match over the accounts — once a day, clean or not. */
  pattern_scan_daily: 'DuplicateScan.gs',
  // The two release letters — one about an account, one about a door.
  user_release_invite: 'CommRelease.gs',
  app_release_announced: 'CommRelease.gs',
  staff_broadcast: 'CommBroadcast.gs',
  open_shift_covered: 'CommOpenShiftCovered.gs',
  hiring_screen_day_reminder: 'CommRecruit.gs',
  hiring_onboarding_start: 'CommRecruit.gs',
  hiring_bci_howto: 'CommRecruit.gs',
  // The hiring store lane and the outreach ladder — pressed by a person or by the walk, addressed to the candidate…
  hiring_welcome: 'HiringOutreach.gs',
  hiring_ask: 'HiringOutreach.gs',
  hiring_shortlist: 'HiringOutreach.gs',
  hiring_outreach: 'HiringOutreach.gs',
  hiring_cjis_request: 'HiringOutreach.gs',
  hiring_decision_ask: 'HiringOutreach.gs',
  hiring_resume_request: 'HiringOutreach.gs',
  hiring_first_contact: 'HiringOutreach.gs',
  hiring_screen_call: 'HiringOutreach.gs',
  hiring_screen_redo: 'HiringOutreach.gs',
  hiring_phone_collect: 'HiringOutreach.gs',
  hiring_phone_confirm: 'HiringOutreach.gs',
  hiring_contact_failed: 'HiringOutreach.gs',
  hiring_referral_contact: 'HiringOutreach.gs',
  hiring_unreachable_archived: 'HiringOutreach.gs',
  /* The graduation lane. */
  hiring_hired_complete: 'Hired.gs',
  hiring_hired_missing: 'Hired.gs',
  hiring_hired_congrats: 'Hired.gs',
  hiring_ready_to_start: 'Hired.gs',
  hiring_onboarding_finish: 'Hired.gs',
  hiring_onboarding_stalled: 'Hired.gs',
  /* The screening and the interview. */
  hiring_date_accepted: 'Screening.gs',
  hiring_screen_report: 'Screening.gs',
  hiring_scorecard_report: 'Interview.gs',
  hiring_cjis_gate: 'Interview.gs',
  hiring_event_scheduled: 'HiringFlow.gs',
  hiring_packet_request: 'Packet.gs',
  interview_invite: 'InterviewFlow.gs',
  interview_supervisor_ask: 'InterviewFlow.gs',
  interview_supervisor_slots_request: 'InterviewFlow.gs',
  interview_slots_offer: 'InterviewFlow.gs',
  interview_slots_ask: 'InterviewFlow.gs',
  interview_confirmed: 'InterviewFlow.gs',
  interview_candidate_confirmed: 'InterviewFlow.gs',
  interview_days_ask: 'InterviewFlow.gs',
  // The two that are never sent at all: they are the words the public referral door PRINTS on its own page.
  referral_no_contact: 'Referrals.gs',
  referral_already_known: 'Referrals.gs'
};

/** The seeded situations, with the wording already in use so nothing changes on the day this ships. */

/** THE HIRING ESCALATIONS, as rows. */
var SMART_HIRING_EVENTS = [
  // THE HOTLINE CALL-OFF PAGE.
  {
    id: 'hotline_call_off', kind: 'event', event: 'hotline_call_off',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hotline — a DSP called off',
    sender: '',
    sms_text: 'CALL OFF ALERT: {employee} called off {date} at {location}. ' +
              'Reason: {reason}.{manager}',
    email_subject: 'Call off — {employee} · {date}',
    email_text: 'asa. mylife Platform — Employee Support Hotline.\n\n' +
                'A call-off came through the hotline:\n\n' +
                '  Employee   {employee}\n' +
                '  Shift      {date}\n' +
                '  Location   {location}\n' +
                '  Reason     {reason}\n' +
                '  House manager on the calendar: {manager}\n\n' +
                'The Call Offs app carries the running history; the request ' +
                'itself is on the Support Queue.',
    note: 'Queued by the hotline sweep, one situation per call — the ledger dedups.'
  },
  {
    id: 'travel_outcome_missing', kind: 'event', event: 'travel_outcome_missing',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Business Travel — a trip came home without its outcome',
    sender: '',
    sms_text: 'asa. mylife Platform: the {destination} trip ended {days} day(s) ago and its outcome is still unwritten — close it out in Business Travel.',
    email_subject: 'Trip outcome owed — {destination}',
    email_text: 'asa. mylife Platform — Business Travel.\n\n' +
                'The trip to {destination} ({name}) ended on {end_date}, {days} day(s) ago, ' +
                'and no outcome has been written.\n\n' +
                'Open Business Travel and press "Close it out" — the actual cost and one ' +
                'sentence on what came of it keep the ledger honest.',
    note: 'Swept from travel_trips: booked/completed, ended 3+ days, outcome blank.'
  },
  {
    id: 'shopper_worth_checking', kind: 'event', event: 'shopper_worth_checking',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Smart Shopper — a watched item is worth checking',
    sender: '',
    sms_text: 'asa. mylife Platform: {first_name}, {count} watched item(s) hit their target — "{first}" estimates at {best}. Worth a look.',
    email_subject: 'Worth checking — {count} watched item(s) at target',
    email_text: 'asa. mylife Platform — Smart Shopper.\n\n' +
                'Hi {first_name},\n\n' +
                '{count} of your watched items now estimate at or under your target price — ' +
                'starting with "{first}" at {best}.\n\n' +
                'Open Smart Shopper to see the whole list.',
    note: 'to_subject: the owner hears about their own watchlist, nobody else.'
  },
 /** The sync receipt. */
  {
    id: 'truelink_run', kind: 'event', event: 'truelink_run',
    // SHIPS OFF, and `to: team` — both required by the self-test.
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'TrueLink card feed — a sync finished',
    sender: '',
    sms_text: 'TrueLink card feed on asa. mylife Platform: {mode}. ' +
              '{found} new transaction(s) {verb}, {skipped} already on file. {tail}',
    email_subject: 'TrueLink card feed on asa. mylife Platform: {mode} — {found} {verb}',
    email_text: 'TrueLink card feed on asa. mylife Platform.\n\n' +
                'A sync finished: {mode}.\n\n' +
                '  Transactions {verb}   {found}\n' +
                '  Already on file      {skipped}\n' +
                '  Unreadable rows      {unreadable}\n\n' +
                '{tail}\n\n' +
                'Spending without a receipt shows per client in ' +
                'Settings → Client Finances.',
    note: 'Swept, not fired by the action. One row per run, reported once.'
  },
  {
    /** The IST notice. */
    id: 'ist_due', kind: 'event', event: 'ist_due',
    // IT WRITES, IT DOES NOT SEND: the sheet comes first, and the row is switched back on afterwards.
    record_to: 'ist_notices',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'IST owed — employee has not been trained on a client',
    sender: '',
    sms_text: 'asa. mylife Platform: {first_name}, you still need your IST for {client} ' +
              'at {house} — it was needed by {due}. Ask your house manager to run it and ' +
              'sign the record. Reply here if it is already done.',
    email_subject: 'IST outstanding — {name} · {client}',
    email_text: 'asa. mylife Platform — In-Service Training.\n\n' +
                'Hi {first_name},\n\n' +
                'Our records show no IST on file for you on this client:\n\n' +
                '  Client      {client}\n' +
                '  House       {house}\n' +
                '  Needed by   {due}\n\n' +
                'Ohio requires this training BEFORE you work with a client, and it is ' +
                'given by a house manager. Please arrange it and make sure the record is ' +
                'signed — an unsigned training is an untrained one as far as an audit is ' +
                'concerned.\n\n' +
                '{cert_note}\n\n' +
                'If you have already been trained on {client}, reply and we will correct ' +
                'the record.',
    note: 'IST.gs. Addressed to the employee (to_subject). Re-sent from the table on request.'
  },
  {
    // SHIPS OFF like every seeded situation, and this one reaches STAFF PHONES the moment somebody enables it — a…
    id: 'questionnaire_due', kind: 'event', event: 'questionnaire_due',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'A questionnaire is still unanswered',
    sender: '',
    sms_text: 'asa. mylife Platform: {first_name}, the {questionnaire} evaluation is open — ' +
              '{questions} questions, about {minutes} minutes. {link}',
    email_subject: '{questionnaire} — {period}',
    email_text: 'Hi {first_name},\n\n' +
                'The {questionnaire} evaluation for {period} is open and we do not have your ' +
                'answers yet.\n\n' +
                '  Questions   {questions}\n' +
                '  Time        about {minutes} minutes\n\n' +
                'It is answered here: {link}\n\n' +
                'Answer honestly — the open-ended ones are read by a person, and the rest feed ' +
                'the training numbers this company is measured on.',
    note: 'Questionnaires app. Addressed to the employee (to_subject). Seeded 2026-08-11.'
  },
  {
    id: 'finance_receipts_missing', kind: 'event', event: 'finance_receipts_missing',
    // SHIPS OFF, and the self-test enforces it: a seed that arrives enabled starts messaging real people the moment…
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'Receipts still owed on a client ledger',
    sender: '',
    sms_text: '{name} has {count} purchase(s) in {month} with no receipt on file, {total} in total. The oldest is {oldest}.',
    email_subject: 'Receipts outstanding — {name}, {month}',
    email_text: '{name} has {count} purchase(s) in {month} with no receipt on file, {total} in total. ' +
                'The oldest is {oldest}. Attach them in Client Finances, or record why none is coming.',
    note: 'Client ledger. Seeded 2026-08-09 with the chase the old portal ran on a trigger.'
  },
  {
    id: 'onboarding_report', kind: 'event', event: 'onboarding_report',
    /** SHIPS OFF, like every situation that never sent from code here — it reaches three real phones the moment a new hire finishes. */
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'A new hire finished their onboarding',
    sender: '',
    // The six lines are assembled server-side and arrive whole, so SMS and email cannot drift apart and there is…
    sms_text: '{report}\n\n{phone} · {email}',
    email_subject: 'Onboarding Report — {name}',
    email_text: '{report}\n\n' +
                '  Phone   {phone}\n' +
                '  Email   {email}\n\n' +
                'Anything reading "Not Delivered", "Not Done" or "Missing" is still owed.',
    note: 'Onboarding.gs. Written by seatRelease when a visit FINISHES (obReportWrite_), swept from onboarding_reports — never fired by the action. Seeded 2026-08-10.'
  },
  {
    id: 'recon_errors_found', kind: 'event', event: 'recon_errors_found',
    // SHIPS OFF, like every situation that never sent from code here.
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'Time reconciliation — a run found errors',
    sender: '',
    sms_text: 'Time reconciliation {runId}: {total} error(s) in {period} — ' +
              '{missing} missing, {noEnd} no clock-out, {dupe} duplicate, ' +
              '{gap} coverage gap, {overlap} overlap. Open Time Reconciliation to review.',
    email_subject: 'Time reconciliation found {total} error(s) — {period}',
    email_text: 'A time reconciliation run finished with discrepancies to review.\n\n' +
                '  Run        {runId}\n' +
                '  Period     {period}\n' +
                '  Total      {total}\n' +
                '  Missing    {missing}\n' +
                '  No end     {noEnd}\n' +
                '  Duplicate  {dupe}\n' +
                '  Gap        {gap}\n' +
                '  Overlap    {overlap}\n\n' +
                'Open Time Reconciliation to excuse, cover, verify or flag each one.',
    note: 'Recon.gs. Swept, not fired by the action — one row per run, reported once. Seeded 2026-08-10.'
  },
  {
    id: 'recon_punch_reminder', kind: 'event', event: 'recon_punch_reminder',
    /** SHIPS OFF; `to: team` is inert (addressed to the employee via `to_subject`) and stays because the self-test refuses a typed address. */
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms', days_before: '0',
    statuses: '', label: 'Time reconciliation — remind an employee about a punch',
    sender: '',
    sms_text: 'Hi {first_name}, our time reconciliation shows {what} for your {date} shift at ' +
              '{location} ({hours}h scheduled). Please reply here or contact your house manager ' +
              'to correct it.',
    email_subject: 'Your {date} shift at {location} — punch needed',
    email_text: 'Hi {first_name},\n\n' +
                'Our time reconciliation shows {what} for your {date} shift at {location} ' +
                '({hours}h scheduled). Please contact your house manager to correct the record.',
    note: 'Recon.gs. Addressed to the employee (to_subject). Queued per error by reconErrorRemind; the queue stamp is the instance, so a re-remind is a new event. Seeded 2026-08-10.'
  },
  {
    id: 'packet_missing', kind: 'event', event: 'packet_missing',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'New Hire packet not on file',
    // Blank, NOT SMART_SENDER_DEFAULT: that constant is declared further down this file, so a top-level value built…
    sender: '',
    sms_text: '{name} finished onboarding on {since} and the signed New Hire packet still has not arrived. The card is held at Onboarding.',
    email_subject: 'New Hire packet overdue — {name}',
    email_text: '{name} finished onboarding on {since} and the signed New Hire packet still has ' +
      'not arrived. The card is held at Onboarding and stays there until it is signed in Dropbox ' +
      'Sign or attached by hand.',
    note: 'Fires the moment onboarding ends without the packet — the same moment the card goes amber. Placeholders: {name} {since} {day}'
  },
  {
    id: 'packet_day_elapsed', kind: 'event', event: 'packet_day_elapsed',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'New Hire packet — their day ran out',
    sender: '',
    sms_text: '{name} finished onboarding on {since}. Their day to produce the signed New Hire packet ran out on {day} and it still has not arrived.',
    email_subject: 'New Hire packet STILL missing — {name}',
    email_text: '{name} finished onboarding on {since}. Their day to produce the signed New Hire ' +
      'packet ran out on {day} and it still has not arrived.\n' +
      'They are held at Onboarding and cannot become staff until it is signed in Dropbox Sign, ' +
      'attached by hand, or found and confirmed in the mirror.',
    note: 'The second message, after the candidate\'s own day. How long that day is: packet_hold_hours in Settings. Placeholders: {name} {since} {day}'
  },
  {
    id: 'deadline_extended_expired', kind: 'event', event: 'deadline_extended_expired',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email', days_before: '0',
    statuses: '', label: 'Extended deadline missed — the card is RED',
    sender: '',
    sms_text: '{name} is now RED on the hiring board: {why}. Somebody already gave them extra time and it has run out.',
    email_subject: 'Extended deadline missed — {name}',
    email_text: '{name} is now RED on the hiring board: {why}.\n' +
      'Somebody already gave them extra time and it has run out, so this will not resolve on its ' +
      'own. Extend again from the card, or decide it ends here.',
    note: 'The only alert that fires because a PERSON\'s decision expired rather than a clock. Placeholders: {name} {why}'
  },
  {
    // The referral door's warning words — SCREEN COPY, never a send: the login page shows email_text when a…
    id: 'referral_no_contact', kind: 'event', event: 'referral_no_contact',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'email', days_before: '0',
    statuses: '', label: 'Referral needs a contact (login-page warning copy)',
    sender: '',
    sms_text: '',
    email_subject: 'sync',
    email_text: 'Thank you for thinking of {name}! To move forward, our team needs ' +
      'a way to reach them — a phone number or an e-mail address. We read the ' +
      'resume you sent and could not find either one. Please add a number or an ' +
      'e-mail to the form and press Send again.',
    note: 'SCREEN COPY: shown on the login page referral form when no contact ' +
      'exists anywhere. {name} = the referred person. Never sent.'
  },
  {
    // The sibling copy: the referred person already lives in the hiring records — the referrer hears it plainly…
    id: 'referral_already_known', kind: 'event', event: 'referral_already_known',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'email', days_before: '0',
    statuses: '', label: 'Referral already in our records (login-page copy)',
    sender: '',
    sms_text: '',
    email_subject: 'sync',
    email_text: 'Good news — {name} is already in our hiring records, and our ' +
      'team is on it. There is nothing you need to do: if anything is missing ' +
      'on their side, we will reach out to them directly. Thank you for ' +
      'looking out!',
    note: 'SCREEN COPY: shown on the login page when the referred person ' +
      'already exists in the pipeline. {name} = the referred person. Never sent.'
  },
  {
    // THE SCHEDULING E-MAIL: when an appointment is made on the Flow calendar — an interview, an orientation, a…
    id: 'hiring_event_scheduled', kind: 'event', event: 'hiring_event_scheduled',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'email', days_before: '0',
    statuses: '', label: 'An appointment was scheduled (calendar e-mail)',
    sender: '',
    sms_text: '',
    email_subject: '{event} — {date}{time_line}',
    email_text: 'Hi {first_name},\n\n' +
      'Your {event} with Asa LifeCare is scheduled.\n\n' +
      '  When    {date}{time_line}\n' +
      '{where_line}{with_line}' +
      '\n{notes}\n\n' +
      'If this day or time does not work, reply to this e-mail and we will move it.\n\n' +
      'Asa LifeCare',
    note: 'Fired BY hiringScheduleCreate, never by the sweep. Placeholders: {name} {first_name} {event} {date} {time} {time_line} {where_line} {with_line} {location} {with_name} {notes}'
  },
  // THE HIRING MESSAGES — they ARE smart comms.
  {
    id: 'hiring_date_accepted', kind: 'event', event: 'hiring_date_accepted',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — Date Accepted could not be read',
    sender: '',
    sms_text: 'Hub: could not read the accepted in-person date for {name}.\n' +
              'Phone: {phone} · Email: {email}\n{screen}\n{report}' +
              'Action: open the Hiring Pipeline card and press Manual on Date accepted.',
    email_subject: 'Hub — Date Accepted missing: {name}',
    email_text: 'Hub: could not read the accepted in-person date for {name}.\n' +
                'Phone: {phone} · Email: {email}\n{screen}\n{report}' +
                'Action: open the Hiring Pipeline card and press Manual on Date accepted.',
    note: 'Fired by hubDateAcceptedEscalate_ (Screening.gs) when every reading of the ' +
          'accepted date failed — never by the sweep. Reaches the team (SMS + designed ' +
          'e-mail). Placeholders: {name} {phone} {email} {screen} {report}'
  },
  {
    id: 'hiring_hired_complete', kind: 'event', event: 'hiring_hired_complete',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — Hired with everything green',
    sender: '',
    sms_text: 'Hub: {name} completed every Hired step — all documentation is OK.{manual_note}\n' +
              'Phone: {phone} · Email: {email}\n' +
              'They stay on the last step of the Hiring Pipeline for one more day, ' +
              'then move to Users as staff automatically.',
    email_subject: 'Hub — Hired complete: {name}',
    email_text: 'Hub: {name} completed every Hired step — all documentation is OK.{manual_note}\n' +
                'Phone: {phone} · Email: {email}\n' +
                'They stay on the last step of the Hiring Pipeline for one more day, ' +
                'then move to Users as staff automatically.',
    note: 'Fired by hubHiredSweep_ (Hired.gs) the first time a card reaches Hired with ' +
          'nothing missing — never by the sweep here. Placeholders: {name} {phone} {email} {manual_note}'
  },
  {
    id: 'hiring_hired_missing', kind: 'event', event: 'hiring_hired_missing',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — Hired with items missing',
    sender: '',
    sms_text: 'Hub: {name} reached Hired, but these items are missing:\n{missing}\n' +
              'Phone: {phone} · Email: {email}\n' +
              'They still stay one more day on the pipeline and then move to Users as ' +
              'staff — chase the missing items in the Onboarding Tracker.',
    email_subject: 'Hub — Hired with items MISSING: {name}',
    email_text: 'Hub: {name} reached Hired, but these items are missing:\n{missing}\n' +
                'Phone: {phone} · Email: {email}\n' +
                'They still stay one more day on the pipeline and then move to Users as ' +
                'staff — chase the missing items in the Onboarding Tracker.',
    note: 'Fired by hubHiredSweep_ (Hired.gs) the first time a card reaches Hired with ' +
          'items missing — never by the sweep here. Placeholders: {name} {phone} {email} {missing}'
  },
  {
    // The only one addressed to the CANDIDATE: `to: team` is inert here (the packet sweep writes to the person on…
    id: 'hiring_packet_request', kind: 'event', event: 'hiring_packet_request',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — the New Hire packet request',
    sender: '',
    sms_text: 'Hi DSP, this is ASA Lifecare. To finish your onboarding we still need your ' +
              'signed New Hire packet. Please check your inbox for your New Hire packet and complete it.',
    email_subject: 'Your signed New Hire packet — ASA Lifecare',
    email_text: 'Hi DSP,\n\n' +
                'To finish your onboarding we still need your signed New Hire packet.\n' +
                'Please check your inbox for your New Hire packet and complete it.\n\n' +
                'ASA Lifecare',
    note: 'The only hiring message that reaches an APPLICANT. Fired by ' +
          'packetRequestSweep_ (Packet.gs) when a card arrives at Onboarding without ' +
          'the packet; the words travel inside the designed letter ' +
          '(packetRequestEmail_). {name} works but the default deliberately says DSP — ' +
          'a card can be wrong, and greeting a stranger by the wrong name cannot be ' +
          'taken back. Placeholders: {name}'
  },
  // THE FIRST CONTACT IS A SITUATION LIKE ITS SIBLINGS, and it was found missing when no message from it ever…
  {
    id: 'hiring_first_contact', kind: 'event', event: 'hiring_first_contact',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — the first contact with a new candidate',
    sender: '',
    sms_text: '{opening}',
    email_subject: 'A Direct Support Professional opportunity at ASA LifeCare',
    email_text: '{opening}\n\n' +
                'We support people with developmental disabilities across Ohio, and we are ' +
                'hiring Direct Support Professionals.\n\n' +
                'Please reply to this message — by text or by letter, either one reaches ' +
                'us — and we can start.',
    note: 'HiringOutreach.gs manualContactSend, pressed by manualContactSweepMaybe_ for ' +
          'every card standing at New with a phone or an address. The retry ladder and ' +
          'its clock stay in hiring_sim_config (sim_attempts_manual_contact, ' +
          'sim_retry_minutes_manual_contact) — this row is the switch and the words. ' +
          'Placeholders: {opening} {first_name} {name}'
  },
  // THE DICTATED RULES — EVERY MESSAGE GOES THROUGH SMART COMMS.
  {
    id: 'hiring_phone_collect', kind: 'event', event: 'hiring_phone_collect',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Hiring — asking an e-mail-only candidate for a phone number',
    sender: '',
    sms_text: '',
    email_subject: 'One thing missing — a phone number for your application',
    email_text: 'Hi {first_name},\n\nThank you for joining the ASA LifeCare selection ' +
                'process. To register your application and keep you posted we need a phone ' +
                'number — please reply to this letter with the best number to reach you.',
    note: 'HiringOutreach.gs — fired for a card at New that has an e-mail and no phone. ' +
          'Seven letters, one every two hours (sim_attempts_phone_collect). A reply ' +
          'carrying a number settles it and starts the confirmation text. ' +
          'Placeholders: {first_name} {name}'
  },
  {
    id: 'hiring_phone_confirm', kind: 'event', event: 'hiring_phone_confirm',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms',
    days_before: '0', statuses: '', label: 'Hiring — confirming the phone number just collected',
    sender: '',
    sms_text: 'This is ASA LifeCare — congratulations, you are moving to the next steps of ' +
              'our selection process. Reply YES to confirm you received this message.',
    email_subject: '', email_text: '',
    note: 'HiringOutreach.gs — the number a candidate sent by letter is texted until they ' +
          'answer YES (7x, every 2 hours). A YES verifies the phone and moves them to ' +
          'Phone Screen. Placeholders: {first_name} {name}'
  },
  {
    id: 'hiring_contact_failed', kind: 'event', event: 'hiring_contact_failed',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — the team is told a candidate could not be reached for their phone',
    sender: '',
    sms_text: 'ASA hiring: it was not possible to reach candidate {name} to collect a ' +
              'phone number — every try went unanswered.',
    email_subject: 'Could not reach {name} to collect a phone number',
    email_text: 'It was not possible to reach candidate {name} to collect their phone ' +
                'number.\n\nEvery configured try went out and none was answered. Their ' +
                'card is at New with what we hold: {email} {phone}',
    note: 'Fired ONCE when the phone-collect or phone-confirm ladder runs out. ' +
          'Placeholders: {name} {email} {phone}'
  },
  {
    id: 'hiring_referral_contact', kind: 'event', event: 'hiring_referral_contact',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — asking the referrer for the candidate\'s contact',
    sender: '',
    sms_text: 'ASA LifeCare hiring — you referred {name} to us. Do you have a phone ' +
              'number or e-mail for them? Reply here with any contact you hold.',
    email_subject: 'Your referral {name} — do you have their contact?',
    email_text: 'Hi {referrer},\n\nYou referred {name} to our hiring process, and we ' +
                'have no working contact for them yet. Please reply with any phone ' +
                'number or e-mail you hold — anything helps.',
    note: 'HiringOutreach.gs referral relay — seven asks every two hours on day one; a ' +
          'second seven starts the next Ohio morning. No name and no e-mail at the end ' +
          'means the Archive. Placeholders: {name} {referrer}'
  },
  {
    id: 'hiring_screen_report', kind: 'event', event: 'hiring_screen_report',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — the AI screening report goes to the team',
    sender: '',
    sms_text: 'ASA hiring: {name} finished the phone screening. Score {score} — ' +
              '{qualification}. Full AI report: {report_url}',
    email_subject: 'AI screening report — {name}: {score}, {qualification}',
    email_text: 'The phone screening of {name} is complete and analyzed.\n\n' +
                'Score: {score}\nQualification: {qualification}\n\n' +
                'The full AI report is here: {report_url}\n\n' +
                'Unless somebody stops the process, they move on to the interview.',
    note: 'Screening.gs — fired once when the transcript analysis completes; the card ' +
          'then advances to Interview by itself unless a person stops it. ' +
          'Placeholders: {name} {score} {qualification} {report_url}'
  },
  {
    id: 'interview_slots_ask', kind: 'event', event: 'interview_slots_ask',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Interview — asking the interviewer for slots (date AND time)',
    sender: '',
    sms_text: 'ASA LifeCare hiring — {name} is ready for an interview. Open {link} and ' +
              'pick {slots_wanted} time slots on different days (date and time); the ' +
              'candidate then chooses one of them.',
    email_subject: '{name} is ready for an interview — {slots_wanted} slots, please',
    email_text: 'Hi {interviewer},\n\n{name} has passed the phone screening and is ready ' +
                'to meet you.\n\nOpen {link} and pick {slots_wanted} time slots on ' +
                'different days — date AND time. The candidate then chooses one of them, ' +
                'and you get the confirmation. Replying here with the slots also works.',
    note: 'InterviewFlow.gs — fired by the interview-start sweep when a card reaches ' +
          'Interview. Three slots on the first round; six when the candidate says none ' +
          'work (7x, every 2 hours until she replies). ' +
          'Placeholders: {name} {interviewer} {slots_wanted}'
  },
  {
    id: 'hiring_scorecard_report', kind: 'event', event: 'hiring_scorecard_report',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Interview — the signed scorecard goes to the team',
    sender: '',
    sms_text: '',
    email_subject: 'Interview scorecard — {name}: {score} by {interviewer}',
    email_text: 'The interview of {name} was scored.\n\nInterviewer: {interviewer}\n' +
                'Score: {score}\nDecision: {decision}\n\nComments:\n{comments}',
    note: 'Interview.gs — fired once when the interviewer signs the scorecard. ' +
          'Placeholders: {name} {interviewer} {score} {decision} {comments}'
  },
  {
    id: 'hiring_cjis_gate', kind: 'event', event: 'hiring_cjis_gate',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Onboarding — the CJIS is missing and the team decides',
    sender: '',
    sms_text: 'ASA hiring: may I proceed with candidate {name} to onboarding? No CJIS is ' +
              'on their card — can somebody upload it, or I hold them at Onboarding.',
    email_subject: 'May I proceed with {name} to onboarding? The CJIS is missing',
    email_text: 'Candidate {name} finished the interview and is ready for onboarding, but ' +
                'no CJIS report is on their card.\n\nMay I proceed? And can somebody ' +
                'upload the CJIS into the hiring process — otherwise I hold them at ' +
                'Onboarding.\n\nThe folders keep being watched: if their CJIS or resume ' +
                'appears there it is attached by itself.',
    note: 'Fired once at the Interview -> Onboarding boundary when the card has no CJIS. ' +
          'Placeholders: {name}'
  },
  {
    id: 'hiring_onboarding_finish', kind: 'event', event: 'hiring_onboarding_finish',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Onboarding — a started-and-abandoned onboarding is asked to finish',
    sender: '',
    sms_text: '',
    email_subject: 'Finish your onboarding — you are almost at the end',
    email_text: 'Hi {first_name},\n\nYour onboarding with ASA LifeCare is still open — ' +
                'please finish it to reach the end of your application.\n\n' +
                'Sign in here: {login_link}\nYour password: {password}\n\n' +
                'It picks up right where you left off.',
    note: 'Fired for somebody whose onboarding account exists and whose steps stopped ' +
          '(7 letters, every 2 hours, each carrying the login link and password). ' +
          'Exhausted -> the team is told; Arthur\'s "tente mais" restarts a fresh seven ' +
          'the next Ohio morning after 8am. Placeholders: {first_name} {login_link} {password}'
  },
  {
    id: 'hiring_onboarding_stalled', kind: 'event', event: 'hiring_onboarding_stalled',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Onboarding — the team is told somebody began and did not finish',
    sender: '',
    sms_text: '',
    email_subject: '{name} began the onboarding and did not finish',
    email_text: 'Candidate {name} signed into the onboarding portal, began the steps, and ' +
                'stopped before the end.\n\nSeven reminders went out over the last hours ' +
                '— each carrying the login link and password — and none was answered.\n\n' +
                'Reply "tente mais" and a fresh round of seven starts tomorrow after 8am ' +
                'Ohio time. Otherwise they stand at Onboarding until somebody decides.',
    note: 'Fired once when the finish-your-onboarding ladder runs out. The ear reads ' +
          '"tente mais" from the team and re-arms the ladder for the next morning. ' +
          'Placeholders: {name}'
  },
  {
    id: 'hiring_hired_congrats', kind: 'event', event: 'hiring_hired_congrats',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hired — the candidate is congratulated',
    sender: '',
    sms_text: 'ASA LifeCare — congratulations {first_name}, you are HIRED! Our team will ' +
              'contact you shortly with the next steps.',
    email_subject: 'Congratulations — you are hired at ASA LifeCare',
    email_text: 'Hi {first_name},\n\nCongratulations — you have completed our selection ' +
                'process and you are HIRED.\n\nPlease await contact from our team to ' +
                'set your start.\n\nWelcome to ASA LifeCare.',
    note: 'Fired once when the card reaches Hired with everything the rules require ' +
          '(questionnaire above 7, DODD, CPR, name, phone, e-mail). ' +
          'Placeholders: {first_name} {name}'
  },
  // ASKING THE INTERVIEWER FOR HER DAYS — it has to be set up in the smart comms like everything else.
  {
    id: 'interview_days_ask', kind: 'event', event: 'interview_days_ask',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Interview — asking the interviewer which days she can take',
    sender: '',
    sms_text: 'ASA LifeCare hiring — {name} is ready for an interview. Open {link} and pick ' +
              'the days you can take; the candidate then chooses a time inside them.',
    email_subject: '{name} is ready for an interview — which days can you take?',
    email_text: 'Hi {interviewer},\n\n' +
                '{name} has finished the phone screening and is ready to meet you.\n\n' +
                'Open {link} and choose the days that suit you. The candidate picks a time ' +
                'inside the days you choose, so nothing lands on you unannounced.',
    note: 'InterviewFlow.gs interviewDaysAskSend, pressed by interviewStartSweepMaybe_ for a ' +
          'card standing at Interview with nothing booked. Re-asked on the clock in ' +
          'sim_attempts_interview_days / sim_retry_minutes_interview_days (7, every 30 min) ' +
          'and settled the moment she picks. Placeholders: {name} {interviewer} {link}'
  },
  // THE CALL THAT WAS WRITTEN AND NEVER SENT — asked seven times, and configured entirely in the smart comms.
  {
    id: 'hiring_welcome', kind: 'event', event: 'hiring_welcome',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Hiring — the welcome message',
    sender: '', sms_text: '', email_subject: 'The Hiring Pipeline is open — start hiring from our own database', email_text: 'The Hiring Pipeline is open on the platform. It carries every candidate from the first contact to their first day — the resume and its score, the background check, the phone screen and its transcript, the in-person interview, the onboarding paperwork, and the account the new hire signs in with.\n\nOpen the app, pick the people worth calling, and start them down the process — every step after that is prompted by the platform itself, and every message it sends is recorded on the card.',
    note: 'HiringOutreach.gs hiringWelcomeSend — a person\'s press. Blank cells fall to ' +
          'the sim_text_welcome_* config, then the shipped words. Placeholders: {first_name} {name}'
  },
  {
    id: 'hiring_ask', kind: 'event', event: 'hiring_ask',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Hiring — the "are we hiring?" ask to the deciders',
    sender: '', sms_text: '', email_subject: 'Are we hiring? — your word starts the process', email_text: 'Hello team — are we currently hiring?\n\nIf we are, how many Direct Support Professionals from the pool I have already analyzed would you like to see? Reply with a number and I will send the ranked shortlist with my reading of it.',
    note: 'HiringOutreach.gs hiringAskSend — step 0 of the store lane. Blank cells fall to ' +
          'sim_text_ask_*, then the shipped words.'
  },
  {
    id: 'hiring_shortlist', kind: 'event', event: 'hiring_shortlist',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Hiring — the ranked shortlist to the deciders',
    sender: '', sms_text: '', email_subject: 'Our strongest DSPs right now', email_text: 'We reviewed the Direct Support Professionals currently in our database and ranked them against the work we actually need covered. These are the strongest, in order:',
    note: 'HiringOutreach.gs hiringShortlistSend. Blank cells fall to sim_text_shortlist_*.'
  },
  {
    id: 'hiring_outreach', kind: 'event', event: 'hiring_outreach',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — the store-lane outreach to a candidate',
    sender: '', sms_text: 'Hi {first_name}, this is ASA LifeCare. We are hiring Direct Support Professionals and would like to talk with you about the role. Are you interested? Reply YES and we will call you.', email_subject: 'A Direct Support Professional opportunity — ASA LifeCare', email_text: 'Hi {first_name}, this is ASA LifeCare — we support people with developmental disabilities across Ohio, and we are hiring Direct Support Professionals.\n\nWe would like to talk with you about the role. Are you interested? Reply YES — or answer the text we sent to your phone — and we will call you.',
    note: 'HiringOutreach.gs hiringOutreachSend/Sms — pressed by a person or the walk; ' +
          'retried by the book (7x). Blank cells fall to sim_text_outreach_*.'
  },
  {
    id: 'hiring_cjis_request', kind: 'event', event: 'hiring_cjis_request',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Hiring — the CJIS asked from the team',
    sender: '', sms_text: '', email_subject: 'CJIS for {name} — did the candidate send it to you?', email_text: 'I see that we do not have the CJIS for {name} in the folders.\n\nDid the candidate send it to you? If yes, just answer this message with a yes — the card is marked On file and the pipeline keeps moving (CJIS never blocks anyone).\n\nIf it is not with you either, please pull the CJIS yourself and load it into ONE of the folders below — the platform watches all of them and matches the file to the candidate by the name on it:\nhttps://drive.google.com/drive/folders/1YVyiaMAi4oJ5hUmYGdX1KmXZla6bwHR_\nhttps://drive.google.com/drive/folders/1igORZ8bHmXECSEFByu6eOdhFDCAfGHlkaaCNmTCrm5oGuJeBMLKPyk6R2ZWq_EKREG9oXjJ2\n(or the Original Documents folder, as always).',
    note: 'HiringOutreach.gs hiringCjisRequestSend — folder-first, then the ask. Blank ' +
          'cells fall to sim_text_cjis_request_*.'
  },
  {
    id: 'hiring_decision_ask', kind: 'event', event: 'hiring_decision_ask',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — the deciders asked to release after the screening',
    sender: '', sms_text: '{name} finished the phone screen and is waiting on your decision. Reply ADVANCE or DECLINE, or open the card on the platform.', email_subject: 'Your decision: {name} after the phone screen', email_text: '{name} finished the phone screen. We read the transcript and scored it — the next move is yours.',
    note: 'HiringOutreach.gs hiringDecisionAskSend. Blank cells fall to sim_text_decision_ask_*.'
  },
  // THE WORKBOOK'S ONE FLAGGED GAP: hiringResumeRequestSend was the last hiring sender with no situation row and no…
  {
    id: 'hiring_resume_request', kind: 'event', event: 'hiring_resume_request',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'email',
    days_before: '0', statuses: '', label: 'Hiring — the resume-and-phone ask to a referred person',
    sender: '',
    sms_text: '',
    email_subject: 'REFERRAL - Your phone or resume — a selection process at ASA LifeCare',
    email_text: 'Hi {first_name}, {referrer} passed your name to us at ASA LifeCare — we ' +
                'support people with developmental disabilities across Ohio, and we are ' +
                'hiring Direct Support Professionals.\n\nTo look at you for a selection ' +
                'process, we would like either or both of:\n1. A phone number we can reach ' +
                'you on.\n2. Your resume — attached to a reply is perfect.\n\nAnd the ' +
                'question that decides it: are you interested in a selection process at ' +
                'ASA LifeCare? If you are, reply WITH your phone number or your resume — ' +
                'either one is what lets us take the next step, and our recruiting team ' +
                'calls you from there.',
    note: 'HiringOutreach.gs hiringResumeRequestSend, re-asked by the ladder. Blank cells ' +
          'fall to sim_text_resume_request_*. Placeholders: {first_name} {name} {referrer}'
  },
  {
    id: 'interview_candidate_confirmed', kind: 'event', event: 'interview_candidate_confirmed',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Interview — the booking confirmed to the CANDIDATE',
    sender: '',
    sms_text: 'ASA LifeCare — your interview is booked: {when}. We look forward to meeting ' +
              'you; reply here if anything changes.',
    email_subject: 'Your interview is booked — {when}',
    email_text: 'Hi {first_name},\n\nYour in-person interview with ASA LifeCare is ' +
                'booked: {when}.\n\nWe look forward to meeting you. If anything changes, ' +
                'reply to this message and we will find another time.',
    note: 'InterviewFlow.gs interviewAskConfirm_ — fired once per booking, the moment the ' +
          'candidate\'s pick lands on the Calendar. The supervisor\'s own receipt is the ' +
          'interview_confirmed row. Placeholders: {first_name} {name} {when}'
  },
  // THE CUT CALL'S SECOND CHANCE — a smart comm like every other message.
  {
    id: 'hiring_screen_redo', kind: 'event', event: 'hiring_screen_redo',
    enabled: 'yes', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — a cut screening call is asked for one more try',
    sender: '',
    sms_text: 'Your screening call to {screen_line} was cut short — please call again when ' +
              'you can, from a quiet spot. It picks up in minutes.',
    email_subject: 'One more try — your screening call',
    email_text: 'Hi {first_name},\n\nYour call to {screen_line} did not reach the end — ' +
                'calls drop, lines get noisy, it happens. Please call {screen_line} again ' +
                'when you can, from a quiet place: it only takes a few minutes.',
    note: 'HiringOutreach.gs screenRedoSweepMaybe_ — fired once per CUT call (a complete ' +
          'call settles the ask instead). The words here win over the ' +
          'screen_redo_* cells in hiring_sim_config. Placeholders: {first_name} {screen_line}'
  },
  {
    id: 'hiring_screen_call', kind: 'event', event: 'hiring_screen_call',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — asking a candidate to call for the phone screening',
    sender: '',
    sms_text: 'Hi {first_name}, this is ASA LifeCare — the next step is a short phone ' +
              'screening, and you can start it whenever suits you: just call {screen_line} ' +
              'and our line will take you through it.',
    email_subject: 'Your phone screening — call when it suits you',
    email_text: 'Hi {first_name},\n\n' +
                'The next step with us is a short phone screening, and you are in charge of ' +
                'when it happens: call {screen_line} and our line will take you through it.\n\n' +
                'It takes a few minutes, and there is nothing to prepare.',
    note: 'HiringOutreach.gs hiringScreenCallSend, pressed by screenCallSweepMaybe_ for every ' +
          'card standing at Phone Screen with no screen recorded. The ladder and its clock ' +
          'are sim_attempts_screen_call / sim_retry_minutes_screen_call; this row is the ' +
          'switch and the words. Placeholders: {first_name} {name} {screen_line}'
  },
  // NOBODY COULD REACH THEM.
  {
    id: 'hiring_unreachable_archived', kind: 'event', event: 'hiring_unreachable_archived',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Nobody could reach a candidate — archived',
    sender: '',
    sms_text: '{name} was archived: {tries} on {phone} and {email}, no answer. ' +
              'The next name in the queue comes in by itself.',
    email_subject: '{name} was archived — nobody could reach them',
    email_text: 'We tried {name} {tries}, on every contact we hold, and got nothing back. ' +
                'Their card moved to the Archive with everything on it — nothing was ' +
                'deleted, and it comes back whole if they ever answer.\n\n' +
                'The next name in the queue comes in by itself.',
    note: 'HiringOutreach.gs. Fired once per candidate when the outreach attempts run out ' +
          'with the card still at New — it archives and tells. ' +
          'Placeholders: {name} {tries} {phone} {email}'
  },
  {
    /** The words hubBecomingStaffSweep_ says, as a row like its four siblings. */
    id: 'hiring_ready_to_start', kind: 'event', event: 'hiring_ready_to_start',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Hiring — finished, ready to start',
    sender: '',
    sms_text: '{name} has finished the hiring process.\n' +
              'Staff account: created and able to sign in.\n' +
              'ASA Employee Database: written.\n' +
              'Their card is at READY TO START — a manager begins their activities from the board.',
    email_subject: 'Hub — {name} is ready to start',
    email_text: '{name} has finished the hiring process.\n' +
                'Staff account: created and able to sign in.\n' +
                'ASA Employee Database: written.\n' +
                'Their card is at READY TO START — a manager begins their activities from the board.',
    note: 'Fired by hubBecomingStaffSweep_ (Hired.gs) when the staff account is armed ' +
          'and the Employee Database is written — never by the sweep here. Switching it ' +
          'off does NOT hold the card: the move to Ready to start still happens, silently. ' +
          'Placeholders: {name}'
  },
  // THE INTERVIEW SCHEDULER'S FIVE.
  {
    id: 'interview_invite', kind: 'event', event: 'interview_invite',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Interview scheduler — the invite link',
    sender: '',
    sms_text: 'Hi {first_name}, this is ASA Lifecare — time to book your in-person ' +
              'interview. Pick the day and hour here: {link} (this link is personal to you).',
    email_subject: 'Pick your interview time — ASA Lifecare',
    email_text: 'Hi {first_name},\n\n' +
                'Thank you for talking with ASA Lifecare — the next step in our ' +
                'conversation about the role is your in-person interview.\n\n' +
                'Pick the day and the hour that suit you best here: {link}\n\n' +
                'This link is personal to you — please do not forward it.',
    note: 'Fired by interviewInviteSend (InterviewFlow.gs), never by the sweep. ' +
          'These words travel inside the platform\'s designed letter ' +
          '(interviewInviteEmail_); one invite per ask per day (the ledger dedups). ' +
          'Placeholders: {name} {first_name} {link}'
  },
  {
    id: 'interview_supervisor_ask', kind: 'event', event: 'interview_supervisor_ask',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms',
    days_before: '0', statuses: '', label: 'Interview scheduler — ask the supervisor',
    sender: '',
    sms_text: '{candidate} picked {slot} for the in-person interview — reply YES to ' +
              'confirm or NO to propose times.',
    email_subject: '',
    email_text: '',
    note: 'SMS to the Division Supervisor (interview_supervisor_name in Hiring rules) ' +
          'the moment a candidate picks. Fired by the public submit, never the sweep. ' +
          'Placeholders: {candidate} {slot}'
  },
  {
    id: 'interview_supervisor_slots_request', kind: 'event', event: 'interview_supervisor_slots_request',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms',
    days_before: '0', statuses: '', label: 'Interview scheduler — ask her for three slots',
    sender: '',
    sms_text: 'Could you give me three day/time slots that work best for you?',
    email_subject: '',
    email_text: '',
    note: 'SMS to the supervisor after she answers NO. Fired by the ask sweep. ' +
          'Placeholders: {candidate}'
  },
  {
    id: 'interview_slots_offer', kind: 'event', event: 'interview_slots_offer',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Interview scheduler — the three slots, offered',
    sender: '',
    sms_text: 'Hi {first_name}, our supervisor offered three times for your interview: ' +
              '{slots}. Pick yours here: {link}',
    email_subject: 'Three times for your interview — pick one',
    email_text: 'Hi {first_name},\n\n' +
                'Our supervisor offered three times for your in-person interview:\n\n' +
                '{slots}\n\n' +
                'Choose yours here: {link}\n\n' +
                'This link is personal to you — please do not forward it.',
    note: 'The candidate hears the supervisor\'s three slots — the SAME personal link; ' +
          'the page turns into a three-choice. The words travel inside the designed ' +
          'letter (interviewInviteEmail_). Placeholders: {name} {first_name} {slots} {link}'
  },
  {
    id: 'interview_confirmed', kind: 'event', event: 'interview_confirmed',
    enabled: 'no', to: '+13309195559, +13309197779, +13309195558', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Interview scheduler — booked, the receipt',
    sender: '',
    sms_text: 'Booked: {candidate} — {slot}. Thank you!',
    email_subject: 'Interview booked — {candidate}',
    email_text: 'The in-person interview is booked.\n\n' +
                '  Candidate   {candidate}\n' +
                '  When        {slot}\n\n' +
                'It is on the hiring calendar; the candidate was e-mailed their confirmation.',
    note: 'Tells the supervisor the interview is booked — SMS on her YES, e-mail AND SMS ' +
          'when the candidate picked one of her three. The candidate\'s own confirmation ' +
          'rides hiringScheduleCreate (hiring_event_scheduled). Placeholders: {candidate} {slot}'
  }
];

// THE ENVIRONMENT CALLING THE OWNER — the feedback must come back proactively.
var SMART_GUARDIAN_EVENTS = [
  {
    id: 'guardian_alert', kind: 'event', event: 'guardian_alert',
    enabled: 'no', to: '', channels: 'sms, email',
    days_before: '0', statuses: '', label: 'Guardian — the environment needs a person',
    sender: '',
    sms_text: 'GUARDIAN ALERT: {issues}. Open the Guardian app for the full picture.',
    email_subject: 'Guardian alert — the environment needs a person',
    email_text: 'Hi,\n\nThe platform\'s Guardian found something that needs a person:\n\n{issues}\n\n' +
                'Open the Guardian app for the full picture.',
    // The designed letter (MailTemplates.gs): the e-mail leg wears the red Guardian design; the SMS keeps the plain…
    email_design: 'guardian_alert',
    note: 'OFF. Put your own number or address in `to`, then enable. Fires at most once ' +
          'per day while red (the instance is the day). Placeholders: {issues}'
  }
];

// WHAT THE MAILBOX HEARS — a fourth species.
var SMART_MAILBOX_EVENTS_SEED = [
  {
    id: 'staff_late_show', kind: 'mailbox', event: 'late_show',
    enabled: 'yes', channels: 'email', days_before: '0', statuses: '',
    to: 'asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com',
    label: 'Attendance — Late Show', sender: '',
    sms_text: 'LATE SHOW: {person} — {when}.',
    email_subject: 'Late Show — {person}',
    email_text: 'Hi,\n\n{person} arrived late: {when}.',
    note: 'The platform mailbox hears "Late Show — <person> (<iso>)" and the relay sweeps it on its ' +
          'own timer (StaffAlerts.gs). This row IS the recipient list — edit `to` here; a row that ' +
          'names nobody sends nothing. The subject and the lead paragraph are this row\'s e-mail ' +
          'cells; the designed layout adds the facts. Placeholders: {person} {when} {shift}'
  },
  {
    id: 'staff_no_call', kind: 'mailbox', event: 'no_call',
    enabled: 'yes', channels: 'email', days_before: '0', statuses: '',
    to: 'asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com',
    label: 'Attendance — No Show No Call', sender: '',
    sms_text: 'NO SHOW NO CALL: {person} — {when}.',
    email_subject: 'No Show No Call — {person}',
    email_text: 'Hi,\n\n{person} did not arrive and did not call: {when}.',
    note: 'Same mailbox lane as Late Show, different category. This row is the recipient list, and ' +
          'its e-mail cells are the letter\'s words. Placeholders: {person} {when} {shift}'
  }
];

/** The two weekly reports: one message about MANY people. */
var SMART_DIGESTS = [
  {
    id: 'weekly_expirations', kind: 'digest', direction: 'expiring',
    enabled: 'no', statuses: 'yes, other',
    // Empty = every date column the sweep knows: the seven mapped certifications plus the licence and insurance…
    credential: '', label: 'expirations', days_before: '45',
    to: '', exclude_column: '', exclude_values: '',
    channels: 'email', cc: '', sender: '',
    sms_text: '', email_subject: 'ABD ALERTS - URGENT ACTIONS REQUIRED',
    email_text: 'Urgent action required — everything expiring within {days_before} days.\n\n{table}',
    note: 'OFF until the recipients are filled in. Put the addresses in `to`. ' +
          'The original hardcoded two of them; a report nobody can redirect is a report ' +
          'that stops arriving the day somebody leaves.'
  },
  {
    id: 'weekly_referrals_unpaid', kind: 'digest', direction: 'elapsed',
    enabled: 'no', statuses: 'yes, other',
    credential: 'Start Date (first day)', label: 'unpaid referrals', days_before: '90',
    to: '', exclude_column: 'Referral Paid?', exclude_values: 'yes, not eligible',
    channels: 'email', cc: '', sender: '',
    sms_text: '', email_subject: 'ABD ALERTS - URGENT PAY EMPLOYEE REFERRALS',
    email_text: 'Urgent action required — pay employee referrals.\n\n{table}',
    note: 'OFF until the recipient is filled in. `direction: elapsed` means the window ' +
          'counts days SINCE the start date, not days until it.'
  }
];

/** THE GENERIC TEMPLATE — one wording that fits every certification. */
var SMART_SENDER_DEFAULT = 'the admin team from ASA LifeCare';

var SMART_GENERIC_SEED = {
  sms_text: 'Hi {first_name}, this is {sender}. Your {credential} expires on {expires} ' +
            '({days_left} days). Please renew it and upload the new certificate to our document portal.',
  email_subject: 'Your {credential} expires on {expires}',
  email_text: 'Hi {first_name},\n\nYour {credential} expires on {expires} ({days_left} days).\n\n' +
              'Please renew it and upload the new certificate to our document portal.\n\n{sender}'
};

/** DODD keeps its own wording: the State's renewal link, the portal link and the warning about all 8 hours rather than the first 2. */
var SMART_DODD_SMS_SEED =
  'Hi {first_name}, this is {sender}. Your DODD training is about to expire. ' +
  'Please follow the link below to renew your certification now. In addition, please be sure to ' +
  'complete all 8 hours and not just the first 2 hours.\n\n' +
  'https://mylearning.dodd.ohio.gov/enrol/programs/catalogue/program.php?id=5\n\n' +
  'When you\'re done you can upload your final certificate to our document portal.\n\n' +
  'https://docs.google.com/forms/d/e/1FAIpQLSeami3JUtuQXCGHDKXc_SPbrF10TZYTLunf3ge-ZKSD4DeYqQ/viewform?usp=sf_link';

// One situation per certification — the REQUIREMENTS TAB speaks first (Requirements.gs, label, window, credential…

// ── THE LETTERS AND THE SITUATIONS LIVE IN THE BOOK ───────── THE RULE: none of these stays hardcoded.
function smartMailboxEvents_() {
  return (typeof hubBookMerge_ === 'function')
    ? hubBookMerge_('Smart Mailbox Events', SMART_MAILBOX_EVENTS_SEED, 'id')
    : SMART_MAILBOX_EVENTS_SEED;
}
function smartAiRequests_() {
  return (typeof hubBookMerge_ === 'function')
    ? hubBookMerge_('Smart AI Requests', SMART_AI_REQUESTS_SEED, 'id')
    : SMART_AI_REQUESTS_SEED;
}
// THE EXTRAS, AND THE TWO FAMILIES THAT JOINED THEM.
function smartExtraSituations_() {
  var seed = SMART_EXTRA_SITUATIONS_SEED;
  try {
    if (typeof hubGateSeeds_ === 'function') seed = seed.concat(hubGateSeeds_());
    if (typeof hubAuthSeeds_ === 'function') seed = seed.concat(hubAuthSeeds_());
    if (typeof hubLetterSeeds_ === 'function') seed = seed.concat(hubLetterSeeds_());
    if (typeof hubDisabledLetterSeeds_ === 'function') seed = seed.concat(hubDisabledLetterSeeds_());
    if (typeof hubLaneSeeds_ === 'function') seed = seed.concat(hubLaneSeeds_());
    if (typeof hubNoticeSeeds_ === 'function') seed = seed.concat(hubNoticeSeeds_());
  } catch (e) { seed = SMART_EXTRA_SITUATIONS_SEED; }
  return (typeof hubBookMerge_ === 'function')
    ? hubBookMerge_('Smart Situations', seed, 'id')
    : seed;
}
/** The words every expiring credential wears when it has none of its own. */
function smartGeneric_() {
  if (typeof hubBookText_ !== 'function') return SMART_GENERIC_SEED;
  var got = {
    sms_text: hubBookText_('Smart Letters', 'generic_sms', SMART_GENERIC_SEED.sms_text),
    email_subject: hubBookText_('Smart Letters', 'generic_email_subject',
                                SMART_GENERIC_SEED.email_subject),
    email_text: hubBookText_('Smart Letters', 'generic_email_text',
                             SMART_GENERIC_SEED.email_text)
  };
  // AND WHAT THE BOOK ANSWERED IS REMEMBERED.
  try { smartGenericRemember_([got.sms_text, got.email_subject, got.email_text]); }
  catch (eR) { /* the seed and today's wording still stand on their own */ }
  return got;
}
/** DODD keeps its own wording, and the State keeps moving its link. */
function smartDoddSms_() {
  return (typeof hubBookText_ === 'function')
    ? hubBookText_('Smart Letters', 'dodd_sms', SMART_DODD_SMS_SEED)
    : SMART_DODD_SMS_SEED;
}

function smartDefaults_() {
  // READ ONCE PER CALL: three of these are book-backed now, and a reader per line would ask the same tab a dozen…
  var GEN = smartGeneric_();
  var DODD = smartDoddSms_();
  var fromTab = (typeof requirementsForSmart_ === 'function') ? requirementsForSmart_() : null;
  var out = [];
  if (fromTab && fromTab.length) {
    for (var i = 0; i < fromTab.length; i++) {
      var r = fromTab[i];
      var isDodd = r.consequence === 'dodd_expiring';
      out.push({
        id: r.consequence,
        enabled: isDodd ? 'yes' : 'no',
        credential: r.credential,
        days_before: r.warn_days || '30',
        statuses: 'yes, other',
        kind: 'reminder', direction: 'expiring', to: '', exclude_column: '', exclude_values: '',
        channels: 'sms',
        cc: '',
        label: '',
        sender: '',
        sms_text: r.sms_text || (isDodd ? DODD : GEN.sms_text),
        email_subject: GEN.email_subject,
        email_text: GEN.email_text,
        note: r.notes || (isDodd
          ? 'The reminder already in use, wording unchanged. Sends once per expiry date.'
          : 'OFF until somebody reads the wording. Put a number or address in `cc` if a ' +
            'trainer or coordinator should be copied — the message will then really reach them.'),
        max_attempts: r.max_attempts || '1',
        frequency: r.frequency || 'once'
      });
    }
  } else {
    var labels = (typeof certLabels_ === 'function') ? certLabels_() : { dodd: 'DODD 8-Hour' };
    for (var key in labels) {
      if (!labels.hasOwnProperty(key)) continue;
      var dodd = key === 'dodd';
      out.push({
        id: key + '_expiring',
        enabled: dodd ? 'yes' : 'no',
        credential: key,
        days_before: '30',
        statuses: 'yes, other',
        kind: 'reminder', direction: 'expiring', to: '', exclude_column: '', exclude_values: '',
        channels: 'sms',
        cc: '',
        label: '',
        sender: '',
        sms_text: dodd ? DODD : GEN.sms_text,
        email_subject: GEN.email_subject,
        email_text: GEN.email_text,
        note: dodd
          ? 'The reminder already in use, wording unchanged. Sends once per expiry date.'
          : 'OFF until somebody reads the wording. Put a number or address in `cc` if a ' +
            'trainer or coordinator should be copied — the message will then really reach them.',
        max_attempts: '1',
        frequency: 'once'
      });
    }
  }
  // THE EXTRAS DO NOT DEPEND ON THE REQUIREMENTS TAB.
  var plantedById = {};
  out.forEach(function (d) { plantedById[d.id] = d; });
  smartExtraSituations_().forEach(function (e) {
    var already = plantedById[e.id];
    if (already) {
      if (!str_(already.label) && str_(e.label)) already.label = e.label;
      return;
    }
    // A seed that SAYS what it is keeps it (the bundle ships ON, kind bundle, on both channels, with its own…
    var said = function (field) { return Object.prototype.hasOwnProperty.call(e, field); };
    var pick = function (field, whenSilent) {
      return said(field) ? String(e[field] == null ? '' : e[field]) : whenSilent;
    };
    out.push({
      id: e.id, enabled: pick('enabled', 'no'), credential: e.credential, days_before: e.days_before,
      statuses: pick('statuses', 'yes, other'), kind: pick('kind', 'reminder'),
      direction: pick('direction', 'expiring'), to: pick('to', ''),
      exclude_column: '', exclude_values: '',
      channels: pick('channels', 'sms'), cc: pick('cc', ''),
      label: e.label, sender: pick('sender', ''),
      sms_text: e.sms_text,
      email_subject: pick('email_subject', GEN.email_subject),
      email_text: pick('email_text', GEN.email_text),
      note: e.note,
      // `event` names the condition an event row waits on.
      event: pick('event', ''),
      max_attempts: pick('max_attempts', '1'),
      frequency: pick('frequency', 'once'),
      // AND THE TWO COLUMNS THIS MAPPING WAS NEVER TOLD ABOUT.
      send_at: pick('send_at', ''),
      record_to: pick('record_to', ''),
      from_line: pick('from_line', '')
    });
    plantedById[e.id] = out[out.length - 1];
  });
  SMART_DIGESTS.forEach(function (d) {
    out.push(Object.assign({ max_attempts: '1', frequency: 'once' }, d));
  });
  SMART_HIRING_EVENTS.forEach(function (e) {
    out.push(Object.assign({ max_attempts: '1', frequency: 'once' }, e));
  });
  SMART_GUARDIAN_EVENTS.forEach(function (e) {
    out.push(Object.assign({ max_attempts: '1', frequency: 'once' }, e));
  });
  // the mailbox lane's two — StaffAlerts.gs reads `to` from these rows
  smartMailboxEvents_().forEach(function (e) {
    out.push(Object.assign({ max_attempts: '1', frequency: 'once' }, e));
  });
  return out;
}

// The two that are NOT certifications — a driver's licence and car insurance.
var SMART_AI_DEFAULT_ID = 'ai_default';

var SMART_AI_REQUESTS_SEED = [
  {
    id: 'ai_default', enabled: 'no', kind: 'ai',
    label: 'The default — used when a place has no row of its own',
    ai_model: '', ai_providers: '',
    note: 'The fallback for every AI call whose own row is absent or off. Set the model here and the whole platform follows.'
  },
  {
    id: 'ai_phone_screen', enabled: 'no', kind: 'ai',
    label: 'Phone screen / résumé analysis (screenAnalyze)',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_resume_rubric', enabled: 'no', kind: 'ai',
    label: 'Résumé scoring against the rubric (rubricAnalyze_)',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_date_accepted', enabled: 'no', kind: 'ai',
    label: 'Reading a Date Accepted out of free text',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_interest_reply', enabled: 'no', kind: 'ai',
    label: 'Is this reply a yes? (the interest classifier)',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_interview_reply', enabled: 'no', kind: 'ai',
    label: 'Reading an interview reply',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_crossing_reply', enabled: 'no', kind: 'ai',
    label: 'Reading an authorization reply at the crossing',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_member_reply', enabled: 'no', kind: 'ai',
    label: 'Reading a member authorization reply',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_referral_contact', enabled: 'no', kind: 'ai',
    label: 'Finding a phone or e-mail in a referral reply',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_shortlist_reading', enabled: 'no', kind: 'ai',
    label: 'The shortlist reading sent to the deciders',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_hiring_notice', enabled: 'no', kind: 'ai',
    label: 'Wording a hiring event notice',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_find_email', enabled: 'no', kind: 'ai',
    label: 'Finding a new hire\'s e-mail address',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_message_rewrite', enabled: 'no', kind: 'ai',
    label: 'Rewriting a message before it is sent',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_mail_route', enabled: 'no', kind: 'ai',
    label: 'Routing an incoming mail to a folder',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_alert_classify', enabled: 'no', kind: 'ai',
    label: 'Classifying a staff alert',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_hotline_manager', enabled: 'no', kind: 'ai',
    label: 'Naming the house manager for a hotline call',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_isp_guardian', enabled: 'no', kind: 'ai',
    label: 'Extracting the guardian from an ISP',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_book_licence', enabled: 'no', kind: 'ai',
    label: 'Judging whether a book licence is free',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_receipt_verdict', enabled: 'no', kind: 'ai',
    label: 'Reading a receipt and giving a verdict',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_recon_day', enabled: 'no', kind: 'ai',
    label: 'Reading a stored day in reconciliation',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_staff_performance', enabled: 'no', kind: 'ai',
    label: 'The staff performance board',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_profile_summary', enabled: 'no', kind: 'ai',
    label: 'Synthesizing a person profile',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_shopper_estimate', enabled: 'no', kind: 'ai',
    label: 'Smart Shopper price estimates',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_palette_search', enabled: 'no', kind: 'ai',
    label: 'The command palette understanding a phrase',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_playground_page', enabled: 'no', kind: 'ai',
    label: 'Drafting a page in the app builder',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. Set a model here only to give THIS call its own.'
  },
  {
    id: 'ai_behavior_reading', enabled: 'no', kind: 'ai',
    label: 'The behaviour reading for one person (Behavior Support)',
    ai_model: '', ai_providers: '',
    note: 'Blank or off, this place uses the default row (ai_default), then the code. The PROMPT is not here — it lives in the generic config book\'s Prompts tab under this same id, with a floor shipped in Behavior.gs.'
  }
];

/** The URGENT OPEN SHIFT never carries the reason; that goes to the 5558 group alone. */
var SMART_URGENT_LINK_LINE = 'To apply, reply YES {ref} - or open {link}';
var SMART_URGENT_OPEN_SHIFT_TEXT =
  'URGENT OPEN SHIFT\n' +
  'Can anyone pick up shift for {house} at {time} {day_word}. Located at {location}.\n' +
  'Please respond if you can take this shift\n' +
  SMART_URGENT_LINK_LINE + '\n' +
  'Thank you';
/** Earlier seed, matched exactly by smartUrgentLinkOnce_. */
var SMART_URGENT_OPEN_SHIFT_NO_LINK =
  'URGENT OPEN SHIFT\n' +
  'Can anyone pick up shift for {house} at {time} {day_word}. Located at {location}.\n' +
  'Please respond if you can take this shift\n' +
  'Thank you';
var SMART_URGENT_OPEN_SHIFT_BEFORE =
  'URGENT OPEN SHIFT\nCan anyone pick up a shift today, {date}?\n' +
  'Please respond if you can take this shift\nThank you';
// The layout as the previous build seeded it, with the reason line — which the last publish may already have…
var SMART_URGENT_OPEN_SHIFT_WITH_REASON =
  'URGENT OPEN SHIFT\n' +
  'Can anyone pick up shift for {house} at {time} {day_word}. Located at {location}.\n' +
  '{reason}\n' +
  'Please respond if you can take this shift\n' +
  'Thank you';

// THE REASON, TO THE 5558 GROUP ONLY — the directors and the people responsible.
var SMART_CALLOFF_DIRECTORS_TEXT =
  'CALL OFF: {employee} - {house} {time} {day_word}.\n' +
  'Reason: {reason} - {sender}';

/** Plain ASCII keeps the text GSM-7; never a reason and never who called off. */
var SMART_OPEN_SHIFT_COVERED_TEXT =
  'OPEN SHIFT COVERED\n' +
  'The shift for {house} at {time} {day_word} has been covered - no need to respond.\n' +
  'Thank you!';

/* The *_BEFORE words are earlier seeds, matched exactly by smartHandoffWordsOnce_. */
var SMART_HANDOFF_ASK_STAFF_BEFORE = '{other} wants to give you the {shift} shift at {house} on {day}. ' +
  'Reply YES to take it or NO to pass. Ref {handoff} - {sender}';
var SMART_HANDOFF_ASK_STAFF_TEXT = '{other} wants to give you the {shift} shift at {house} on {day}. ' +
  'Reply YES {handoff} to take it or NO {handoff} to pass - or answer on the Hub, Calendar Builder - Requests. - {sender}';
var SMART_HANDOFF_ASK_MANAGER_BEFORE = '{other} wants to give the {shift} shift at {house} on {day} to {name}. ' +
  'Reply YES to approve or NO to decline. Ref {handoff} - {sender}';
var SMART_HANDOFF_ASK_MANAGER_TEXT = '{other} wants to give the {shift} shift at {house} on {day} to {name}. ' +
  'Reply APPROVE {handoff} or NO {handoff} - or answer on the Hub, Calendar Builder - Requests. - {sender}';
var SMART_HANDOFF_ASK_MANAGER_MAIL_BEFORE = 'Hi {first_name},\n\nA shift handoff at your house needs your approval:\n\n  House:  {house}\n  Day:    {day}\n  Shift:  {shift}\n  Giving: {other}\n  Taking: {name}\n\nReply to this e-mail with YES or APPROVE to allow it, or NO or NOT APPROVE to decline.\nYou can also answer on the Hub, on Shift Board - House Calendars.\nNothing changes on the calendar until you approve AND the other staff member accepts.\n\nReference {handoff}\n- {sender}';
var SMART_HANDOFF_ASK_MANAGER_MAIL = SMART_HANDOFF_ASK_MANAGER_MAIL_BEFORE
  .replace('on Shift Board - House Calendars', 'on Calendar Builder - Requests');
/* shift_applicants_waiting: the earlier seed named the Shift Board, which moved into Calendar Builder. */
var SMART_APPLICANTS_WAITING_SMS_BEFORE = 'Applications closed for the {shift} shift at {house} on {day}: {applicants} ' +
  'applied. Open Shift Board - Requests to approve one or assign somebody. - {sender}';
var SMART_APPLICANTS_WAITING_SMS = SMART_APPLICANTS_WAITING_SMS_BEFORE
  .replace('Open Shift Board - Requests', 'Open Calendar Builder - Requests');
var SMART_APPLICANTS_WAITING_MAIL_BEFORE = 'Hi {to_first_name},\n\nApplications have closed for an open shift at your house:\n\n  House:      {house}\n  Day:        {day}\n  Shift:      {shift}\n  Applicants: {applicants}\n\nOpen Shift Board - Requests on the Hub to see who applied, with the hours each of them already has that week, and approve one - or assign somebody else.\n\nNobody is on this shift until you decide.\n- {sender}';
var SMART_APPLICANTS_WAITING_MAIL = SMART_APPLICANTS_WAITING_MAIL_BEFORE
  .replace('Open Shift Board - Requests', 'Open Calendar Builder - Requests');

/* Recruiter texts: seeds only (the Desk owns the words); plain ASCII keeps them GSM-7. */

/** The morning of the screen. */
var SMART_RECRUIT_SCREEN_TEXT =
  'Hello {first_name}, this is {sender}.\n\n' +
  'I am just passing by to remind you that your in-person screening is scheduled for today at ' +
  '{time}, with our house manager {screener}, located at {location}.\n\n' +
  'Please confirm if you are going to be able to show up.';

/** After a screen that went well. */
var SMART_RECRUIT_ONBOARD_TEXT =
  'Hello {first_name}, this is {sender}.\n\n' +
  '{screener} has reached out to me, and let me know that your screening went really well.\n' +
  'Therefore, I would like to start helping you out with your onboarding process.\n\n' +
  'Firstly, there are a few forms we will need you to fill out, could you please provide me with ' +
  'your best email address?';

/** The True Hire how-to. */
var SMART_RECRUIT_BCI_TEXT =
  'Hello {first_name}, this is {sender}.\n' +
  'We noticed you have still not completed your BCI Background. Would you be able to have it ' +
  'completed today?\n\n' +
  'Here is the information you will need to complete your BCI background:\n\n' +
  'DODD has recently changed background check providers and is now using True Hire. They accept ' +
  'walk-ins Mon-Fri (8A-5P) and close for lunch between noon and 1PM.\n\n' +
  'Address: 4650 Hills and Dales Road NW Ste. 320, Canton, Ohio 44708\n\n' +
  'Our company information for the background check:\n\n' +
  'Company: A Brighter Dawn, Inc\n' +
  'Phone: (330) 919-7595\n' +
  'Mailing: PO Box 289, Louisville, OH 44641\n' +
  'Reason Code: 5123.081 (BCI only)\n' +
  'You\'re doing ONLY BCI Background and the reason code is 5123.081. Bring valid photo ' +
  'identification (Driver\'s License or State ID).';

/** Default sender until the Desk says otherwise. */
var SMART_RECRUIT_SENDER = 'Arthur from Asa Life Care';

/** The recruiters' line, so replies land where screens are booked. */
var SMART_RECRUIT_LINE = 'Administration';

// THE NIGHT, SAID ONCE FOR THE THREE CALL-OFF ROWS THAT DO NOT WAIT FOR THE LADDER — the manager, the cover offer…
var SMART_CALLOFF_QUIET_NOTE =
  'THE QUIET WINDOW HOLDS IT: nothing leaves 21:31-07:59 New York (the standing rule for ' +
  'every message) - a call-off recorded in the night is resolved, its words go into the mock ' +
  'outbox as held_quiet, and the first hotline pass after 08:00 sends it if the shift it is ' +
  'about (found on the roster as of the call) has not ended; otherwise the call-off row says ' +
  'it went stale and nobody is told.';

/* Time off (server/time_off.py plans, StaffAlerts.gs says): plain ASCII; a reason never travels. */
var SMART_TIME_OFF_ASK_MANAGER_TEXT = '{requester} asks for time off {dates} ({days}, {house}). {reason_line} ' +
  'Reply YES {ref} to approve or NO {ref} to decline - or open {link} - {sender}';
var SMART_TIME_OFF_ASK_ABOVE_TEXT = '{requester} asks for time off {dates} ({days}). {approval}. A director ' +
  'approves in place of the house manager: reply YES {ref} or NO {ref} - or open {link} - {sender}';
var SMART_TIME_OFF_ASK_DIRECTOR_TEXT = '{requester} asks for time off {dates} ({days}, {house}). It needs a ' +
  'director\'s approval as well as the house manager\'s. Reply YES {ref} or NO {ref} - or open {link} - {sender}';
var SMART_TIME_OFF_SCHEDULED_TEXT = 'Your time off {dates} is approved by the house manager and a director, and ' +
  'scheduled. Ref {ref} - {sender}';
var SMART_TIME_OFF_SCHEDULED_MANAGER_TEXT = '{requester} is off {dates} (approved). {drafts} Publish them from ' +
  'Calendar Builder - Builder. Ref {ref} - {sender}';
var SMART_TIME_OFF_DENIED_TEXT = 'Your time off request {dates} was not approved by {by}: {words} Ref {ref} - {sender}';
var SMART_TIME_OFF_CANCELLED_TEXT = 'Your scheduled time off {dates} was cancelled by {by}: {words} Ref {ref} - ' +
  '{sender}';
var SMART_TIME_OFF_CANCELLED_MANAGER_TEXT = '{requester}\'s time off {dates} was cancelled. The shifts put up as ' +
  'open drafts stay open until you give them back in Calendar Builder - Builder. Ref {ref} - {sender}';
var SMART_TIME_OFF_EXPIRED_TEXT = 'Your time off request {dates} was not answered before it ended and is closed. ' +
  'Ref {ref} - {sender}';
var SMART_TIME_OFF_MAIL_TEXT = 'Hi {to_first_name},\n\n{message}\n\n  Person: {requester}\n  Dates:  {dates}\n' +
  '  Houses: {house}\n\nOpen it on the Hub: {link}\n\nReference {ref}\n- {sender}';

/** One time off situation: SMS and e-mail, on, `Goes to` empty — the door resolves the named recipient. */
function smartTimeOffSeed_(id, label, sms, subject, who) {
  return {
    id: id, enabled: 'yes', kind: 'shift_clock', credential: '', label: label, days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: sms, email_subject: subject,
    email_text: SMART_TIME_OFF_MAIL_TEXT.replace('{message}', sms.replace(/ - or open \{link\}/, '')
      .replace(/ - \{sender\}$/, '')),
    note: 'Time off (server/time_off.py plans it, StaffAlerts.gs staffShiftReminder says it). ' + who +
          ' Replies are YES {ref} or NO {ref} by text, or a click on the Hub. Held inside 21:31-07:59 like ' +
          'every staff message; while test mode is on it is written into the mock outbox and NOBODY IS ' +
          'CONTACTED. The reason itself never travels. Placeholders: {requester} {dates} {days} {house} {ref} ' +
          '{link} {by} {words} {drafts} {reason_line} {approval} {sender}.'
  };
}

// The Scheduling app's texts (SchedulingFlows.gs).
var SMART_SCHED_CALLOFF_HOUSE_TEXT = 'URGENT OPEN SHIFT\n' +
  'Can you pick up the {shift} shift at {house} {day_word} ({date}), starting at {time}? Located at {location}.\n' +
  'Take it on the Hub: {link}\nThank you - {sender}';
var SMART_SCHED_CALLOFF_EVERYONE_TEXT = 'URGENT OPEN SHIFT\n' +
  'Can anyone pick up the {shift} shift at {house} {day_word} ({date}), starting at {time}? Located at {location}.\n' +
  'Take it on the Hub: {link}\nThank you - {sender}';
var SMART_SCHED_SWAP_ASK_TEXT = 'Shift swap waiting for your answer: {original} to {replacement}, the {shift} shift ' +
  'at {house} on {date}. Answer in My Work on the Hub: {link} - {sender}';
var SMART_SCHED_SWAP_DECLINED_STAFF_TEXT = '{replacement} declined the swap - {house}, {date}, {shift}. The shift ' +
  'is still yours. - {sender}';
var SMART_SCHED_SWAP_DECLINED_MANAGER_TEXT = 'The house manager declined the swap - {house}, {date}, {shift}. The ' +
  'shift is still yours. - {sender}';
var SMART_SCHED_SWAP_DECLINED_DIRECTOR_TEXT = 'The director declined the swap - {house}, {date}, {shift}. The shift ' +
  'is still yours. - {sender}';
var SMART_SCHED_SWAP_DONE_TEXT = 'Shift swapped: {house} {date} {shift} - {original} to {replacement}. - {sender}';
var SMART_SCHED_REQUEST_DECIDED_TEXT = 'Your Request Off for the {shift} shift at {house} on {date} was {result}. ' +
  '- {sender}';
var SMART_SCHED_TIMEOFF_DECIDED_TEXT = 'Your time off {dates} was {result}. - {sender}';
var SMART_SCHED_TRAINING_ASK_TEXT = 'Training approval waiting: {trainee} has no IST at {house} and is on the {shift} ' +
  'shift on {date} as a training with the house manager. Approve or decline in My Work on the Hub: {link} - {sender}';
var SMART_SCHED_TRAINING_DECIDED_TEXT = 'Your training shift at {house} on {date} ({shift}) was {result}. - {sender}';

// One Scheduling text: SMS only, `Goes to` empty — SchedulingFlows.gs names each recipient.
function smartSchedSeed_(id, label, sms, who, names) {
  return {
    id: id, enabled: 'yes', kind: 'letter', credential: '', label: label, days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: sms, email_subject: '', email_text: '',
    note: 'Scheduling (SchedulingFlows.gs names it, smartTell_ says it). ' + who + ' A letter: the moment ' +
          'is the Scheduling write or its outreach clock, never a sweep. Born ON by the Scheduling ruling. Held ' +
          'inside 21:31-07:59 and said at 08:00; while test mode is on it is written into the rehearsal book and ' +
          'NOBODY IS CONTACTED. It never names who called off or why. Placeholders: {house} {date} {day_word} ' +
          '{time} {shift} {location} {link} ' + (names ? '{original} {replacement} ' : '') +
          '{result} {dates} {sender}.'
  };
}

// An exchange: two people's shifts change hands, at any houses.
var SMART_SCHED_EXCHANGE_ASK_TEXT = 'Shift swap waiting for your answer: {original} gives the {shift} shift at {house} ' +
  'on {date} and takes {replacement}\'s {their_shift} shift at {their_house} on {their_date}. Answer in My Work on ' +
  'the Hub: {link} - {sender}';
var SMART_SCHED_EXCHANGE_DONE_TEXT = 'Shifts swapped: {original} now works {their_house} {their_date} {their_shift}, ' +
  'and {replacement} works {house} {date} {shift}. - {sender}';

function smartSchedExchangeSeed_(id, label, sms, who) {
  var s = smartSchedSeed_(id, label, sms, who, true);
  s.note += ' And {their_shift} {their_house} {their_date}: the shift that comes back.';
  return s;
}

// The Support Requests app's texts (SupportDesk.gs).
var SMART_SR_VEHICLE_REQUEST_TEXT = 'Vehicle request from {requestor} ({callback}): {type} - {summary}. Urgency ' +
  '{urgency}. Open Support Requests: {link} - {sender}';
var SMART_SR_PAYROLL_REQUEST_TEXT = 'Payroll request from {requestor} ({callback}): {type} - {summary}. Open ' +
  'Support Requests: {link} - {sender}';
var SMART_SR_PUNCH_AWARE_TEXT = '{person} is not punching {direction} - {house}, {shift} on {date}. Are you aware? ' +
  'Open My Inbox: {link} - {sender}';
var SMART_SR_ADP_APPLIED_TEXT = 'Update information from {requestor} applied automatically: {field} changed on the ' +
  'platform. ADP still needs it. {link} - {sender}';

/** One Support Requests text: SMS only, `Goes to` empty — SupportDesk.gs names each recipient. */
function smartSupportSeed_(id, label, sms, who) {
  return {
    id: id, enabled: 'yes', kind: 'letter', credential: '', label: label, days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: sms, email_subject: '', email_text: '',
    note: 'Support Requests (SupportDesk.gs says it, through the one send door). ' + who + ' A letter: the moment ' +
          'is the request or warning the platform raised, never a sweep. Its Settings switch (Settings > My Work, ' +
          'Support Requests) ships OFF and is the act that starts it. Held inside 21:31-07:59 and said at 08:00; ' +
          'while test mode is on it is written into the rehearsal book and NOBODY IS CONTACTED. Placeholders: ' +
          '{requestor} {callback} {type} {summary} {urgency} {person} {direction} {house} {shift} {date} {field} ' +
          '{link} {sender}.'
  };
}

var SMART_TRANSPORT_REQUEST_ASK_TEXT = 'Vehicle request waiting for your approval: {requester} asks for the {vehicle}, ' +
  '{when}. Phone: {requester_phone}. Staff: {staff}. Client: {client}. Trip: {trip_type}. Wheelchair-accessible ' +
  'vehicle needed: {wheelchair}. Details: {details}. Approve or decline in My Work: {link} - {sender}';
var SMART_TRANSPORT_REQUEST_DECIDED_TEXT = 'Your vehicle request for the {vehicle}, {when}, was {result} by {by}. ' +
  'Note: {note}. {link} - {sender}';
var SMART_TRANSPORT_TRIP_CANCELLED_TEXT = 'Your trip with the {vehicle}, {when}, was cancelled by {by}. Note: {note}. ' +
  '- {sender}';
var SMART_STAFF_LOAN_REQUEST_TEXT = 'Employee loan request waiting for your approval: {employee}, {amount}, ' +
  'disbursement {date}. Requested by {requester}. Approve or decline in My Work: {link} - {sender}';

/** One Transportation text: SMS only, `Goes to` empty — VehicleCalendarFlows.gs names each recipient. */
function smartTransportSeed_(id, label, sms, who) {
  return {
    id: id, enabled: 'yes', kind: 'letter', credential: '', label: label, days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: sms, email_subject: '', email_text: '',
    note: 'Transportation (VehicleCalendarFlows.gs names the recipient, smartTell_ says it). ' + who + ' A letter: ' +
          'the moment is the Transportation write, or its clock for a text the quiet window held. Held inside ' +
          '21:31-07:59 and said at 08:00; while test mode is on it is written into the rehearsal book and NOBODY IS ' +
          'CONTACTED. A sentence whose placeholder has nothing to say is dropped. Placeholders: {requester} ' +
          '{requester_phone} {vehicle} {when} {staff} {client} {trip_type} {wheelchair} {details} {result} {by} ' +
          '{note} {link} {sender}.'
  };
}

var SMART_EXTRA_SITUATIONS_SEED = [
  {
    id: 'drivers_license_expiring', credential: 'Driver License Exp Date',
    label: 'driver\'s license', days_before: '60',
    sms_text: 'Hi {first_name}, this is {sender}. Your {credential} is about to expire. Once it expires, ' +
              'you\'re not legally allowed to drive, and you may have to take additional tests to get it ' +
              'renewed.\n\nHere\'s what you\'ll need to take with you to your nearest BMV:\n\n' +
              ' -Your current driver\'s license\n' +
              ' -Proof of your Social Security Number (like your SS card or W-2)\n' +
              ' -Two documents showing your Ohio address (utility bill, bank statement, etc.)\n\n' +
              'When you\'re done you can upload your new license to our document portal.\n\n' +
              'https://docs.google.com/forms/d/e/1FAIpQLSeyzahxLs37-qejU19Hynh4jFGwxVsWGgnBPArflgc2bmV3dA/viewform',
    note: 'OFF. The original sent every one of these to a single hardcoded number instead of to the ' +
          'person — read it, then enable.'
  },
  {
    id: 'car_insurance_expiring', credential: 'Insurance Exp Date',
    label: 'car insurance', days_before: '15',
    sms_text: 'Hi {first_name}, this is {sender}. Your {credential} is about to expire in {days_left} days. ' +
              'Once it expires, you\'re not legally allowed to drive our clients in your vehicle.\n\n' +
              'Please renew it as soon as possible. If you do not plan to renew please let us know.\n' +
              'When you\'re done you can upload your new insurance card to our document portal.\n\n' +
              'https://docs.google.com/forms/d/e/1FAIpQLSeami3JUtuQXCGHDKXc_SPbrF10TZYTLunf3ge-ZKSD4DeYqQ/viewform?usp=sf_link',
    note: 'OFF. The original read "our car insurance is about to expire" — "your" is meant, and it has ' +
          'been going out that way. Corrected here.'
  },
  // THE BUNDLE (CommRecord.gs): one message carrying several obligations.
  {
    // OFF as shipped — the law is that a publish never switches a sender on.
    id: 'compliance_bundle', enabled: 'no', kind: 'bundle',
    credential: '', label: 'outstanding compliance items', days_before: '',
    channels: 'sms, email',
    sms_text: 'Hi {first_name}, this is {sender}. Our records show {credential} still outstanding ' +
              'on your file. Please send the updated document(s) through the document portal, ' +
              'or reply here if you have questions or already sent them. Ref {token}',
    email_subject: 'Action needed on your file: {credential}',
    email_text: 'Hi {first_name},\n\nThis is {sender}. Our records show the following still ' +
                'outstanding on your file: {credential}.\n\nPlease send the updated document(s) ' +
                'through the document portal, or reply to this message if you have questions or ' +
                'already sent them.\n\nThank you.\nRef {token}',
    note: 'The obligations lane\'s one message per person. {credential} names the items; ' +
          '{items} is their count. Paced by comm_* settings, not by days_before.'
  },
  // THE ASK (CommWindowAsk.gs): the one message in this catalogue that asks a person about THEIR OWN LIFE rather…
  {
    // OFF as shipped — the law is that a publish never switches a sender on.
    id: 'contact_window_ask', enabled: 'no', kind: 'window_ask',
    credential: '', label: 'the best time to reach you', days_before: '',
    channels: 'sms, email',
    // PLAIN ASCII AND THREE SEGMENTS.
    sms_text: 'Hi {first_name}, this is {sender}. One question, no rush: what hours are good ' +
              'for us to text or email you? Reply with a range, like "after 2pm" or ' +
              '"9a-5p, not weekends". We will use it to stop reaching you at bad times. ' +
              'It is about messages only - nothing about your schedule or your pay. ' +
              'Reply STOP and we will stop. Ref {token}',
    email_subject: 'What hours are good for us to reach you?',
    email_text: 'Hi {first_name},\n\nThis is {sender}. One question, and there is no rush.\n\n' +
                'What hours are good for us to text or email you?\n\n' +
                'Reply with a range — for example: after 2pm, or 9a-5p, or not before noon ' +
                'on weekends.\n\nWe will use your answer to stop reaching you at bad times. ' +
                'This is about messages only: it changes nothing about your schedule, your ' +
                'shifts or your pay.\n\nIf you would rather hear nothing from us here, reply ' +
                'STOP and we will not message you again.\n\nThank you.\nRef {token}',
    note: 'The window lane\'s one question per person (CommWindowAsk.gs). Sent inside the ' +
          'minutes before a shift, once a day, until they answer or the ceiling is reached ' +
          '(comm_window_ask_max_asks). Paced by comm_window_ask_* settings, not by days_before.'
  },
  // THE CALL-OFF LANE'S FOUR (CommCallOff.gs), AND THEY SHIP WORKING.
  {
    id: 'call_off_acknowledged', enabled: 'yes', kind: 'call_off',
    credential: '', label: 'we got your call', days_before: '',
    channels: 'sms',
    // NO `to_subject` HERE, and that is not an omission.
    sms_text: 'Hi {first_name}, this is {sender}. We got your call about {expires} and it is on ' +
              'record - you do not need to call again about it, and somebody will be in touch ' +
              'if we need anything. Thank you for letting us know. Ref {token}',
    email_subject: '', email_text: '',
    note: 'CommCallOff.gs — the ONE acknowledgement to the person who called off, so she knows ' +
          'it landed and nobody chases her. It goes to the CALLER and to nobody else: the lane ' +
          'resolves her itself, so `Goes to` stays empty and no cell can widen it. Rung ' +
          '`notice` (CommPolicy.gs COMM_PRIORITY_FLOOR), which means this is the one of the ' +
          'four that DOES obey the quiet hours of the ladder (21:00-08:00) — a 3am ' +
          'acknowledgement is not reassurance, so it defers and the next call-off carries it; the ' +
          'other three are held by the send door\'s own window (21:31-07:59) and carried at 08:00. ' +
          'Fired by the write that records the ' +
          'call-off, never by a clock. Exactly one per person per call-off. A Late Show gets ' +
          'NOTHING — they worked. SHIPS ON with drafted words, by the standing decision that ' +
          'these rows are born working; the sentence is a first draft and can be ' +
          'rewritten here without a publish. NOTHING LEAVES WHILE THE SENDING DIAL STANDS AT ' +
          '`record`: the lane works the answer out, writes it on the call-off row — the ending, ' +
          'the reason and the minute, IN TEST MODE TOO — and contacts nobody; the words she ' +
          'would have read go into the `comm_rehearsal` house, so what you read before moving ' +
          'the dial is the message itself and not only a count. ' +
          'The dial follows test mode: turning test mode off moves it to `send`, with no second ' +
          'step. Placeholders: {first_name} {name} {sender} ' +
          '{expires} (the SHIFT DATE — `{date}` is not filled on this row) {token}.'
  },
  {
    id: 'call_off_cover_offer', enabled: 'yes', kind: 'call_off',
    credential: '', label: 'a shift that needs cover', days_before: '',
    channels: 'sms',
    // THE PEOPLE WHO DECIDE WHO COVERS, AS THE RULE NAMES THEM: the house managers and the director.
    to: 'housemanagers, +13309197779', cc: '',
    sms_text: 'Cover needed at {house} on {date}: {employee} {kind}. The house manager on the ' +
              'calendar is {house_manager}. Please decide who can be asked - this platform is ' +
              'not ranking anybody for it. - {sender}',
    email_subject: '', email_text: '',
    note: 'CommCallOff.gs — the shift that needs cover, to the HOUSE MANAGERS and Ty Bond ' +
          '(`Goes to`: the keyword `housemanagers` resolves to every ** row of the hotline ' +
          'calendar; the Desk shows the count). Fired by the write that records the call-off, ' +
          'never by a clock; ONCE per call-off. ' + SMART_CALLOFF_QUIET_NOTE + ' THE SHIFT\'S ' +
          'OWN HOUSE MANAGER HEARS THIS ONCE AND NOT TWICE: she is told by ' +
          'the house-manager row and is then dropped out of this audience by number, and the ' +
          'call-off row says how many were skipped for that reason. SHIPS ON with DRAFTED ' +
          'words — these are not a dictated sentence, and they can be rewritten here without a publish. ' +
          'NOTHING LEAVES WHILE THE SENDING DIAL STANDS AT `record`: the audience is resolved, ' +
          'counted and written onto the call-off row with the reason and the minute — IN TEST ' +
          'MODE TOO — and nobody is contacted; the message as it would go is written into the ' +
          '`comm_rehearsal` house, one row per channel, addressed to the whole audience and ' +
          'counted there. The turn is ' +
          'still owed the day test mode goes off and the dial follows it to `send`. ' +
          'Placeholders that resolve: {employee} {date} {kind} (the CATEGORY — called off / did ' +
          'not come in) {house} {house_manager} {sender}. {house_manager} RENDERS HER NAME AND ' +
          'NEVER HER NUMBER — the calendar cell holds both and a colleague\'s mobile is not a ' +
          'placeholder value; where the calendar names no manager it says so in words. ' +
          'When the caller never named a house, ' +
          '{house} renders "(the house was not named on the call)" rather than a blank gap, and ' +
          'the lane writes that down. THE SUGGESTION IS NOT IN THIS BUILD and there is no ' +
          '{suggestion} placeholder: ranking who should cover is the cover-suggestion engine\'s ' +
          'work — Behavior Support and Staff Performance are CONTEXT and never rank a person ' +
          'for work — and it arrives with that engine. {reason} never resolves: the caller\'s ' +
          'own words about her morning are not a value this lane will put in a message.'
  },
  // THE TWO CALL-OFF MESSAGES NAMED BY THE RULES, AND THEY ARRIVE SAYING SOMETHING.
  {
    id: 'call_off_house_manager', enabled: 'yes', kind: 'call_off',
    credential: '', label: 'the house manager is told', days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    /* THE DICTATED SENTENCE, KEPT WORD FOR WORD. */
    sms_text: 'Staff {employee} informed that will not work today. Shift {date}, {house}. ' +
              '- {sender}',
    email_subject: '', email_text: '',
    note: 'CommCallOff.gs — ONE message to the house manager on the calendar for the shift that ' +
          'was called off, in the dictated sentence ("Staff X informed that will not work ' +
          'today"). Fired by the write that records the call-off, never by a clock; ONCE per ' +
          'call-off, and she hears about that call-off from THIS row rather than from the cover ' +
          'offer, which drops her by number. `Goes to` is EMPTY on purpose and stays empty: the ' +
          'audience is the manager the hotline resolves for THAT shift, per call-off, and no ' +
          'cell can hold a different manager per house. No manager resolved means NO SEND and a ' +
          'line on the call-off row saying so — never a guess — and the Desk carries the share ' +
          'of recent call-offs whose location did resolve, which IS the reach of this row ' +
          '(`smartCommsGet` → `call_off_reach`, counted off the recorded rows). ' +
          '⚠ SHE MAY HEAR ABOUT THIS ABSENCE TWICE, AND THAT IS THE ONE THING TO WEIGH BEFORE ' +
          'LEAVING THIS ROW ON. The hotline\'s own Call Off Processor v1.3 already finds the ' +
          'House Lead and texts her through OpenPhone — "CALL OFF ALERT: <name> called off ' +
          '<date> at <house>. Reason: …", carrying the caller\'s own words, which this row will ' +
          'not send. PROVED: that sender, its wording and its delivery. NOT PROVED: whether it ' +
          'spoke this week — the newest alert this platform can see is from 2026-03-20 and that ' +
          'message log has recorded nothing since, while the legacy project itself still runs. ' +
          'A quiet log is NOT a disarmed sender, and nothing here reads it as one. Switch this ' +
          'row off if one text is enough until that processor is retired. ' +
          SMART_CALLOFF_QUIET_NOTE + ' SHIPS ON with the dictated sentence, and ' +
          'NOTHING LEAVES WHILE THE SENDING DIAL STANDS AT `record`: the manager is resolved ' +
          'and written onto the call-off row with the reason and the minute — IN TEST MODE TOO ' +
          '— and nobody is contacted; the message as it would go is written into the ' +
          '`comm_rehearsal` house. Nothing is claimed, so the turn is still owed — but this is ' +
          'NOT A QUEUE: turning test mode off (the dial follows it) hands over the NEXT ' +
          'call-off, never the ones already recorded. A NO ' +
          'SHOW NO CALL reaches this row too and nobody informed us about that one: `{kind}` is ' +
          'the honest word there, and rewording this cell in the Desk needs no publish. ' +
          'Placeholders that resolve: {employee} {date} {kind} (the CATEGORY — called off / did ' +
          'not come in) {house} {house_manager} {sender}. {shift} and {time} do NOT resolve — ' +
          'the backend cannot read the roster, so the shift hour is not a fact this lane has — ' +
          'and {reason} never will: the caller\'s own words about her morning are not a value ' +
          'this lane puts in a message. A Late Show and a Sent Home say nothing here.'
  },
  {
    id: 'call_off_everyone', enabled: 'yes', kind: 'call_off',
    credential: '', label: 'an open shift, to everybody', days_before: '',
    channels: 'sms', cc: '', direction: '', statuses: '',
    // THE ONE KEYWORD, AND IT IS A FUNCTION (SMART_TO_KEYWORDS above).
    to: 'allstaff',
    // THE DICTATED LAYOUT, EXACTLY (SMART_URGENT_OPEN_SHIFT_TEXT below — the migration that carries it to the live…
    sms_text: SMART_URGENT_OPEN_SHIFT_TEXT,
    email_subject: '', email_text: '',
    note: 'CommCallOff.gs — the URGENT OPEN SHIFT blast, in the dictated layout: one message ' +
          'asking who can pick the shift up, saying which house ({house}: its own name, "JH home"), ' +
          'the hour ({time}: "2pm", from the roster), the day ({day_word}: today, tomorrow or the ' +
          'weekday), where it is ({location}: the street, from the houses directory - by declared ' +
          'exception, which overrides the older rule that kept a house\'s place out of company-wide texts), ' +
          'and the road to the shift ({ref}: its handle, SP and ten characters, which a reply "YES SP..." ' +
          'applies with; {link}: the platform page that opens its blood-red square on House Calendars) - ' +
          'the ref names the shift, never the person who called off, and a shift no house calendar draws ' +
          'has neither, so that line is left out. ' +
          'IT NEVER SAYS WHY: the message goes to everyone and nobody learns the reason why the shift is ' +
          'available - no reason from the hotline or from the form, and a {reason} ' +
          'typed into this cell is always left out; the reason goes to the 5558 group alone, in ' +
          '`call_off_reason_directors`. The day is the ABSENCE\'s: a hotline call is ' +
          'dated by the day the phone rang, so the day the call named is used, else the roster\'s ' +
          'next shift at that house, else the hour and the day are left out - never "today" about ' +
          'tomorrow. A value that cannot be found is NEVER shown ' +
          'as a gap: the sentence that needs it is left out (a missing hour drops " at {time}", a ' +
          'missing street drops "Located at ..."); every ' +
          'other character of these words stays exactly as written. ' +
          'SWITCHING THIS ON IS ABOUT 77 TEXTS ON THE NEXT CALL-OFF — the count ' +
          'beside the switch is the live one. Fired by the write that records the call-off, ' +
          'never by a clock; ONCE per call-off, and only for a kind that leaves a shift with ' +
          'nobody in it (a Late Show and a Sent Home say nothing). `to: allstaff` is a KEYWORD ' +
          'THE CODE RESOLVES (never a word parked in a cell, which is what `to: team` is): ' +
          'every active member of staff this platform can text — the `status` column read with ' +
          'the contact guard\'s own allow-list — minus a shared line, minus anybody opted out, ' +
          'minus a client, minus the person who called off — BY NAME AND BY HER NUMBER, so a ' +
          'colleague who carries the same phone does not put that handset back in the list — ' +
          'and minus anybody this same ' +
          'call-off already reached: the person answered, the house manager or a decider. ' +
          'The count is written ' +
          'to the call-off row AS THE BLAST GOES — in test mode too — so a pass cut short ' +
          'leaves a number somebody ' +
          'can act on instead of a bare claim. It does NOT know who is already working: the ' +
          'roster is not readable from the backend, so somebody at work may be asked. ' +
          SMART_CALLOFF_QUIET_NOTE + ' SHIPS ON carrying THE DICTATED URGENT ' +
          'OPEN SHIFT text, and NOTHING LEAVES WHILE THE SENDING DIAL STANDS AT `record`: the ' +
          'audience is resolved, counted and written onto the call-off row with the reason and ' +
          'the minute — IN TEST MODE TOO — and nobody is ' +
          'contacted — so the first thing read is the number, not seventy-seven texts. And ' +
          'the text itself is written into the `comm_rehearsal` house: ONE row for the whole ' +
          'blast, not seventy-seven, addressed to the audience and counted there, rendered for ' +
          'the first of them so a name placeholder reads as a sample rather than as a blank. ' +
          'The ' +
          'turn is still owed — and it is NOT A QUEUE: turning test mode off (the dial follows it) ' +
          'blasts the NEXT call-off, never the ones already recorded. Placeholders that resolve: ' +
          '{house} {time} {day_word} {location} (above), {employee} (who called off) ' +
          '{first_name} and {name} (the person being texted) {date} {kind} (the CATEGORY) {sender}.'
  },
  // THE REASON, TO THE 5558 GROUP ALONE — the second of the two dictated messages: the reason goes only to the 5558…
  {
    id: 'call_off_reason_directors', enabled: 'yes', kind: 'call_off',
    credential: '', label: 'the reason, to the 5558 group', days_before: '',
    channels: 'sms', cc: '', direction: '', statuses: '',
    to: 'directors',
    sms_text: SMART_CALLOFF_DIRECTORS_TEXT,
    email_subject: '', email_text: '',
    note: 'CommCallOff.gs — ONE text per call-off to the 5558 group (the directors and the people ' +
          'responsible) saying who called off, which shift, and WHY: {reason} is the hotline ' +
          'call\'s Description of Request word for word, or the reason typed on the call-off form. ' +
          'This is the only message that carries the reason; the URGENT OPEN SHIFT to everybody ' +
          'never does. `to: directors` is a KEYWORD THE CODE RESOLVES: ' +
          'the 5558 group line, reached the same way test mode used to reach it. ' +
          'Only for a Call Off (a No Show No Call has no reason to give, a Late Show and a Sent Home ' +
          'say nothing here). Fired by the write that records the call-off, never by a clock; ' +
          'ONCE per call-off. A line whose value cannot be found is left out whole, never shown ' +
          'with a gap: no reason drops the "Reason:" line, and a missing house, hour or day ' +
          'is left out of the first line. ' +
          SMART_CALLOFF_QUIET_NOTE + ' NOTHING LEAVES WHILE THE SENDING DIAL STANDS AT `record` ' +
          '(test mode on): the message is written into the mock outbox and the rehearsal house and ' +
          'nobody is contacted. Placeholders that resolve: {employee} {house} {time} {day_word} ' +
          '{reason} {location} {date} {kind} {sender}.'
  },
  // RULE 13 — PSI SHIFT LOGIN, AND THE EARLY CLOCK-IN (StaffAlerts.gs, `staffShiftReminder`).
  {
    id: 'shift_login_before', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'clock in reminder, 5 min before', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Hi {first_name}, this is {sender}. Your shift at {house} starts at {time}. ' +
              'Please remember to clock in on PsiAnywhere when you get there.',
    email_subject: 'Your shift starts soon - {house} {time}',
    email_text: 'Hi {first_name},\n\nYour shift at {house} starts at {time} on {day}.\n\nPlease remember to log in to PsiAnywhere when you get there.\n\n- {sender}',
    note: 'Rule 13 (StaffAlerts.gs staffShiftReminder, planned by the relay in ' +
          'server/psi_reminders.py). ONE text to the staff member five minutes before each houred ' +
          'roster shift — ONLY TO SOMEBODY WHO ANSWERED THE ASK WITH YES (shift_confirm_ask), so ' +
          'nobody is texted twice about one shift in half an hour — to the PERSON, resolved from ' +
          'the People house (on staff, a number we may text), so `Goes to` stays empty. Not sent to ' +
          'somebody a call-off book already names for that day, nor to somebody the time clock ' +
          'already shows on the clock. It goes from the roster whether or not PsiAnywhere can be ' +
          'read. QUIET WINDOW 21:31-07:59 (21:30 is allowed): a reminder that falls inside is never ' +
          'sent late — the 08:00 re-check says "not logged in" instead, if a check shows it. ' +
          'Placeholders: {first_name} {name} {house} {time} {day} {sender}.'
  },
  {
    id: 'shift_login_missing', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'not clocked in yet, every 30 min', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Hi {first_name}, {login_state} for your {time} shift at {house}, which began ' +
              '{minutes} min ago. Please clock in now. If you already did, or cannot make it, ' +
              'reply to this text.',
    email_subject: 'You are not logged in - {house} {time}',
    email_text: 'Hi {first_name},\n\nFor the {time} shift at {house} on {day}: {login_state}.\n\nPlease log in to PsiAnywhere, or reply to this e-mail and tell us what is happening.\n\n- {sender}',
    note: 'THE TEXT ONLY: the e-mail of the first check-backed ask about a shift is ' +
          'shift_login_missing_mail, worded and switched on its own. ' +
          'Rule 13. To the staff member, every 30 minutes, ONLY AFTER A PSIANYWHERE CHECK shows no ' +
          'clock-in for that shift, and only to somebody who answered the ask with YES or whose ' +
          'house manager was already told they did not reply (shift_no_show_house_manager) — a NO or ' +
          'any other answer ends every text about that shift — until they clock in, reply to any of ' +
          'these texts, or the shift ' +
          'has been over for an hour (a day at most; the relay\'s HUB_PSI_REMIND_AFTER_END_MIN). ' +
          'When PsiAnywhere cannot be read (the account refused, every request paused after ' +
          'a timeout, no credential) it goes from the ROSTER instead, every 30 minutes from the ' +
          'start, stopping on a reply, and {login_state} then says "we could not check PsiAnywhere, ' +
          'so this is a reminder" instead of "you have not logged in to PsiAnywhere yet". Nothing inside ' +
          '21:31-07:59; at 08:00 it goes only if a check still shows it (or, from the roster, if ' +
          'there is still no reply). Placeholders: {first_name} {name} {house} {time} {minutes} ' +
          '(since the start) {login_state} {sender}.'
  },
  // THE E-MAIL BESIDE THE FIRST "NOT LOGGED IN" ABOUT A SHIFT (StaffAlerts.gs STAFF_SHIFT_MAIL_SITUATIONS).
  {
    id: 'shift_login_missing_mail', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'not clocked in yet - the e-mail, once per shift', days_before: '',
    channels: 'email', to: '', cc: '', direction: '', statuses: '',
    sms_text: '',
    email_subject: 'You are not logged in - {house} {time}',
    email_text: 'Hi {first_name},\n\nFor the {time} shift at {house} on {day}: {login_state}.\n\nPlease log in to PsiAnywhere, or reply to this e-mail and tell us what is happening.\n\n- {sender}',
    note: 'Rule 13\'s e-mail, apart from its text (shift_login_missing). To the staff member ONCE ' +
          'PER SHIFT, on the first "not logged in" a PsiAnywhere check backs - a person with two ' +
          'shifts of a day that both owe a punch gets two, one per shift, each naming its own. ' +
          'Never on the repeats, never when the clock could not be read, and never while this is ' +
          'off. Held inside 21:31-07:59 with the text. `Goes to` stays empty. Placeholders: ' +
          '{first_name} {name} {house} {time} {day} {login_state} {sender}.'
  },
  {
    id: 'shift_early_in', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'clocked in early, to the house manager', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: '{name} clocked in on PsiAnywhere at {arrived}, {minutes} min before the {time} ' +
              'shift at {house}. - {sender}',
    email_subject: 'Early clock-in - {name} at {house}',
    email_text: 'Hi {first_name},\n\n{name} clocked in {minutes} minutes early for the {time} shift at {house} on {day}.\n\n- {sender}',
    note: 'The anticipated shift. To the HOUSE MANAGER of the roster house (the hotline calendar\'s ' +
          '** row for it), the moment a PsiAnywhere collection shows an entry that began more than ' +
          '15 minutes before the roster start (HUB_PSI_EARLY_MIN on the relay) — ONE message per ' +
          'person per shift. An entry that is the shift before still running (a double) is not an ' +
          'early clock-in and says nothing. Held inside 21:31-07:59 and sent at 08:00 if the entry ' +
          'is still on the board. `Goes to` stays empty: the manager is resolved per house. ' +
          'Placeholders: {name} {first_name} (the staff member) {arrived} {minutes} (how early) ' +
          '{time} {house} {sender}.'
  },
  // THE PUNCH PAIR (StaffAlerts.gs `staffShiftReminder`, planned by the relay in server/punch_pairs.py).
  {
    id: 'shift_punch_changeover', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'punch out, then punch in - at a changeover', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Hi {first_name}, this is {sender}. Your {shift} shift at {house} ends at {ends}. ' +
              'Punch OUT of it, then punch IN to your {next_shift} shift at {next_house}, which ' +
              'starts at {next_time}. Each shift needs its own clock-in and clock-out.',
    email_subject: 'Punch out, then punch in - {house} {ends}',
    email_text: 'Hi {first_name},\n\nYour {shift} shift at {house} ends at {ends}. Punch OUT of it, then punch IN to your {next_shift} shift at {next_house}, which starts at {next_time}.\n\nOne shift, one clock-in and one clock-out: a single punch across two shifts does not count for either of them.\n\n- {sender}',
    note: 'To the STAFF MEMBER, once per shift, in the ten minutes before a shift they are on the ' +
          'clock for ends and another of theirs begins within half an hour. Never about a shift a ' +
          'human already wrote down (a call off), a person the roster holds on two grids at once, ' +
          'or a next shift that was called off. ONE MESSAGE PER SHIFT: two shifts that owe ' +
          'something are two messages, never one about both. Held inside 21:31-07:59 like ' +
          'every other message. Placeholders: {first_name} {house} {shift} {ends} {next_shift} ' +
          '{next_house} {next_time} {sender}.'
  },
  {
    id: 'shift_punch_open_entry', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'a time entry left open', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Hi {first_name}, this is {sender}. Your entry for the {shift} shift at {house} on ' +
              '{day} has a clock-in at {punched_in} and no clock-out. Please close it on the time ' +
              'clock.',
    email_subject: 'A time entry is still open - {house} {day}',
    email_text: 'Hi {first_name},\n\nYour entry for the {shift} shift at {house} on {day} has a clock-in at {punched_in} and no clock-out. Please close it on the time clock.\n\nAn entry with a clock-in and no clock-out is not a blank - the shift stays unfinished until it is closed.\n\n- {sender}',
    note: 'To the STAFF MEMBER when an entry of theirs has a clock-in and no clock-out and a read ' +
          'of the time clock made an hour after the shift ended still shows it open (the relay\'s ' +
          'grace: an entry is often typed late, and nobody is told they left one open while they ' +
          'are still on the clock). ONE PER SHIFT. Held inside 21:31-07:59 and said at 08:00 if ' +
          'the entry is still open. Placeholders: {first_name} {house} {shift} {day} ' +
          '{punched_in} {sender}.'
  },
  {
    id: 'shift_punch_warning', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'no punch at all - to each director', days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Hi {to_first_name}, no punch: {staff} has no clock-in and no clock-out for the ' +
              '{shift} shift at {house} on {day}, which started at {time}. The reminders to them ' +
              'have run out. Reply RECEIVED {ref} and it becomes an open shift. Notice {tells}.',
    email_subject: '', email_text: '',
    note: 'To EACH DIRECTOR on the Time Off settings list (never a name in code), on their own ' +
          'phone from the People house, one row per director, and ONLY after the reminders to ' +
          'the person themselves really reached them and ran out: the person is always asked ' +
          'first, and that chase stops the moment the pair is complete. Said again every 20 ' +
          'minutes, WITH NO CAP ON HOW MANY TIMES, until a director replies RECEIVED with the ' +
          'warning\'s ref - or a bare RECEIVED from a phone this warning reached, when it is the ' +
          'only one waiting there. It stops only when a director answers, when the punches ' +
          'arrive (or a human writes the day down), or when the shift ends, because the answer ' +
          'could then open nothing; the punch board then says how often it was said and over ' +
          'what span. While this situation is off nothing is sent and the warning waits on the ' +
          'punch board; switched on while the shift is still under way, it is told at the next ' +
          'telling. A director whose phone in the People house is a shared or group line cannot ' +
          'be heard by text; their RECEIVED is taken on the punch board. A director\'s RECEIVED ' +
          'turns the shift into an automatic call off through the calendar\'s own act, so the ' +
          'URGENT OPEN SHIFT to everybody (no reason, no name) and the description to the 5558 ' +
          'group are the call-off lane\'s own - except for a shift that shares its calendar cell ' +
          'with another of the same person\'s shifts: a call off opens the whole cell, so that ' +
          'one is warned in the words of shift_punch_warning_by_hand instead, which say to open ' +
          'it by hand. Every telling stands on a read of the time clock made minutes before, and ' +
          'the attendance lane reads it on this cadence for as long as the warning is live. ' +
          'Held inside 21:31-07:59 ' +
          'like every other message. A text; given the email channel and e-mail words here, the ' +
          'FIRST telling also goes by e-mail and every later one is a text alone - one e-mail per ' +
          'shift, never one every 20 minutes. Placeholders: {to_first_name} {staff} {house} ' +
          '{shift} {day} {time} {ref} {tells} (the telling\'s number: 1, 2, 3 ...).'
  },
  {
    id: 'shift_punch_warning_by_hand', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'no punch at all, shared calendar cell - to each director', days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Hi {to_first_name}, no punch: {staff} has no clock-in and no clock-out for the ' +
              '{shift} shift at {house} on {day}, which started at {time}. The reminders to them ' +
              'have run out. This shift shares its calendar cell with another of theirs, so it is ' +
              'not opened for you: open it by hand on the house calendar, and reply RECEIVED {ref} ' +
              'to stop this warning. Notice {tells}.',
    email_subject: '', email_text: '',
    note: 'The warning of shift_punch_warning, for a shift that shares its calendar cell with ' +
          'another of the same person\'s shifts. A call off opens the whole cell, so a RECEIVED ' +
          'cannot open this one without opening the other too: these words say to open it by ' +
          'hand, and a RECEIVED stops the warning and is answered with the closed ' +
          'acknowledgement. Everything else is the same: to EACH DIRECTOR on the Time Off ' +
          'settings list, one row per director, said again every 20 minutes WITH NO CAP until a ' +
          'director answers, the punches arrive or the shift ends; while this situation is off ' +
          'nothing is sent and the warning waits on the punch board. Held inside 21:31-07:59. ' +
          'Text only. Placeholders: {to_first_name} {staff} {house} {shift} {day} {time} {ref} ' +
          '{tells}.'
  },
  // THE SHIFT FLOW — EVERY MESSAGE THE RULES NAME, AS A ROW THAT CAN BE READ, REWORDED AND SWITCHED OFF.
  {
    id: 'shift_confirm_ask', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'the ask before every shift, 30 min before', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    /* THE DICTATED SENTENCE, WORD FOR WORD. */
    sms_text: 'All set for your shift at {house} at {time}? Reply YES or NO. - {sender}',
    email_subject: 'All set for your shift? - {house} {time}',
    email_text: 'Hi {first_name},\n\nAre you all set for your shift?\n\n  House: {house}\n  Day:   {day}\n  Time:  {time}\n\nReply to this e-mail with YES or NO.\n\n- {sender}',
    note: 'The shift flow (StaffAlerts.gs staffShiftReminder, planned by the relay in ' +
          'server/psi_reminders.py). THE FIRST ASK, to the staff member, 30 minutes before each houred ' +
          'roster shift, from the 5558 - their reply is heard by the SMS ear. YES / Y / SIM / OK is a ' +
          'yes, NO / N / NAO or a plain refusal ("nope", "can\'t make it", "not coming", "won\'t be ' +
          'there", "calling off", "I\'m sick") is a no (any case); "running late" is a late call ' +
          '(late_call_house_manager); any other reply is a human answering and stops the ' +
          'asks. Nobody a call-off book names for that day, nobody the time clock already shows in, ' +
          'nobody the clock does not know. `Goes to` stays empty: the person is resolved from the ' +
          'People house. QUIET WINDOW: nothing 21:31-07:59 (21:30 itself is allowed - the ask before a ' +
          '22:00 shift, which may go from 21:25 so a slow minute never loses it); an ask that falls ' +
          'inside goes at 08:00 only if the shift still has a slot for ' +
          'one. Placeholders: {first_name} {name} {house} {time} {day} {sender}.'
  },
  {
    id: 'shift_confirm_again', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'the ask again, every 10 min until a reply', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Reminder: all set for your shift at {house} at {time}? Please reply YES or NO. - {sender}',
    email_subject: 'Reminder: all set for your shift? - {house} {time}',
    email_text: 'Hi {first_name},\n\nWe have not heard back about your shift:\n\n  House: {house}\n  Day:   {day}\n  Time:  {time}\n\nPlease reply with YES or NO so the house knows whether to find cover.\n\n- {sender}',
    note: 'The shift flow. The ask again, every 10 minutes after the first, while nobody replied and ' +
          'no punch is known - until 30 minutes after the start, when the house manager is told ' +
          'instead (shift_no_show_house_manager). A punch stops it, any reply stops it. Held inside ' +
          '21:31-07:59 like every staff message. Placeholders: {first_name} {name} {house} {time} ' +
          '{day} {sender}.'
  },
  {
    id: 'shift_no_show_house_manager', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'did not go to work, to the house manager', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    // THE DICTATED SENTENCE, with what backs it in {status}: "did not go to work - no reply and no clock-in" from…
    sms_text: '{name} {status} for the {time} shift at {house}. - {sender}',
    email_subject: 'Nobody came - {name} at {house} {time}',
    email_text: 'Hi {first_name},\n\n{name} {status} for the {time} shift at {house} on {day}.\n\nYou may need to find cover.\n\n- {sender}',
    note: 'The shift flow. To the HOUSE MANAGER of the roster house (the hotline calendar\'s ** row ' +
          'for it), once per shift, when the staff member did not reply to the asks AND no punch is ' +
          'known 30 minutes after the start. From PsiAnywhere it rests on a read made at or after ' +
          'that minute - the relay collects for it - and {status} reads "did not go to work - no ' +
          'reply and no clock-in". When PsiAnywhere cannot be read (refused, paused, no credential, ' +
          'unreadable), or no read lands within the hour after, it says so honestly: "did not reply, ' +
          'and the time clock could not be checked," - and, with nothing but a missing reply behind ' +
          'it, never once the shift is over. A read that shows no punch after a reply that was ' +
          'neither YES nor NO says "did not go to work - replied, but not YES, and no clock-in". A ' +
          'person no ask REACHED is never said not to have replied: when the asks went only into ' +
          'the rehearsal book, this message goes there too and to no manager. After this message ' +
          'the person is sent shift_login_missing. Held inside ' +
          '21:31-07:59 and sent at 08:00 only if still true. `Goes to` stays empty. Placeholders: ' +
          '{name} {first_name} (the staff member) {status} {time} {day} {house} {sender}.'
  },
  {
    id: 'shift_confirm_no_house_manager', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'replied NO, to the house manager', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    /* THE DICTATED SENTENCE, WORD FOR WORD. */
    sms_text: '{name} replied NO for the {time} shift at {house}. - {sender}',
    email_subject: 'Replied NO - {name} at {house} {time}',
    email_text: 'Hi {first_name},\n\n{name} replied NO for the {time} shift at {house} on {day}.\n\nThat shift needs cover.\n\n- {sender}',
    note: 'The shift flow. To the HOUSE MANAGER of the roster house, AT ONCE and once per shift, ' +
          'when the staff member answers the ask with NO / N / NAO. The asks stop, and nothing more ' +
          'goes to the person about that shift. Held inside 21:31-07:59 like every staff message. ' +
          '`Goes to` stays empty. Placeholders: {name} {first_name} {time} {day} {house} {sender}.'
  },
  /* Shift transfer: sms + email; {handoff} names exactly one offer; {name} is always the taker. */
  {
    id: 'shift_handoff_ask_staff', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'a shift offered to you - do you accept', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: SMART_HANDOFF_ASK_STAFF_TEXT,
    email_subject: 'Shift offered to you - {house} {day} [{handoff}]',
    email_text: 'Hi {first_name},\n\n{other} would like to hand you this shift:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n\nReply to this e-mail with YES to take it, or NO to pass.\nNothing changes on the calendar until you accept AND the house manager approves.\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane (server/shift_handoff.py plans it, StaffAlerts.gs staffShiftReminder ' +
          'says it). TO THE STAFF MEMBER BEING OFFERED THE SHIFT, once. Their YES is only half: ' +
          'the house manager must approve too, and the roster does not change until both are in. ' +
          'A NO ends the offer at once and the shift stays where it was. YES / Y / SIM / OK is a ' +
          'yes; NO / N / NAO and a plain refusal is a no; anything else is a human answering and ' +
          'is not read as an answer. Held inside 21:31-07:59 like every staff message. ' +
          '`Goes to` stays empty: the person is resolved from the People house.'
  },
  {
    id: 'shift_handoff_ask_manager', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'a shift handoff waiting for your approval', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: SMART_HANDOFF_ASK_MANAGER_TEXT,
    email_subject: 'Approve a shift handoff - {house} {day} [{handoff}]',
    email_text: SMART_HANDOFF_ASK_MANAGER_MAIL,
    note: 'The handoff lane. TO THE HOUSE MANAGER the relay names on the transfer (the most recent ' +
          '** row for the house, less anybody in the swap), once. APPROVE and AUTHORIZE read as a yes, NOT APPROVE / DISAPPROVE / ' +
          'DECLINE / REJECT as a no - and the refusal is looked for FIRST, because "not approved" ' +
          'contains "approve". A NO ends the offer at once. Held inside 21:31-07:59. `Goes to` ' +
          'stays empty.'
  },
  // APPLICATIONS CLOSED, AND SOMEBODY WANTS THE SHIFT.
  {
    id: 'shift_applicants_waiting', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'open shift - applications closed, your decision', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: SMART_APPLICANTS_WAITING_SMS,
    email_subject: 'Open shift waiting on you - {house} {day}',
    email_text: SMART_APPLICANTS_WAITING_MAIL,
    note: 'The shift requests lane (server/shift_requests.py plans it, StaffAlerts.gs ' +
          'staffShiftReminder says it). TO THE HOUSE MANAGER of the roster house (the hotline ' +
          'calendar ** row for it), ONCE per shift, and only when the window closed with at ' +
          'least one applicant - a notice about an empty window is how a manager learns to ' +
          'ignore these. There is nothing to reply to: the decision is made on the Requests ' +
          'screen. Held inside 21:31-07:59 like every staff message, and re-planned at 08:00 ' +
          'if it is still true. `Goes to` stays empty.'
  },
  /* SMS reply answers (server/sms_ears.py); {reply} is composed by the relay; the e-mail half is inert. */
  {
    id: 'shift_reply_applied', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'your YES by text - you applied', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Got it - you applied for the {shift} shift at {house} on {day} (ref {ref}). {reply} - {sender}',
    email_subject: 'You applied by text - {house} {day} [{ref}]',
    email_text: 'Hi {first_name},\n\nWe got your reply. You applied for this shift:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n\n{reply}\n\nReference {ref}\n- {sender}',
    note: 'The reply ear (server/sms_ears.py). TO THE STAFF MEMBER WHOSE YES BY TEXT became an ' +
          'application - by the shift\'s ref, or because exactly one call-off was open to them and ' +
          'nothing else waited on their answer. It is an application, not the shift: {reply} says the ' +
          'house manager decides (and, for a first shift there, approves the training). Held inside ' +
          '21:31-07:59 and said at 08:00 only if the application is still open and the shift has not ' +
          'started. `Goes to` stays empty.'
  },
  {
    id: 'shift_reply_refused', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'your reply by text could not be taken', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Your reply could not be taken: {reply}. - {sender}',
    email_subject: 'Your reply by text could not be taken',
    email_text: 'Hi {first_name},\n\nYour reply by text could not be taken: {reply}.\n\nYou can apply on the Hub, on Calendar Builder - Requests, or call the office.\n- {sender}',
    note: 'The reply ear. TO THE SENDER whose YES named one shift and a rule said no - applications ' +
          'closed, somebody already has it, it overlaps a shift they hold, it is the shift they called ' +
          'off, no shift carries that ref, or their name is on no house calendar. {reply} names the ' +
          'shift and the rule in their own words, never who took it. Held inside 21:31-07:59; said at ' +
          '08:00 only if the shift has not started. `Goes to` stays empty.'
  },
  {
    id: 'shift_reply_unclear', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'your text could mean more than one shift', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'About your text: {reply}. Nothing was done. - {sender}',
    email_subject: 'About your text - nothing was done',
    email_text: 'Hi {first_name},\n\nAbout your text: {reply}.\n\nNothing was done. Reply with the reference, or answer on the Hub, on Calendar Builder - Requests.\n- {sender}',
    note: 'The reply ear. TO THE SENDER of a YES or NO that could answer more than one thing (two ' +
          'call-off shifts, a call-off and a swap, a call-off and the shift reminder) - or that quoted a ' +
          'ref without a yes or a no. NEVER GUESS: nothing is applied for or answered, and {reply} lists ' +
          'each thing it could have meant with the ref to reply with. Held inside 21:31-07:59; said at ' +
          '08:00 only if something it could have meant is still open. `Goes to` stays empty.'
  },
  {
    id: 'shift_reply_answered', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'your answer to a swap, by text', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Got it - {reply}. - {sender}',
    email_subject: 'Your answer to the swap [{ref}]',
    email_text: 'Hi {first_name},\n\nGot it - {reply}.\n\nReference {ref}\n- {sender}',
    note: 'The reply ear. TO THE STAFF MEMBER OR HOUSE MANAGER whose YES / NO / APPROVE by text ' +
          'answered a swap (shift_handoff.answer, via sms). {reply} says what it came to: accepted and ' +
          'waiting on the house manager, approved and done, or closed. Held inside 21:31-07:59. ' +
          '`Goes to` stays empty.'
  },
  // A DIRECTOR'S RECEIVED ON A PUNCH WARNING, BY TEXT (server/sms_ears.py hears it, server/punch_pairs.py acts on…
  {
    id: 'shift_reply_punch_open', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'your RECEIVED by text - the shift is open', days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Got it - {ref}: the {shift} shift at {house} on {day} is now an open shift ' +
              '({call_off_ref}), {why}. - {sender}',
    email_subject: '', email_text: '',
    note: 'The reply ear. TO THE DIRECTOR whose RECEIVED by text answered a punch warning and turned ' +
          'the shift into an automatic call off through the calendar\'s own act - and, once, to the ' +
          'director whose RECEIVED (by text or on the punch board) was told it is not open yet, ' +
          'when a later try opens it. {call_off_ref} is ' +
          'the open shift\'s ref; {why} says how applications are taken (the window). Held inside ' +
          '21:31-07:59 and said at 08:00 only while the shift has not ended. Text only; `Goes to` ' +
          'stays empty. Placeholders: {ref} {call_off_ref} {why} ' +
          '{staff} {shift} {house} {day} {sender}.'
  },
  {
    id: 'shift_reply_punch_waiting', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'your RECEIVED by text - on file, not open yet', days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Got it - your RECEIVED on {ref} is on file. The {shift} shift at {house} on {day} ' +
              'is not open yet: {why}. - {sender}',
    email_subject: '', email_text: '',
    note: 'The reply ear. TO THE DIRECTOR whose RECEIVED by text is on file while the call off ' +
          'waits: for a fresh read of the time clock that still shows no punch, or for the house ' +
          'calendar, which is tried again. {why} says which. What it comes to is said on its own, ' +
          'by shift_reply_punch_open or shift_reply_punch_closed. Held inside 21:31-07:59 and ' +
          'said at 08:00 only while the answer still waits and its shift has not ended. Text only; ' +
          '`Goes to` stays empty. Placeholders: {ref} {why} {staff} {shift} {house} {day} {sender}.'
  },
  {
    id: 'shift_reply_punch_closed', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'your RECEIVED by text - the shift was not opened', days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Your RECEIVED on {ref} is on file, and the {shift} shift at {house} on {day} was ' +
              'not opened: {why}. - {sender}',
    email_subject: '', email_text: '',
    note: 'The reply ear. TO THE DIRECTOR whose RECEIVED by text could not open the shift and ' +
          'stops there - a fresh read showed a punch, the shift ended, the hole was already open, ' +
          'or the calendar refused it for good - and, once, to the director whose RECEIVED (by ' +
          'text or on the punch board) was told it is not open yet, when it stops unopened. {why} ' +
          'says which. Held inside 21:31-07:59 and said at 08:00, kept six hours from then. Text ' +
          'only; `Goes to` stays empty. ' +
          'Placeholders: {ref} {why} {staff} {shift} {house} {day} {sender}.'
  },
  {
    id: 'shift_handoff_done', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'the handoff went through', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Done: {name} now has the {shift} shift at {house} on {day}. ' +
              'It is off your calendar. - {sender}',
    email_subject: 'Shift handoff complete - {house} {day} [{handoff}]',
    email_text: 'Hi {first_name},\n\nYour handoff went through.\n\n  House:  {house}\n  Day:    {day}\n  Shift:  {shift}\n  Now on: {name}\n\nThe calendar has been updated and the shift is off yours.\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE STAFF MEMBER WHO GAVE THE SHIFT AWAY, once, when BOTH the ' +
          'receiver accepted and the house manager approved - the same moment the calendar cell ' +
          'moves. Held inside 21:31-07:59. `Goes to` stays empty.'
  },
  {
    id: 'shift_handoff_declined', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'the handoff did not go through', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'The {shift} shift at {house} on {day} is still yours - {status}. - {sender}',
    email_subject: 'Shift handoff not approved - {house} {day} [{handoff}]',
    email_text: 'Hi {first_name},\n\nThe handoff did not go through, so this shift is still yours:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n\nWhy: {status}\n\nIf you still cannot work it, speak to your house manager.\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE STAFF MEMBER WHO TRIED TO GIVE THE SHIFT AWAY, once, when ' +
          'the offer died: the receiver declined, the house manager did not approve, or the cell ' +
          'changed while the two were deciding. {status} carries which one, in words. THE SHIFT ' +
          'IS STILL THEIRS and the message says so - an offer that quietly did nothing is how ' +
          'somebody does not turn up. Held inside 21:31-07:59. `Goes to` stays empty.'
  },
  /* The transfer's other five (server/shift_handoff.py). */
  {
    id: 'shift_handoff_ask_above', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'a shift transfer for a director to approve', days_before: '',
    channels: 'sms', to: 'directors', cc: '', direction: '', statuses: '',
    sms_text: '{other} wants to give the {shift} shift at {house} on {day} to {name}. {approval}. ' +
              'Approve on the Hub (Calendar Builder - Requests) or text APPROVE {handoff} from your own phone. - {sender}',
    email_subject: '', email_text: '',
    note: 'The handoff lane (server/shift_handoff.py). TO THE DIRECTORS (the 5558 group, `to: directors`) ' +
          'when the house manager gives or takes the shift, or the house has no manager on file - nobody ' +
          'approves their own swap. {approval} is the relay\'s sentence saying why. A reply in the group ' +
          'is not read as an answer; a director approves on the Hub or texts APPROVE with the ref from ' +
          'their own phone. Text only: the group is one shared line and has no mailbox. Held inside ' +
          '21:31-07:59.'
  },
  {
    id: 'shift_handoff_done_taker', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'the transfer went through - the shift is yours', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Done: the {shift} shift at {house} on {day} is yours now - {other} handed it to you and it was approved. Ref {handoff} - {sender}',
    email_subject: 'The shift is yours - {house} {day} [{handoff}]',
    email_text: 'Hi {first_name},\n\nThe transfer went through - this shift is yours now:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n  From:  {other}\n\nIt is on your calendar.\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE ONE WHO TAKES THE SHIFT, once, when both consents are in and the ' +
          'calendar cell has moved. Held inside 21:31-07:59. `Goes to` stays empty.'
  },
  {
    id: 'shift_handoff_done_manager', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'a transfer at your house went through', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Done: {name} now has the {shift} shift at {house} on {day} (from {other}). The calendar says so. Ref {handoff} - {sender}',
    email_subject: 'Shift transfer complete - {house} {day} [{handoff}]',
    email_text: 'Hi {to_first_name},\n\nA transfer at your house went through:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n  From:  {other}\n  Now on: {name}\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE HOUSE MANAGER the relay named on the transfer, once, when it ' +
          'completes. Not sent when the approval was asked above. Held inside 21:31-07:59. ' +
          '`Goes to` stays empty.'
  },
  {
    id: 'shift_handoff_declined_taker', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'the transfer to you did not go through', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'The transfer of the {shift} shift at {house} on {day} did not go through - {status}. It is not yours. Ref {handoff} - {sender}',
    email_subject: 'Shift transfer did not go through - {house} {day} [{handoff}]',
    email_text: 'Hi {first_name},\n\nThe transfer to you did not go through, so this shift is not yours:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n\nWhy: {status}\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE ONE WHO WAS OFFERED THE SHIFT, once, when it ended and their ask ' +
          'had reached them or they had accepted - never when they passed themselves. {status} is the ' +
          'relay\'s reason. Held inside 21:31-07:59. `Goes to` stays empty.'
  },
  {
    id: 'shift_handoff_declined_manager', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'a transfer at your house did not go through', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'The transfer of the {shift} shift at {house} on {day} from {other} to {name} did not go through - {status}. Nothing is waiting on you. Ref {handoff} - {sender}',
    email_subject: 'Shift transfer closed - {house} {day} [{handoff}]',
    email_text: 'Hi {to_first_name},\n\nA transfer you were asked about is closed:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n  From:  {other}\n  To:    {name}\n\nWhy: {status}\n\nNothing is waiting on you.\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE HOUSE MANAGER whose approval ask had reached them, once, when the ' +
          'transfer ended - never when they said no themselves. Held inside 21:31-07:59. ' +
          '`Goes to` stays empty.'
  },
  // The transfer's THIRD consent: the director named on the row.
  {
    id: 'shift_handoff_ask_director', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'a shift transfer waiting for your approval (director)', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: '{other} wants to give the {shift} shift at {house} on {day} to {name}. ' +
              'Approve on the Hub (Calendar Builder - Swaps) or text APPROVE {handoff}. Ref {handoff} - {sender}',
    email_subject: 'Approve a shift transfer - {house} {day} [{handoff}]',
    email_text: 'Hi {to_first_name},\n\nA shift transfer is waiting for your approval as a director:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n  From:  {other}\n  To:    {name}\n\nThe shift moves only when the one taking it, the house manager AND you have each said yes.\n\nApprove on the Hub (Calendar Builder - Swaps) or text APPROVE {handoff}.\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane (server/shift_handoff.py). TO EACH DIRECTOR ON THE TIME OFF LIST ' +
          '(Settings - Time Off), never derived from a badge and never a name in code. The row ' +
          'names the director in `person`, so this goes to them by text and by e-mail - not to the ' +
          'shared 5558 group. A director who is part of the swap is never asked. Nothing reads ' +
          'an e-mail reply to it, so the words never offer one. Held inside 21:31-07:59. ' +
          'Arrives OFF. `Goes to` stays empty.'
  },
  {
    id: 'shift_handoff_done_director', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'a transfer you approved went through', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Done: {name} now has the {shift} shift at {house} on {day} (from {other}). Ref {handoff} - {sender}',
    email_subject: 'Shift transfer complete - {house} {day} [{handoff}]',
    email_text: 'Hi {to_first_name},\n\nA transfer you were asked about went through:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n  From:  {other}\n  Now on: {name}\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE DIRECTOR the relay named on the transfer, once, when it ' +
          'completes and their ask had reached them. Held inside 21:31-07:59. Arrives OFF. ' +
          '`Goes to` stays empty.'
  },
  {
    id: 'shift_handoff_declined_director', enabled: 'no', kind: 'shift_clock',
    credential: '', label: 'a transfer you were asked about did not go through', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'The transfer of the {shift} shift at {house} on {day} from {other} to {name} did not go through - {status}. Nothing is waiting on you. Ref {handoff} - {sender}',
    email_subject: 'Shift transfer closed - {house} {day} [{handoff}]',
    email_text: 'Hi {to_first_name},\n\nA transfer you were asked about is closed:\n\n  House: {house}\n  Day:   {day}\n  Shift: {shift}\n  From:  {other}\n  To:    {name}\n\nWhy: {status}\n\nNothing is waiting on you.\n\nReference {handoff}\n- {sender}',
    note: 'The handoff lane. TO THE DIRECTOR whose approval ask had reached them, once, when the ' +
          'transfer ended - never when they said no themselves. Held inside 21:31-07:59. ' +
          'Arrives OFF. `Goes to` stays empty.'
  },
  {
    id: 'late_call_house_manager', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'said they will be late, to the house manager', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    /* THE DICTATED SENTENCE, WORD FOR WORD. */
    sms_text: '{name} said they will be late for the {time} shift at {house}. - {sender}',
    email_subject: 'Running late - {name} at {house} {time}',
    email_text: 'Hi {first_name},\n\n{name} said they will be late for the {time} shift at {house} on {day}.\n\n- {sender}',
    note: 'The shift flow. To the HOUSE MANAGER of the roster house, once per person per shift day, ' +
          'when a call-off book says the staff member called to say they would be late: a "Late ' +
          'Show" on the Call Off Tracker (how the office records a late call), or a hotline call ' +
          'filed as a call-off whose own words say "running late" / "will be late" (read for those ' +
          'words only and never forwarded) from a caller whose WHOLE name is theirs, on that day - ' +
          'a caller who shares only a first or last name names nobody - or their own reply to the ' +
          'ask saying so. Only when it was learned before the start or within 30 minutes after it ' +
          '(a Late Show typed hours into the shift is a record, not news), while the shift is not ' +
          'over and they are not on the clock yet. Nobody is asked anything about a shift a human ' +
          'already told us about. ' +
          '`Goes to` stays empty. Placeholders: {name} {first_name} {time} {day} {house} {sender}.'
  },
  {
    id: 'daily_note_due', enabled: 'yes', kind: 'shift_clock',
    credential: '', label: 'the Daily Note is still owed (rule 8)', days_before: '',
    channels: 'sms, email', to: '', cc: '', direction: '', statuses: '',
    sms_text: 'Hi {first_name}, please remember your Daily Note for {shifts}: call (330) 919-5558 to ' +
              'leave it. - {sender}',
    email_subject: 'Daily note not written yet - {house} {day}',
    email_text: 'Hi {first_name},\n\nThe daily note for your {time} shift at {house} on {day} is not written yet.\n\nPlease write it on the Hub when you get a moment.\n\n- {sender}',
    note: 'Rule 8 (the shift flow). To the staff member who worked the shift: 30 and 10 minutes ' +
          'before it ends, 10 minutes after, then every 2 hours between 08:00 and 20:00, for up to ' +
          '48 hours after the end - at most 12 per shift (HUB_NOTE_CAP on the relay) and 6 per ' +
          'person per day (HUB_NOTE_PERSON_DAY_CAP). It stops the ' +
          'moment a Daily Note from that person exists after the shift began (Smart Comms -> ' +
          'Hotline -> DailyNotes, read by the relay from its own copy or the Postgres mirror, never ' +
          'a live read per check; an unreadable book reminds nobody; the book keeps the name as the ' +
          'caller spoke it, so a near spelling of the roster name counts). A person who owes several ' +
          'notes gets ONE message per slot, and {shifts} names them all. Nobody is asked about a ' +
          'shift they did not work (a call-off, a NO, a read of the time clock showing no punch - ' +
          'a missing reply alone is not proof). HUB_NOTE_BOOK_FRESH_DAYS on the relay holds every ' +
          'reminder while the book has no note from anybody that recent. Held inside 21:31-07:59: what falls ' +
          'there goes at 08:00, once, if the note is still missing. Placeholders: {first_name} ' +
          '{name} {shifts} ("your Mon 9/22 8:00 AM shift at JH home", or "2 shifts: ...") {house} ' +
          '{time} {day} (of the first) {sender}.'
  },
  // PSI ANYWHERE, ANSWERED WHILE THE CALLER IS STILL ON THE LINE.
  {
    id: 'psyanywhere_false_message', enabled: 'yes', kind: 'event',
    event: 'psyanywhere_false_message',
    credential: '', label: 'PSI Anywhere is working', days_before: '',
    direction: '', statuses: '',
    channels: 'sms, email', to: '', cc: '',
    sms_text: 'Hi {first_name}, this is {sender}. We checked PSI Anywhere at {status_at} and it is ' +
              'working normally. If you still cannot get in, reply here and we will reset your ' +
              'access. Ref {token}',
    email_subject: 'PSI Anywhere is working',
    email_text: 'Hi {first_name},\n\nThis is {sender}. We checked PSI Anywhere at {status_at} and ' +
                'it is working normally.\n\nIf you still cannot get in, reply to this message and ' +
                'we will reset your access.\n\nThank you.\nRef {token}',
    note: 'CommPsi.gs — the answer to a caller who reported PSI Anywhere down when the proof says ' +
          'it is up. Fired by the hotline execution that filed the request, never by a clock; ' +
          'once per call. The request they rang about is on the Support Queue either way. ' +
          'NOTHING LEAVES WHILE THE SENDING DIAL STANDS AT `record` (or at `off`): this leg ' +
          'asks the dial before it claims the call, so she is NOT answered, the reason is on ' +
          'the audit line and the sentence she would have read is written into the ' +
          '`comm_rehearsal` house. The claim is not spent, so she is answered the day the dial ' +
          'moves — but only on a NEW call: this lane speaks inside the execution that files the ' +
          'request and never sweeps for old ones. ' +
          'Placeholders: {first_name} {name} {sender} {status_at} {token}.'
  },
  {
    // THE INCIDENT PAGE.
    id: 'pattern_scan_daily', enabled: 'yes', kind: 'event',
    event: 'pattern_scan_daily',
    // ITS OWN MOCKUP WHILE IT IS BEING JUDGED — the message is switched on in test mode, into a mockup of its own.
    record_to: 'pattern_scan',
    credential: '', label: 'The daily pattern match over the accounts',
    days_before: '', direction: '', statuses: '',
    channels: 'sms',
    to: '+13309195558, +13309197779, +19377166410',
    cc: '', sender: '',
    sms_text: 'asa. mylife Platform: pattern match complete, {finding}. ' +
              '({scanned} accounts, {day})',
    email_subject: 'Pattern match — {finding}',
    email_text: 'asa. mylife Platform — daily pattern match.\n\n' +
                'Pattern match complete, {finding}.\n\n' +
                '  Accounts checked   {scanned}\n' +
                '  Day                {day}\n' +
                '  Detail             {detail}\n\n' +
                'A duplicate is one person with two doors into this platform: a message can be ' +
                'sent to an address they never read, and nothing about it looks wrong from ' +
                'either side. The chat already folds a person\'s accounts together; this is the ' +
                'warning that they exist at all.',
    note: 'Sent by DuplicateScan.gs once a day, clean or not. {finding} carries the dictated ' +
          'sentence on a clean day and the names found on any other. ' +
          'Placeholders: {finding} {count} {scanned} {day} {detail}.'
  },
  {
    id: 'hotline_support_request', enabled: 'yes', kind: 'event',
    event: 'hotline_support_request',
    credential: '', label: 'A new support request came in through the hotline',
    days_before: '', direction: '', statuses: '',
    channels: 'sms',
    to: '+13307544040, +13309195559',
    cc: '', sender: '',
    sms_text: 'asa. mylife Platform: NEW SUPPORT REQUEST from {requestor} - {type}. {description}',
    email_subject: 'New support request - {requestor} · {type}',
    email_text: 'asa. mylife Platform — Employee Support Queue.\n\n' +
                'A new request came in through the hotline.\n\n' +
                '  From       {requestor}\n' +
                '  Type       {type}\n' +
                '  Urgency    {urgency}\n' +
                '  Received   {received}\n\n' +
                'What was asked\n{description}\n\n' +
                'The row is on the Hotline screen, in the Support Queue lane, with the call it ' +
                'came from beside it.',
    note: 'Sent by CommSupport.gs as the queue row lands — not by the sweep, and never for a ' +
          'call off: that has its own four audiences and its own words. ' +
          'Placeholders: {requestor} {type} {urgency} {received} {description} {status}.'
  },
  {
    id: 'hotline_incident', enabled: 'yes', kind: 'event', event: 'hotline_incident',
    credential: '', label: 'An incident was reported through the hotline',
    days_before: '', direction: '', statuses: '',
    channels: 'sms, email',
    to: '+13309197779, ty.bond@asalifecare.com',
    cc: '',
    sender: '',
    // PLAIN ASCII IN THE TEXT: one em dash turns a message from GSM-7 into UCS-2 and halves what fits in a part.
    sms_text: 'asa. mylife Platform: INCIDENT reported for {client} at {location} ' +
              '({category}), {date} {time}. Reported by {dsp}. {summary}',
    email_subject: 'Incident reported — {client} · {category}',
    email_text: 'asa. mylife Platform — Incident report.\n\n' +
                'An incident has just been reported through the Employee Support Hotline.\n\n' +
                '  Client       {client}\n' +
                '  Location     {location}\n' +
                '  Category     {category}\n' +
                '  When         {date} {time}\n' +
                '  Reported by  {dsp}\n' +
                '  Involved     {employees}\n\n' +
                'Summary\n{summary}\n\n' +
                'Immediate action taken\n{action}\n\n' +
                'The full row, with the cause and the prevention plan as they were given, is in ' +
                'the incidents tab on the Hotline screen. The house manager for {location} has ' +
                'been texted about it.',
    note: 'Sent by CommIncident.gs as the rows land — not by the sweep. The house manager of ' +
          'the incident\'s own location is texted beside this list; a location that resolves to ' +
          'nobody is said out loud and nobody is texted in her place. ' +
          'Placeholders: {client} {location} {category} {date} {time} {dsp} {employees} ' +
          '{summary} {action} {house_manager}.'
  },
  {
    id: 'psyanywhere_true_message', enabled: 'yes', kind: 'event',
    event: 'psyanywhere_true_message',
    credential: '', label: 'PSI Anywhere is down', days_before: '',
    direction: '', statuses: '',
    channels: 'sms, email',
    // THE ESCALATION LIST, WRITTEN OUT AS ADDRESSES.
    to: '+13309197779, +13309195559, +13307544040',
    cc: 'arthur.torres@asalifecare.com, documents@abrighterdawninc.com',
    // PLAIN ASCII IN THE SMS, and it is not a style rule: a single em dash turns a message from GSM-7 into UCS-2…
    sms_text: 'Hi {first_name}, this is {sender}. PSI Anywhere is not answering right now. We ' +
              'checked at {status_at}, your report is on our support queue and we are telling ' +
              'the team now - you do not need to do anything else. Ref {token}',
    email_subject: 'PSI Anywhere is not answering - your report is filed',
    email_text: 'Hi {first_name},\n\nThis is {sender}. PSI Anywhere is not answering right now. ' +
                'We checked it at {status_at}, your report is on our support queue and the ' +
                'people who can act on it are being told now — you do not need to do anything ' +
                'else.\n\nThank you for telling us.\nRef {token}',
    note: 'CommPsi.gs — the answer to a caller when the proof says PSI Anywhere is NOT answering, ' +
          'and the escalation at the same time. `to` and `cc` are the people who can act on an ' +
          'outage; they receive the proof line first and then these same words, so they can see ' +
          'exactly what the caller was told. THE ESCALATION IS CLAIMED FOR THE OUTAGE, NOT FOR ' +
          'THE CALL: one page an hour while it stands, so the second and third callers in that ' +
          'hour ride the first page rather than repeating it — every one of them is still ' +
          'answered herself and counted on the row, and a proved recovery closes the hour so ' +
          'the next outage pages again. THE CALLER IS ANSWERED FIRST AND HER SENTENCE DOES NOT ' +
          'WAIT for the escalation, which is why it says the report is filed and the team is ' +
          'being told rather than promising a fix: if every copy of the escalation is refused, ' +
          'the row records "escalation: 0 reached" and nobody who can act has heard. The ' +
          'escalation goes whether or not the caller could be reached. ' +
          'NOTHING LEAVES WHILE THE SENDING DIAL STANDS AT `record` (or at `off`), AND THAT ' +
          'INCLUDES THIS ROW — it used to be the exception. Both legs ask the dial before they ' +
          'claim anything: the caller is not answered, the five addresses in `Goes to` and `Cc` ' +
          'are resolved and counted and paged by nobody, and both messages are written into the ' +
          '`comm_rehearsal` house exactly as they would have gone — one row for the caller, one ' +
          'per channel for the escalation, addressed to the whole list and counted there. The ' +
          'held hour still stands, so a record run shows you ONE page and the rest counted, ' +
          'which is the shape a release would produce; the first caller after you move the dial ' +
          'supersedes that held hour and pages for real. Under test mode with the dial at ' +
          '`send`, that one page is one REHEARSAL at the tester line, not a page. Placeholders: ' +
          '{first_name} {name} {sender} {status_at} {token}.'
  },
  // ------------------------------------------------------------------ THE TWO RELEASE LETTERS — they were not in…
  {
    id: 'user_release_invite', enabled: 'yes', kind: 'event',
    event: 'user_release_invite',
    credential: '', label: 'an account released into its first login', days_before: '',
    direction: '', statuses: '',
    channels: 'sms, email',
    // NO `to` HERE, and that is not an omission — the same law `call_off_acknowledged` states.
    to: '',
    // PLAIN ASCII in the text: one em dash turns an SMS from GSM-7 into UCS-2 and halves what fits in a part.
    sms_text: 'Hi {first_name}, this is {sender}. Your ASA Hub account is ready. ' +
              'Sign in at {url} with {login} and the temporary password {password}. ' +
              'You will be asked to choose your own password the first time you sign in.',
    email_subject: 'Your ASA Hub account is ready',
    email_text: 'Hi {first_name},\n\n' +
                'Your ASA Hub account is ready to use.\n\n' +
                'Sign in: {url}\n' +
                'Your login: {login}\n' +
                'Temporary password: {password}\n\n' +
                'The first time you sign in you will be asked to choose a password of your ' +
                'own, and this temporary one stops working. If anything does not open the way ' +
                'you expect, reply to this message and somebody will take a look.\n\n' +
                '{sender}',
    note: 'ReleaseUsers.gs sends this when the Release button is pressed — not on a clock — ' +
          'and BEFORE the account is touched: the account is rearmed only when a letter or a ' +
          'text whose words name the password really left, so any brake refuses the press with ' +
          'their own password still working. The audience is the released person and nobody ' +
          'else, resolved by the code that reads their row, so `Goes to` stays empty and no cell ' +
          'can widen it. BOTH LEGS: the text goes to the number on their row when there is one, ' +
          'the letter to their address; an account with neither is said out loud in the answer ' +
          'rather than counted as told. THE LETTER PASSES TEST MODE: it is an authentication ' +
          'letter (the `invitation` kind), so while test mode or the sending switch holds every ' +
          'other message it is STILL DELIVERED to the real person, because a person locked out ' +
          'cannot be helped by a letter in a mockup, and its row in the mock outbox says it ' +
          'left. The text waits for test mode like every other message. SWITCHED OFF — this ' +
          'row, or `auth_invitation`, which stops every invitation — it sends nothing and the ' +
          'release is refused; an opt-out still stops it. THE PASSWORD IS IN THE WORDS ON PURPOSE — it is ' +
          'the shared first password and the account is armed with `must_change`, so it stops ' +
          'working the moment they choose their own — and it is withheld from every record of ' +
          'the message (the mock outbox, the `comm_rehearsal` house, the mail log). ' +
          'Placeholders: {first_name} {name} {login} {password} {url} {sender}.'
  },
  {
    id: 'app_release_announced', enabled: 'yes', kind: 'event',
    event: 'app_release_announced',
    credential: '', label: 'an app opened to more people', days_before: '',
    direction: '', statuses: '',
    channels: 'sms, email',
    to: '',
    sms_text: 'Hi {first_name}, this is {sender}. {app_title} is now open to you on the ASA Hub. ' +
              'Sign in at {url}, open the App Hub and add it to your sidebar if it is not ' +
              'there yet.',
    email_subject: '{app_title} is now open to you on the ASA Hub',
    email_text: 'Hi {first_name},\n\n' +
                '{app_title} is now open to you on the ASA Hub.\n\n' +
                '{objective}\n\n' +
                'Sign in at {url}. If it is not already in your sidebar, open the App Hub and ' +
                'add it from there - your access is what decides whether it is listed, and it ' +
                'now lists this one.\n\n' +
                '{sender}',
    note: 'ReleaseUsers.gs sends this when an app is announced, or by itself when App Control ' +
          'widens the badge list. NO PASSWORD ON THIS ROW, ever: it is about a door, not an ' +
          'account. The audience is resolved by code and never by a cell — released accounts ' +
          'whose badges open that app, minus the hidden, the denied and the inactive. THE ' +
          'WORDS STOP SHORT OF A PROMISE THEY CANNOT KEEP: the earlier letter said "nothing ' +
          'to set up on your side" while the app still had to be added from the App Hub, ' +
          'which is the one thing the letter could not know. Placeholders: {first_name} ' +
          '{name} {app_title} {objective} {url} {sender}.'
  },
  /* The broadcast: a person's own words to a group of staff. */
  {
    id: 'staff_broadcast', enabled: 'yes', kind: 'event', event: 'staff_broadcast',
    credential: '', label: 'a broadcast a person wrote to a group of staff', days_before: '',
    direction: '', statuses: '',
    channels: 'sms',
    /* No `to`: CommBroadcast.gs resolves the audience; `cc` joins the company-wide ones. */
    to: '', cc: '', sender: '',
    sms_text: '{message}\n{signature}',
    email_subject: '', email_text: '',
    note: 'CommBroadcast.gs sends this when a house manager or a director presses Send on Smart Comms → ' +
          'Broadcast — never on a clock. THE AUDIENCE IS CHOSEN ON THE PAGE AND RESOLVED BY CODE: All staff ' +
          '(the `allstaff` keyword), Only Med Del (a star in the hotline calendar\'s Designation column), ' +
          'One house (that house\'s calendar rows, the exact location), Leadership (`housemanagers` and ' +
          '`directors`), PRN (NOTE = PRN in the Staff Preferences mirror). The sender sees the exact count and ' +
          'every name before sending and confirms them; the numbers are deduplicated; a text that looks like it ' +
          'says why a shift is open is warned about, because an open shift never says why. A house manager ' +
          'writes to all staff and to their own house; Leadership is for a director, team lead, administrator ' +
          'or the master. EVERY COPY GOES THROUGH THE ONE DOOR: while test mode is on the broadcast becomes rows ' +
          'in the mock outbox and the rehearsal book and NOBODY IS CONTACTED; inside the quiet window it is held ' +
          'and sent at 08:00 unless it is withdrawn first. `cc` joins All staff, Only Med Del and Leadership. ' +
          'Placeholders: {message} {signature} {first_name} {name} {sender_name} {sender} {house} {audience} — ' +
          'an empty {signature}, {first_name}, {name}, {sender_name} or {house} takes its line with it when ' +
          'nothing else is left on that line.'
  },
  /* The shift is covered: once per shift, to the people the URGENT OPEN SHIFT reached. */
  {
    id: 'open_shift_covered', enabled: 'yes', kind: 'event', event: 'open_shift_covered',
    credential: '', label: 'a call-off\'s open shift was covered', days_before: '',
    direction: '', statuses: '',
    channels: 'sms',
    /* No `to`/`cc`: the audience is the one kept on the call-off row. */
    to: '', cc: '', sender: '',
    sms_text: SMART_OPEN_SHIFT_COVERED_TEXT,
    email_subject: '', email_text: '',
    note: 'CommOpenShiftCovered.gs sends this when a call-off\'s open shift is FILLED on the Requests pool — the ' +
          'house manager approved an applicant or assigned somebody, or a claim filled it — and the relay hands the ' +
          'fill over (server/open_shift_covered.py). ONCE PER SHIFT, TO THE SAME PEOPLE THE URGENT OPEN SHIFT ' +
          'REACHED AND NOBODY ELSE: the list is the one the blast kept on the call-off row, never `allstaff` read ' +
          'again, so nobody hired since, and nobody the blast never got to, hears about a shift they were never ' +
          'asked to take. An ask that reached nobody (the dial held it and has since moved, it went stale, or it ' +
          'was never sent) is followed by nothing. IT NEVER SAYS WHY THE SHIFT WAS OPEN OR WHO CALLED OFF: ' +
          '{reason} and {employee} are taken out of these words whatever the cell says. A shift filled while the ' +
          'URGENT OPEN SHIFT was still held for the morning drops that ask instead — nobody is asked, so nobody ' +
          'needs telling. THE QUIET WINDOW HOLDS IT (21:31-07:59 New York): a shift filled in the night is told ' +
          'after 08:00, and only if it has not ended. While test mode is on the follow-up is written into the ' +
          'mock outbox and the rehearsal book, ONE row for the whole audience like the blast\'s, and NOBODY IS ' +
          'CONTACTED. Placeholders that resolve: {house} (the house as people say it, "JH home") {time} (the ' +
          'shift\'s start, "2pm") {day_word} (today, tomorrow or the weekday) {location} (the street) {date} ' +
          '{first_name} and {name} (the person being texted) {sender}. A missing house, hour or day leaves its ' +
          'words out rather than a gap.'
  },
  /* The recruiters' book: planned by the relay, sent by CommRecruit.gs. */
  {
    id: 'hiring_screen_day_reminder', enabled: 'yes', kind: 'event', event: 'hiring_screen_day_reminder',
    credential: '', label: 'the in-person screen is today', days_before: '',
    direction: '', statuses: '',
    channels: 'sms',
    /* No `to`: the candidate on the book's row is the only recipient. */
    to: '', cc: '', sender: SMART_RECRUIT_SENDER, from_line: SMART_RECRUIT_LINE,
    sms_text: SMART_RECRUIT_SCREEN_TEXT,
    email_subject: '', email_text: '',
    note: 'Sent by CommRecruit.gs when the relay (server/recruit_book.py) finds a Talent Pipeline row of the ' +
          'recruiters\' book whose in-person screen is TODAY, still at "3 - In Person" with no hiring decision, ' +
          'with a phone, a time, a place and a screener. From 08:00 New York until the screen starts; once per ' +
          'screen (the phone, the day and the time — a screen moved to another day is a new one). Never to a ' +
          'person who is on the Hub\'s hiring board (their own lanes text them), never to a shared line or one ' +
          'of ours. Leaves from the line in `from_line` (Administration, 919-5559), so a "can\'t make it" lands ' +
          'with the recruiter. EVERY TEXT GOES THROUGH THE ONE DOOR: while test mode is on it is written into ' +
          'the mock outbox and the rehearsal book and NOBODY IS CONTACTED. Placeholders: {first_name} {name} ' +
          '{screener} (as the book names them) {time} ("11AM") {location} (its closing full stop taken off) ' +
          '{date} {sender}.'
  },
  {
    id: 'hiring_onboarding_start', enabled: 'yes', kind: 'event', event: 'hiring_onboarding_start',
    credential: '', label: 'the screen went well — onboarding starts', days_before: '',
    direction: '', statuses: '',
    channels: 'sms',
    to: '', cc: '', sender: SMART_RECRUIT_SENDER, from_line: SMART_RECRUIT_LINE,
    sms_text: SMART_RECRUIT_ONBOARD_TEXT,
    email_subject: '', email_text: '',
    note: 'Sent by CommRecruit.gs when the relay sees a candidate PASS on the recruiters\' book: " Hire ?" turns ' +
          'Yes on the Talent Pipeline, or a new Onboarding Checklist row reads Pending. ONCE PER PERSON (the ' +
          'phone), and only a change seen happening: the day the lane was born, everybody already at Yes or ' +
          'Pending was written down and told nothing — the 253 who said Yes before, and this week\'s, who were ' +
          'texted by hand. Told within 72 hours of the book saying so, or never (never a week late). Never to a ' +
          'Hub card, a shared line or one of ours. Leaves from `from_line`, so the e-mail address the text asks ' +
          'for comes back to the recruiter. While test mode is on it is written into the mock outbox and the ' +
          'rehearsal book and NOBODY IS CONTACTED. Placeholders: {first_name} {name} {screener} (the Talent ' +
          'Pipeline\'s screener for that phone; "Our house manager" when the book names nobody) {sender}.'
  },
  {
    id: 'hiring_bci_howto', enabled: 'yes', kind: 'event', event: 'hiring_bci_howto',
    credential: '', label: 'the BCI background check is not done — the True Hire how-to', days_before: '',
    direction: '', statuses: '',
    channels: 'sms',
    to: '', cc: '', sender: SMART_RECRUIT_SENDER, from_line: SMART_RECRUIT_LINE,
    max_attempts: '1', frequency: 'once',
    sms_text: SMART_RECRUIT_BCI_TEXT,
    email_subject: '', email_text: '',
    note: 'Sent by CommRecruit.gs when the relay finds an Onboarding Checklist row of the recruiters\' book at ' +
          'Pending or Yes whose Background Check reads "n". Weekdays 08:00-17:00 New York only — True Hire takes ' +
          'walk-ins Mon-Fri 8A-5P, and the text asks for it today. ONCE PER PERSON by default; to ask again, set ' +
          'Max # of attempts and Frequency on this row (asked again only while the book still says "n"). Never ' +
          'to a Hub card, a shared line or one of ours. Leaves from `from_line`. While test mode is on it is ' +
          'written into the mock outbox and the rehearsal book and NOBODY IS CONTACTED. About 950 characters, ' +
          'so it travels as several segments. Placeholders: {first_name} {name} {sender}.'
  },
  smartTimeOffSeed_('time_off_ask_manager', 'time off waiting for your approval (house manager)',
    SMART_TIME_OFF_ASK_MANAGER_TEXT, 'Approve time off - {requester} {dates} [{ref}]',
    'TO EACH HOUSE MANAGER the relay named on the request (the ** rows of the houses the person is drawn on, ' +
    'less the person and whoever filed it). One YES from any of them approves the house-manager half; a ' +
    'director approves the other half. A NO ends the request.'),
  smartTimeOffSeed_('time_off_ask_above', 'time off waiting for your approval (in place of the house manager)',
    SMART_TIME_OFF_ASK_ABOVE_TEXT, 'Approve time off - {requester} {dates} [{ref}]',
    'TO EACH DIRECTOR ON THE TIME OFF LIST when no house manager other than the person or the filer is on ' +
    'file. Two different people approve the two halves; one person never approves both.'),
  smartTimeOffSeed_('time_off_ask_director', 'time off waiting for a director\'s approval',
    SMART_TIME_OFF_ASK_DIRECTOR_TEXT, 'Approve time off - {requester} {dates} [{ref}]',
    'TO EACH DIRECTOR ON THE TIME OFF LIST (Settings - Time Off), never derived from a badge.'),
  smartTimeOffSeed_('time_off_scheduled', 'your time off is scheduled', SMART_TIME_OFF_SCHEDULED_TEXT,
    'Time off scheduled - {dates} [{ref}]', 'TO THE PERSON, once, when both halves are approved.'),
  smartTimeOffSeed_('time_off_scheduled_manager', 'time off scheduled - open drafts to publish',
    SMART_TIME_OFF_SCHEDULED_MANAGER_TEXT, 'Time off - {requester} {dates} [{ref}]',
    'TO THE HOUSE MANAGER of each house where the time off drafted an OPEN shift or an R/O day. Nothing is ' +
    'assigned: the drafts wait in Calendar Builder - Builder.'),
  smartTimeOffSeed_('time_off_denied', 'your time off request was not approved', SMART_TIME_OFF_DENIED_TEXT,
    'Time off not approved - {dates} [{ref}]', 'TO THE PERSON, with the words of whoever said no.'),
  smartTimeOffSeed_('time_off_cancelled', 'your scheduled time off was cancelled', SMART_TIME_OFF_CANCELLED_TEXT,
    'Time off cancelled - {dates} [{ref}]', 'TO THE PERSON, with the words of whoever cancelled it.'),
  smartTimeOffSeed_('time_off_cancelled_manager', 'time off cancelled - the open drafts stay open',
    SMART_TIME_OFF_CANCELLED_MANAGER_TEXT, 'Time off cancelled - {requester} {dates} [{ref}]',
    'TO THE HOUSE MANAGER of each house the time off drafted shifts at.'),
  smartTimeOffSeed_('time_off_expired', 'your time off request was not answered', SMART_TIME_OFF_EXPIRED_TEXT,
    'Time off request closed - {dates} [{ref}]', 'TO THE PERSON, when the request ended still unanswered.'),
  smartSchedSeed_('sched_calloff_house', 'an open shift, to the house first', SMART_SCHED_CALLOFF_HOUSE_TEXT,
    'STAGE 1 OF A CALL-OFF: to the house managers and to the people on that house\'s roster who are free then, ' +
    'never to the person who called off.'),
  smartSchedSeed_('sched_calloff_everyone', 'an open shift, to everybody after the wait',
    SMART_SCHED_CALLOFF_EVERYONE_TEXT,
    'STAGE 2 OF A CALL-OFF, after the outreach wait and only while the shift is still open: every active member ' +
    'of staff this platform can text (the allstaff keyword), less everyone stage 1 already asked.'),
  smartSchedSeed_('sched_swap_ask', 'a shift swap waiting for your answer', SMART_SCHED_SWAP_ASK_TEXT,
    'TO EACH SEAT OF A SWAP IN TURN: the replacement, then the house managers, then the directors.', true),
  smartSchedSeed_('sched_swap_declined_staff', 'your swap was declined by the replacement',
    SMART_SCHED_SWAP_DECLINED_STAFF_TEXT, 'TO THE PERSON WHO ASKED, when the replacement says no.', true),
  smartSchedSeed_('sched_swap_declined_manager', 'your swap was declined by the house manager',
    SMART_SCHED_SWAP_DECLINED_MANAGER_TEXT, 'TO THE PERSON WHO ASKED, when the house manager says no.', true),
  smartSchedSeed_('sched_swap_declined_director', 'your swap was declined by a director',
    SMART_SCHED_SWAP_DECLINED_DIRECTOR_TEXT, 'TO THE PERSON WHO ASKED, when a director says no.', true),
  smartSchedSeed_('sched_swap_done', 'a shift swap is done', SMART_SCHED_SWAP_DONE_TEXT,
    'TO BOTH PEOPLE IN THE SWAP, once every seat said yes and the calendar changed.', true),
  smartSchedSeed_('sched_request_decided', 'your Request Off was decided', SMART_SCHED_REQUEST_DECIDED_TEXT,
    'TO THE PERSON WHO ASKED, with the first director\'s answer.'),
  smartSchedSeed_('sched_timeoff_decided', 'your time off was decided', SMART_SCHED_TIMEOFF_DECIDED_TEXT,
    'TO THE PERSON WHO ASKED, with the first director\'s answer.'),
  smartSchedSeed_('sched_training_ask', 'a training waiting for your approval (no IST)', SMART_SCHED_TRAINING_ASK_TEXT,
    'TO BOTH SEATS OF A TRAINING AT ONCE: the house managers of that house and the Scheduling directors, when ' +
    'somebody new to the house without its IST is placed on a shift there. {trainee} is the person placed.'),
  smartSchedSeed_('sched_training_decided', 'your training shift was decided', SMART_SCHED_TRAINING_DECIDED_TEXT,
    'TO THE PERSON PLACED AS A TRAINING, once the house manager and a director approved, or the first one declined.'),
  smartSupportSeed_('sr_vehicle_request', 'a vehicle request or issue came in', SMART_SR_VEHICLE_REQUEST_TEXT,
    'TO EACH DIRECTOR, after the My Inbox item, for a hotline row typed as a vehicle request or issue. {callback} ' +
    'is the number the caller filed from.'),
  smartSupportSeed_('sr_payroll_request', 'a payroll request came in', SMART_SR_PAYROLL_REQUEST_TEXT,
    'TO THE PAYROLL LIST of the Support Requests settings, after the My Inbox item, for a hotline row typed as ' +
    'payroll or pay stubs.'),
  smartSupportSeed_('sr_punch_aware', 'somebody is not punching in or out', SMART_SR_PUNCH_AWARE_TEXT,
    'TO THE DIRECTORS AND THE LEADS, once per person per shift, at the first missing clock-in or clock-out. A ' +
    'shared company line is never texted: that person\'s My Inbox item is theirs.'),
  smartSupportSeed_('sr_adp_applied', 'update information was applied automatically', SMART_SR_ADP_APPLIED_TEXT,
    'TO EACH DIRECTOR when an ADP - Update Information request was applied on the platform. It names the field, ' +
    'never the value.'),
  smartTransportSeed_('transport_request_ask', 'a vehicle request waiting for your approval',
    SMART_TRANSPORT_REQUEST_ASK_TEXT,
    'TO EACH TRANSPORTATION DIRECTOR (never the requester) when a staff member requests a vehicle; the first answer ' +
    'decides. {details} is cut at 140 characters; {wheelchair} is Yes or No.'),
  smartTransportSeed_('transport_request_decided', 'your vehicle request was decided',
    SMART_TRANSPORT_REQUEST_DECIDED_TEXT,
    'TO THE PERSON WHO REQUESTED THE VEHICLE, with the first director\'s answer.'),
  smartTransportSeed_('transport_trip_cancelled', 'your trip was cancelled', SMART_TRANSPORT_TRIP_CANCELLED_TEXT,
    'TO THE PERSON WHO REQUESTED THE VEHICLE, when a director cancels the trip.'),
  smartSchedExchangeSeed_('sched_exchange_ask', 'a two-shift swap waiting for your answer', SMART_SCHED_EXCHANGE_ASK_TEXT,
    'TO EACH SEAT OF AN EXCHANGE IN TURN: the partner, then the house managers of each house involved, then the ' +
    'directors.'),
  smartSchedExchangeSeed_('sched_exchange_done', 'a two-shift swap is done', SMART_SCHED_EXCHANGE_DONE_TEXT,
    'TO BOTH PEOPLE IN THE EXCHANGE, once every seat said yes and both shifts changed hands.'),
  {
    id: 'staff_loan_request', enabled: 'yes', kind: 'letter', credential: '',
    label: 'an employee loan request waiting for your approval', days_before: '',
    channels: 'sms', to: '', cc: '', direction: '', statuses: '',
    sms_text: SMART_STAFF_LOAN_REQUEST_TEXT, email_subject: '', email_text: '',
    note: 'Employee loans (EmployeeLoans.gs names the recipient, smartTell_ says it). TO EACH SCHEDULING DIRECTOR ' +
          '(never the requester) when a loan is requested from Staff; the first answer in My Work decides. A letter: ' +
          'the moment is the request. Held inside 21:31-07:59 and said at 08:00 while the request still waits; while ' +
          'test mode is on it is written into the rehearsal book and NOBODY IS CONTACTED. Placeholders: {employee} ' +
          '{amount} {date} {requester} {link} {sender}.'
  }
];

/* ---- The tab ---- */

/** Seeded on first touch, ADDITIVELY: an admin-edited row is never overwritten. */
function smartSheet_() {
  var header = smartHeader_();
  var sheet = hubTabEnsure_(SMART_TAB, header);
  if (sheet.getMaxColumns() < header.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), header.length - sheet.getMaxColumns());
  }
  // NAME THE NEW COLUMNS — ONLY the ones with no name yet.
  var hdrNow = sheet.getRange(1, 1, 1, header.length).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var named = 0;
  for (var hc = 0; hc < header.length; hc++) {
    if (hdrNow[hc] === '') {
      sheet.getRange(1, hc + 1).setValue(header[hc]);
      named++;
    }
  }
  if (named) {
    try { smartCacheBust_(); } catch (eH) { /* next read rebuilds */ }
  }
  var last = sheet.getLastRow();
  var have = {};
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var k = String(r[0] || '').trim();
      if (k) have[k] = true;
    });
  }
  var missing = smartDefaults_().concat(smartAiRequests_())
    .filter(function (d) { return !have[d.id]; });
  if (missing.length) {
    var block = missing.map(function (d) {
      return SMART_HEADER.map(function (h) { return String(d[h] == null ? '' : d[h]); });
    });
    if (sheet.getMaxRows() < sheet.getLastRow() + block.length) {
      sheet.insertRowsAfter(sheet.getMaxRows(), sheet.getLastRow() + block.length - sheet.getMaxRows());
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, block.length, SMART_HEADER.length).setValues(block);
    try { smartCacheBust_(); } catch (e) { /* next read rebuilds */ }
  }
  // A ROW THAT ALREADY EXISTS IS NEVER COMPLETED — and five of them were only half written.
  try { smartFillBlankStructure_(sheet); } catch (eFb) {
    hubSysLog_('asa-hub:smartcomms', 'seed_structure_fill_failed',
               String((eFb && eFb.message) || eFb), { status: 500 });
  }
  // AND A `to` CELL THAT ADDRESSES NOBODY IS LEFT EXACTLY AS THE HOUSE HAS IT.
  try { smartMigrateAiDefault_(sheet); } catch (eAi) {
    hubSysLog_('asa-hub:smartcomms', 'ai_default_migration_failed',
               String((eAi && eAi.message) || eAi), { status: 500 });
  }

 // The move: the Hiring messages screen's texts arrive in their rows exactly once, on the bootstrap path like every…
  try { smartMigrateHiringMessages_(sheet); } catch (eMig) {
    hubSysLog_('asa-hub:smartcomms', 'hiring_messages_migration_failed',
               String((eMig && eMig.message) || eMig), { status: 500 });
  }
 // The move, and it is the SAME KIND of move: live behaviour that gained a row must not arrive switched off.
  try { smartArmFirstContactOnce_(sheet); } catch (eArm) {
    hubSysLog_('asa-hub:smartcomms', 'first_contact_arm_failed',
               String((eArm && eArm.message) || eArm), { status: 500 });
  }
 // The dictated rules touch rows that ALREADY exist sheet, which a seed never overwrites — so they arrive by…
  try { smartApplyRules20260830_(sheet); } catch (eR30) {
    hubSysLog_('asa-hub:smartcomms', 'rules_20260830_failed',
               String((eR30 && eR30.message) || eR30), { status: 500 });
  }
  // AND THE FOUR CALL-OFF ROWS, for the same reason: two of them are already in the house, so the seed above never…
  try { smartArmCallOffsOnce_(sheet); } catch (eCo) {
    hubSysLog_('asa-hub:smartcomms', 'call_offs_ship_on_failed',
               String((eCo && eCo.message) || eCo), { status: 500 });
  }
  // AND THE URGENT OPEN SHIFT'S OWN LAYOUT, the same kind of move: the row is already in the house, so the seed…
  try { smartUrgentOpenShiftOnce_(sheet); } catch (eUo) {
    hubSysLog_('asa-hub:smartcomms', 'urgent_open_shift_layout_failed',
               String((eUo && eUo.message) || eUo), { status: 500 });
  }
  // AND THE URGENT OPEN SHIFT LOSES ITS REASON LINE — the same kind of move, after the one above: the reason goes…
  try { smartUrgentNoReasonOnce_(sheet); } catch (eUn) {
    hubSysLog_('asa-hub:smartcomms', 'urgent_open_shift_no_reason_failed',
               String((eUn && eUn.message) || eUn), { status: 500 });
  }
  try { smartUrgentLinkOnce_(sheet); } catch (eUl) {
    hubSysLog_('asa-hub:smartcomms', 'urgent_open_shift_link_failed',
               String((eUl && eUl.message) || eUl), { status: 500 });
  }
  try { smartHandoffWordsOnce_(sheet); } catch (eHw) {
    hubSysLog_('asa-hub:smartcomms', 'handoff_words_failed',
               String((eHw && eHw.message) || eHw), { status: 500 });
  }
  return sheet;
}

var SMART_URGENT_OPEN_SHIFT_KEY = 'urgent_open_shift_layout';
// A sentence only the earlier build wrote into the blast's note, and one that is now false: the house, the hour and…
var SMART_URGENT_OPEN_SHIFT_NOTE_MARK = 'none of the three is filled here';

// ONE-TIME MIGRATION: the URGENT OPEN SHIFT takes the dictated layout.
function smartUrgentOpenShiftOnce_(sheet) {
  var cfg = {};
  try { cfg = hiringAlerts_(); } catch (e) { cfg = {}; }
  if (str_(cfg[SMART_URGENT_OPEN_SHIFT_KEY]).toLowerCase() === 'yes') return { done: false, reason: 'already' };

  var last = sheet.getLastRow();
  if (last < 2) return { done: false, reason: 'no rows' };
  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h) col[h] = i; });
  var seed = null;
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { if (s.id === 'call_off_everyone') seed = s; });
  var said = '';
  var wrote = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0] || '').trim() !== 'call_off_everyone') continue;
    var words = String(values[r][col.sms_text] == null ? '' : values[r][col.sms_text]).replace(/\r\n/g, '\n');
    if (col.sms_text !== undefined && words === SMART_URGENT_OPEN_SHIFT_BEFORE) {
      sheet.getRange(r + 1, col.sms_text + 1).setValue(SMART_URGENT_OPEN_SHIFT_TEXT);
      wrote.push('sms_text');
    } else if (col.sms_text !== undefined && words !== SMART_URGENT_OPEN_SHIFT_TEXT &&
               words !== SMART_URGENT_OPEN_SHIFT_WITH_REASON && words !== SMART_URGENT_OPEN_SHIFT_NO_LINK) {
      /* earlier seeds; the migrations below carry them on */
      var n = col.sms_text + 1, letters = '';
      while (n > 0) { letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters; n = Math.floor((n - 1) / 26); }
      said = SMART_TAB + '!' + letters + String(r + 1) +
             ' (call_off_everyone.sms_text) holds words somebody wrote, and they stand';
    }
    var note = String(values[r][col.note] == null ? '' : values[r][col.note]);
    if (col.note !== undefined && seed && note.indexOf(SMART_URGENT_OPEN_SHIFT_NOTE_MARK) !== -1) {
      sheet.getRange(r + 1, col.note + 1).setValue(String(seed.note));
      wrote.push('note');
    }
    break;
  }
  try {
    var aSheet = hiringAlertsSheet_();
    var aVals = aSheet.getDataRange().getValues();
    var found = false;
    for (var a = 1; a < aVals.length; a++) {
      if (String(aVals[a][0]).trim() === SMART_URGENT_OPEN_SHIFT_KEY) {
        aSheet.getRange(a + 1, 2).setValue('yes');
        found = true;
        break;
      }
    }
    if (!found) {
      aSheet.appendRow([SMART_URGENT_OPEN_SHIFT_KEY, 'yes',
        'The URGENT OPEN SHIFT took the dictated layout (house, hour, day, street, reason) ' +
        'once, by smartUrgentOpenShiftOnce_ — only where the cell still held the earlier build\'s ' +
        'words. Do not edit.']);
    }
    hiringAlertsBump_();
  } catch (eMk) { /* no marker means it runs again; the exact-words guard makes that a no-op */ }
  try { smartCacheBust_(); } catch (eS) { /* the TTL rebuilds */ }
  hubSysLog_('asa-hub:smartcomms', said ? 'urgent_open_shift_kept' : 'urgent_open_shift_layout',
             wrote.length ? 'call_off_everyone took the URGENT OPEN SHIFT layout: ' + wrote.join(', ') +
               (said ? ' · ' + said : '')
             : (said || 'call_off_everyone was not found, or already carries the layout — nothing written'),
             { status: 200 });
  return { done: true, wrote: wrote, kept: said };
}

var SMART_URGENT_NO_REASON_KEY = 'urgent_open_shift_no_reason';
// A sentence only the previous build wrote into the blast's note, and one that is now false: the blast carries no…
var SMART_URGENT_NO_REASON_NOTE_MARK = 'and why ({reason}:';

// ONE-TIME MIGRATION: the URGENT OPEN SHIFT to everybody loses its reason line.
function smartUrgentNoReasonOnce_(sheet) {
  var cfg = {};
  try { cfg = hiringAlerts_(); } catch (e) { cfg = {}; }
  if (str_(cfg[SMART_URGENT_NO_REASON_KEY]).toLowerCase() === 'yes') return { done: false, reason: 'already' };

  var last = sheet.getLastRow();
  if (last < 2) return { done: false, reason: 'no rows' };
  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h) col[h] = i; });
  var seed = null;
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { if (s.id === 'call_off_everyone') seed = s; });
  var kept = '';
  var wrote = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0] || '').trim() !== 'call_off_everyone') continue;
    if (col.sms_text !== undefined) {
      var words = String(values[r][col.sms_text] == null ? '' : values[r][col.sms_text]).replace(/\r\n/g, '\n');
      if (words === SMART_URGENT_OPEN_SHIFT_BEFORE || words === SMART_URGENT_OPEN_SHIFT_WITH_REASON) {
        sheet.getRange(r + 1, col.sms_text + 1).setValue(SMART_URGENT_OPEN_SHIFT_TEXT);
        wrote.push('sms_text');
      } else if (words !== SMART_URGENT_OPEN_SHIFT_TEXT && words !== SMART_URGENT_OPEN_SHIFT_NO_LINK) {
        /* an earlier seed; smartUrgentLinkOnce_ carries it on */
        var n = col.sms_text + 1, letters = '';
        while (n > 0) { letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters; n = Math.floor((n - 1) / 26); }
        kept = SMART_TAB + '!' + letters + String(r + 1) +
               ' (call_off_everyone.sms_text) holds words somebody wrote, and they stand — ' +
               'a {reason} in them is never filled, so that line is left out when it renders';
      }
    }
    if (col.note !== undefined && seed) {
      var note = String(values[r][col.note] == null ? '' : values[r][col.note]);
      if (note.indexOf(SMART_URGENT_NO_REASON_NOTE_MARK) !== -1 ||
          note.indexOf(SMART_URGENT_OPEN_SHIFT_NOTE_MARK) !== -1) {
        sheet.getRange(r + 1, col.note + 1).setValue(String(seed.note));
        wrote.push('note');
      }
    }
    break;
  }
  try {
    var aSheet = hiringAlertsSheet_();
    var aVals = aSheet.getDataRange().getValues();
    var found = false;
    for (var a = 1; a < aVals.length; a++) {
      if (String(aVals[a][0]).trim() === SMART_URGENT_NO_REASON_KEY) {
        aSheet.getRange(a + 1, 2).setValue('yes');
        found = true;
        break;
      }
    }
    if (!found) {
      aSheet.appendRow([SMART_URGENT_NO_REASON_KEY, 'yes',
        'The URGENT OPEN SHIFT to everybody lost its reason line once, by smartUrgentNoReasonOnce_ — ' +
        'only where the cell still held one of the earlier builds\' words; the reason goes to the ' +
        '5558 group alone (call_off_reason_directors). Do not edit.']);
    }
    hiringAlertsBump_();
  } catch (eMk) { /* no marker means it runs again; the exact-words guard makes that a no-op */ }
  try { smartCacheBust_(); } catch (eS) { /* the TTL rebuilds */ }
  hubSysLog_('asa-hub:smartcomms', kept ? 'urgent_open_shift_kept' : 'urgent_open_shift_no_reason',
             wrote.length ? 'call_off_everyone lost its reason line: ' + wrote.join(', ') +
               (kept ? ' · ' + kept : '')
             : (kept || 'call_off_everyone was not found, or already carries no reason line — nothing written'),
             { status: 200 });
  return { done: true, wrote: wrote, kept: kept };
}

/** Once-per-install migration: a cell changes only while it holds exactly an earlier seed. */
function smartExactWordsOnce_(sheet, spec) {
  var cfg = {};
  try { cfg = hiringAlerts_(); } catch (e) { cfg = {}; }
  if (str_(cfg[spec.key]).toLowerCase() === 'yes') return { done: false, reason: 'already' };

  var last = sheet.getLastRow();
  if (last < 2) return { done: false, reason: 'no rows' };
  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h) col[h] = i; });
  var wrote = [], kept = [];
  spec.cells.forEach(function (want) {
    var c = col[want.col];
    if (c === undefined) return;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][0] || '').trim() !== want.id) continue;
      var words = String(values[r][c] == null ? '' : values[r][c]).replace(/\r\n/g, '\n');
      if (words === want.to) break;
      if (want.from.indexOf(words) !== -1) {
        sheet.getRange(r + 1, c + 1).setValue(want.to);
        wrote.push(want.id + '.' + want.col);
        break;
      }
      var n = c + 1, letters = '';
      while (n > 0) { letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters; n = Math.floor((n - 1) / 26); }
      kept.push(SMART_TAB + '!' + letters + String(r + 1) + ' (' + want.id + '.' + want.col +
                ') holds words somebody wrote, and they stand' + (want.hint ? ' — ' + want.hint : ''));
      break;
    }
  });
  try {
    var aSheet = hiringAlertsSheet_();
    var aVals = aSheet.getDataRange().getValues();
    var found = false;
    for (var a = 1; a < aVals.length; a++) {
      if (String(aVals[a][0]).trim() === spec.key) {
        aSheet.getRange(a + 1, 2).setValue('yes');
        found = true;
        break;
      }
    }
    if (!found) aSheet.appendRow([spec.key, 'yes', spec.marker]);
    hiringAlertsBump_();
  } catch (eMk) { /* no marker means it runs again; the exact-words guard makes that a no-op */ }
  try { smartCacheBust_(); } catch (eS) { /* the TTL rebuilds */ }
  var keptWords = kept.join(' · ');
  hubSysLog_('asa-hub:smartcomms', keptWords ? spec.keptLog : spec.log,
             wrote.length ? spec.what + ': ' + wrote.join(', ') + (keptWords ? ' · ' + keptWords : '')
             : (keptWords || 'the rows were not found, or already carry the words — nothing written'),
             { status: 200 });
  return { done: true, wrote: wrote, kept: keptWords };
}

var SMART_URGENT_LINK_KEY = 'smart_urgent_open_shift_link_once';

/** One-time migration: the URGENT OPEN SHIFT gains SMART_URGENT_LINK_LINE. */
function smartUrgentLinkOnce_(sheet) {
  return smartExactWordsOnce_(sheet, {
    key: SMART_URGENT_LINK_KEY,
    marker: 'The URGENT OPEN SHIFT gained its link line once, by smartUrgentLinkOnce_ — only where ' +
            'the cell still held the shipped words. Do not edit.',
    log: 'urgent_open_shift_link', keptLog: 'urgent_open_shift_kept',
    what: 'call_off_everyone gained the road to the shift',
    cells: [{ id: 'call_off_everyone', col: 'sms_text', to: SMART_URGENT_OPEN_SHIFT_TEXT,
              from: [SMART_URGENT_OPEN_SHIFT_NO_LINK, SMART_URGENT_OPEN_SHIFT_BEFORE,
                     SMART_URGENT_OPEN_SHIFT_WITH_REASON],
              hint: 'add "' + SMART_URGENT_LINK_LINE + '" there to carry the link' }]
  });
}

var SMART_HANDOFF_WORDS_KEY = 'smart_handoff_words_once';

/** One-time migration: the transfer asks carry the ref; Requests is named on Calendar Builder. */
function smartHandoffWordsOnce_(sheet) {
  return smartExactWordsOnce_(sheet, {
    key: SMART_HANDOFF_WORDS_KEY,
    marker: 'The transfer asks gained the ref in the reply, and Requests is named on Calendar Builder, once, ' +
            'by smartHandoffWordsOnce_ - only where the cells still held the shipped words. Do not edit.',
    log: 'handoff_words', keptLog: 'handoff_words_kept',
    what: 'the transfer asks carry the ref in the reply and name Calendar Builder - Requests',
    cells: [
      { id: 'shift_handoff_ask_staff', col: 'sms_text', to: SMART_HANDOFF_ASK_STAFF_TEXT,
        from: [SMART_HANDOFF_ASK_STAFF_BEFORE],
        hint: 'a reply by text quotes the ref with "YES {handoff}" / "NO {handoff}"' },
      { id: 'shift_handoff_ask_manager', col: 'sms_text', to: SMART_HANDOFF_ASK_MANAGER_TEXT,
        from: [SMART_HANDOFF_ASK_MANAGER_BEFORE],
        hint: 'a reply by text quotes the ref with "APPROVE {handoff}" / "NO {handoff}"' },
      { id: 'shift_handoff_ask_manager', col: 'email_text', to: SMART_HANDOFF_ASK_MANAGER_MAIL,
        from: [SMART_HANDOFF_ASK_MANAGER_MAIL_BEFORE],
        hint: 'Approve is drawn on Calendar Builder - Requests, not on House Calendars' },
      { id: 'shift_applicants_waiting', col: 'sms_text', to: SMART_APPLICANTS_WAITING_SMS,
        from: [SMART_APPLICANTS_WAITING_SMS_BEFORE],
        hint: 'Requests is on Calendar Builder now' },
      { id: 'shift_applicants_waiting', col: 'email_text', to: SMART_APPLICANTS_WAITING_MAIL,
        from: [SMART_APPLICANTS_WAITING_MAIL_BEFORE],
        hint: 'Requests is on Calendar Builder now' }
    ]
  });
}

var SMART_RULES_20260830_KEY = 'hiring_rules_20260830';

// THE DICTATION, applied once to rows that already exist.
function smartApplyRules20260830_(sheet) {
  var cfg = {};
  try { cfg = hiringAlerts_(); } catch (e) { cfg = {}; }
  if (str_(cfg[SMART_RULES_20260830_KEY]).toLowerCase() === 'yes') return;

  var last = sheet.getLastRow();
  if (last < 2) return;
  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h) col[h] = i; });
  if (col.enabled === undefined) return;

  var OLD_SC = {
    sms_text: 'Hi {first_name}, this is ASA LifeCare — the next step is a short phone ' +
              'screening, and you can start it whenever suits you: just call {screen_line} ' +
              'and our line will take you through it.',
    email_subject: 'Your phone screening — call when it suits you',
    email_text: 'Hi {first_name},\n\nThe next step with us is a short phone screening, ' +
                'and you are in charge of when it happens: call {screen_line} and our ' +
                'line will take you through it.\n\nIt takes a few minutes, and there is ' +
                'nothing to prepare.'
  };
  var NEW_SC = {
    sms_text: 'Hi {first_name}, this is ASA LifeCare — the next step is your initial ' +
              'phone screening. Please call {screen_line} as soon as you can, within the ' +
              'next 2 days, and the line takes you through it.',
    email_subject: 'Your phone screening — please call {screen_line} within 2 days',
    email_text: 'Hi {first_name},\n\nThe next step of your selection process is the ' +
                'initial phone screening.\n\nPlease call {screen_line} as soon as you ' +
                'can — within the next 2 days — and our line will take you through it. ' +
                'It only lasts a few minutes.',
  };
  var armed = [];
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][0] || '').trim();
    if (id === 'hiring_screen_call' || id === 'onboarding_report') {
      if (String(values[r][col.enabled] || '').trim().toLowerCase() === 'no') {
        sheet.getRange(r + 1, col.enabled + 1).setValue('yes');
        armed.push(id);
      }
    }
    if (id === 'hiring_screen_call') {
      for (var cell in NEW_SC) {
        if (!NEW_SC.hasOwnProperty(cell) || col[cell] === undefined) continue;
        var now = String(values[r][col[cell]] == null ? '' : values[r][col[cell]]);
        if (now === '' || now === OLD_SC[cell]) {
          sheet.getRange(r + 1, col[cell] + 1).setValue(NEW_SC[cell]);
        }
      }
    }
  }
  try {
    var aSheet = hiringAlertsSheet_();
    var aVals = aSheet.getDataRange().getValues();
    var found = false;
    for (var a = 1; a < aVals.length; a++) {
      if (String(aVals[a][0]).trim() === SMART_RULES_20260830_KEY) {
        aSheet.getRange(a + 1, 2).setValue('yes');
        found = true;
        break;
      }
    }
    if (!found) {
      aSheet.appendRow([SMART_RULES_20260830_KEY, 'yes',
        'The dictated hiring rules of 2026-08-30 were applied once by ' +
        'smartApplyRules20260830_; do not edit.']);
    }
    hiringAlertsBump_();   // memo + the 60s entry, both
  } catch (eMk) { /* no marker means it runs again; the guards make that a no-op */ }
  try { smartCacheBust_(); } catch (eS) {}
  if (armed.length) {
    hubSysLog_('asa-hub:smartcomms', 'rules_20260830_applied',
               'switched on by the 2026-08-30 dictation: ' + armed.join(', '), { status: 200 });
  }
}

var SMART_FIRST_CONTACT_ARMED_KEY = 'hiring_first_contact_armed';

// THE ROW ARRIVED OFF AND STOPPED A WORKING MACHINE.
function smartArmFirstContactOnce_(sheet) {
  var cfg = {};
  try { cfg = hiringAlerts_(); } catch (e) { cfg = {}; }
  if (str_(cfg[SMART_FIRST_CONTACT_ARMED_KEY]).toLowerCase() === 'yes') return;

  var last = sheet.getLastRow();
  if (last < 2) return;
  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h) col[h] = i; });
  if (col.enabled === undefined) return;

  var armed = false;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0] || '').trim() !== 'hiring_first_contact') continue;
    if (String(values[r][col.enabled] || '').trim().toLowerCase() === 'no') {
      sheet.getRange(r + 1, col.enabled + 1).setValue('yes');
      armed = true;
    }
    break;
  }

  // The marker rides the config tab, so this is once per installation.
  try {
    var aSheet = hiringAlertsSheet_();
    var aVals = aSheet.getDataRange().getValues();
    var found = false;
    for (var a = 1; a < aVals.length; a++) {
      if (String(aVals[a][0]).trim() === SMART_FIRST_CONTACT_ARMED_KEY) {
        aSheet.getRange(a + 1, 2).setValue('yes');
        found = true;
        break;
      }
    }
    if (!found) {
      aSheet.appendRow([SMART_FIRST_CONTACT_ARMED_KEY, 'yes',
        'The first-contact machine gained a Smart Comms row on 2026-08-29 and must not ' +
        'have arrived switched off. Set by smartArmFirstContactOnce_; do not edit.']);
    }
    hiringAlertsBump_();   // memo + the 60s entry, both
  } catch (eMk) {
    // No marker means it runs again, and the 'no'-only guard makes that a no-op once somebody has deliberately…
  }
  try { smartCacheBust_(); } catch (eS) {}
  if (armed) {
    hubSysLog_('asa-hub:smartcomms', 'first_contact_armed',
               'hiring_first_contact was switched on — it had been sending since ' +
               '2026-08-26 and its new row arrived off', { status: 200 });
  }
}

var SMART_CALLOFF_SHIP_ON_KEY = 'call_offs_ship_on';

// THE FOUR ROWS THIS MIGRATION MAY TOUCH, AND THE ONE IT MAY NOT.
var SMART_CALLOFF_SHIP_ON_IDS = ['call_off_acknowledged', 'call_off_cover_offer',
                                 'call_off_house_manager', 'call_off_everyone'];

// SENTENCES ONLY THIS CODE CAN HAVE WRITTEN, AND EVERY ONE OF THEM IS NOW FALSE ABOUT THE ROW IT SITS ON.
var SMART_CALLOFF_RETIRED_NOTE_MARKS = [
  'Ships wordless: write the words, set `channels`, then switch it on.',
  'Ships wordless on every channel: write the words, set `channels`, then switch it on.',
  'Ships wordless on every channel.',
  'It cannot fire today: the roster is not readable from the backend.'
];

// Is this cell one of the letters the generic mapper planted?
function smartCallOffPlantedWords_(value) {
  var v = smartFoldWords_(value);
  if (!v) return false;
  var planted = [];
  try { planted = smartGenericTexts_(); } catch (e) { planted = []; }
  for (var i = 0; i < planted.length; i++) {
    if (smartFoldWords_(planted[i]) === v) return true;
  }
  return false;
}

// ONE-TIME MIGRATION: the four call-off rows are born working.
function smartArmCallOffsOnce_(sheet) {
  var cfg = {};
  try { cfg = hiringAlerts_(); } catch (e) { cfg = {}; }
  if (str_(cfg[SMART_CALLOFF_SHIP_ON_KEY]).toLowerCase() === 'yes') return { done: false, reason: 'already' };

  var last = sheet.getLastRow();
  if (last < 2) return { done: false, reason: 'no rows' };
  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h) col[h] = i; });
  var seedById = {};
  smartDefaults_().forEach(function (d) {
    if (SMART_CALLOFF_SHIP_ON_IDS.indexOf(String(d.id)) !== -1) seedById[d.id] = d;
  });

  var retired = function (note) {
    var v = String(note == null ? '' : note);
    for (var i = 0; i < SMART_CALLOFF_RETIRED_NOTE_MARKS.length; i++) {
      if (v.indexOf(SMART_CALLOFF_RETIRED_NOTE_MARKS[i]) !== -1) return true;
    }
    return false;
  };
  var changed = [];
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][0] || '').trim();
    var seed = seedById[id];
    if (!seed) continue;                        // every other row, and hotline_call_off
    var row = values[r], wrote = 0;
    var cell = function (name) {
      return col[name] === undefined ? null : String(row[col[name]] == null ? '' : row[col[name]]);
    };
    var put = function (name, value) {
      if (col[name] === undefined) return;
      row[col[name]] = value;
      wrote++;
    };
    // THE SWITCH — only while it still reads the seeded 'no'.
    if (col.enabled !== undefined && !smartOn_(cell('enabled'))) put('enabled', 'yes');
    // THE CHANNEL, and only when nobody has named one.
    if (col.channels !== undefined && cell('channels') === '' &&
        String(seed.channels || '')) put('channels', String(seed.channels));
    // THE WORDS — blank, or the letter the old mapper planted.
    if (col.sms_text !== undefined && String(seed.sms_text || '') &&
        (cell('sms_text').trim() === '' || smartCallOffPlantedWords_(cell('sms_text')))) {
      put('sms_text', String(seed.sms_text));
    }
    // AND THE PLANTED CREDENTIAL LETTER IS TAKEN OUT of the two rows carrying it.
    ['email_subject', 'email_text'].forEach(function (f) {
      if (col[f] === undefined) return;
      if (String(seed[f] || '')) return;                 // the seed writes it: not this migration's business
      if (smartCallOffPlantedWords_(cell(f))) put(f, '');
    });
    // THE AUDIENCE, for the two rows whose `Goes to` is a keyword this backend resolves — blank cells only, and…
    if (col.to !== undefined && String(seed.to || '') && cell('to').trim() === '') {
      put('to', String(seed.to));
    }
    // THE NOTE, when it is blank or still says something this build has made false.
    if (col.note !== undefined && String(seed.note || '') &&
        (cell('note').trim() === '' || retired(cell('note')))) put('note', String(seed.note));
    if (wrote) {
      sheet.getRange(r + 1, 1, 1, SMART_HEADER.length).setValues([row]);
      changed.push(id + ' (' + wrote + ' cell(s))');
    }
  }

  // The marker rides the config tab, so the run is once per installation.
  try {
    var aSheet = hiringAlertsSheet_();
    var aVals = aSheet.getDataRange().getValues();
    var found = false;
    for (var a = 1; a < aVals.length; a++) {
      if (String(aVals[a][0]).trim() === SMART_CALLOFF_SHIP_ON_KEY) {
        aSheet.getRange(a + 1, 2).setValue('yes');
        found = true;
        break;
      }
    }
    if (!found) {
      aSheet.appendRow([SMART_CALLOFF_SHIP_ON_KEY, 'yes',
        'The four call-off situations were brought to what the build ships — on, worded, ' +
        'addressed, and with notes that describe the row as it now is — once, by ' +
        'smartArmCallOffsOnce_, on the written decision that they are born ' +
        'working. Do not edit.']);
    }
    hiringAlertsBump_();   // memo + the 60s entry, both
  } catch (eMk) {
    // No marker means it runs again, and every guard above makes a second pass write nothing once the rows stand as…
  }
  try { smartCacheBust_(); } catch (eS) { /* the 300s TTL rebuilds */ }
  hubSysLog_('asa-hub:smartcomms', 'call_offs_ship_on',
             changed.length
               ? 'the call-off rows were brought to what this build ships: ' + changed.join(', ') +
                 ' — the sending dial and test mode decide whether anything leaves'
               : 'the call-off rows already stand as this build ships them; nothing was written',
             { status: 200 });
  return { done: true, changed: changed };
}

// The columns that say what a row IS, as opposed to what it SAYS.
var SMART_STRUCTURE_COLS = ['kind', 'event', 'direction', 'credential', 'label',
                            'days_before', 'statuses', 'channels',
                            'max_attempts', 'frequency', 'note',
                            // WHERE A ROW WRITES INSTEAD OF SENDING.
                            'record_to'];

// The cells that say WHO, which no SEEDING PATH in this platform fills in.
var SMART_AUDIENCE_COLS = ['to', 'cc'];

/** How recently the structure was checked. Six hours, in the script cache. */
var SMART_STRUCTURE_KEY = 'smart_structure_checked';

// What a keyword audience resolved to, held briefly.
var SMART_KEYWORD_COUNT_KEY = 'smart_to_keyword_counts:v1';
var SMART_KEYWORD_COUNT_TTL = 600;

// THE ONLY WORDS A `to` CELL MAY HOLD THAT ARE NOT ADDRESSES — AND EACH ONE IS A FUNCTION, NOT A CONVENTION.
var SMART_TO_KEYWORDS = {
  allstaff: {
    label: 'every active member of staff this platform can text',
    resolver: 'commCallOffEveryoneAudience_',
    resolve: function (facts) {
      return (typeof commCallOffEveryoneAudience_ === 'function')
        ? commCallOffEveryoneAudience_(facts || {})
        : { ok: false, people: [], why: 'the resolver is absent from this build', missing: '' };
    }
  },
  // THE SECOND ONE, AND IT EARNS THE SAME WAY.
  housemanagers: {
    label: 'every house manager on the hotline calendar we can text',
    resolver: 'commCallOffHouseManagersAudience_',
    resolve: function () {
      return (typeof commCallOffHouseManagersAudience_ === 'function')
        ? commCallOffHouseManagersAudience_()
        : { ok: false, readable: false, people: [],
            why: 'the resolver is absent from this build', missing: '' };
    }
  },
  // THE THIRD: the 5558 group — the directors and the people responsible, on the shared line the platform already…
  directors: {
    label: 'the 5558 group — the directors and the people responsible',
    resolver: 'commCallOffDirectorsAudience_',
    resolve: function () {
      return (typeof commCallOffDirectorsAudience_ === 'function')
        ? commCallOffDirectorsAudience_()
        : { ok: false, readable: false, people: [],
            why: 'the resolver is absent from this build', missing: '' };
    }
  }
};

/** The keyword this entry is, or '' — one word, folded, nothing else in it. */
function smartToKeyword_(entry) {
  var v = String(entry == null ? '' : entry).trim().toLowerCase().replace(/[^a-z]/g, '');
  return (v && Object.prototype.hasOwnProperty.call(SMART_TO_KEYWORDS, v)) ? v : '';
}

// IS THIS CELL AN ADDRESS ANYBODY CAN ACTUALLY REACH?
function smartAddressable_(raw) {
  var list = smartList_(raw);
  for (var i = 0; i < list.length; i++) {
    var v = String(list[i] || '').trim();
    if (!v) continue;
    if (v.indexOf('@') !== -1 && /@[^@\s]+\.[a-z]{2,}$/i.test(v)) return true;
    if (v.replace(/\D/g, '').length >= 10) return true;
    if (smartToKeyword_(v)) return true;
  }
  return false;
}

// WHAT EACH KEYWORD RESOLVES TO TODAY — the count, and why it is that count.
function smartToKeywordAudiences_(opts) {
  var wanted = (opts && opts.wanted) || null;   // null = every keyword
  var fresh = !!(opts && opts.fresh);
  var cache = null, held = null;
  try {
    cache = CacheService.getScriptCache();
    if (!fresh) {
      var hit = cache.get(SMART_KEYWORD_COUNT_KEY);
      if (hit) held = JSON.parse(hit);
    }
  } catch (eC) { cache = null; held = null; }

  var out = {}, computed = 0;
  Object.keys(SMART_TO_KEYWORDS).forEach(function (k) {
    var def = SMART_TO_KEYWORDS[k];
    if (held && held[k]) { out[k] = held[k]; return; }
    if (wanted && wanted[k] !== true) {
      // NOBODY NAMES IT, SO NOBODY PAYS FOR IT.
      out[k] = { label: String(def.label || ''), count: null, readable: false, pending: true,
                 at: '', why: 'no situation names this keyword, so it was not resolved',
                 missing: '' };
      return;
    }
    var row = { label: String(def.label || ''), count: 0, readable: false, pending: false,
                at: new Date().toISOString(), why: '', missing: '' };
    try {
      var got = def.resolve({});
      // READABLE IS THE QUESTION, NOT `ok`.
      row.readable = (got && got.readable !== undefined) ? !!got.readable : !!(got && got.ok);
      row.count = row.readable ? ((got && got.people) ? got.people.length : 0) : null;
      row.why = String((got && got.why) || '');
      row.missing = String((got && got.missing) || '');
    } catch (e) {
      // UNREADABLE IS NOT EMPTY.
      row.count = null;
      row.why = 'the audience could not be resolved: ' + String((e && e.message) || e);
    }
    computed++;
    out[k] = row;
  });
  // ONLY A RESOLVED ROW IS WORTH HOLDING.
  if (computed && cache) {
    var keep = {};
    Object.keys(out).forEach(function (k) { if (!out[k].pending) keep[k] = out[k]; });
    try { cache.put(SMART_KEYWORD_COUNT_KEY, JSON.stringify(keep), SMART_KEYWORD_COUNT_TTL); }
    catch (eP) { /* the next visit resolves again */ }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────── WORDS NOBODY WROTE ARE NOT WORDS, AND…

// Does the CODE's own seed spell this field blank for this id?
function smartSeedSpellsBlank_(id, field) {
  var want = String(id || '');
  if (!want) return false;
  for (var i = 0; i < SMART_EXTRA_SITUATIONS_SEED.length; i++) {
    var e = SMART_EXTRA_SITUATIONS_SEED[i];
    if (String(e.id) !== want) continue;
    return Object.prototype.hasOwnProperty.call(e, field) &&
           String(e[field] == null ? '' : e[field]).trim() === '';
  }
  return false;
}

// Said once per execution per row and field: a refusal that leaves no trace is the shape of failure this whole lane…
var SMART_DRIFT_SAID = {};

// THE WORDINGS THE GENERIC MAPPER HAS ACTUALLY PRODUCED.
var SMART_GENERIC_SEEN_PROP = 'SMART_GENERIC_SEEN';
var SMART_GENERIC_SEEN_MAX = 9;
var SMART_GENERIC_SEEN_MEMO = null;

function smartGenericSeen_() {
  if (SMART_GENERIC_SEEN_MEMO) return SMART_GENERIC_SEEN_MEMO;
  var held = [];
  try {
    var raw = (typeof hubProp_ === 'function') ? hubProp_(SMART_GENERIC_SEEN_PROP) : '';
    var got = raw ? JSON.parse(raw) : [];
    if (Object.prototype.toString.call(got) === '[object Array]') {
      held = got.map(function (x) { return String(x == null ? '' : x); }).filter(String);
    }
  } catch (e) { held = []; }          // unreadable: the pair below still stands
  SMART_GENERIC_SEEN_MEMO = held;
  return held;
}

// Remember a wording the book answered with.
function smartGenericRemember_(texts) {
  var seedTexts = [];
  for (var k in SMART_GENERIC_SEED) {
    if (Object.prototype.hasOwnProperty.call(SMART_GENERIC_SEED, k)) {
      seedTexts.push(String(SMART_GENERIC_SEED[k] || '').trim());
    }
  }
  var held = smartGenericSeen_();
  var add = [];
  (texts || []).forEach(function (t) {
    var v = String(t == null ? '' : t).trim();
    if (!v || seedTexts.indexOf(v) !== -1) return;
    if (held.indexOf(v) === -1 && add.indexOf(v) === -1) add.push(v);
  });
  if (!add.length) return held;
  var next = held.concat(add);
  if (next.length > SMART_GENERIC_SEEN_MAX) next = next.slice(next.length - SMART_GENERIC_SEEN_MAX);
  SMART_GENERIC_SEEN_MEMO = next;
  try {
    if (typeof hubPropSet_ === 'function') hubPropSet_(SMART_GENERIC_SEEN_PROP, JSON.stringify(next));
  } catch (eW) { /* a memory that could not be written is the old narrowness, no worse */ }
  return next;
}

// Every text the generic mapper can produce: the letter as the book has it today, as the code ships it, and as this…
function smartGenericTexts_() {
  var out = [];
  var push = function (v) {
    var s = String(v == null ? '' : v).trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  };
  var live = {};
  try { live = smartGeneric_() || {}; } catch (eG) { live = {}; }
  ['sms_text', 'email_subject', 'email_text'].forEach(function (f) {
    push(live[f]);
    push((SMART_GENERIC_SEED || {})[f]);
  });
  smartGenericSeen_().forEach(push);
  return out;
}

// Whitespace collapsed and case folded — a re-wrapped paragraph is the same planted letter, and a sentence somebody…
function smartFoldWords_(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().toLowerCase();
}

// IS THIS CELL A LETTER THE CODE PLANTED AND NOBODY WROTE?
function smartUnwrittenWords_(situation, field) {
  var value = String((situation && situation[field]) || '').trim();
  if (!value) return false;
  var id = String((situation && situation.id) || '');
  if (!smartSeedSpellsBlank_(id, field)) return false;
  var planted = smartGenericTexts_();
  var want = smartFoldWords_(value);
  for (var i = 0; i < planted.length; i++) {
    if (!planted[i] || smartFoldWords_(planted[i]) !== want) continue;
    var key = id + '.' + field;
    if (!SMART_DRIFT_SAID[key]) {
      SMART_DRIFT_SAID[key] = true;
      try {
        hubSysLog_('asa-hub:smartcomms', 'smart_words_unwritten',
                   key + ' holds the generic credential letter, which nobody wrote for this ' +
                   'situation — the send door refused that channel. Write the words in the Desk ' +
                   'or blank the cell.', { status: 200 });
      } catch (eL) { /* the attempt row carries the refusal too */ }
    }
    return true;
  }
  return false;
}

// Which keywords are actually written into a `to` cell — the set the Desk needs a count for, and nothing else.
function smartKeywordsInUse_(rows) {
  var wanted = {};
  (rows || []).forEach(function (s) {
    smartList_(s && s.to).forEach(function (entry) {
      var k = smartToKeyword_(entry);
      if (k) wanted[k] = true;
    });
  });
  return wanted;
}

// WHY NOTHING HERE REPAIRS A DEAD `to`, AND WHY THAT IS THE DECISION.

// Fill a blank structural cell from the seed.
function smartFillBlankStructure_(sheet) {
  // AT MOST FOUR SCANS A DAY, not one per read.
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    if (cache.get(SMART_STRUCTURE_KEY)) return { filled: 0, rows: 0, skipped: 'checked recently' };
  } catch (eK) { cache = null; }

  var last = sheet.getLastRow();
  if (last < 2) return { filled: 0, rows: 0 };
  var seedById = {};
  smartDefaults_().concat(smartAiRequests_()).forEach(function (d) { seedById[d.id] = d; });

  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var col = {};
  values[0].forEach(function (h, i) { var n = String(h).trim(); if (n) col[n] = i; });

  var filled = 0, touched = 0;
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][0] || '').trim();
    var seed = id ? seedById[id] : null;
    if (!seed) continue;                       // a row invented in the tab stands
    var row = values[r], changed = 0;
    for (var s = 0; s < SMART_STRUCTURE_COLS.length; s++) {
      // AN AUDIENCE IS NEVER FILLED IN BY THIS LOOP, and it is refused here as well as left out of the list above…
      if (SMART_AUDIENCE_COLS.indexOf(SMART_STRUCTURE_COLS[s]) !== -1) continue;
      var c = col[SMART_STRUCTURE_COLS[s]];
      if (c === undefined) continue;           // column not named on this install
      var now = String(row[c] == null ? '' : row[c]).trim();
      var want = String(seed[SMART_STRUCTURE_COLS[s]] == null
                        ? '' : seed[SMART_STRUCTURE_COLS[s]]).trim();
      if (now !== '' || want === '') continue; // typed, or the seed is blank too
      row[c] = want;
      changed++;
    }
    // ONE WRITE PER REPAIRED ROW, never one per cell: the first pass had 324 blanks to fill and 324 setValue calls…
    if (changed) {
      sheet.getRange(r + 1, 1, 1, SMART_HEADER.length).setValues([row]);
      filled += changed;
      touched++;
    }
  }
  try { if (cache) cache.put(SMART_STRUCTURE_KEY, '1', 21600); } catch (eP) { /* scans again */ }
  if (filled) {
    try { smartCacheBust_(); } catch (eC) { /* the 300s TTL rebuilds */ }
    hubSysLog_('asa-hub:smartcomms', 'seed_structure_filled',
               filled + ' blank structural cell(s) on ' + touched + ' row(s) took the seed value',
               { status: 200 });
  }
  return { filled: filled, rows: touched };
}

// How recently the one-time carry was checked.
/**
 * ONE-TIME MIGRATION: carry the one global AI request onto the default row.
 *
 * Idempotent and blank-only: it writes `ai_default` ONLY while that row is
 * still untouched (no model, still off), and only from an `ai_phone_screen`
 * that actually carries something. A default somebody has since set by hand
 * is never overwritten, and running it twice changes nothing.
 */
var SMART_AI_DEFAULT_CHECK_KEY = 'smart_ai_default_checked';
var SMART_AI_DEFAULT_CHECK_EVERY_S = 21600;

function smartMigrateAiDefault_(sheet) {
  // THE ONE MIGRATION IN THIS BLOCK WITH NO GATE.
  try {
    var gateCache = CacheService.getScriptCache();
    if (gateCache.get(SMART_AI_DEFAULT_CHECK_KEY)) return;
    gateCache.put(SMART_AI_DEFAULT_CHECK_KEY, '1', SMART_AI_DEFAULT_CHECK_EVERY_S);
  } catch (eG) { /* an unreadable cache migrates, never skips */ }
  var last = sheet.getLastRow();
  if (last < 2) return;
  var values = sheet.getRange(2, 1, last - 1, SMART_HEADER.length).getValues();
  var col = {};
  for (var h = 0; h < SMART_HEADER.length; h++) col[SMART_HEADER[h]] = h;
  var defAt = -1, from = null;
  for (var r = 0; r < values.length; r++) {
    var id = String(values[r][col.id] || '').trim();
    if (id === SMART_AI_DEFAULT_ID) defAt = r;
    else if (id === 'ai_phone_screen') from = values[r];
  }
  if (defAt === -1 || !from) return;
  var already = String(values[defAt][col.ai_model] || '').trim();
  var alreadyOn = smartOn_(values[defAt][col.enabled]);
  if (already || alreadyOn) return;              // a word typed in the tab stands
  var model = String(from[col.ai_model] || '').trim();
  if (!model) return;                            // nothing live to carry
  var row = defAt + 2;
  sheet.getRange(row, col.ai_model + 1).setValue(model);
  sheet.getRange(row, col.ai_providers + 1).setValue(String(from[col.ai_providers] || ''));
  sheet.getRange(row, col.enabled + 1).setValue(String(from[col.enabled] || 'no'));
  try { smartCacheBust_(); } catch (eC) { /* 300s TTL */ }
  hubSysLog_('asa-hub:smartcomms', 'ai_default_seeded_from_phone_screen',
             'carried "' + model + '" onto ' + SMART_AI_DEFAULT_ID, { status: 200 });
}

// ONE-TIME MIGRATION: the Hiring messages screen's texts move into their Smart Comms situation rows.
var SMART_HIRING_MIGRATED_KEY = 'hiring_messages_migrated';

// situation id → which config key feeds which cell.
var SMART_HIRING_MIGRATION = [
  { id: 'hiring_date_accepted',
    cells: { sms_text: 'msg_date_accepted', email_text: 'msg_date_accepted' } },
  { id: 'hiring_hired_complete',
    cells: { sms_text: 'msg_hired_complete', email_text: 'msg_hired_complete' } },
  { id: 'hiring_hired_missing',
    cells: { sms_text: 'msg_hired_missing', email_text: 'msg_hired_missing' } },
  { id: 'hiring_packet_request',
    cells: { sms_text: 'msg_packet_request_sms',
             email_subject: 'msg_packet_request_email_subject',
             email_text: 'msg_packet_request_email' } },
  // No config key ever existed for this one — the words were literals in hubBecomingStaffSweep_.
  { id: 'hiring_ready_to_start', cells: {} }
];

function smartMigrateHiringMessages_(sheet) {
  var cfg = {};
  try { cfg = hiringAlerts_(); } catch (e) { cfg = {}; }
  if (str_(cfg[SMART_HIRING_MIGRATED_KEY]).toLowerCase() === 'yes') return { done: false, reason: 'already' };

  var last = sheet.getLastRow();
  if (last < 2) return { done: false, reason: 'no rows' };
  var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h) col[h] = i; });
  var rowById = {};
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][0] || '').trim();
    if (id && rowById[id] === undefined) rowById[id] = r;
  }
  var seedById = {};
  SMART_HIRING_EVENTS.forEach(function (e) { seedById[e.id] = e; });

  var copied = 0, armed = 0;
  SMART_HIRING_MIGRATION.forEach(function (m) {
    var r = rowById[m.id];
    var seed = seedById[m.id];
    if (r === undefined || !seed) return;      // the seed pass above creates it; next touch migrates
    for (var cell in m.cells) {
      if (!m.cells.hasOwnProperty(cell) || col[cell] === undefined) continue;
      var now = String(values[r][col[cell]] == null ? '' : values[r][col[cell]]);
      var operators = str_(cfg[m.cells[cell]]);
      // Only a cell still at the shipped default (or blank) takes the copy — and only when the config text really…
      if (!operators || operators === String(seed[cell] || '')) continue;
      if (now !== '' && now !== String(seed[cell] || '')) continue;
      sheet.getRange(r + 1, col[cell] + 1).setValue(operators);
      copied++;
    }
    // The switch: these four fired unconditionally before the move, so ON is the state being carried, not a choice…
    if (col.enabled !== undefined &&
        String(values[r][col.enabled] || '').trim().toLowerCase() === 'no') {
      sheet.getRange(r + 1, col.enabled + 1).setValue('yes');
      armed++;
    }
  });

  // The marker rides the config tab, so the run is once per installation.
  try {
    var aSheet = hiringAlertsSheet_();
    var aVals = aSheet.getDataRange().getValues();
    var found = false;
    for (var a = 1; a < aVals.length; a++) {
      if (String(aVals[a][0]).trim() === SMART_HIRING_MIGRATED_KEY) {
        aSheet.getRange(a + 1, 2).setValue('yes');
        found = true;
        break;
      }
    }
    if (!found) {
      aSheet.appendRow([SMART_HIRING_MIGRATED_KEY, 'yes',
        'The Hiring messages texts moved to Smart Comms situation rows on 2026-08-17. ' +
        'Set by smartMigrateHiringMessages_; do not edit.']);
    }
    hiringAlertsBump_();   // memo + the 60s entry, both
  } catch (eMk) {
    // No marker means it runs again — and the default/blank guard above makes a second pass write nothing, so the…
  }
  try { smartCacheBust_(); } catch (eS) { /* rebuilt */ }
  hubSysLog_('asa-hub:smartcomms', 'hiring_messages_migrated',
             copied + ' text(s) carried over, ' + armed + ' situation(s) switched on',
             { status: 200 });
  return { done: true, copied: copied, armed: armed };
}

// THE SITUATIONS, READ ONCE PER EXECUTION.
var SMART_SITUATIONS_MEMO = null;
var SMART_SITUATIONS_CHUNK = 30000;      // characters; three bytes each at most, inside 100 KB
var SMART_SITUATIONS_MAX_CHUNKS = 24;

function smartSituationsCopy_(list) {
  return (list || []).map(function (r) {
    var c = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
    return c;
  });
}

/** The cached list's text, or '' — chunks behind a head that names their count. */
function smartSituationsCacheGet_(cache) {
  var base = smartCacheKey_();
  var head = cache.get(base + ':n');
  var n = parseInt(head, 10);
  if (!head || !isFinite(n) || n < 1 || n > SMART_SITUATIONS_MAX_CHUNKS) return '';
  var text = '';
  for (var i = 0; i < n; i++) {
    var part = cache.get(base + ':' + i);
    if (part === null || part === undefined) return '';
    text += part;
  }
  return text;
}

/** Writes the chunks first and the head last, so a reader never finds a head without its parts. */
function smartSituationsCachePut_(cache, text) {
  var base = smartCacheKey_();
  var n = Math.ceil(text.length / SMART_SITUATIONS_CHUNK);
  if (n < 1 || n > SMART_SITUATIONS_MAX_CHUNKS) return false;
  for (var i = 0; i < n; i++) {
    cache.put(base + ':' + i, text.substr(i * SMART_SITUATIONS_CHUNK, SMART_SITUATIONS_CHUNK), 300);
  }
  cache.put(base + ':n', String(n), 300);
  return true;
}

function smartSituations_() {
  if (SMART_SITUATIONS_MEMO) return smartSituationsCopy_(SMART_SITUATIONS_MEMO);
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = smartSituationsCacheGet_(cache);
    if (hit) {
      var parsed = JSON.parse(hit);
      if (Array.isArray(parsed)) {
        SMART_SITUATIONS_MEMO = parsed;
        return smartSituationsCopy_(parsed);
      }
    }
  } catch (e) { cache = null; }
  var sheet = smartSheet_();
  var last = sheet.getLastRow();
  var out = [];
  if (last > 1) {
    var values = sheet.getRange(1, 1, last, SMART_HEADER.length).getValues();
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    for (var r = 1; r < values.length; r++) {
      var row = {};
      for (var c = 0; c < hdr.length; c++) if (hdr[c]) row[hdr[c]] = String(values[r][c] == null ? '' : values[r][c]);
      if (row.id) out.push(row);
    }
  }
  SMART_SITUATIONS_MEMO = out;
  try { if (cache) smartSituationsCachePut_(cache, JSON.stringify(out)); } catch (e2) { /* uncached */ }
  return smartSituationsCopy_(out);
}

// The situation row by id, or null when absent or OFF — fail closed, seed law (the hiring_event_scheduled grammar…
function smartSituationOn_(id) {
  var sit = null;
  try {
    smartSituations_().forEach(function (s) { if (str_(s.id) === id) sit = s; });
  } catch (e) { sit = null; }
  if (!sit || !smartOn_(sit.enabled)) return null;
  return sit;
}

// THE AI REQUEST, AS CONFIGURATION.
function smartAiRequest_(id) {
  var sit = null;
  try {
    smartSituations_().forEach(function (x) {
      if (str_(x.id) === String(id) &&
          String(x.kind || '').trim().toLowerCase() === 'ai') sit = x;
    });
  } catch (e) { return null; }
  if (!sit || !smartOn_(sit.enabled)) return null;
  return {
    id: str_(sit.id),
    model: str_(sit.ai_model),
    providers: smartList_(sit.ai_providers)
  };
}

/** A cell holding a list: split on comma, semicolon, pipe or newline. */
function smartList_(raw) {
  return String(raw || '').split(/[,;|\n]+/).map(function (s) { return s.trim(); }).filter(String);
}

/** Is this switch cell on? Anything but yes/true/on/1 is OFF. */
function smartOn_(v) {
  var s = String(v || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === 'on' || s === '1';
}

// THE SLOT A MESSAGE MAY CARRY A LEAD LINE IN — a key no template can name, because substitution below matches…
var SMART_LEAD_KEY = '@lead';

// {placeholder} substitution.
function smartRender_(tpl, vars) {
  var v = vars || {};
  var out = String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) {
    return v[k] !== undefined && v[k] !== '' ? String(v[k]) : m;
  });
  var lead = v[SMART_LEAD_KEY];
  if (!lead || !tpl) return out;
  var t = String(tpl);
  if (t === String(lead.subject_tpl || '')) return out;      // a subject is not a body
  var line = '';
  if (t === String(lead.sms_tpl || '')) line = String(lead.line_sms || '');
  else if (t === String(lead.email_tpl || '')) line = String(lead.line_email || '');
  if (!line || !out) return out;
  lead.used = (t === String(lead.sms_tpl || '')) ? 'sms' : 'email';
  return line + '\n\n' + out;
}

/** A date straight off the estate Master, by header label — certPicture_ only knows the mapped certifications. */
function smartRawColumn_(row, label) {
  if (!row || !label) return '';
  var want = (typeof estateKey_ === 'function') ? estateKey_(label) : String(label).toLowerCase();
  if (row[want]) return String(row[want]);
  // Tolerate the label being given already normalised.
  var k = String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return row[k] ? String(row[k]) : '';
}

// What a message calls this thing.
function smartCredentialLabel_(s) {
  var key = String(s.credential || '').trim();
  if (str_(s.label)) return str_(s.label);
  if (typeof certLabels_ === 'function' && certLabels_()[key]) return certLabels_()[key];
  return key.replace(/_/g, ' ').replace(/\s+exp(iration)?\s*date$/i, '').trim();
}

/* ---- The ledger: who has already been told, and about which expiry ---- */

// THE KEY IS THE EXPIRY, NOT THE DAY — and, on a row that keeps hours, the hour as well (`…|@`).
function smartLedgerKey_(situationId, nameKey, expiresIso, slot) {
  return situationId + '|' + nameKey + '|' + String(expiresIso || '').slice(0, 10) +
         (slot ? '@' + slot : '');
}

/** The ledger tab, created on first touch. */
function smartLedgerSheet_() {
  return hubTabEnsure_(SMART_LEDGER_TAB,
                       ['key', 'situation', 'person', 'expires', 'channel', 'at']);
}

/** Every ledger key already written, as a set. */
function smartAlreadySent_() {
  var sheet = smartLedgerSheet_();
  var last = sheet.getLastRow();
  var seen = {};
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var k = String(r[0] || '').trim();
      if (k) seen[k] = true;
    });
  }
  return seen;
}

// The ledger as the pacing gate needs it: the key set smartAlreadySent_ has always been, PLUS per-key delivery…
function smartLedgerStats_() {
  var sheet = smartLedgerSheet_();
  var last = sheet.getLastRow();
  var stats = { sent: {}, attempts: {} };
  if (last > 1) {
    var values = sheet.getRange(2, 1, last - 1, 6).getValues();
    values.forEach(function (r) {
      var k = String(r[0] || '').trim();
      if (!k) return;
      stats.sent[k] = true;
      if (String(r[4] || '').toLowerCase() === 'rehearsal') return;
      var at = new Date(String(r[5] || '')).getTime();
      if (isNaN(at)) at = 0;
      var cur = stats.attempts[k];
      if (!cur) { stats.attempts[k] = { count: 1, lastAtMs: at }; }
      else {
        cur.count++;
        if (at > cur.lastAtMs) cur.lastAtMs = at;
      }
    });
  }
  return stats;
}

// MAY THIS KEY BE TOLD NOW?
function smartAttemptsAllow_(attempts, situation, nameKey, expiresIso, nowMs, slot) {
  var base = smartLedgerKey_(String(situation.id), String(nameKey), expiresIso);
  var maxA = parseInt(situation.max_attempts, 10);
  if (isNaN(maxA) || maxA < 1) maxA = 1;           // blank/bad = the old law: once
  var days = SMART_FREQUENCIES[String(situation.frequency || 'once').trim().toLowerCase()];
  if (days === undefined) days = 0;                // unknown word = once, fail closed

  // THE ROW KEEPS HOURS.
  if (slot) {
    if (attempts[smartLedgerKey_(String(situation.id), String(nameKey), expiresIso, slot)]) {
      return false;                                // this hour has already spoken
    }
    var today = String(slot).slice(0, 10);
    var daysTold = {}, lastMs = 0;
    for (var k2 in attempts) {
      if (!attempts.hasOwnProperty(k2)) continue;
      if (k2.indexOf(base + '@') !== 0) continue;
      daysTold[k2.slice(base.length + 1, base.length + 11)] = true;
      if (attempts[k2].lastAtMs > lastMs) lastMs = attempts[k2].lastAtMs;
    }
    // WHAT THE ROW SAID BEFORE IT KEPT HOURS IS STILL WHAT IT SAID.
    var slotless = attempts[base];
    var undated = (slotless && slotless.count) ? slotless.count : 0;
    if (slotless && slotless.lastAtMs > lastMs) lastMs = slotless.lastAtMs;
    // Another hour of a day this row already spoke on: the same occasion.
    if (daysTold[today]) return true;
    var told = Object.keys(daysTold).length + undated;
    if (!told) return true;
    if (told >= maxA) return false;
    if (days === 0) return false;                  // 'once' — one day, ever
    // THE WAIT IS COUNTED IN DAYS, BECAUSE THE OCCASION IS A DAY.
    var newest = '';
    for (var d in daysTold) {
      if (!daysTold.hasOwnProperty(d)) continue;
      if (d > newest) newest = d;                  // yyyy-MM-dd sorts as the date it is
    }
    var newestMs = newest ? certDateMs_(newest) : null, todayMs = certDateMs_(today);
    // AND WHEN THERE IS NO NAMED DAY TO COUNT FROM, THE STAMPS STILL HOLD IT.
    if (newestMs === null || todayMs === null) {
      return (nowMs - lastMs) >= days * 86400000;
    }
    return Math.round((todayMs - newestMs) / 86400000) >= days;
  }

  // AND THE SAME WALK IN THE OTHER DIRECTION.
  var st = attempts[base];
  var told2 = (st && st.count) ? st.count : 0;
  var lastAt = st ? st.lastAtMs : 0;
  var hourDays = {};
  for (var k3 in attempts) {
    if (!attempts.hasOwnProperty(k3)) continue;
    if (k3.indexOf(base + '@') !== 0) continue;
    hourDays[k3.slice(base.length + 1, base.length + 11)] = true;
    if (attempts[k3].lastAtMs > lastAt) lastAt = attempts[k3].lastAtMs;
  }
  told2 += Object.keys(hourDays).length;
  if (!told2) return true;
  if (told2 >= maxA) return false;
  if (days === 0) return false;                    // 'once' — one telling, ever
  return (nowMs - lastAt) >= days * 86400000;
}

/** THE REHEARSAL HAS A MEMORY OF ITS OWN. */
function smartRehearsalKey_(key) { return 'REHEARSAL|' + key; }

/** Test mode on? The transport is the authority, not a copy of the cell. */
function smartRehearsing_() {
  try { return !!(typeof hubTestRedirect_ === 'function' && hubTestRedirect_()); }
  catch (e) { return false; }
}

/** How many messages one rehearsal pass may send. */
var SMART_REHEARSAL_CAP = 3;

/** Write one send into the ledger. Returns false if the row was lost. */
function smartRecord_(key, situation, person, expires, channel) {
  try {
    smartLedgerSheet_().appendRow([key, situation, person, String(expires || '').slice(0, 10),
                                   channel, new Date().toISOString()]);
    return true;
  } catch (e) {
    // LOUD.
    hubSysLog_('asa-hub:smartcomms', 'smart_ledger_lost',
               key + ' — ' + String((e && e.message) || e), { status: 500 });
    return false;
  }
}

// ONE TEXT, IN THE DESK'S WORDS, TO SOMEBODY ANOTHER APP NAMED.
var SMART_TELL_LEDGERED = {};
function smartTell_(o) {
  var w = o || {};
  var sid = str_(w.situation);
  var out = { situation: sid, state: '', held: '', why: '', receipt: '', unreadable: false };
  var sit = null;
  try { sit = smartSituationOn_(sid); } catch (e) { sit = null; }
  if (!sit) {
    var read = (typeof hubSituationRead_ === 'function') ? hubSituationRead_(sid) : null;
    out.state = 'off';
    out.unreadable = !!(read && (read.unreadable || read.on));
    out.why = out.unreadable
      ? 'the situations tab could not be read, so whether `' + sid + '` is on cannot be told — nothing was sent'
      : 'the situation `' + sid + '` is off or absent on the Desk — nothing was sent';
    return out;
  }
  if (smartList_(sit.channels).indexOf('sms') === -1 || !str_(sit.sms_text) || smartUnwrittenWords_(sit, 'sms_text')) {
    out.state = 'off'; out.why = 'the situation `' + sid + '` names no SMS words — nothing was sent'; return out;
  }
  var to = packetSendableNumber_(w.to);
  if (!to) { out.state = 'no_phone'; out.why = 'no number this platform may text'; return out; }
  if (hubQuietAt_(w.at_ms ? new Date(Number(w.at_ms)) : null)) {
    out.state = 'held'; out.held = 'quiet';
    out.why = 'inside the quiet window (' + hubQuietWords_() + ') — owed at ' + HUB_QUIET_TO;
    return out;
  }
  var v = {};
  for (var k in (w.vars || {})) if (Object.prototype.hasOwnProperty.call(w.vars, k)) v[k] = w.vars[k];
  if (!v.sender) v.sender = str_(sit.sender) || SMART_SENDER_DEFAULT;
  var body = smartRender_(sit.sms_text, v);
  if (w.prune) body = smartPruneUnfilled_(body);
  if (!str_(body)) { out.state = 'off'; out.why = 'the words rendered empty — nothing was sent'; return out; }
  var key = str_(w.key), lane = str_(w.lane) || 'smart comms';
  var heldR = (typeof HUB_REHEARSAL_CTX !== 'undefined') ? HUB_REHEARSAL_CTX : null;
  var heldM = (typeof COMM_MOCK_CTX !== 'undefined') ? COMM_MOCK_CTX : null;
  var r;
  try {
    HUB_REHEARSAL_CTX = { pass_by: 'asa-hub:' + lane, situation: sid, intent_key: key, person_key: str_(w.person_key),
                          person_name: str_(w.person), purpose: lane, sender_used: v.sender };
    COMM_MOCK_CTX = { situation: sid, person_name: str_(w.person), ledger_key: key, purpose: lane };
    r = rpcCall_('smsSend', { to: to, body: body, reason: lane + ': ' + sid }, { idempotency_key: key }) || {};
  } catch (eS) {
    r = { ok: false, error: 'transport', detail: String((eS && eS.message) || eS) };
  } finally { HUB_REHEARSAL_CTX = heldR; COMM_MOCK_CTX = heldM; }
  out.receipt = str_(r.receipt);
  var ledger = function (rehearsal) {
    var lk = str_(w.ledger_key) || key;
    if (!lk) return;
    if (rehearsal) lk = smartRehearsalKey_(lk);
    if (SMART_TELL_LEDGERED[lk]) return;
    SMART_TELL_LEDGERED[lk] = true;
    smartRecord_(lk, sid, str_(w.ledger_person) || str_(w.person), str_(w.occasion), rehearsal ? 'rehearsal' : 'sms');
  };
  if (r.quiet) { out.state = 'held'; out.held = 'quiet'; out.why = str_(r.detail) || 'inside the quiet window'; }
  else if (r.rehearsed) { out.state = 'held'; out.held = 'test_mode'; out.why = 'test mode: written to the rehearsal book and the mock outbox — nobody contacted'; }
  else if (r.recorded_to) { out.state = 'held'; out.held = 'recorded'; out.why = 'written into ' + str_(r.recorded_to) + ' — nobody contacted'; }
  else if (r.deduplicated) { out.state = 'already'; out.why = 'this exact text was already asked for'; }
  else if (r.redirected) { out.state = 'held'; out.held = 'redirected'; out.why = str_(r.detail) || 'test mode sent it to the testers'; ledger(true); }
  else if (r.ok && r.sent) { out.state = 'sent'; ledger(false); }
  else if (str_(r.reason) === 'opted_out') { out.state = 'refused'; out.why = str_(r.detail) || 'opted out'; }
  else if (r.ok === false) { out.state = 'failed'; out.why = str_(r.error) + (r.detail ? ': ' + str_(r.detail) : ''); }
  else { out.state = 'held'; out.held = str_(r.reason) || 'gated'; out.why = str_(r.detail); }
  return out;
}

/** Drops each sentence still holding a {placeholder} after rendering, never a gap. */
function smartPruneUnfilled_(text) {
  return String(text || '').split('\n').map(function (line) {
    if (!/\{\w+\}/.test(line)) return line;
    var parts = line.match(/[^.!?]+[.!?]*\s*/g) || [line];
    return parts.filter(function (p) { return !/\{\w+\}/.test(p); }).join('').trim();
  }).filter(function (l) { return l !== ''; }).join('\n');
}

/* ---- The sweep ---- */

/** Days from now until this date — negative when it has already passed. */
function smartDaysLeft_(ms) {
  return Math.floor((ms - Date.now()) / 86400000);
}

/** Everybody a situation applies to right now, WITHOUT sending anything. */
function smartDue_(opts) {
  opts = opts || {};
  var situations = smartSituations_().filter(function (s) {
    if (!smartOn_(s.enabled)) return false;
    if (opts.only && s.id !== opts.only) return false;
    // A digest is not a per-person reminder; it has its own sweep.
    var k = String(s.kind || 'reminder').trim().toLowerCase();
    // `bundle` is the obligations lane's own species (CommRecord.gs): one message carrying several obligations…
    return k !== 'digest' && k !== 'ai' && k !== 'bundle' && k !== 'window_ask' &&
           k !== 'call_off' && k !== 'shift_clock' && k !== 'letter' && k !== 'gate';
  });
  if (!situations.length) return { situations: 0, due: [] };

  var picture = certPicture_();                 // cached; costs no new read
  // The Master's RAW rows, from the same cache, so a situation can name a column certPicture_ does not map…
  var rawByName = {};
  try {
    var masterName = certSourceField_('master.name');
    certReadTab_(certSourceTab_('master')).forEach(function (r) {
      var k = clientNameKey_(certFieldOf_(r, masterName));
      if (k && !rawByName[k]) rawByName[k] = r;
    });
  } catch (eRaw) { rawByName = {}; }
  var people = withoutIspClients_(peopleMerged_(listRows_('people', {})));
  var stats = opts.skip_ledger ? { sent: {}, attempts: {} } : smartLedgerStats_();
  var sent = stats.sent;
  var attempts = stats.attempts;
  var due = [];

  people.forEach(function (p) {
    var nameKey = clientNameKey_(p.name);
    if (!nameKey) return;
    var known = picture[nameKey] || { certs: {} };
    known.row = rawByName[nameKey] || null;
    if (!known.certs && !known.row) return;
    // A rehearsal card is a rehearsal wherever it appears.
    var rehearsal = (typeof packetIsRehearsal_ === 'function')
      ? packetIsRehearsal_({ candidatename: p.name, phone: p.phone, email: p.email }) : false;

    situations.forEach(function (s) {
      var statuses = smartList_(s.statuses).map(function (x) { return x.toLowerCase(); });
      if (statuses.length) {
        if (statuses.indexOf(smartStatusOf_(known.row, p)) === -1) return;
      }
      // THE SOURCE IS ANY DATE COLUMN, not only a mapped certification: `credential` is tried as a mapped…
      var src = String(s.credential || '').trim();
      var expires = '';
      var cell = known.certs[src];
      if (cell && cell.expires) expires = cell.expires;
      else expires = smartRawColumn_(known.row, src);
      if (!expires) return;
      var ms = certDateMs_(expires);
      if (ms === null) return;
      var left = smartDaysLeft_(ms);
      var before = parseInt(s.days_before, 10);
      if (isNaN(before)) return;
      // `<=` and not `===`: the original compared the date exactly, so a day the sweep did not run was a person…
      if (left > before) return;
      // THE HOUR GATE.
      var sched = smartScheduleNow_(s, Date.now());
      if (sched.holds) return;
      var key = smartLedgerKey_(s.id, nameKey, expires, sched.slot);
      // THE PACING GATE: not "told, ever?" but "told too many times, or too soon?" — max_attempts and frequency are…
      if (!smartAttemptsAllow_(attempts, s, nameKey, expires, Date.now(), sched.slot)) return;
      due.push({
        rehearsed: !!sent[smartRehearsalKey_(key)],
        slot: sched.slot || '', slot_label: sched.label || '',
        situation: s.id, key: key, name: p.name, name_key: nameKey,
        phone: str_(p.phone), email: str_(p.email),
        credential: s.credential, expires: String(expires).slice(0, 10),
        days_left: left, channels: smartList_(s.channels), rehearsal: rehearsal,
        config: s
      });
    });
  });
  return { situations: situations.length, due: due };
}

// Send what is due.
function smartCommsSweep_(opts) {
  opts = opts || {};
  // The relay's clock tells the reminders and the digests now (app/smart_clock.py).
  return { situations: 0, due: 0, sms: 0, email: 0, skipped: 0, recorded_not_sent: [], failed: [], python: true };
  var found = smartDue_(opts);
  var sms = 0, email = 0, skipped = 0, gated = [], failed = [];
  var rehearsing = smartRehearsing_();
  var rehearsedThisPass = 0, capped = 0;

  found.due.forEach(function (d) {
    // Already rehearsed, and still rehearsing: do not send it again.
    if (rehearsing && d.rehearsed) return;
    // And never more than the cap in one rehearsal pass.
    if (rehearsing && rehearsedThisPass >= SMART_REHEARSAL_CAP) { capped++; return; }
    var vars = {
      first_name: String(d.name).split(/\s+/)[0], name: d.name,
      expires: d.expires, days_left: String(d.days_left),
      credential: smartCredentialLabel_(d.config),
      sender: str_(d.config.sender) || SMART_SENDER_DEFAULT
    };
    var reached = false;
    // Which channels REALLY delivered, and whether delivery was to the person or to a tester.
    var delivered = [], redirected = false;

    // `cc` is a real column and it really sends: the CPR reminder read "I'm sending this to you and our CPR…
    var cc = d.rehearsal ? [] : smartList_(d.config.cc);
    var ccPhones = [], ccEmails = [];
    cc.forEach(function (x) {
      if (x.indexOf('@') !== -1) { ccEmails.push(x); return; }
      var n = packetSendableNumber_(x);
      if (n) ccPhones.push(n);
    });

    if (d.channels.indexOf('sms') !== -1) {
      var to = d.rehearsal ? (typeof packetRehearsalNumber_ === 'function' ? packetRehearsalNumber_() : '')
                           : packetSendableNumber_(d.phone);
      if (!to) {
        skipped++;
        hubSysLog_('asa-hub:smartcomms', 'smart_no_number',
                   d.situation + ' — ' + d.name, { status: 200 });
      } else {
        var body = smartRender_(d.config.sms_text, vars);
        if (d.rehearsal) body = '[rehearsal for ' + d.name + '] ' + body;
        var r = rpcCall_('smsSend', { to: to, body: body, reason: 'smart comms: ' + d.situation },
                         { idempotency_key: 'smart_' + d.key });
        if (r.ok && r.sent) {
          sms++; reached = true;
          if (r.redirected) redirected = true; else delivered.push('sms');
        }
        else if (r.ok && r.gated) gated.push(d.situation + ' → ' + d.name);
        else if (!r.ok) failed.push(d.situation + ' → ' + d.name + ': ' + str_(r.error));

        // Each copy is its own message with its own key: one failing must not cost the others, and a retry must not…
        ccPhones.forEach(function (n, i) {
          var cr = rpcCall_('smsSend',
            { to: n, body: body, reason: 'smart comms cc: ' + d.situation },
            { idempotency_key: 'smart_cc' + i + '_' + d.key });
          if (cr.ok && cr.sent) sms++;
          else if (cr.ok && cr.gated) gated.push(d.situation + ' → cc');
          else if (!cr.ok) failed.push(d.situation + ' → cc: ' + str_(cr.error));
        });
      }
    }

    if (d.channels.indexOf('email') !== -1 && str_(d.email)) {
      var er = rpcCall_('emailSend', {
        to: d.rehearsal ? str_(COMMS_OPERATOR_TEST_EMAIL) : str_(d.email),
        subject: smartRender_(d.config.email_subject, vars),
        body: smartRender_(d.config.email_text, vars),
        reason: 'smart comms: ' + d.situation
      }, { idempotency_key: 'smart_mail_' + d.key });
      if (er.ok && er.sent) {
        email++; reached = true;
        if (er.redirected) redirected = true; else delivered.push('email');
      }
      else if (er.ok && er.gated) gated.push(d.situation + ' → ' + d.name + ' (email)');
      else if (!er.ok) failed.push(d.situation + ' → ' + d.name + ' (email): ' + str_(er.error));

      ccEmails.forEach(function (addr, i) {
        var ce = rpcCall_('emailSend', {
          to: addr, subject: smartRender_(d.config.email_subject, vars),
          body: smartRender_(d.config.email_text, vars),
          reason: 'smart comms cc: ' + d.situation
        }, { idempotency_key: 'smart_mailcc' + i + '_' + d.key });
        if (ce.ok && ce.sent) email++;
        else if (ce.ok && ce.gated) gated.push(d.situation + ' → cc (email)');
        else if (!ce.ok) failed.push(d.situation + ' → cc (email): ' + str_(ce.error));
      });
    }

    // THE LEDGER RECORDS WHAT REALLY WENT OUT, and nothing else.
    if (reached && !redirected) {
      smartRecord_(d.key, d.situation, d.name, d.expires, delivered.join('+') || 'sms');
    } else if (redirected) {
      // THE REHEARSAL IS REMEMBERED, THE TELLING IS NOT.
      smartRecord_(smartRehearsalKey_(d.key), d.situation, d.name, d.expires, 'rehearsal');
      rehearsedThisPass++;
      hubSysLog_('asa-hub:smartcomms', 'smart_test_only',
                 d.situation + ' → ' + d.name + ': reached the TESTERS, so the ledger ' +
                 'was NOT written — this person has not been told', { status: 200 });
    }
  });

  if (capped) {
    // NO SILENT CAP here either.
    hubSysLog_('asa-hub:smartcomms', 'smart_rehearsal_capped',
               capped + ' more reminder(s) would have been rehearsed this pass', { status: 200 });
  }

  var digests = null;
  try { digests = smartDigestSweep_(opts); } catch (eD) {
    hubSysLog_('asa-hub:smartcomms', 'smart_digest_error', String((eD && eD.message) || eD), { status: 500 });
  }

  // The requirement states are rebuilt by Python on the relay's clock (app/compliance_engine_writes.py).
  var states = null;

  return { situations: found.situations, due: found.due.length,
           sms: sms, email: email, skipped: skipped,
           recorded_not_sent: gated, failed: failed, digests: digests,
           states: states };
}

/** THE EVENT SWEEP — the hiring funnel's escalations, as configuration. */
function smartEventSweep_(opts) {
  opts = opts || {};
  // The relay's clock tells the events now (app/smart_clock.py); only a dry run is still answered here.
  if (!opts['dry_run']) return { situations: 0, sent: 0, skipped: 0, would: [], python: true };
  var sits = smartSituations_().filter(function (s) {
    return String(s.kind || '').toLowerCase() === 'event' &&
           smartOn_(s.enabled) && SMART_EVENTS[String(s.event || '').trim()];
  });
  if (!sits.length) return { situations: 0, sent: 0, skipped: 0, would: [] };

  /** The rows an event's `subject` is about. */
  var cands = null;
  function subjectRows(def) {
    if (String(def.subject || 'candidate') === 'sync') {
      try { return (typeof truelinkRunSubjects_ === 'function') ? truelinkRunSubjects_() : []; }
      catch (eS) { return []; }
    }
    // A RECON RUN — rows, not people, same shape as `sync`.
    if (String(def.subject || 'candidate') === 'recon') {
      try { return (typeof reconSmartSubjects_ === 'function') ? reconSmartSubjects_() : []; }
      catch (eR) { return []; }
    }
    // THE PSI ANYWHERE ANSWERS — NO ROWS, AND THE EMPTINESS IS THE POINT.
    if (String(def.subject || 'candidate') === 'psi') return [];
    // AN INCIDENT — no rows here either, and for the same reason: CommIncident.gs pages as the rows land, from…
    if (String(def.subject || 'candidate') === 'incident') return [];
    /* sent by their own lanes; named so they never fall through to the candidates */
    if (String(def.subject || 'candidate') === 'broadcast') return [];
    if (String(def.subject || 'candidate') === 'open_shift') return [];
    if (String(def.subject || 'candidate') === 'recruit_book') return [];
    // A HOTLINE CALL-OFF — queued rows, one per call, two-day window.
    if (String(def.subject || 'candidate') === 'hotline') {
      try { return (typeof hotlineSmartSubjects_ === 'function') ? hotlineSmartSubjects_() : []; }
      catch (eH) { return []; }
    }
    // A TRIP HOME WITHOUT ITS OUTCOME — Travel.gs's own subjects, wired at last.
    if (String(def.subject || 'candidate') === 'travel') {
      try { return (typeof travelSmartSubjects_ === 'function') ? travelSmartSubjects_() : []; }
      catch (eTr) { return []; }
    }
    // A SHOPPER OWNER WITH RIPE ITEMS — Shopper.gs's own subjects, same story.
    if (String(def.subject || 'candidate') === 'shopperOwners') {
      try { return (typeof shopSmartSubjects_ === 'function') ? shopSmartSubjects_() : []; }
      catch (eSh) { return []; }
    }
    if (String(def.subject || 'candidate') === 'client') {
      try { return (typeof finSmartSubjects_ === 'function') ? finSmartSubjects_() : []; }
      catch (eC) { return []; }
    }
    // A FINISHED ONBOARDING VISIT — rows, not people.
    if (String(def.subject || 'candidate') === 'onboarding') {
      try { return (typeof obReportSubjects_ === 'function') ? obReportSubjects_() : []; }
      catch (eO) { return []; }
    }
    // THE GUARDIAN — the environment's own row (Guardian.gs).
    if (String(def.subject || 'candidate') === 'guardian') {
      try { return (typeof guardianSmartSubjects_ === 'function') ? guardianSmartSubjects_() : []; }
      catch (eG) { return []; }
    }
    // STAFF: the first subject the event lane reaches directly rather than escalating about (see `to_subject`).
    if (String(def.subject || 'candidate') === 'staff') {
      // The IST notices (ist_due) are raised by Python from the records it holds (app/ist_writes.py).
      var staffRows = [];
      try {
        if (typeof reconReminderSubjects_ === 'function') staffRows = reconReminderSubjects_();
      } catch (eR) { staffRows = []; }
      return staffRows;
    }
    if (cands === null) {
      try {
        cands = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
      } catch (e) {
        hubSysLog_('asa-hub:smartcomms', 'smart_event_unreadable', String((e && e.message) || e), { status: 500 });
        cands = [];
      }
    }
    return cands;
  }

  var stats = smartLedgerStats_();
  var sent = stats.sent;
  var attempts = stats.attempts;
  var rehearsing = smartRehearsing_();
  var rehearsedThisPass = 0, capped = 0;
  var out = { situations: sits.length, sent: 0, skipped: 0, would: [], failed: [] };

  sits.forEach(function (sit) {
    var def = SMART_EVENTS[String(sit.event).trim()];
    // THE HOUR GATE.
    var sched = smartScheduleNow_(sit, Date.now());
    if (sched.holds) return;
    var slot = sched.slot || '';
    var slotTag = slot ? '_' + slot : '';
    var stages = smartList_(sit.statuses).map(function (x) { return x.toLowerCase(); });
    var grace = parseInt(sit.days_before, 10);
    if (isNaN(grace) || grace < 0) grace = 0;

    var subj = String(def.subject || 'candidate');
    // "Not a candidate", really — the name predates the other subjects and keeps its meaning: skip the…
    var isClient = subj === 'client' || subj === 'sync' || subj === 'staff' ||
                   subj === 'recon' || subj === 'onboarding' || subj === 'hotline' ||
                   subj === 'travel' || subj === 'shopperOwners' || subj === 'guardian';
    subjectRows(def).forEach(function (c) {
      // The identity a ledger key is built on: a candidate id, or the client's own name — which is what the finance…
      var cid = (subj === 'sync' || subj === 'staff' || subj === 'recon' ||
                 subj === 'onboarding' || subj === 'hotline' || subj === 'travel' ||
                 subj === 'guardian')
                  ? str_(c.id)
                  : subj === 'shopperOwners' ? str_(c.ownerId)
                  : (isClient ? str_(c.name) : str_(c.candidateid));
      if (!cid) return;
      if (!isClient && str_(c.archived).toLowerCase() === 'true') return;
      if (!isClient && stages.length &&
          stages.indexOf(String(talentStage_(c.status) || '').toLowerCase()) === -1) return;

      var hit;
      try { hit = def.applies(c); } catch (eA) { hit = { fires: false }; }
      if (!hit || !hit.fires) return;

      // The grace period lives in the row, not the code: "tell them, but not the same minute".
      if (grace > 0) {
        var since = new Date(str_(hit.instance)).getTime();
        if (!isNaN(since) && Date.now() < since + grace * 86400000) return;
      }

      // ALREADY TOLD — by this sweep, or by the hardcoded alert this replaced.
      var key = smartLedgerKey_(sit.id, cid, str_(hit.instance), slot);
      if (!smartAttemptsAllow_(attempts, sit, cid, str_(hit.instance), Date.now(), slot)) return;
      // Rehearsed already, and still rehearsing: do not send it again.
      if (rehearsing && sent[smartRehearsalKey_(key)]) return;
      // And never more than the cap in a single rehearsal pass.
      if (rehearsing && rehearsedThisPass >= SMART_REHEARSAL_CAP) { capped++; return; }
      if (!isClient && def.legacy && str_(c[def.legacy])) return;

      // A REHEARSAL NEVER PAGES THE TEAM.
      if (!isClient && typeof packetIsRehearsal_ === 'function' && packetIsRehearsal_(c)) { out.skipped++; return; }

      // DRY RUN — and it really was not one.
      if (opts.dry_run) {
        out.would.push(sit.id + ' → ' + (str_(c.candidatename) || cid) + ' (dry run)');
        return;
      }

      var name = subj === 'sync' ? str_(c.mode)
               : subj === 'staff' ? str_(c.name)
               : subj === 'recon' ? (str_(c.name) || str_(c.id))
               : (isClient ? cid : (str_(c.candidatename) || cid));
      var vars = { name: name, first_name: String(name).split(/\s+/)[0],
                   sender: str_(sit.sender) || SMART_SENDER_DEFAULT };
      for (var k in (hit.vars || {})) vars[k] = hit.vars[k];

      /** `to_subject` addresses the message to the person it is about instead of escalating to the team, by text AND email. */
      if (def.to_subject) {
        var channels = smartList_(sit.channels);
        var reachedSubj = false, redirectedSubj = false, failedSubj = '';

        if (channels.indexOf('sms') !== -1) {
          var num = packetSendableNumber_(str_(c.phone));
          if (num) {
            var rs = rpcCall_('smsSend', {
              to: num, body: smartRender_(sit.sms_text, vars),
              reason: 'smart comms event: ' + sit.id
            }, { idempotency_key: 'smart_evt_sms_' + sit.id + '_' + cid + '_' + String(hit.instance).slice(0, 24) + slotTag });
            if (rs.ok && rs.sent) { reachedSubj = true; if (rs.redirected) redirectedSubj = true; }
            // A MESSAGE WRITTEN INTO THE ROW'S OWN HOUSE (`record_to`) IS A TELLING THAT HAPPENED: the words exist…
            else if (rs.ok && rs.recorded_to) reachedSubj = true;
            else if (rs.ok && rs.gated) out.would.push(sit.id + ' → ' + name);
            else if (!rs.ok) failedSubj = str_(rs.error);
          } else {
            hubSysLog_('asa-hub:smartcomms', 'smart_no_number', sit.id + ' — ' + name, { status: 200 });
          }
        }

        if (channels.indexOf('email') !== -1 && str_(c.email)) {
          var re = rpcCall_('emailSend', {
            to: str_(c.email),
            subject: smartRender_(sit.email_subject, vars),
            body: smartRender_(sit.email_text || sit.sms_text, vars),
            reason: 'smart comms event: ' + sit.id
          }, { idempotency_key: 'smart_evt_mail_' + sit.id + '_' + cid + '_' + String(hit.instance).slice(0, 24) + slotTag });
          if (re.ok && re.sent) { reachedSubj = true; if (re.redirected) redirectedSubj = true; }
          else if (re.ok && re.recorded_to) reachedSubj = true;
          else if (re.ok && re.gated) out.would.push(sit.id + ' → ' + name + ' (email)');
          else if (!re.ok) failedSubj = str_(re.error);
        }

        // AND THE COPY LIST ACTUALLY GETS A COPY.
        var copies = smartList_(sit.to);
        copies.forEach(function (dest, ci) {
          if (!dest) return;
          if (dest.indexOf('@') !== -1) {
            rpcCall_('emailSend', {
              to: dest,
              subject: smartRender_(sit.email_subject, vars),
              body: smartRender_(sit.email_text || sit.sms_text, vars),
              reason: 'smart comms cc: ' + sit.id
            }, { idempotency_key: 'smart_evt_cc' + ci + '_' + sit.id + '_' + cid + '_' + String(hit.instance).slice(0, 20) + slotTag });
            return;
          }
          // Our own team lines ARE the audience of an internal copy, so this asks the copy question, not the…
          var cn = (typeof packetTeamCopyNumber_ === 'function')
            ? packetTeamCopyNumber_(dest) : packetSendableNumber_(dest);
          if (!cn) {
            hubSysLog_('asa-hub:smartcomms', 'smart_cc_unaddressable',
                       sit.id + ' — copy to ' + String(dest).slice(0, 40) +
                       ' is neither an e-mail nor a number we may text',
                       { status: 200 });
            out.would.push(sit.id + ' → copy ' + String(dest).slice(0, 40) + ' (no address)');
            return;
          }
          rpcCall_('smsSend', {
            to: cn, body: smartRender_(sit.sms_text, vars),
            reason: 'smart comms cc: ' + sit.id
          }, { idempotency_key: 'smart_evt_ccs' + ci + '_' + sit.id + '_' + cid + '_' + String(hit.instance).slice(0, 20) + slotTag });
        });

        if (reachedSubj && !redirectedSubj) {
          smartRecord_(key, sit.id, name, str_(hit.instance), smartList_(sit.channels).join('+') || 'sms');
          // The row counts a DELIVERY, never an attempt — the manual re-send in the table depends on this number…
          if (subj === 'staff' && typeof istMarkNotified_ === 'function') {
            try { istMarkNotified_(cid); } catch (eM) { /* the send stands */ }
          }
          out.sent++;
        } else if (redirectedSubj) {
          // Recorded as a REHEARSAL, never as the real thing.
          smartRecord_(smartRehearsalKey_(key), sit.id, name, str_(hit.instance), 'rehearsal');
          rehearsedThisPass++;
          hubSysLog_('asa-hub:smartcomms', 'smart_event_test_only',
                     sit.id + ' → ' + name + ': reached the TESTERS, not recorded as told', { status: 200 });
        } else if (failedSubj) {
          out.failed.push(sit.id + ' → ' + name + ': ' + failedSubj);
        }
        return;
      }

      // `to` IS THE ADDRESSES — e-mails or phone numbers, written out.
      var to = smartList_(sit.to).join(', ');

      // A situation that names an email_design wears the designed letter on the e-mail leg (MailTemplates.gs); the…
      var designHtml = '';
      if (str_(sit.email_design) === 'guardian_alert' && typeof guardianAlertEmail_ === 'function') {
        try {
          designHtml = guardianAlertEmail_({
            issues: String(vars.issues || 'something needs a person').split(/;\s*/).filter(Boolean)
          }).html;
        } catch (eD) { designHtml = ''; }
      }

      var res = rpcCall_('teamAlert', {
        to: to,
        subject: smartRender_(sit.email_subject, vars),
        body: smartRender_(sit.email_text || sit.sms_text, vars),
        reason: 'smart comms event: ' + sit.id,
        html: designHtml || undefined
      }, { idempotency_key: 'smart_evt_' + sit.id + '_' + cid + '_' + String(hit.instance).slice(0, 10) + slotTag });

      if (res.ok && (res.sent || res.recorded_to) && !res.redirected) {
        // `key`, NOT `sit.id`.
        smartRecord_(key, sit.id, name, str_(hit.instance), smartList_(sit.channels).join('+') || 'team');
        out.sent++;
      } else if (res.redirected) {
        // Sent, to a tester.
        smartRecord_(smartRehearsalKey_(key), sit.id, name, str_(hit.instance), 'rehearsal');
        rehearsedThisPass++;
        hubSysLog_('asa-hub:smartcomms', 'smart_event_test_only',
                   sit.id + ' → ' + name + ': reached the TESTERS, not recorded', { status: 200 });
      } else if (res.ok && res.gated) {
        out.would.push(sit.id + ' → ' + name);
      } else if (res.ok && res.deduplicated) {
        // A RECEIPT IS NOT A FAILURE.
        out.deduplicated = (out.deduplicated || 0) + 1;
        hubSysLog_('asa-hub:smartcomms', 'smart_event_deduplicated',
                   sit.id + ' → ' + name + ': the same ask already landed within the receipt window',
                   { status: 200 });
      } else {
        out.failed.push(sit.id + ' → ' + name + ': ' + str_(res.error));
      }
    });
  });
  if (capped) {
    // NO SILENT CAP.
    out.rehearsal_capped = capped;
    hubSysLog_('asa-hub:smartcomms', 'smart_rehearsal_capped',
               capped + ' more would have been rehearsed this pass', { status: 200 });
  }
  return out;
}

// Every date column the sweep can read: the mapped certifications plus the raw Master columns the reports name.
function smartAllSources_() {
  var out = [];
  var labels = (typeof certLabels_ === 'function') ? certLabels_() : {};
  for (var k in labels) if (labels.hasOwnProperty(k)) out.push({ key: k, label: labels[k] });
  smartExtraSituations_().forEach(function (e) {
    if (str_(e.credential)) out.push({ key: e.credential, label: e.label });   // a bundle names no column
  });
  return out;
}

/** WHOSE STATUS, AND FROM WHICH SHEET. */
function smartStatusOf_(raw, person) {
  var fromMaster = raw ? String(smartRawColumn_(raw, 'Status') || '').trim() : '';
  if (fromMaster) return fromMaster.toLowerCase();
  return String((person && person.status) || '').trim().toLowerCase();
}

/** Days between now and a date: ahead for `expiring`, behind for `elapsed`. */
function smartWindowDays_(ms, direction) {
  var d = Math.floor((ms - Date.now()) / 86400000);
  return String(direction || 'expiring').toLowerCase() === 'elapsed' ? -d : d;
}

/** The rows a digest is about. */
function smartDigestRows_(sit) {
  var picture = certPicture_();
  var rawByName = {};
  try {
    var masterName = certSourceField_('master.name');
    certReadTab_(certSourceTab_('master')).forEach(function (r) {
      var k = clientNameKey_(certFieldOf_(r, masterName));
      if (k && !rawByName[k]) rawByName[k] = r;
    });
  } catch (e) { rawByName = {}; }

  var direction = String(sit.direction || 'expiring').toLowerCase();
  var win = parseInt(sit.days_before, 10);
  if (isNaN(win)) return [];
  var statuses = smartList_(sit.statuses).map(function (x) { return x.toLowerCase(); });
  var named = smartList_(sit.credential);
  var sources = named.length ? named.map(function (n) {
    var lab = (typeof certLabel_ === 'function') ? certLabel_(n) : n;
    return { key: n, label: lab };
  }) : smartAllSources_();

  var excludeCol = str_(sit.exclude_column);
  var excludeVals = smartList_(sit.exclude_values).map(function (x) { return x.toLowerCase(); });

  var rows = [];
  withoutIspClients_(peopleMerged_(listRows_('people', {}))).forEach(function (p) {
    var nameKey = clientNameKey_(p.name);
    if (!nameKey) return;
    var known = picture[nameKey] || { certs: {} };
    var raw = rawByName[nameKey] || null;
    if (statuses.length && statuses.indexOf(smartStatusOf_(raw, p)) === -1) return;

    // The exclusion the referral report needs: a column whose value takes the person out of the report entirely…
    if (excludeCol && raw) {
      var got = String(smartRawColumn_(raw, excludeCol) || '').trim().toLowerCase();
      if (got && excludeVals.indexOf(got) !== -1) return;
    }

    sources.forEach(function (src) {
      var val = (known.certs[src.key] && known.certs[src.key].expires)
        ? known.certs[src.key].expires : smartRawColumn_(raw, src.key);
      if (!val) return;
      var ms = certDateMs_(val);
      if (ms === null) return;
      var days = smartWindowDays_(ms, direction);
      if (direction === 'elapsed') { if (days <= win) return; }
      else if (days <= 0 || days > win) return;
      rows.push([String(p.name), src.label, String(val).slice(0, 10), String(days)]);
    });
  });
  return rows;
}

// One build, two shapes, so the e-mail and the preview can never describe different rows.
function smartTable_(header, rows) {
  var html = '<table border="1" style="border-collapse: collapse; text-align: left;"><tr>' +
    header.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>' +
    rows.map(function (r) {
      return '<tr>' + r.map(function (c) { return '<td>' + String(c) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</table>';
  var text = header.join(' | ') + '\n' + rows.map(function (r) { return r.join(' | '); }).join('\n');
  return { html: html, text: text };
}

// The week this digest belongs to.
function smartDigestStamp_() {
  var d = new Date();
  var jan = new Date(d.getFullYear(), 0, 1);
  return d.getFullYear() + 'w' + Math.floor(((d - jan) / 86400000 + jan.getDay()) / 7);
}

/** Send the digests — one e-mail per situation, to the addresses in `to`. */
function smartDigestSweep_(opts) {
  opts = opts || {};
  var out = { digests: 0, sent: 0, rows: 0, gated: [], failed: [], skipped: [] };
  smartSituations_().forEach(function (sit) {
    if (String(sit.kind || '').trim().toLowerCase() !== 'digest') return;
    if (!smartOn_(sit.enabled)) return;
    if (opts.only && sit.id !== opts.only) return;
    // THE HOURS TURN A WEEKLY REPORT INTO A DAILY ONE, and that is the point of them here: with hours on the row…
    var sched = smartScheduleNow_(sit, Date.now());
    if (sched.holds) { out.skipped.push(sit.id + ': next at ' + sched.next); return; }
    var stamp = sched.slot || smartDigestStamp_();
    out.digests++;
    var to = smartList_(sit.to).filter(function (x) { return x.indexOf('@') !== -1; });
    if (!to.length) { out.skipped.push(sit.id + ': nobody in `to`'); return; }
    var rows = smartDigestRows_(sit).sort(function (a, b) { return Number(a[3]) - Number(b[3]); });
    // NOTHING TO REPORT IS NOT A REPORT.
    if (!rows.length) { out.skipped.push(sit.id + ': nothing due'); return; }
    out.rows += rows.length;
    // A WEEK IS A WEEK.
    var dkey = 'DIGEST|' + sit.id + '|' + stamp;
    if (!opts.dry_run && smartAlreadySent_()[dkey]) {
      out.skipped.push(sit.id + (sched.slot ? ': already sent at ' + sched.label
                                            : ': already sent this week'));
      return;
    }
    var table = smartTable_(['Employee Name', 'Type', 'Date', 'Days'], rows);
    var landed = false;
    var vars = { days_before: str_(sit.days_before), table: table.text,
                 sender: str_(sit.sender) || SMART_SENDER_DEFAULT,
                 credential: smartCredentialLabel_(sit),
                 expires: '', days_left: '', first_name: '', name: '' };
    to.forEach(function (addr, i) {
      var r = rpcCall_('emailSend', {
        to: addr,
        subject: smartRender_(sit.email_subject, vars),
        body: smartRender_(sit.email_text, vars),
        reason: 'smart comms digest: ' + sit.id
      }, { idempotency_key: 'digest_' + sit.id + '_' + stamp + '_' + i });
      if (r.ok && r.sent) { out.sent++; landed = true; }
      else if (r.ok && r.deduplicated) landed = true;
      else if (r.ok && r.gated) out.gated.push(sit.id + ' -> ' + addr);
      else if (!r.ok) out.failed.push(sit.id + ' -> ' + addr + ': ' + str_(r.error));
    });
    // Recorded once per week per digest, whatever the recipient count, and only when something actually left — a…
    if (landed && !opts.dry_run) {
      smartRecord_(dkey, sit.id, 'digest', stamp, 'email');
    }
  });
  return out;
}

/* ---- Actions ---- */

/** Read the situations for Settings → Smart Comms. Admin only. */
HUB_POLICY.smartCommsGet = {
  file: 'SmartComms.gs', lane: 'read', store: 'sheet', idempotent: true,
  cost: 'seconds', roles: ['admin'], invalidates: [], emits: []
};
// WHO A `teamAlert` REACHES — counted off the list the SEND PATH really uses, and off no other.
function smartTeamRecipients_() {
  var out = { sms: [], emails: [], floor_sms: [], amber_sms: [], readable: true };
  try {
    out.floor_sms = (typeof packetAmberFloor_ === 'function')
      ? packetAmberFloor_() : [];
    out.amber_sms = (typeof packetAmberRecipients_ === 'function')
      ? packetAmberRecipients_() : out.floor_sms;
    var cfg = hubAlertRecipients_();
    out.sms = ((cfg && cfg.sms) || []).filter(function (n) {
      return String(n).replace(/\D/g, '').length >= 10;
    });
    // An address is an address.
    out.emails = ((cfg && cfg.emails) || []).filter(function (e) {
      return String(e).indexOf('@') !== -1;
    });
  } catch (e) {
    // UNREADABLE IS NOT EMPTY.
    out.readable = false;
  }
  return out;
}

// WHICH ROWS PAGE THE ALERT FLOOR WHATEVER THEIR `to` SAYS.
function smartFloorAlerts_(rows) {
  var out = {};
  var senders = (typeof SMART_EVENT_SENDERS !== 'undefined') ? SMART_EVENT_SENDERS : {};
  (rows || []).forEach(function (s) {
    if (String((s && s.kind) || '').trim().toLowerCase() !== 'event') return;
    var ev = String((s && s.event) || '').trim();
    var def = (typeof SMART_EVENTS !== 'undefined') ? SMART_EVENTS[ev] : null;
    if (!def || def.to_subject) return;
    if (Object.prototype.hasOwnProperty.call(senders, ev)) return;
    out[String(s.id || '')] = { floor: true, adds: true };
  });
  return out;
}

// THE HOURS EACH ROW KEEPS — AND WHETHER ANY CLOCK IS LISTENING.
function smartScheduleFacts_(rows) {
  var senders = (typeof SMART_EVENT_SENDERS !== 'undefined') ? SMART_EVENT_SENDERS : {};
  var out = {};
  (rows || []).forEach(function (s) {
    var id = String((s && s.id) || '');
    if (!id) return;
    var parsed = smartSlotsParse_(s && s.send_at);
    var kind = String((s && s.kind) || 'reminder').trim().toLowerCase();
    var ev = String((s && s.event) || '').trim();
    // A letter is fired by its door and a gate says nothing: no sweep reads either one's hours.
    var elsewhere = Object.prototype.hasOwnProperty.call(senders, ev) ||
                    kind === 'call_off' || kind === 'bundle' || kind === 'window_ask' ||
                    kind === 'ai' || kind === 'shift_clock' || kind === 'letter' || kind === 'gate';
    var now = smartScheduleNow_(s, Date.now());
    out[id] = {
      hours: parsed.labels,
      unreadable: parsed.bad,
      honored: !elsewhere,
      standing: !!(now.scheduled && !now.holds),
      next: now.next || '',
      why: elsewhere
        ? 'this one is sent the moment it happens, by its own lane — hours here hold nothing back'
        : (parsed.labels.length
            ? 'the sweep speaks at ' + parsed.labels.join(', ') +
              ', and each hour is its own telling'
            : 'no hours kept: it speaks whenever its sweep passes')
    };
  });
  return out;
}

HUB_ACTIONS.smartCommsGet = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var rows = smartSituations_();
  // The tab moved out of the Core into its own data house — the id the screen links to must be the workbook the…
  var bookId = '';
  try { bookId = hubTabWorkbook_(SMART_TAB).getId(); } catch (eB) { bookId = ''; }
  return { status: 200, data: {
    tab: SMART_TAB, spreadsheet_id: bookId,
    situations: rows,
    credentials: (typeof certLabels_ === 'function') ? certLabels_() : {},
    // `{correction}` is the written sentence about what was wrong, and it is only ever filled for the situation…
    placeholders: ['{first_name}', '{name}', '{expires}', '{days_left}', '{credential}',
                   '{sender}', '{correction}'],
    team: smartTeamRecipients_(),
    // AND WHICH ROWS REACH THAT TEAM WHATEVER IS TYPED IN `to`.
    floor_alerts: smartFloorAlerts_(rows),
    // THE HOURS, and whether a clock is listening at all on that row.
    schedule: smartScheduleFacts_(rows),
    // AND WHICH ROWS ARE SENT SOMEWHERE ELSE ENTIRELY, by name of the file that sends them (SMART_EVENT_SENDERS).
    event_senders: (typeof SMART_EVENT_SENDERS !== 'undefined') ? SMART_EVENT_SENDERS : {},
    // WHAT A KEYWORD IN `to` RESOLVES TO.
    keywords: smartToKeywordAudiences_({
      wanted: smartKeywordsInUse_(rows),
      fresh: String((payload && payload.keywords) || '') === 'fresh'
    }),
    sending: (typeof rpcSendEnabled_ === 'function' && rpcSendEnabled_()) ? 'on' : 'off',
    // THE TWO BRAKES, PUBLISHED WHERE THE SCREEN ASKS FOR THEM.
    dial: (function () {
      try { return (typeof commDial_ === 'function') ? String(commDial_() || '') : ''; }
      catch (eD) { return ''; }
    })(),
    dial_follows: 'test_mode',
    test_mode: (function () {
      try {
        var st = (typeof hubTestModeState_ === 'function') ? hubTestModeState_() : null;
        if (!st) return null;
        return { on: !!st.on, explicit: !!st.explicit, unrecognized: st.unrecognized || '',
                 sms: st.sms || [], emails: st.emails || [], shared: st.shared || [] };
      } catch (eT) { return null; }
    })(),
    // THE REACH OF THE ONE ROW WHOSE REACH IS THE QUESTION, and the sender this platform does not own.
    call_off_reach: (typeof commCallOffManagerReach_ === 'function')
      ? commCallOffManagerReach_(null) : null,
    call_off_also_sent_by: (typeof commCallOffLegacySender_ === 'function')
      ? commCallOffLegacySender_() : null,
    // THE DOORS THAT REACH THE WORLD WITHOUT SAYING ANYTHING (SmartGate.gs).
    gates: (typeof hubGateDesk_ === 'function') ? hubGateDesk_(rows) : null,
    // AND THE LETTERS THAT LEAVE WHILE EVERYTHING ELSE IS HELD.
    auth_letters: (function () {
      if (typeof HUB_AUTH_SITUATIONS === 'undefined') return null;
      var out = [];
      var rowOf = function (sid) {
        var hit = null;
        rows.forEach(function (r) { if (str_(r.id) === sid) hit = r; });
        return hit;
      };
      for (var kind in HUB_AUTH_SITUATIONS) {
        if (!Object.prototype.hasOwnProperty.call(HUB_AUTH_SITUATIONS, kind)) continue;
        var sid = HUB_AUTH_SITUATIONS[kind];
        var row = rowOf(sid);
        var kindOn = !row || smartOn_(row.enabled);
        var words = (typeof HUB_AUTH_LETTER_WORDS !== 'undefined' && HUB_AUTH_LETTER_WORDS[kind]) || 'row';
        out.push({ kind: kind, id: sid, known: !!row,
                   on: kindOn,
                   delivered_while_held: true,
                   email_words: words,
                   note: 'the letter is delivered to the real person while the lane is holding; ' +
                         'switched off here it does not send at all, and a situations tab that ' +
                         'cannot be read holds it' +
                         (words === 'template'
                           ? '. Its e-mail is a designed letter whose words are not in this row; ' +
                             'the SMS copy is this row\'s words and the dial holds it like any text'
                           : '') });
        var also = (typeof HUB_AUTH_ALSO_CLAIMED !== 'undefined' && HUB_AUTH_ALSO_CLAIMED[kind]) || [];
        also.forEach(function (a) {
          var arow = rowOf(a.id);
          out.push({ kind: kind, id: a.id, label: a.label, known: !!arow,
                     // a situation that arrives disabled is off until its row says yes
                     on: !!arow && smartOn_(arow.enabled) && kindOn,
                     also_needs: sid,
                     delivered_while_held: true,
                     email_words: 'row',
                     note: 'sent from ' + a.door + '; its letter passes test mode: it claims the ' +
                           kind.replace(/_/g, ' ') + '\'s exemption, so the letter reaches the real ' +
                           'person while test mode holds every other message. It sends only while this ' +
                           'row and ' + sid + ' are both on; its text leg is held like any text' });
        });
      }
      return out;
    })()
  } };
};

// Save edited situations by id.
HUB_POLICY.smartCommsSet = {
  file: 'SmartComms.gs', lane: 'write', store: 'sheet', idempotent: true,
  cost: 'seconds', roles: ['admin'],
  // IT CAN REACH PEOPLE NOW — a save that declares a correction sends it in the same breath — and the registry has…
  invalidates: ['smartCommsDesk'], emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.smartCommsSet = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var rows = (payload && payload.rows) || [];
  if (!Array.isArray(rows) || !rows.length) {
    return { status: 400, message: 'Nothing to save.' };
  }
  var sheet = smartSheet_();
  var last = sheet.getLastRow();
  var values = last > 1 ? sheet.getRange(2, 1, last - 1, SMART_HEADER.length).getValues() : [];
  var index = {};
  values.forEach(function (r, i) { index[String(r[0] || '').trim()] = i + 2; });
  var saved = 0, unknown = [], unaddressed = [], badHours = [], badLines = [], lineNames = [];
  // EVERY ROW IS JUDGED BEFORE ANY ROW IS WRITTEN.
  rows.forEach(function (row) {
    var id = str_(row.id);
    // A situation is only editable, never creatable from the screen: an id invented in a form governs nothing, and…
    if (!id || !index[id]) { unknown.push(id || '(blank)'); return; }
    // A KEYWORD NOBODY RESOLVES MAY NOT BE PARKED IN `to`, AND THIS IS WHERE THAT HAS TO BE REFUSED.
    if (row.to !== undefined && smartList_(row.to).length && !smartAddressable_(row.to)) {
      unaddressed.push(id + ': "' + String(row.to).slice(0, 40) + '"');
    }
    // AN HOUR NOBODY CAN READ IS AN APPOINTMENT NOBODY KEEPS.
    if (row.send_at !== undefined && String(row.send_at).trim()) {
      var hrs = smartSlotsParse_(row.send_at);
      if (hrs.bad.length) badHours.push(id + ': "' + hrs.bad.join('", "') + '"');
      else if (!hrs.slots.length) badHours.push(id + ': "' + String(row.send_at).slice(0, 40) + '"');
    }
    /* An unknown line is refused at save rather than failing at the send door. */
    if (row.from_line !== undefined && String(row.from_line).trim() &&
        typeof hubLineSenderKnown_ === 'function') {
      var fl = hubLineSenderKnown_(row.from_line);
      if (!fl.ok) {
        badLines.push(id + ': "' + String(row.from_line).slice(0, 40) + '" (' + fl.why + ')');
        lineNames = fl.names || [];
      }
    }
  });
  if (unaddressed.length || unknown.length || badHours.length || badLines.length) {
    var refusal = [];
    if (unaddressed.length) {
      refusal.push('Nobody would be reached: ' + unaddressed.join(' · ') +
                   '. `to` holds e-mail addresses and phone numbers written out — the only ' +
                   'words allowed there are keywords this backend resolves (' +
                   Object.keys(SMART_TO_KEYWORDS).join(', ') + '). Leave it blank if the lane ' +
                   'resolves its own audience.');
    }
    if (unknown.length) {
      refusal.push('No situation has the id ' + unknown.join(' · ') +
                   ' — a row is editable here, never creatable.');
    }
    if (badHours.length) {
      refusal.push('These hours could not be read: ' + badHours.join(' · ') +
                   '. Write times of day separated by commas — 09:00, 13:00, 17:00 ' +
                   '(9am and 21h are read too). Leave it blank for a row that speaks ' +
                   'whenever its sweep passes.');
    }
    if (badLines.length) {
      refusal.push('No line of ours sends from: ' + badLines.join(' · ') +
                   '. Write a line\'s role, its name or its number' +
                   (lineNames.length ? ' (' + lineNames.join(', ') + ')' : '') +
                   ', or leave it blank to send from ' +
                   ((typeof RPC_DEFAULT_LINE_NAME !== 'undefined') ? RPC_DEFAULT_LINE_NAME : 'Automations') + '.');
    }
    refusal.push('NOTHING WAS SAVED, including the other ' +
                 Math.max(0, rows.length - unaddressed.length - unknown.length - badHours.length -
                          badLines.length) +
                 ' row(s) in this save.');
    try {
      hubSysLog_(user.email, 'smart_comms_set_refused', refusal.join(' '), { status: 400 });
    } catch (eLg) { /* the answer below is the caller's copy */ }
    return { status: 400, message: refusal.join(' '),
             data: { saved: 0, unknown: unknown, unaddressed: unaddressed, bad_hours: badHours,
                     bad_lines: badLines } };
  }
  // THE OLD ROW AND THE NEW ONE, BOTH KEPT, and the pair is the whole of the evidence.
  var changed = [];
  rows.forEach(function (row) {
    var id = str_(row.id);
    var at = index[id];
    var before = {}, after = {};
    var out = SMART_HEADER.map(function (h, c) {
      var was = String(values[at - 2][c] == null ? '' : values[at - 2][c]);
      var now = row[h] !== undefined ? String(row[h]) : was;
      before[h] = was;
      after[h] = now;
      return now;
    });
    sheet.getRange(at, 1, 1, SMART_HEADER.length).setValues([out]);
    saved++;
    changed.push({ before: before, after: after,
                   correct_audience: !!(row.correct_audience === true ||
                                        String(row.correct_audience || '').toLowerCase() === 'true' ||
                                        String(row.correct_audience || '').toLowerCase() === 'yes'),
                   what_was_wrong: str_(row.what_was_wrong) });
  });
  // THE CACHE FIRST, THEN THE CORRECTION.
  try { smartCacheBust_(); } catch (e) { /* 300s TTL */ }

  var repair = null;
  if (changed.length && typeof commRepairOnWordsChanged_ === 'function') {
    try { repair = commRepairOnWordsChanged_(changed, user); }
    catch (eR) {
      // THE SAVE IS NOT LOST BECAUSE THE APOLOGY FAILED.
      repair = { error: String((eR && eR.message) || eR) };
      try {
        hubSysLog_(user.email, 'smart_comms_correction_error',
                   'the words were saved and the correction could not be started: ' +
                   repair.error, { status: 500 });
      } catch (eL) { /* the repair rows carry it */ }
    }
  }
  hubSysLog_(user.email, 'smart_comms_set',
             saved + ' situation(s)' +
             (repair && repair.discovered ? ' · ' + repair.discovered + ' correction(s) declared, ' +
                                            repair.audience + ' people hold the old words, ' +
                                            repair.said + ' told in this save' : ''),
             { status: 200 });
  // A 200 HERE MEANS EVERY ROW LANDED.
  return { status: 200, data: { saved: saved, unknown: unknown,
                                unaddressed: unaddressed, bad_hours: badHours, correction: repair } };
};

/** SMART COMMS IN THE PROTOCOL — it has to be in the smart comms and in the resolver too. */
HUB_POLICY.smartCommsRun = {
  file: 'SmartComms.gs', lane: 'write', store: 'sheet',
  idempotent: true,               // the ledger is the memory, not the call
  cost: 'seconds',
  roles: ['admin'],
  invalidates: ['candidates'],
  emits: ['smsSend', 'emailSend', 'teamAlert']
};
HUB_ACTIONS.smartCommsRun = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var out = {};
  // Events first: they are about people who are waiting right now.
  try { out.events = smartEventSweep_({}); }
  catch (e) { out.events = 'failed: ' + String((e && e.message) || e); }
  try { out.reminders = smartCommsSweep_(payload || {}); }
  catch (e2) { out.reminders = 'failed: ' + String((e2 && e2.message) || e2); }
  hubSysLog_(user && user.email, 'smart_comms_run', JSON.stringify(out).slice(0, 250), { status: 200 });
  return { status: 200, data: out };
};

// ▶ What the event situations would do right now.
function runSmartEventPreview() {
  var out = smartEventSweep_({ dry_run: true });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** Who WOULD be messaged, right now, changing nothing. */
HUB_POLICY.smartCommsPreview = {
  file: 'SmartComms.gs', lane: 'tool', store: 'sheet', idempotent: true,
  cost: 'minutes', roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.smartCommsPreview = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var found = smartDue_({ only: str_(payload && payload.situation) || '' });
  return { status: 200, data: {
    situations: found.situations,
    due: found.due.map(function (d) {
      return { situation: d.situation, name: d.name, credential: d.credential,
               expires: d.expires, days_left: d.days_left,
               channels: d.channels, rehearsal: d.rehearsal,
               cc: d.rehearsal ? [] : smartList_(d.config.cc),
               // The message as it would really read, so the wording is reviewed before it reaches anybody rather…
               preview: smartRender_(d.config.sms_text, {
                 first_name: String(d.name).split(/\s+/)[0], name: d.name,
                 expires: d.expires, days_left: String(d.days_left),
                 credential: smartCredentialLabel_(d.config),
                 sender: str_(d.config.sender) || SMART_SENDER_DEFAULT
               }).slice(0, 400) };
    })
  } };
};

/* ---- Editor entry points ---- */

/** ▶ Create/level the tab. Run once; safe to re-run. */
function runSmartCommsInstall() {
  smartSheet_();
  // AND THE ALERTS TAB: hiringAlertsSheet_ seeds additively but is only reached on a CACHE MISS, so a key added in…
  try {
    if (typeof hiringAlertsSheet_ === 'function') {
      hiringAlertsSheet_();
      hiringAlertsBump_();   // memo + the 60s entry, both
      hiringAlertsSheet_();          // after the bust, so the seed really runs
    }
  } catch (e) { /* reported by the count below */ }
  var alerts = 0;
  try { alerts = Object.keys(hiringAlerts_()).length; } catch (e2) { alerts = -1; }
  var redirect = 'off';
  try {
    var r = hubTestRedirect_();
    redirect = r ? 'ON — nothing leaves the platform; every message is a row in the mock outbox'
                 : 'off (every message goes to its real recipient)';
  } catch (e3) { redirect = 'unknown'; }
  var out = { tab: SMART_TAB, situations: smartSituations_().length,
              alert_config_keys: alerts,
              sending: (typeof rpcSendEnabled_ === 'function' && rpcSendEnabled_()) ? 'ON' : 'off',
              test_redirect: redirect };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** ▶ Who would be messaged, and what it would say. Sends nothing. */
function runSmartCommsPreview() {
  var out = HUB_ACTIONS.smartCommsPreview({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** ▶ Actually run it. Held by HUB_RPC_SEND like everything else. */
function runSmartCommsSweep() {
  var out = smartCommsSweep_({});
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ------------------------------------------------------------------ THE DESK'S DATA DOORS (the Smart Comms app)…

// The tellings, newest first — the ledger's deliveries (never rehearsals), filterable by situation.
HUB_POLICY.smartCommsHistory = {
  file: 'SmartComms.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.smartCommsHistory = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var situation = str_(payload && payload.situation);
  var limit = Math.min(500, Math.max(1, parseInt(payload && payload.limit, 10) || 200));
  var sheet = smartLedgerSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return { status: 200, data: { deliveries: [] } };
  var start = Math.max(2, last - 1999);
  var values = sheet.getRange(start, 1, last - start + 1, 6).getValues();
  var out = [];
  for (var r = values.length - 1; r >= 0 && out.length < limit; r--) {
    var sit = str_(values[r][1]);
    if (situation && sit !== situation) continue;
    var channel = str_(values[r][4]).toLowerCase();
    // A rehearsal is remembered, not a telling — the desk counts real ones.
    if (channel === 'rehearsal') continue;
    out.push({
      situation: str_(values[r][1]),
      person: str_(values[r][2]),
      expires: str_(values[r][3]),
      channel: str_(values[r][4]),
      at: str_(values[r][5])
    });
  }
  return { status: 200, data: { deliveries: out } };
};
