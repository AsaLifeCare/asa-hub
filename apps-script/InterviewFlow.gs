// INTERVIEW SCHEDULER (item 4; rebuilt for steps 9, 10 and 12 of the HIRING card) — the invite link, the…
// The loop: interviewInviteSend e-mails (and texts) a personal HMAC link → the STANDALONE public page…

var INTERVIEW_ASKS_TAB = 'interview_asks';
var INTERVIEW_ASKS_HEADER = ['ask_id', 'candidate_id', 'candidate_name', 'candidate_email',
  'candidate_phone', 'state', 'invited_at', 'invited_by', 'picked_date', 'picked_time',
  'supervisor_asked_at', 'supervisor_reply', 'slots_json', 'offered_at',
  'confirmed_date', 'confirmed_time', 'confirmed_at', 'updated_at',
  // THE INTERVIEWER'S DAYS COME FIRST: before the candidate sees a calendar, Tieara chooses the days they MAY pick…
  'days_asked_at', 'allowed_days_json', 'days_chosen_at'];

/** One AI verdict per supervisor message, ever — this tab is the memory. */
var INTERVIEW_ASK_AI_TAB = 'interview_ask_ai';
var INTERVIEW_ASK_AI_HEADER = ['message_id', 'verdict', 'slots_json', 'via', 'seen_at'];

var INTERVIEW_LINK_SECRET_PROP = 'INTERVIEW_LINK_SECRET';
var INTERVIEW_ASK_CURSOR_PROP = 'HUB_INTERVIEW_ASK_CURSOR';
var INTERVIEW_ASK_BATCH_ROWS = 800;

/** The company's three interview periods (the book's hours.* cells). */
var INTERVIEW_SLOT_TIMES = ['10:00', '14:00', '17:00'];

// WHERE THE CANDIDATE'S CALENDAR LIVES.
var INTERVIEW_LINK_BASE = 'https://asamylife.asalifecare.com/interview.html?t=';

/** The floor under the Smart Comms cells — the row is the editable truth. */
var INTERVIEW_ASK_FALLBACK = {
  invite_sms: 'Hi {first_name}, this is ASA Lifecare — time to book your in-person ' +
              'interview. Pick the day and hour here: {link} (this link is personal to you).',
  supervisor_ask: '{candidate} picked {slot} for the in-person interview — reply YES ' +
                  'to confirm or NO to propose times.',
  slots_request: 'Could you give me three day/time slots that work best for you?',
  slots_offer_sms: 'Hi {first_name}, our supervisor offered three times for your ' +
                   'interview: {slots}. Pick yours here: {link}',
  confirmed_sms: 'Booked: {candidate} — {slot}. Thank you!',
  confirmed_subject: 'Interview booked — {candidate}',
  confirmed_text: 'The in-person interview is booked.\n\n' +
                  '  Candidate   {candidate}\n' +
                  '  When        {slot}\n\n' +
                  'It is on the hiring calendar; the candidate was e-mailed their confirmation.'
};

// ------------------------------------------------------------------ the tabs…

/** Text-formatted at birth so a typed time never coerces to an 1899 date. */
function interviewAskSheet_() {
  var sheet = hubTabSheet_(INTERVIEW_ASKS_TAB);
  if (sheet) {
    // The days columns arrived later — a grid born before them has to gain them.
    if (!sheet.isRuntimeBacked) ensureHeader_(sheet, INTERVIEW_ASKS_HEADER);
    return sheet;
  }
  sheet = hubTabEnsure_(INTERVIEW_ASKS_TAB, INTERVIEW_ASKS_HEADER);
  sheet.getRange(1, 1, sheet.getMaxRows(), INTERVIEW_ASKS_HEADER.length).setNumberFormat('@');
  return sheet;
}

function interviewAskAiSheet_() {
  var sheet = hubTabSheet_(INTERVIEW_ASK_AI_TAB);
  if (sheet) {
    // A memo written by an older shape widens; a fresh one is stamped whole.
    if (!sheet.isRuntimeBacked) ensureHeader_(sheet, INTERVIEW_ASK_AI_HEADER);
    return sheet;
  }
  return hubTabEnsure_(INTERVIEW_ASK_AI_TAB, INTERVIEW_ASK_AI_HEADER);
}

/** Soft read — no tab yet is an empty list, never an error. */
function interviewAskRows_() {
  try { return readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INTERVIEW_ASKS_TAB); }
  catch (e) { return []; }
}

/** The candidate's OPEN ask (last wins) — one open ask per candidate. */
function interviewAskOpenFor_(cid) {
  var hit = null;
  interviewAskRows_().forEach(function (r) {
    if (str_(r.candidateid) !== cid) return;
    if (str_(r.state) === 'confirmed') return;
    hit = r;
  });
  return hit;
}

// The ask most recently waiting in one of `states` (last question wins).
function interviewAskWaiting_(states, wantRehearsal) {
  var hit = null;
  interviewAskRows_().forEach(function (r) {
    if (states.indexOf(str_(r.state)) === -1) return;
    if (wantRehearsal === true && !interviewAskIsRehearsal_(r)) return;
    if (wantRehearsal === false && interviewAskIsRehearsal_(r)) return;
    if (!hit || str_(r.updatedat) > str_(hit.updatedat)) hit = r;
  });
  return hit;
}

/** Patch one ask row by header name; every change stamps updated_at. */
function interviewAskWrite_(askId, fields) {
  var sheet = interviewAskSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('askid');
  var target = 0;
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) === askId) target = r + 1;   // last wins
  }
  if (!target) return false;
  fields = fields || {};
  fields.updated_at = new Date().toISOString();
  for (var k in fields) {
    if (!fields.hasOwnProperty(k)) continue;
    var i = hdr.indexOf(normKey_(k));
    if (i === -1) continue;
    var cell = sheet.getRange(target, i + 1);
    cell.setNumberFormat('@');
    cell.setValue(str_(fields[k]));
  }
  return true;
}

/** Append one ask row — a fact set in the runtime, cells in a sheet. */
function interviewAskAppend_(row) {
  var sheet = interviewAskSheet_();
  // THE RUNTIME HAS NO GRID PAST ITS LAST ROW.
  if (sheet.isRuntimeBacked) {
    var sub = str_(row && row.ask_id);
    if (!sub) return false;
    return hiringLegacyWrite_(INTERVIEW_ASKS_TAB, sub, row, 'interview-ask:append');
  }
  var atRow = sheet.getLastRow() + 1;
  if (sheet.getMaxRows() < atRow) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  var target = sheet.getRange(atRow, 1, 1, INTERVIEW_ASKS_HEADER.length);
  target.setNumberFormat('@');   // text before the values, or a time coerces
  target.setValues([INTERVIEW_ASKS_HEADER.map(function (h) { return str_(row[h]); })]);
  return true;
}

// ------------------------------------------------------------------ the token — HMAC, personal to one ask…

function interviewLinkSecret_() {
  try {
    return String(hubProp_(INTERVIEW_LINK_SECRET_PROP) || '');
  } catch (e) { return ''; }
}

/** base64url HMAC-SHA256 over ask_id + candidate_id. */
function interviewTokenSig_(askId, candidateId) {
  var secret = interviewLinkSecret_();
  if (!secret) return '';
  var bytes = Utilities.computeHmacSha256Signature(askId + '.' + candidateId, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function interviewTokenFor_(askId, candidateId) {
  var sig = interviewTokenSig_(askId, candidateId);
  return sig ? askId + '.' + sig : '';
}

// The INTERVIEWER's own days-link token — the same HMAC, the literal 'days' where the candidate id would be, so…
function interviewDaysTokenFor_(askId) {
  var sig = interviewTokenSig_(askId, 'days');
  return sig ? askId + '.' + sig : '';
}

/** Resolve an ask from a DAYS token (askId.sig over askId+'.days'). */
function interviewAskByDaysToken_(t) {
  var raw = String(t || '');
  var dot = raw.indexOf('.');
  if (dot < 1) return null;
  var askId = raw.slice(0, dot), sig = raw.slice(dot + 1);
  if (!interviewSigEqual_(sig, interviewTokenSig_(askId, 'days'))) return null;
  var hit = null;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INTERVIEW_ASKS_TAB).forEach(function (a) {
      if (str_(a.askid) === askId) hit = a;   // last row wins
    });
  } catch (e) { hit = null; }
  return hit;
}

/** The stored allowed days of one ask ([] = never chosen = every day open). */
function interviewAllowedDays_(ask) {
  try {
    var arr = JSON.parse(str_(ask && ask.alloweddaysjson) || '[]') || [];
    return arr.filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d)); });
  } catch (e) { return []; }
}

/** Constant-time-ish compare (ServiceIdentity.gs pattern). */
function interviewSigEqual_(a, b) {
  var x = String(a || ''), y = String(b || '');
  if (!x || !y || x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= (x.charCodeAt(i) ^ y.charCodeAt(i));
  return diff === 0;
}

// Token → its ask row, or null.
function interviewAskByToken_(t) {
  var m = String(t == null ? '' : t).match(/^(ASK_[A-Z0-9]{6,})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  if (!interviewLinkSecret_()) return null;
  var hit = null;
  interviewAskRows_().forEach(function (r) {
    if (str_(r.askid) === m[1]) hit = r;   // last wins
  });
  if (!hit) return null;
  var expected = interviewTokenSig_(m[1], str_(hit.candidateid));
  if (!expected || !interviewSigEqual_(m[2], expected)) return null;
  return hit;
}

// ------------------------------------------------------------------ slots — shape first, never parsed…

/** YYYY-MM-DD + one of the three company periods, by SHAPE. */
function interviewSlotShapeOk_(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  return INTERVIEW_SLOT_TIMES.indexOf(String(time || '')) !== -1;
}

/** 'Tuesday, Sep 1 at 2:00 PM' — built from PARTS, never a parsed string. */
function interviewSlotLabel_(date, time) {
  var m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(date || '') + (time ? ' at ' + time : '');
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  var wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  var mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return wd + ', ' + mo + ' ' + d.getDate() + (time ? ' at ' + interviewTimeLabel_(time) : '');
}

function interviewTimeLabel_(t) {
  var m = String(t || '').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(t || '');
  var h = Number(m[1]);
  var ap = h >= 12 ? 'PM' : 'AM';
  var hh = h % 12;
  if (hh === 0) hh = 12;
  return hh + ':' + m[2] + ' ' + ap;
}

/** Today where the company is, as text. */
function interviewTodayText_() {
  var tz = (typeof hiringTimeZone_ === 'function') ? hiringTimeZone_() : 'America/New_York';
  try { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

// The AI reports words; THIS validates.
function interviewSlotsValid_(slots, today) {
  // ONE TO SIX.
  if (!slots || !slots.length || slots.length > 6) return [];
  var out = [], seen = {};
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i] || {};
    var date = str_(s.date), time = str_(s.time);
    if (!interviewSlotShapeOk_(date, time)) return [];
    if (date <= String(today || '')) return [];
    var m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    // a rolled-over Feb 31 is an invented day
    if (d.getDate() !== Number(m[3]) || (d.getMonth() + 1) !== Number(m[2])) return [];
    var dow = d.getDay();
    if (dow === 0 || dow === 6) return [];
    var k = date + 'T' + time;
    if (seen[k]) return [];
    seen[k] = true;
    out.push({ date: date, time: time });
  }
  return out;
}

/** Confirmed interview slots ('YYYY-MM-DDTHH:MM') — no names ever leave. */
function interviewTakenSlots_() {
  var taken = [];
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), HIRING_EVENTS_TAB).forEach(function (r) {
      if (str_(r.eventtype) !== 'in_person_interview') return;
      if (str_(r.status).toLowerCase() === 'cancelled') return;
      var day = hiringDateText_(r.date), tm = hiringTimeText_(r.time);
      if (day && tm) taken.push(day + 'T' + tm);
    });
  } catch (e) { /* tab not born yet — nothing is taken */ }
  return taken;
}

/** Where interviews happen: the last confirmed one's location, or Office. */
function interviewLastLocation_() {
  var loc = '';
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), HIRING_EVENTS_TAB).forEach(function (r) {
      if (str_(r.eventtype) !== 'in_person_interview') return;
      if (str_(r.location)) loc = str_(r.location);   // last wins
    });
  } catch (e) { loc = ''; }
  return loc || 'Office';
}

// ------------------------------------------------------------------ the supervisor — resolved at runtime, never…

// WHO CONFIRMS AN INTERVIEW — THE BADGE DECIDES (HIRING card step 12: the interviewer is found by the INTERVIEWER…
function interviewSupervisor_() {
  if (typeof hiringInterviewerPick_ !== 'function') return { name: '', phone: '', email: '' };
  var p = hiringInterviewerPick_('');
  return { name: p.name, phone: p.phone, email: p.email, by: p.by, user_id: p.user_id };
}

// Is this ask row about a rehearsal card?
function interviewAskIsRehearsal_(ask) {
  return str_(ask && ask.candidatename).toLowerCase().indexOf('[test]') === 0;
}

// WHO IS ASKED ABOUT THIS ASK.
function interviewSupervisorFor_(ask) {
  if (interviewAskIsRehearsal_(ask) && typeof hiringSimActors_ === 'function') {
    var a = hiringSimActors_();
    if (a.interviewer_email || a.interviewer_phone) {
      return { name: a.interviewer_name || 'the simulation interviewer',
               email: a.interviewer_email, phone: a.interviewer_phone,
               by: 'the simulation interviewer actor — this ask is about a rehearsal card',
               user_id: '' };
    }
  }
  return interviewSupervisor_();
}

/** The situation row, or null when absent/OFF — fail closed, seed law. */
function interviewSituation_(id) {
  var sit = null;
  try {
    smartSituations_().forEach(function (s) {
      if (str_(s.id) === id) sit = s;
    });
  } catch (e) { sit = null; }
  if (!sit || !smartOn_(sit.enabled)) return null;
  return sit;
}

// ------------------------------------------------------------------ interviewInviteSend — the recruiter's button…

HUB_POLICY.interviewInviteSend = {
  file: 'InterviewFlow.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend', 'smsSend']
};
/** Send the personal scheduling link — e-mail always, SMS when a phone exists. */
HUB_ACTIONS.interviewInviteSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  if (!interviewLinkSecret_()) {
    return { status: 200, data: { invited: false, reason: 'no_link_secret' } };
  }
  // Resolved ONCE for the whole press: the gate, the ledger key and the record must name the SAME row even if…
  var invSitId = commSituationId_('hiring.interview.invitation', 'interview_invite');
  var sit = interviewSituation_(invSitId);
  if (!sit) return { status: 200, data: { invited: false, reason: 'situation_off' } };

  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var name = str_(ev.cand.candidatename);
  var email = str_(ev.cand.email);
  var phone = (typeof simSendablePhone_ === 'function')
    ? simSendablePhone_(str_(ev.cand.phone)) : packetSendableNumber_(str_(ev.cand.phone));
  if (!email && !phone) {
    return { status: 200, data: { invited: false, reason: 'no_email_no_phone' } };
  }

 // ONE APPOINTMENT, ONE LINK (the runaway morning): a client retry of a slow press used to send a SECOND link and…
  var openEarly = interviewAskOpenFor_(cid);
  var openSt = openEarly ? str_(openEarly.state) : '';
  // states past the LINK refuse a re-send; the days states pass through — they come BEFORE the link
  if (openEarly && ['picked', 'picked2', 'supervisor_asked', 'slots_offered', 'confirmed']
        .indexOf(openSt) !== -1) {
    return { status: 200, data: { invited: false, reason: 'already_scheduled',
             detail: 'this candidate already moved past the link (' + openSt + ') — one appointment, one link',
             ask_id: str_(openEarly.askid) } };
  }
  // THE INTERVIEWER'S DAYS COME FIRST — INSIDE THIS SAME STEP: before 'the candidate picks their own time' the…
  var earlyDays = openEarly ? interviewAllowedDays_(openEarly) : [];
  if (!earlyDays.length) {
    if (openEarly && str_(openEarly.daysaskedat)) {
      // she was asked already and has not chosen yet — the calendar waits
      return { status: 200, data: { invited: false, reason: 'waiting_interviewer_days',
               detail: 'the interviewer was asked to choose the days and has not answered yet — ' +
                       'the candidate\'s calendar goes out by itself the moment she does',
               ask_id: str_(openEarly.askid) } };
    }
    // first touch: ask HER now, through the same door the step map knows
    var daysOut = null;
    try {
      daysOut = HUB_ACTIONS.interviewDaysAskSend({ candidate_id: cid }, user);
    } catch (eDA) { daysOut = null; }
    var dd = (daysOut && daysOut.data) ? daysOut.data : {};
    // the rehearsal's actor may have chosen ALREADY — and her save sent the candidate's calendar itself; a second…
    var after = interviewAskOpenFor_(cid);
    if (after && interviewAllowedDays_(after).length) {
      return { status: 200, data: { invited: false, reason: 'calendar_sent_with_days',
               detail: 'the interviewer actor chose the days and the candidate\'s calendar went ' +
                       'out with her save — one appointment, one link',
               interviewer: dd.interviewer || '', ask_id: str_(after.askid) } };
    }
    return { status: 200, data: { invited: false, reason: 'interviewer_days_asked',
             detail: 'the calendar went to the interviewer FIRST (' + (dd.interviewer || 'by badge') +
                     ', e-mail + OpenPhone) — the candidate\'s calendar goes out by itself the ' +
                     'moment she chooses her days',
             interviewer: dd.interviewer || '', ask_id: after ? str_(after.askid) : '' } };
  }

  // BEFORE STEP 9, STILL WITHOUT THE CJIS → ASK ARTHUR AGAIN: before step 9, if the CJIS is still missing, Arthur…
  try {
    var aCj = ev.analysis || {};
    var cjSt = str_(aCj.cjisstatus).toLowerCase();
    var haveCjis = hubCjisCleared_(aCj) || cjSt === 'on file' || !!str_(aCj.cjisreporturl);
    // an OPEN ask means the recheck step (or step 3) already asked and no answer came yet — the invite must not…
    var askOpen = false;
    try {
      askOpen = simAskRows_().some(function (r) {
        return str_(r.state) === 'open' && str_(r.step) === 'cjis_request' &&
               str_(r.candidateid) === cid;
      });
    } catch (eAsk) { askOpen = false; }
    if (!haveCjis && !askOpen && typeof HUB_ACTIONS !== 'undefined' && HUB_ACTIONS.hiringCjisRequestSend) {
      // no_auto: the letters go NOW and the sweep's ears do the rest — the full auto chain (Drive upload, API…
      HUB_ACTIONS.hiringCjisRequestSend({ candidate_id: cid, no_auto: true }, user);
      journeyLog_({ candidate_id: cid, name: name, step: 'schedule_invite', channel: 'email',
                    ok: true,
                    detail: 'still no CJIS before the interview invite — Arthur was asked AGAIN ' +
                            '(e-mail + Quo together), non-blocking: the invite goes out either way',
                    by: str_(user && user.email) });
    }
  } catch (eCj) { /* the re-ask never holds the invite */ }

  // one OPEN ask per candidate — reuse it so the old link keeps working
  var open = interviewAskOpenFor_(cid);
  var askId = open ? str_(open.askid) : 'ASK_' + randomHex_(10).toUpperCase();
  var now = new Date().toISOString();
  if (!open) {
    // THE LETTER NEVER LEAVES BEFORE THE ASK EXISTS.
    if (!interviewAskAppend_({
      ask_id: askId, candidate_id: cid, candidate_name: name,
      candidate_email: email, candidate_phone: phone, state: 'invited',
      invited_at: now, invited_by: 'asa-hub:' + str_(user && user.email), updated_at: now
    })) {
      return { status: 500, message: 'The interview ask did not land in the store — ' +
                                     'no invite was sent.' };
    }
  }
  var link = INTERVIEW_LINK_BASE + interviewTokenFor_(askId, cid);

  // one invite per ask per day — the ledger is the memory
  var today = interviewTodayText_();
  var key = smartLedgerKey_(invSitId, cid + ':' + askId, today);
  try {
    if (smartAlreadySent_()[key]) return { status: 200, data: { invited: false, reason: 'already_told' } };
  } catch (eK) { /* an unreadable ledger must not block the invite */ }

  var vars = { name: name,
               first_name: (typeof hiringGreetFirst_ === 'function')
                 ? hiringGreetFirst_(name) : (name.split(/\s+/)[0] || name),
               link: link };
  var emailed = false, smsed = false, redirected = false, failures = [];
 // THE FENCE — a candidate leg outside the configured cast is refused out loud, test mode or not.
  if (typeof simOutboundAllowed_ === 'function') {
    var fE = simOutboundAllowed_(email);
    if (email && !fE.ok) { failures.push('email: ' + fE.detail); email = ''; }
    var fS = simOutboundAllowed_(phone);
    if (phone && !fS.ok) { failures.push('sms: ' + fS.detail); phone = ''; }
  }
  if (email) {
    // the cells carry the overriding words; the builder shells them (or answers whole when a cell is empty), so an…
    var built = interviewInviteEmail_({
      name: name, link: link,
      subject: str_(sit.email_subject) ? hiringRenderMail_(str_(sit.email_subject), vars) : '',
      bodyText: str_(sit.email_text) ? hiringRenderMail_(str_(sit.email_text), vars) : ''
    });
    var invRehearsal = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);
    var rm = rpcCall_('emailSend', {
      to: email,
      subject: (invRehearsal && typeof simTagSubject_ === 'function')
        ? simTagSubject_(built.subject) : built.subject,
      body: built.text, html: built.html,
      cc: (invRehearsal && typeof simCcFor_ === 'function') ? simCcFor_(email) : '',
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.invite_by', ''),
                                { name: name, who: str_(user && user.email) })
    }, { idempotency_key: 'iask_inv_mail_' + askId + '_' + today });
    if (rm && rm.ok && rm.sent) { emailed = true; if (rm.redirected) redirected = true; }
    else if (rm && !rm.ok) failures.push('email: ' + str_(rm.error));
  }
  if (phone) {
    var smsBody = hiringRenderMail_(str_(sit.sms_text) || INTERVIEW_ASK_FALLBACK.invite_sms, vars);
    var rs = rpcCall_('smsSend', {
      to: phone, body: smsBody,
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.invite', ''), { name: name })
    }, { idempotency_key: 'iask_inv_sms_' + askId + '_' + today });
    if (rs && rs.ok && rs.sent) { smsed = true; if (rs.redirected) redirected = true; }
    else if (rs && !rs.ok) failures.push('sms: ' + str_(rs.error));
  }

  if (emailed || smsed) {
    // a redirected send reached the TESTERS — remembered as a rehearsal
    try {
      smartRecord_(redirected ? smartRehearsalKey_(key) : key, invSitId,
                   cid + ':' + askId, today,
                   redirected ? 'rehearsal' : (emailed && smsed ? 'email+sms' : (emailed ? 'email' : 'sms')));
    } catch (eR) {}
    interviewAskWrite_(askId, {});   // stamps updated_at; the state stays
 // The attempt book: the invite is retryable configured clock until the candidate picks — the retry pass watches…
    if (typeof simTrackSend_ === 'function' &&
        typeof simIsRehearsalCid_ === 'function' && simIsRehearsalCid_(cid)) {
      try { simTrackSend_('invite', cid, 'interviewInviteSend', { candidate_id: cid }); }
      catch (eT) { /* the invite went; the book is a convenience */ }
    }
 // THE CANDIDATE PICKS BY ITSELF while the auto-actor is on: the next really-free slot, through the real public…
    if (typeof simAutoPick_ === 'function') {
      try { simAutoPick_(cid); } catch (eAP) { /* the journey reports the pick */ }
    }
  }
  try {
    hubSysLog_(str_(user && user.email), 'interview_invite_send',
               cid + ' — ' + name + (emailed ? ' email' : '') + (smsed ? ' sms' : ''), { status: 200 });
  } catch (eL) {}
  if (typeof journeyLog_ === 'function') {
    journeyLog_({ candidate_id: cid, name: name, step: 'schedule_invite',
                  channel: (emailed ? 'email' : '') + (smsed ? (emailed ? '+sms' : 'sms') : ''),
                  to: email || phone, ok: (emailed || smsed), rehearsal: redirected,
                  ref: askId,
                  detail: (emailed || smsed)
                    ? 'sent their personal scheduling link'
                    : ('nothing went — ' + (failures.join('; ') || 'gated')),
                  by: str_(user && user.email) });
  }
  if (!emailed && !smsed) {
    return { status: 200, data: { invited: false, reason: failures.join('; ') || 'gated', ask_id: askId } };
  }
 // THE LINK COMES BACK TO THE CALLER.
  return { status: 200, data: { invited: true, emailed: emailed, smsed: smsed,
           redirected: redirected, ask_id: askId, first_name: vars.first_name,
           link: link } };
};

// ------------------------------------------------------------------ the public doors — token-gated, beside…

/** Platform-wide hourly throttle, the referralSubmit shape. */
function interviewPubThrottled_(kind, cap) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get('iask_pub_' + kind) || '0');
    if (n >= cap) return true;
    cache.put('iask_pub_' + kind, String(n + 1), 3600);
  } catch (e) { /* cache down: the door stays open */ }
  return false;
}

/** What the page draws: mode + the offered three, or the open grid + taken. */
function interviewSlotContextPub_(payload) {
  if (interviewPubThrottled_('ctx', 240)) {
    return { status: 429, message: 'Too many requests right now — please try again in a few minutes.' };
  }
  // THE INTERVIEWER'S OWN LINK FIRST: the days token opens the day-picking view — never the candidate's grid.
  var dAsk = interviewAskByDaysToken_(payload && payload.t);
  if (dAsk) {
    // THE INTERVIEWER PICKS SLOTS, NOT DAYS — a decent, good-looking calendar where the interviewer chooses the day…
    if (str_(dAsk.state) === 'confirmed') {
      var whenC = str_(dAsk.confirmeddate)
        ? ' for ' + interviewSlotLabel_(str_(dAsk.confirmeddate), str_(dAsk.confirmedtime)) : '';
      return { status: 409, message: 'This interview is already booked' + whenC +
               ' — it is on the Calendar app, and there is nothing more to pick here.' };
    }
    var wanted = str_(dAsk.supervisorreply) === 'candidate_rejected_slots' ? 6 : 3;
    var already = [];
    try { already = JSON.parse(str_(dAsk.slotsjson) || '[]') || []; } catch (eJs) { already = []; }
    return { status: 200, data: {
      mode: 'slots',
      candidate_first: str_(dAsk.candidatename).split(/\s+/)[0] || '',
      slots_wanted: wanted,
      chosen_slots: already,
      times: INTERVIEW_SLOT_TIMES,
      taken: interviewTakenSlots_(),
      horizon_days: 30
    } };
  }
  var ask = interviewAskByToken_(payload && payload.t);
  if (!ask) {
    return { status: 404, message: 'This link is no longer valid — please reach out and we will send a fresh one.' };
  }
  var first = str_(ask.candidatename).split(/\s+/)[0] || '';
  if (str_(ask.state) === 'confirmed') {
    var when = str_(ask.confirmeddate)
      ? ' for ' + interviewSlotLabel_(str_(ask.confirmeddate), str_(ask.confirmedtime)) : '';
    return { status: 409, message: 'Your interview is already booked' + when +
             '. If you need to move it, reply to our message and we will help.' };
  }
  if (str_(ask.state) === 'slots_offered') {
    var slots = [];
    try { slots = JSON.parse(str_(ask.slotsjson) || '[]') || []; } catch (eJ) { slots = []; }
    slots = slots.filter(function (s) { return s && interviewSlotShapeOk_(str_(s.date), str_(s.time)); })
                 .map(function (s) { return { date: str_(s.date), time: str_(s.time) }; });
    if (slots.length) {
      return { status: 200, data: { candidate_first: first, mode: 'choose3', slots: slots,
               times: INTERVIEW_SLOT_TIMES } };
    }
    // an unreadable offer falls back to the open grid, not to a dead page
  }
 // THE HOURS TRAVEL WITH THE CONTEXT.
  return { status: 200, data: { candidate_first: first, mode: 'pick',
           taken: interviewTakenSlots_(), times: INTERVIEW_SLOT_TIMES,
           allowed_days: interviewAllowedDays_(ask) } };
}

// The INTERVIEWER's day choice, stored — and the dictated sequence follows by itself: she chooses, it is stored…

// THE INTERVIEWER'S SAVE: her calendar posts the chosen date+time pairs here.
function interviewSlotsSubmitPub_(payload) {
  if (interviewPubThrottled_('slots', 60)) {
    return { status: 429, message: 'Too many requests right now — please try again in a few minutes.' };
  }
  var ask = interviewAskByDaysToken_(payload && payload.t);
  if (!ask) {
    return { status: 404, message: 'This link is no longer valid — please reach out and we will send a fresh one.' };
  }
  var cid = str_(ask.candidateid);
  var raw = (payload && payload.slots) || [];
  if (!Array.isArray(raw)) raw = [];
  var today = interviewTodayText_();
  var valid = interviewSlotsValid_(raw.map(function (x) {
    return { date: str_(x && x.date), time: str_(x && x.time) };
  }), today);
  // different days — the dictation's own requirement
  var seenDays = {};
  valid = valid.filter(function (x) {
    if (seenDays[x.date]) return false;
    seenDays[x.date] = true;
    return true;
  });
  var wanted = str_(ask.supervisorreply) === 'candidate_rejected_slots' ? 6 : 3;
  // ONE is enough — the three exist so SHE has freedom of choice before the candidate — the candidate adapts to HER…
  if (valid.length < 1) {
    return { status: 400, message: 'Please pick at least one valid time — a future weekday, ' +
             'inside our interview hours.' };
  }
  if (valid.length > wanted) valid = valid.slice(0, wanted);
  var taken = interviewTakenSlots_();
  for (var i = 0; i < valid.length; i++) {
    if (taken.indexOf(valid[i].date + 'T' + valid[i].time) !== -1) {
      return { status: 409, message: interviewSlotLabel_(valid[i].date, valid[i].time) +
               ' was just booked for somebody else — please swap that one.' };
    }
  }
  interviewAskWrite_(str_(ask.askid), {
    state: 'slots_offered', slots_json: JSON.stringify(valid),
    offered_at: new Date().toISOString(), supervisor_reply: 'slots'
  });
  try { simAskAnswer_(['interview_slots'], 'she chose her slots on the calendar', cid); } catch (eA) {}
  try { interviewSlotsOffer_(ask, valid); } catch (eO) {
    hubSysLog_('interview:public', 'interview_slots_offer_failed',
               str_(ask.askid) + ' — ' + String((eO && eO.message) || eO), { status: 500 });
  }
  journeyLog_({ candidate_id: cid, name: str_(ask.candidatename), step: 'interviewer_days',
                channel: 'page', ok: true, ref: str_(ask.askid),
                detail: 'the interviewer chose ' + valid.length + ' slot(s) on her calendar — ' +
                        'the candidate\'s own link goes out by itself',
                by: 'the interviewer' });
  return { status: 200, data: { received: true, offered: valid.length } };
}

function interviewDaysSubmitPub_(payload) {
  if (interviewPubThrottled_('days', 60)) {
    return { status: 429, message: 'Too many requests right now — please try again in a few minutes.' };
  }
  var ask = interviewAskByDaysToken_(payload && payload.t);
  if (!ask) {
    return { status: 404, message: 'This link is no longer valid — please ask for a fresh one.' };
  }
  var days = (payload && payload.days) || [];
  if (!Array.isArray(days)) days = [];
  days = days.map(String).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); });
  // only future days count, and at least one must survive
  var today = new Date(); today.setHours(0, 0, 0, 0);
  days = days.filter(function (d) { return new Date(d + 'T23:59:59') > today; });
  if (!days.length) {
    return { status: 400, message: 'Pick at least one day the interview can happen.' };
  }
  var askId = str_(ask.askid);
  interviewAskWrite_(askId, {
    allowed_days_json: JSON.stringify(days.slice(0, 31)),
    days_chosen_at: new Date().toISOString()
  });
 // SHE PICKED, SO THE ASKING STOPS.
  try { simAskAnswer_(['interview_days'], 'she chose her days', str_(ask.candidateid)); }
  catch (eA) { /* the retry pass re-presses, and the door is idempotent */ }
  journeyLog_({ candidate_id: str_(ask.candidateid), name: str_(ask.candidatename),
                step: 'interviewer_days', channel: 'web', ok: true,
                detail: 'the interviewer chose ' + days.length + ' day(s) for the calendar (' +
                        days.slice(0, 5).join(', ') + (days.length > 5 ? '…' : '') +
                        ') — every other day paints gray and blocked',
                by: 'asa-hub:interviewer-days' });
  // …and then the calendar goes to the candidate — the stored days release it.
  var invited = null;
  try {
    if (typeof HUB_ACTIONS !== 'undefined' && HUB_ACTIONS.interviewInviteSend) {
      invited = HUB_ACTIONS.interviewInviteSend({ candidate_id: str_(ask.candidateid) },
        { role: 'manager', email: 'interview-days@service.local', id: 'SVC_INTERVIEW_DAYS' });
    }
  } catch (eI) { invited = null; }
  return { status: 200, data: { saved: true, days: days,
           calendar_sent: !!(invited && invited.data && invited.data.invited) } };
}

/** The candidate's pick. Records it, then asks (or confirms with) the supervisor. */
function interviewSlotSubmitPub_(payload) {
  if (interviewPubThrottled_('submit', 60)) {
    return { status: 429, message: 'Too many requests right now — please try again in a few minutes.' };
  }
  var ask = interviewAskByToken_(payload && payload.t);
  if (!ask) {
    return { status: 404, message: 'This link is no longer valid — please reach out and we will send a fresh one.' };
  }
  var date = str_(payload && payload.date), time = str_(payload && payload.time);
  if (!interviewSlotShapeOk_(date, time)) {
    return { status: 400, message: 'Pick a day and one of the listed hours.' };
  }
  var askId = str_(ask.askid);
  var state = str_(ask.state);
  if (state === 'confirmed') {
    return { status: 200, data: { received: true,
             message: 'Your interview is already booked — nothing more to do.' } };
  }

  // THE INTERVIEWER'S DAYS ARE LAW, NOT PAINT: the page grays the blocked days, and this door refuses them too…
  var allowedDays = interviewAllowedDays_(ask);
  if (allowedDays.length && allowedDays.indexOf(date) === -1) {
    return { status: 409, message: 'That day is not available for the interviewer — please pick one of the open days on the calendar.' };
  }

  if (state === 'slots_offered') {
    // NONE OF THESE WORK: the interviewer is told it is the SAME candidate, the dates did not suit them, and six…
    if (payload && (payload.none === true || str_(payload.none) === 'true')) {
      interviewAskWrite_(askId, { state: 'slots_requested', slots_json: '',
                                  supervisor_reply: 'candidate_rejected_slots' });
      try {
        HUB_ACTIONS.interviewSlotsAsk(
          { candidate_id: str_(ask.candidateid), slots_wanted: '6' },
          { role: 'manager', email: 'interview-slots@service.local', id: 'SVC_INTERVIEW_SLOTS' });
      } catch (eRe) { /* the retry rung re-asks */ }
      journeyLog_({ candidate_id: str_(ask.candidateid), name: str_(ask.candidatename),
                    step: 'candidate_picked', channel: 'page', ok: true, ref: askId,
                    detail: 'none of the offered slots worked for the candidate — the ' +
                            'interviewer is asked for six different ones',
                    by: 'the candidate' });
      return { status: 200, data: { received: true, reoffered: true } };
    }
    // the pick must BE one of the offered slots
    var offered = [];
    try { offered = JSON.parse(str_(ask.slotsjson) || '[]') || []; } catch (eO) { offered = []; }
    var isOffered = offered.some(function (s) {
      return s && str_(s.date) === date && str_(s.time) === time;
    });
    if (!isOffered) {
      return { status: 400, message: 'That time is not one of the offered slots — pick one of the listed ones.' };
    }
    interviewAskWrite_(askId, { picked_date: date, picked_time: time, state: 'picked2' });
    var conf = interviewAskConfirm_(ask, date, time, 'candidate picked one of the three');
    if (conf.ok) {
      interviewSupervisorTell_(ask, date, time, true);   // e-mail AND SMS
    } else {
      hubSysLog_('interview:public', 'interview_pick2_confirm_failed',
                 askId + ' — ' + conf.reason, { status: 500 });
    }
    return { status: 200, data: { received: true } };
  }

  // the open grid: a slot another candidate confirmed is not offered twice
  if (interviewTakenSlots_().indexOf(date + 'T' + time) !== -1) {
    return { status: 409, message: 'That time was just taken — please pick another.' };
  }
  interviewAskWrite_(askId, { picked_date: date, picked_time: time, state: 'picked' });
  if (typeof journeyLog_ === 'function') {
    journeyLog_({ candidate_id: str_(ask.candidateid), name: str_(ask.candidatename),
                  step: 'candidate_picked', channel: 'page', ok: true, ref: askId,
                  detail: 'the candidate chose ' + interviewSlotLabel_(date, time),
                  by: 'the candidate' });
  }
  var asked = interviewSupervisorAsk_(ask, date, time);
  if (asked.sent) {
    interviewAskWrite_(askId, { state: 'supervisor_asked',
                                supervisor_asked_at: new Date().toISOString() });
 // THE INTERVIEWER ACTOR ANSWERS BY ITSELF — rehearsal asks only, AFTER the state write so the applier finds a…
    if (typeof simAutoInterviewerYes_ === 'function' && interviewAskIsRehearsal_(ask)) {
      try { simAutoInterviewerYes_(); } catch (eAY) { /* the ask waits for a real reply */ }
    }
  } else {
    hubSysLog_('interview:public', 'interview_supervisor_ask_skipped',
               askId + ' — ' + str_(asked.reason), { status: 200 });
  }
  return { status: 200, data: { received: true } };
}

// ------------------------------------------------------------------ the supervisor conversation…

// '<candidate> picked <slot> — YES or NO' (card step 10).
function interviewSupervisorAsk_(ask, date, time) {
  var sit = interviewSituation_(commSituationId_('hiring.interview.supervisor_request', 'interview_supervisor_ask'));
  if (!sit) return { sent: false, reason: 'situation_off' };
  var sup = interviewSupervisorFor_(ask);
  if (!sup.email && !sup.phone) {
    return { sent: false, reason: 'no_interviewer',
             detail: str_(sup.by) || 'nobody holds the INTERVIEWER badge' };
  }
  var cid = str_(ask.candidateid);
  var slot = interviewSlotLabel_(date, time);
  var vars = { candidate: str_(ask.candidatename), slot: slot };
  var out = { sent: false, emailed: false, smsed: false, redirected: false,
              interviewer: sup.name, resolved_by: str_(sup.by), failures: [] };

  if (sup.email) {
    // The candidate's own facts, read once, so the answer can be given without opening anything.
    var facts = [];
    try {
      var ev = hubEvidence_(cid);
      facts = hiringCandidateFacts_(ev.cand, ev.analysis);
    } catch (eF) { facts = []; }
    var letter = interviewerAvailabilityEmail_({
      interviewer: sup.name, name: str_(ask.candidatename), slot: slot, facts: facts,
      subject: hiringRenderMail_(str_(sit.email_subject) || '', vars) || '',
      bodyText: str_(sit.email_text) ? hiringRenderMail_(str_(sit.email_text), vars) : ''
    });
    var rm = rpcCall_('emailSend', {
      to: sup.email,
      subject: (interviewAskIsRehearsal_(ask) && typeof simTagSubject_ === 'function')
        ? simTagSubject_(letter.subject) : letter.subject,
      body: letter.text, html: letter.html,
      cc: (interviewAskIsRehearsal_(ask) && typeof simCcFor_ === 'function')
        ? simCcFor_(sup.email) : '',
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.interviewer_ask', ''), { id: cid })
    }, { idempotency_key: 'iask_sup_mail_' + str_(ask.askid) + '_' + date + 'T' + time });
    if (rm && rm.ok && rm.sent) { out.emailed = true; out.sent = true; out.redirected = out.redirected || !!rm.redirected; }
    else out.failures.push('email: ' + str_((rm && (rm.error || rm.reason || rm.detail)) || 'send_failed'));
  }

  if (sup.phone) {
    var body = hiringRenderMail_(str_(sit.sms_text) || INTERVIEW_ASK_FALLBACK.supervisor_ask, vars);
    var r = rpcCall_('smsSend', {
      to: sup.phone, body: body,
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.supervisor_ask', ''), { id: cid })
    }, { idempotency_key: 'iask_sup_' + str_(ask.askid) + '_' + date + 'T' + time });
    if (r && r.ok && r.sent) { out.smsed = true; out.sent = true; out.redirected = out.redirected || !!r.redirected; }
    else out.failures.push('sms: ' + str_((r && (r.reason || r.error || r.detail)) || 'send_failed'));
  }

  if (typeof journeyLog_ === 'function') {
    journeyLog_({ candidate_id: cid, name: str_(ask.candidatename), step: 'interviewer_ask',
                  channel: (out.emailed ? 'email' : '') + (out.smsed ? (out.emailed ? '+sms' : 'sms') : ''),
                  to: sup.email || sup.phone, ok: out.sent, rehearsal: out.redirected,
                  detail: 'asked ' + (sup.name || 'the badge holder') + ' about ' + slot +
                          ' (' + str_(sup.by) + ')' +
                          (out.failures.length ? ' · ' + out.failures.join(' · ') : ''),
                  ref: str_(ask.askid), by: 'asa-hub:interview-flow' });
  }
  if (!out.sent) out.reason = out.failures.join(' · ') || 'send_failed';
  return out;
}

/** After a NO: ask her for three slots, by SMS. */
function interviewSlotsRequest_(ask) {
  var sit = interviewSituation_(commSituationId_('hiring.interview.supervisor_slots', 'interview_supervisor_slots_request'));
  if (!sit) return { sent: false, reason: 'situation_off' };
  var sup = interviewSupervisorFor_(ask);
  if (!sup.phone) return { sent: false, reason: 'no_supervisor_phone' };
  var body = hiringRenderMail_(str_(sit.sms_text) || INTERVIEW_ASK_FALLBACK.slots_request,
    { candidate: str_(ask.candidatename) });
  var r = rpcCall_('smsSend', {
    to: sup.phone, body: body,
    reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.slots_request', ''),
                              { id: str_(ask.candidateid) })
  }, { idempotency_key: 'iask_slotreq_' + str_(ask.askid) });
  return { sent: !!(r && r.ok && r.sent) };
}

// THE THANK YOU, AND THE BOOKING (card step 10: a yes from the candidate is answered with a letter of thanks).
function interviewSupervisorTell_(ask, date, time, withEmail) {
  var sit = interviewSituation_(commSituationId_('hiring.interview.confirmed', 'interview_confirmed'));
  if (!sit) return { sent: false, reason: 'situation_off' };
  var sup = interviewSupervisorFor_(ask);
  var slot = interviewSlotLabel_(date, time);
  var vars = { candidate: str_(ask.candidatename), slot: slot };
  var askId = str_(ask.askid);
  var out = { sent: false, emailed: false, smsed: false };
  if (sup.phone) {
    var r = rpcCall_('smsSend', {
      to: sup.phone,
      body: hiringRenderMail_(str_(sit.sms_text) || INTERVIEW_ASK_FALLBACK.confirmed_sms, vars),
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.booked_receipt', ''),
                                { id: str_(ask.candidateid) })
    }, { idempotency_key: 'iask_conf_sms_' + askId });
    if (r && r.ok && r.sent) { out.sent = true; out.smsed = true; }
  }
  // withEmail is kept in the signature for the callers that pass it, but the letter no longer waits for permission…
  if (sup.email) {
    var letter = interviewerThanksEmail_({
      interviewer: sup.name, name: str_(ask.candidatename), slot: slot,
      location: interviewLastLocation_(),
      subject: hiringRenderMail_(str_(sit.email_subject) || INTERVIEW_ASK_FALLBACK.confirmed_subject, vars),
      bodyText: str_(sit.email_text) ? hiringRenderMail_(str_(sit.email_text), vars) : ''
    });
    var rm = rpcCall_('emailSend', {
      to: sup.email,
      subject: (interviewAskIsRehearsal_(ask) && typeof simTagSubject_ === 'function')
        ? simTagSubject_(letter.subject) : letter.subject,
      body: letter.text, html: letter.html,
      cc: (interviewAskIsRehearsal_(ask) && typeof simCcFor_ === 'function')
        ? simCcFor_(sup.email) : '',
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.booked_receipt', ''),
                                { id: str_(ask.candidateid) })
    }, { idempotency_key: 'iask_conf_mail_' + askId });
    if (rm && rm.ok && rm.sent) { out.sent = true; out.emailed = true; }
  }
  return out;
}

/** The three slots to the CANDIDATE — same personal link, page turns 3-choice. */
function interviewSlotsOffer_(ask, slots) {
  var sit = interviewSituation_(commSituationId_('hiring.interview.slots_offer', 'interview_slots_offer'));
  if (!sit) return { sent: false, reason: 'situation_off' };
  var token = interviewTokenFor_(str_(ask.askid), str_(ask.candidateid));
  if (!token) return { sent: false, reason: 'no_link_secret' };
  var link = INTERVIEW_LINK_BASE + token;
  var labels = slots.map(function (s) { return interviewSlotLabel_(s.date, s.time); });
  var name = str_(ask.candidatename);
  // {slots} reads inline in an SMS and as its own lines in a letter
  var vars = { name: name,
               first_name: (typeof hiringGreetFirst_ === 'function')
                 ? hiringGreetFirst_(name) : (name.split(/\s+/)[0] || name),
               link: link, slots: labels.join(' · ') };
  var mailVars = { name: vars.name, first_name: vars.first_name,
                   link: link, slots: labels.map(function (l) { return '  ' + l; }).join('\n') };
  var askId = str_(ask.askid);
  var email = str_(ask.candidateemail);
  var phone = (typeof simSendablePhone_ === 'function')
    ? simSendablePhone_(str_(ask.candidatephone)) : packetSendableNumber_(str_(ask.candidatephone));
  var out = { sent: false };
 // THE FENCE — the slots offer is a candidate leg too.
  if (typeof simOutboundAllowed_ === 'function') {
    var fE2 = simOutboundAllowed_(email);
    if (email && !fE2.ok) { out.blocked_email = fE2.detail; email = ''; }
    var fS2 = simOutboundAllowed_(phone);
    if (phone && !fS2.ok) { out.blocked_sms = fS2.detail; phone = ''; }
  }
  if (email) {
    var built = interviewInviteEmail_({
      name: name, link: link, slots: labels,
      subject: str_(sit.email_subject) ? hiringRenderMail_(str_(sit.email_subject), mailVars) : '',
      bodyText: str_(sit.email_text) ? hiringRenderMail_(str_(sit.email_text), mailVars) : ''
    });
    var rm = rpcCall_('emailSend', {
      to: email,
      subject: (interviewAskIsRehearsal_(ask) && typeof simTagSubject_ === 'function')
        ? simTagSubject_(built.subject) : built.subject,
      body: built.text, html: built.html,
      cc: (interviewAskIsRehearsal_(ask) && typeof simCcFor_ === 'function')
        ? simCcFor_(email) : '',
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.slots_offered', ''),
                                { id: str_(ask.candidateid) })
    }, { idempotency_key: 'iask_offer_mail_' + askId });
    if (rm && rm.ok && rm.sent) out.sent = true;
  }
  if (phone) {
    var rs = rpcCall_('smsSend', {
      to: phone,
      body: hiringRenderMail_(str_(sit.sms_text) || INTERVIEW_ASK_FALLBACK.slots_offer_sms, vars),
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.slots_offered', ''),
                                { id: str_(ask.candidateid) })
    }, { idempotency_key: 'iask_offer_sms_' + askId });
    if (rs && rs.ok && rs.sent) out.sent = true;
  }
  return out;
}

// ------------------------------------------------------------------ CONFIRM — through the ONE scheduling writer…

// Re-calls HUB_ACTIONS.hiringScheduleCreate in-process (the CompanyCalendar pattern) so events + interviews are…
function interviewAskConfirm_(ask, date, time, how) {
  var sup = interviewSupervisor_();
  var payload = {
    candidate_id: str_(ask.candidateid),
    event_type: 'in_person_interview',
    date: date, time: time,
    location: interviewLastLocation_(),
    with_name: sup.name,
    notes: 'Booked by the interview scheduler — ' + String(how || '') + '.'
  };
  var actor = { role: 'manager', email: 'interview-flow@service.local', id: 'SVC_INTERVIEW_FLOW' };
  var env = null;
  try { env = HUB_ACTIONS.hiringScheduleCreate(payload, actor); }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
  if (!env || Number(env.status) !== 200) {
    return { ok: false, reason: str_(env && env.message) || 'schedule_failed' };
  }
  interviewAskWrite_(str_(ask.askid), {
    state: 'confirmed', confirmed_date: date, confirmed_time: time,
    confirmed_at: new Date().toISOString()
  });
  // THE CANDIDATE HEARS IT TOO — there have to be messages in between.
  try {
    var cSit = (typeof smartSituationOn_ === 'function')
      ? smartSituationOn_(commSituationId_('hiring.interview.candidate_confirmed', 'interview_candidate_confirmed')) : null;
    var cName = str_(ask.candidatename);
    var cWhen = interviewSlotLabel_(date, time);
    if (cSit) {
      var cFill = function (t2) {
        return String(t2 || '').split('{name}').join(cName)
          .split('{first_name}').join((typeof hiringGreetFirst_ === 'function')
            ? hiringGreetFirst_(cName) : (cName.split(/\s+/)[0] || cName))
          .split('{when}').join(cWhen);
      };
      var cEmail = str_(ask.candidateemail);
      var cPhone = (typeof simSendablePhone_ === 'function')
        ? simSendablePhone_(str_(ask.candidatephone)) : str_(ask.candidatephone);
      if (typeof simOutboundAllowed_ === 'function') {
        var cfE = simOutboundAllowed_(cEmail);
        if (cEmail && !cfE.ok) cEmail = '';
        var cfS = simOutboundAllowed_(cPhone);
        if (cPhone && !cfS.ok) cPhone = '';
      }
      if (cEmail) {
        rpcCall_('emailSend', {
          to: cEmail,
          subject: (interviewAskIsRehearsal_(ask) && typeof simTagSubject_ === 'function')
            ? simTagSubject_(cFill(str_(cSit.email_subject))) : cFill(str_(cSit.email_subject)),
          body: cFill(str_(cSit.email_text)),
          reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.confirming', ''),
                                    { id: str_(ask.candidateid) })
        }, { idempotency_key: 'iask_cconf_mail_' + str_(ask.askid) });
      }
      var cSms = cFill(str_(cSit.sms_text));
      if (cPhone && cSms) {
        rpcCall_('smsSend', { to: cPhone, body: cSms,
          reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.confirming', ''),
                                    { id: str_(ask.candidateid) })
        }, { idempotency_key: 'iask_cconf_sms_' + str_(ask.askid) });
      }
    }
    journeyLog_({ candidate_id: str_(ask.candidateid), name: cName, step: 'interview_booked',
                  channel: 'email+sms', ok: true, ref: str_(ask.askid),
                  title: 'Interview booked — ' + cWhen,
                  detail: 'the candidate picked it (' + String(how || '') + '); confirmations went to ' +
                          'the interviewer and the candidate, and it is on the Calendar app',
                  by: 'asa-hub:interview-flow' });
  } catch (eCc) {
    hubSysLog_('asa-hub:interview-flow', 'candidate_confirm_error',
               str_(ask.askid) + ' — ' + String((eCc && eCc.message) || eCc), { status: 500 });
  }
  return { ok: true };
}

// ------------------------------------------------------------------ the ask sweep — her replies, off the Quo…

/** Whole-message YES/NO, the opt-out law: partial phrases go to the model. */
function interviewReplyVerdict_(body) {
  var s = String(body || '').trim().toLowerCase().replace(/[!.…\s]+$/, '');
  if (/^(yes|y|yep|yeah|confirm|confirmed|ok|okay|sounds good|that works|works|sim)$/.test(s)) return 'yes';
  if (/^(no|n|nope|nao|não|does not work|doesnt work)$/.test(s)) return 'no';
  return '';
}

/** ONE model look per message; the memo tab remembers even the "other"s. */
function interviewAskClassifyAi_(body, today) {
  if (typeof screenAiChat_ !== 'function') return null;
  var ask = bookText_('Prompts', 'ai_interview_reply', '')
    .split('{today}').join(today)
    .split('{message}').join(String(body || '').slice(0, 800));
  var res = null;
  try { res = ask ? screenAiChat_(ask, 0.1, 'ai_interview_reply') : null; } catch (e) { res = null; }
  if (!res || !res.ok) return null;
  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (e2) { parsed = null; }
  if (!parsed) return null;
  var v = str_(parsed.verdict).toLowerCase();
  if (['yes', 'no', 'slots', 'other'].indexOf(v) === -1) return null;
  var slots = (v === 'slots' && Object.prototype.toString.call(parsed.slots) === '[object Array]')
    ? parsed.slots.slice(0, 3) : null;
  return { verdict: v, slots: slots, via: str_(res.via) || 'ai' };
}

function interviewAskCursor_() {
  try {
    var raw = hubProp_(INTERVIEW_ASK_CURSOR_PROP);
    if (raw === null || raw === undefined || raw === '') return -1;
    var n = parseInt(String(raw), 10);
    return isNaN(n) || n < 0 ? -1 : n;
  } catch (e) { return -1; }
}

function interviewAskCursorSet_(n) {
  try { hubPropSet_(INTERVIEW_ASK_CURSOR_PROP, String(n)); }
  catch (e) { /* the memo tab still stops a double act */ }
}

// Rider on the machine pass — service reads only, 15-min throttle.
var INTERVIEW_START_PER_PASS = 5;

function interviewStartSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('interview_start_sweep')) return;
  cache.put('interview_start_sweep', '1', 900);

  // Never press blind: an unreadable ask book would re-ask every card that has already been asked.
  var booked = {};
  try {
    interviewAskRows_().forEach(function (r) {
      var c = str_(r.candidateid);
      if (c) booked[c] = true;                  // any state — asked is asked
    });
  } catch (eB) { return; }

  var actor = { role: 'manager', email: 'interview-start@service.local', id: 'SVC_INTERVIEW_START' };
  var pressed = 0, names = [];
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (pressed >= INTERVIEW_START_PER_PASS) return;
      if (str_(c.archived).toLowerCase() === 'true') return;
      if (talentStage_(str_(c.status)) !== 'interview') return;
      var cid = str_(c.candidateid);
      if (!cid || booked[cid]) return;
      booked[cid] = true;                       // one press per pass, whatever it answers
      try {
        var r = HUB_ACTIONS.interviewSlotsAsk({ candidate_id: cid }, actor);
        // 200 IS NOT 'ASKED' — the same lesson the retry pass learned today.
        var d = (r && r.data) || {};
        if (d.sent === false) {
          hubSysLog_('asa-hub:interview-start', 'interview_start_refused',
                     cid + ' — ' + str_(d.reason || 'the door refused'), { status: 200 });
          return;
        }
        pressed++;
        names.push(str_(c.candidatename) || cid);
      } catch (eP) {
        hubSysLog_('asa-hub:interview-start', 'interview_start_press_failed',
                   cid + ' — ' + String((eP && eP.message) || eP), { status: 500 });
      }
    });
  } catch (eC) { return; }                      // an unreadable tab — next pass reads again

  if (pressed) {
    hubSysLog_('asa-hub:interview-start', 'interview_started',
               pressed + ' card(s) at Interview had their interviewer asked for days: ' +
               names.join(', ').slice(0, 300), { status: 200 });
  } else if (typeof tpSweepIdle_ === 'function') {
    tpSweepIdle_('interview-start',
                 'nobody at Interview is waiting to be asked — every card standing there ' +
                 'is already in the ask book');
  }
}

function interviewAskSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('interview_ask_sweep_ran')) return;
  cache.put('interview_ask_sweep_ran', '1', 900);
  try { interviewAskSweepRun_(); }
  catch (e) {
    hubSysLog_('auto-interview-ask', 'interview_ask_sweep_error',
               String((e && e.message) || e), { status: 500 });
  }
}

// Read the supervisor's inbound rows since the cursor and move the state machine FORWARD only.
function interviewAskSweepRun_() {
  var waiting = interviewAskRows_().filter(function (r) {
    var st = str_(r.state);
    return st === 'supervisor_asked' || st === 'slots_requested';
  });
  if (!waiting.length) return { waiting: 0 };

 // TWO POPULATIONS, TWO EARS.
  var waitingReal = waiting.filter(function (r) { return !interviewAskIsRehearsal_(r); });
  var waitingSim = waiting.filter(function (r) { return interviewAskIsRehearsal_(r); });
  var ears = [];
  if (waitingReal.length) {
    ears.push({ sup: interviewSupervisor_(), waiting: waitingReal, rehearsal: false });
  }
  if (waitingSim.length) {
    ears.push({ sup: interviewSupervisorFor_(waitingSim[0]), waiting: waitingSim, rehearsal: true });
  }

 // THE E-MAIL HALF RUNS EVEN WITH NO PHONE.
  var mail = { acted: 0, scans: [] };
  ears.forEach(function (ear) {
    var m = interviewAskMailScan_(ear.sup, ear.waiting, ear.rehearsal);
    mail.acted += (m.acted || 0);
    mail.scans.push(m);
  });

  // Which numbers we listen to on the mirror, and which population each one speaks for.
  var digitsFor = {};
  var anyDigits = false;
  ears.forEach(function (ear) {
    var d = String(ear.sup.phone || '').replace(/\D/g, '').slice(-10);
    if (d) { digitsFor[d] = ear.rehearsal; anyDigits = true; }
  });

  if (!anyDigits) {
    var anyEmail = ears.some(function (ear) { return !!ear.sup.email; });
    if (!anyEmail) {
      hubSysLog_('auto-interview-ask', 'interview_ask_no_supervisor',
                 'nobody holds the INTERVIEWER badge with a phone or an address — ' +
                 str_(ears.length ? ears[0].sup.by : 'no ask waiting'), { status: 200 });
    }
    return { waiting: waiting.length, supervisor: anyEmail, mail: mail, acted: mail.acted || 0 };
  }

  var sheet = null;
  try { sheet = ssOpen_(hubId_('QUO_SYNC_SHEET_ID')).getSheetByName(QUO_MESSAGES_TAB); }
  catch (e) { sheet = null; }
  if (!sheet) return { waiting: waiting.length, mirror: false, mail: mail, acted: mail.acted || 0 };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { waiting: waiting.length, rows: 0, mail: mail, acted: mail.acted || 0 };

  var cursor = interviewAskCursor_();
  if (cursor < 0) {
    // first run: history is not a reply to a question not yet asked
    interviewAskCursorSet_(lastRow);
    return { waiting: waiting.length, initialized: lastRow };
  }
  var from = Math.max(2, cursor + 1);
  if (from > lastRow) return { waiting: waiting.length, behind: 0 };

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normKey_);
  var iId = header.indexOf('messageid'), iStatus = header.indexOf('status'),
      iExt = header.indexOf('externalparticipants'), iBody = header.indexOf('body');
  if (iId === -1 || iStatus === -1 || iBody === -1) {
    return { waiting: waiting.length, mirror: false };
  }
  var count = Math.min(INTERVIEW_ASK_BATCH_ROWS, lastRow - from + 1);
  var values = sheet.getRange(from, 1, count, header.length).getValues();

  var judged = {};
  var aiSheet = interviewAskAiSheet_();
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INTERVIEW_ASK_AI_TAB).forEach(function (r) {
      if (str_(r.messageid)) judged[str_(r.messageid)] = str_(r.verdict);
    });
  } catch (eJ) { /* empty memo — the deterministic ear still filters */ }

  var today = interviewTodayText_();
  var acted = 0, firstUnjudged = -1;

  for (var i = 0; i < values.length; i++) {
    var g = function (idx) { return idx === -1 ? '' : str_(values[i][idx]); };
    if (g(iStatus).toLowerCase() !== 'received') continue;
    var digits = g(iExt).replace(/\D/g, '').slice(-10);
    if (!Object.prototype.hasOwnProperty.call(digitsFor, digits)) continue;
    var mid = g(iId);
    if (!mid || judged[mid] !== undefined) continue;
    var body = g(iBody);

    // deterministic first — the model reads only what the ear cannot
    var verdict = interviewReplyVerdict_(body);
    var slots = null, via = 'rule';
    if (!verdict) {
      var ai = interviewAskClassifyAi_(body, today);
      if (!ai) {
        // no provider answered: hold the cursor so the next pass retries
        if (firstUnjudged === -1) firstUnjudged = from + i;
        continue;
      }
      verdict = ai.verdict;
      slots = ai.slots || null;
      via = ai.via;
    }
    aiSheet.appendRow([mid, verdict, slots ? JSON.stringify(slots) : '', via,
                       new Date().toISOString()]);
    judged[mid] = verdict;

    acted += interviewAskApply_(verdict, slots, mid, today, digitsFor[digits]);
    // 'other' is remembered and moves nothing
  }

  // never advance past a message the model has not judged yet
  var reached = from + values.length - 1;
  interviewAskCursorSet_(firstUnjudged === -1 ? reached : firstUnjudged - 1);

  if (acted) {
    hubSysLog_('auto-interview-ask', 'interview_ask_sweep',
               acted + ' reply(ies) acted on, ' + waiting.length + ' ask(s) waiting', { status: 200 });
  }
  return { waiting: waiting.length, acted: acted + (mail.acted || 0), reached: reached,
           mail: mail };
}

// WHAT A VERDICT DOES — lifted out of the sweep loop so the SMS mirror and the mailbox both act through exactly one…
function interviewAskApply_(verdict, slots, mid, today, wantRehearsal) {
  var acted = 0;
  if (verdict === 'yes') {
    var askY = interviewAskWaiting_(['supervisor_asked'], wantRehearsal);
    if (askY && interviewSlotShapeOk_(str_(askY.pickeddate), str_(askY.pickedtime))) {
      interviewAskWrite_(str_(askY.askid), { supervisor_reply: 'yes' });
      var conf = interviewAskConfirm_(askY, str_(askY.pickeddate), str_(askY.pickedtime),
                                      'the interviewer said YES');
      if (conf.ok) {
        interviewSupervisorTell_(askY, str_(askY.pickeddate), str_(askY.pickedtime), true);
        if (typeof journeyLog_ === 'function') {
          journeyLog_({ candidate_id: str_(askY.candidateid), name: str_(askY.candidatename),
                        step: 'interview_booked', channel: 'calendar',
                        to: '', ok: true, ref: str_(askY.askid),
                        detail: 'booked ' + str_(askY.pickeddate) + ' ' + str_(askY.pickedtime) +
                                ' after the interviewer said yes',
                        by: 'asa-hub:interview-flow' });
        }
        acted++;
      } else {
        hubSysLog_('auto-interview-ask', 'interview_confirm_failed',
                   str_(askY.askid) + ' — ' + conf.reason, { status: 500 });
      }
    }
  } else if (verdict === 'no') {
    var askN = interviewAskWaiting_(['supervisor_asked'], wantRehearsal);
    if (askN) {
      interviewAskWrite_(str_(askN.askid), { state: 'slots_requested', supervisor_reply: 'no' });
      interviewSlotsRequest_(askN);
      if (typeof journeyLog_ === 'function') {
        journeyLog_({ candidate_id: str_(askN.candidateid), name: str_(askN.candidatename),
                      step: 'interviewer_reply', channel: 'sms', ok: true,
                      ref: str_(askN.askid),
                      detail: 'the interviewer said no — asked for three times instead',
                      by: 'asa-hub:interview-flow' });
      }
      acted++;
    }
  } else if (verdict === 'slots' && slots) {
    var askS = interviewAskWaiting_(['slots_requested', 'supervisor_asked'], wantRehearsal);
    if (askS) {
      var valid = interviewSlotsValid_(slots, today);
      if (valid.length >= 1) {
        interviewAskWrite_(str_(askS.askid), {
          state: 'slots_offered', slots_json: JSON.stringify(valid),
          offered_at: new Date().toISOString(), supervisor_reply: 'slots'
        });
        interviewSlotsOffer_(askS, valid);
        // the dictated ladder rests — she answered
        try { simAskAnswer_(['interview_slots'], 'she sent her slots', str_(askS.candidateid)); } catch (eSl) {}
        acted++;
      } else {
        hubSysLog_('auto-interview-ask', 'interview_slots_invalid',
                   String(mid) + ' — the proposed slots did not validate ' +
                   '(future weekdays, company hours)', { status: 200 });
      }
    }
  }
  // 'other' is remembered by the memo tab and moves nothing
  return acted;
}

// HER REPLY MAY ARRIVE BY E-MAIL (card step 10).
function interviewAskMailScan_(sup, waiting, wantRehearsal) {
  var out = { read: 0, judged: 0, acted: 0, source: 'mailbox',
              rehearsal: wantRehearsal === true };
  if (!sup || !sup.email || !waiting || !waiting.length) return out;
  if (typeof platformMailPost_ !== 'function') return out;

  var threads = [];
  try {
    // mailbox '' → the relay's own fallback is INBOX (it refuses any shape it did not create), which is exactly…
    var r = platformMailPost_('/mail/inbox', { limit: 30, mailbox: '' });
    if (r && r.status === 200 && r.data && r.data.threads) threads = r.data.threads;
  } catch (e) {
    // AN UNREADABLE MAILBOX IS NOT AN EMPTY ONE — the same distinction OptOut.gs makes about the SMS mirror, and…
    hubSysLog_('auto-interview-ask', 'interview_ask_mailbox_unreadable',
               String((e && e.message) || e), { status: 500 });
    out.unreadable = true;
    return out;
  }

  var judged = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INTERVIEW_ASK_AI_TAB).forEach(function (r2) {
      if (str_(r2.messageid)) judged[str_(r2.messageid)] = str_(r2.verdict);
    });
  } catch (eJ) { /* the deterministic ear still filters */ }

  var hers = String(sup.email).trim().toLowerCase();
  // AND THE TESTER, WHILE THE REDIRECT IS LIVE.
  var earKeys = (hers ? [hers] : []);
  try {
    ((typeof simTesterKeys_ === 'function') ? simTesterKeys_() : { emails: [] })
      .emails.forEach(function (e) { if (earKeys.indexOf(e) === -1) earKeys.push(e); });
  } catch (eTk) { /* production keeps one key */ }
  var today = interviewTodayText_();
  var aiSheet = interviewAskAiSheet_();

  for (var i = 0; i < threads.length; i++) {
    var t = threads[i] || {};
    // THE FIELD NAMES ARE THE RELAY'S OWN (_imap_inbox): from_addr, subject, snippet, id.
    var fromAddr = str_(t.from_addr || t.fromaddr).toLowerCase();
    // THE ADDRESS MUST BE THE SENDER, not merely present in the thread: a letter we sent HER sits in the same…
    if (!fromAddr) continue;
    var fromMatched = false;
    for (var k = 0; k < earKeys.length; k++) {
      if (earKeys[k] && fromAddr.indexOf(earKeys[k]) !== -1) { fromMatched = true; break; }
    }
    if (!fromMatched) continue;
    out.read++;
    var mid = 'mail:' + str_(t.id || (str_(t.date) + '|' + str_(t.subject)));
    if (judged[mid] !== undefined) continue;
    // `snippet` is the plain-text body the relay already extracted (400 chars) — enough for YES, NO, or three…
    var body = str_(t.snippet);
    if (!body) continue;

    var verdict = interviewReplyVerdict_(body);
    var slots = null, via = 'rule:mail';
    if (!verdict) {
      var ai = interviewAskClassifyAi_(body, today);
      if (!ai) continue;                       // no provider answered — retry next pass
      verdict = ai.verdict;
      slots = ai.slots || null;
      via = str_(ai.via) + ':mail';
    }
    aiSheet.appendRow([mid, verdict, slots ? JSON.stringify(slots) : '', via,
                       new Date().toISOString()]);
    judged[mid] = verdict;
    out.judged++;
    out.acted += interviewAskApply_(verdict, slots, mid, today, wantRehearsal);
  }
  return out;
}

/** ▶ Run the ask sweep by hand from the editor. */
function runInterviewAskSweep() {
  var out = interviewAskSweepRun_();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

HUB_POLICY.interviewAskSweepNow = {
  file: 'InterviewFlow.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: ['emailSend', 'smsSend']
};
// RUN THE SWEEP NOW, ON PURPOSE.
HUB_ACTIONS.interviewAskSweepNow = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var out;
  try { out = interviewAskSweepRun_(); }
  catch (e) { return { status: 500, message: String((e && e.message) || e) }; }
  return { status: 200, data: out || {} };
};

// ------------------------------------------------------------------ THE STEP BEFORE THE LINK: the calendar goes to…

HUB_POLICY.interviewSlotsAsk = {
  file: 'InterviewFlow.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' },
            slots_wanted: { required: false, type: 'string' } },
  invalidates: [], emits: ['emailSend', 'smsSend']
};
// THE DICTATED OPENING OF THE INTERVIEW: the FIRST thing is a message to Tieara Kennemore, by phone, asking for 3…
HUB_ACTIONS.interviewSlotsAsk = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var wanted = parseInt(str_(payload && payload.slots_wanted), 10) || 3;
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var sit = interviewSituation_(commSituationId_('hiring.interview.slots_request', 'interview_slots_ask'));
  if (!sit) return { status: 200, data: { sent: false, reason: 'situation_off' } };
  // the card may have moved on — the retry pass presses blind
  if (str_(ev.cand.archived).toLowerCase() === 'true' ||
      talentStage_(str_(ev.cand.status)) !== 'interview') {
    try { simAskAnswer_(['interview_slots'], 'the card moved on — the machine lets go', cid); } catch (eG) {}
    return { status: 200, data: { sent: false, reason: 'card_moved_on' } };
  }
  var candName = str_(ev.cand.candidatename);
  var ask = interviewAskOpenFor_(cid);
  var askId = ask ? str_(ask.askid) : 'ASK_' + randomHex_(10).toUpperCase();
  var now = new Date().toISOString();
  if (!ask) {
    // The interviewer's link is an HMAC over the ask id — asking her about an ask that landed nowhere sends her to…
    if (!interviewAskAppend_({
      ask_id: askId, candidate_id: cid, candidate_name: candName,
      candidate_email: str_(ev.cand.email),
      candidate_phone: (typeof simSendablePhone_ === 'function')
        ? simSendablePhone_(str_(ev.cand.phone)) : str_(ev.cand.phone),
      state: 'slots_requested', invited_at: '', invited_by: '',
      updated_at: now
    })) {
      return { status: 500, message: 'The interview ask did not land in the store — ' +
                                     'the interviewer was not asked for slots.' };
    }
  } else if (str_(ask.state) !== 'slots_offered' && str_(ask.state) !== 'confirmed') {
    interviewAskWrite_(askId, { state: 'slots_requested', updated_at: now });
  }
  var sup = interviewSupervisorFor_(ask || { candidatename: candName });
  if (!sup || (!str_(sup.email) && !str_(sup.phone))) {
    return { status: 200, data: { sent: false, reason: 'no_interviewer' } };
  }
  var link = INTERVIEW_LINK_BASE + interviewDaysTokenFor_(askId) + '&m=days';
  var fill = function (t) {
    return String(t || '').split('{name}').join(candName)
      .split('{interviewer}').join(str_(sup.name) || 'there')
      .split('{slots_wanted}').join(String(wanted))
      .split('{link}').join(link);
  };
  var sentAny = false;
  if (str_(sup.phone)) {
    var smsBody = fill(str_(sit.sms_text));
    if (smsBody) {
      if (typeof simTagSubject_ === 'function') smsBody = simTagSubject_(smsBody);
      try {
        var rs = rpcCall_('smsSend', { to: str_(sup.phone), body: smsBody,
          reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.asking_slots', ''),
                            { who: str_(sup.name), n: String(wanted) }) },
          { idempotency_key: 'islots_sms_' + askId + '_' + wanted });
        sentAny = sentAny || !!(rs && rs.sent);
      } catch (eS) {}
    }
  }
  if (str_(sup.email).indexOf('@') !== -1) {
    var subject = fill(str_(sit.email_subject));
    var bodyText = fill(str_(sit.email_text));
    if (bodyText) {
      try {
        var rm = rpcCall_('emailSend', {
          to: str_(sup.email),
          subject: (typeof simTagSubject_ === 'function') ? simTagSubject_(subject) : subject,
          body: bodyText,
          reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.asking_slots', ''),
                            { who: str_(sup.name), n: String(wanted) })
        }, { idempotency_key: 'islots_mail_' + askId + '_' + wanted });
        sentAny = sentAny || !!(rm && rm.sent);
      } catch (eM) {}
    }
  }
  if (sentAny) {
    try { simTrackSend_('interview_slots', cid, 'interviewSlotsAsk',
                        { candidate_id: cid, slots_wanted: String(wanted) }); } catch (eT) {}
  }
  journeyLog_({ candidate_id: cid, name: candName, step: 'interviewer_ask', channel: 'email+sms',
                ok: sentAny, ref: askId,
                title: sentAny ? ('The interviewer was asked for ' + wanted + ' slots')
                               : 'The slots ask could not be sent',
                detail: sentAny
                  ? (str_(sup.name) + ' was asked for ' + wanted + ' time slots on different ' +
                     'days — date and time; the candidate picks among what she sends')
                  : 'neither leg went out — the retry rung re-asks on its clock',
                by: str_(user && user.email) });
  return { status: 200, data: { sent: sentAny, ask_id: askId, slots_wanted: wanted } };
};

HUB_POLICY.interviewDaysAskSend = {
  file: 'InterviewFlow.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend', 'smsSend']
};
HUB_ACTIONS.interviewDaysAskSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  if (!interviewLinkSecret_()) {
    return { status: 200, data: { sent: false, reason: 'no_link_secret' } };
  }
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var candName = str_(ev.cand.candidatename);

  var ask = interviewAskOpenFor_(cid);
  var askId = ask ? str_(ask.askid) : 'ASK_' + randomHex_(10).toUpperCase();
  var now = new Date().toISOString();
  if (!ask) {
    // Her days link is an HMAC over the ask id, and the candidate's whole calendar hangs off her answer — no ask in…
    if (!interviewAskAppend_({
      ask_id: askId, candidate_id: cid, candidate_name: candName,
      candidate_email: str_(ev.cand.email),
      candidate_phone: (typeof simSendablePhone_ === 'function')
        ? simSendablePhone_(str_(ev.cand.phone)) : str_(ev.cand.phone),
      state: 'days_asked', invited_at: '', invited_by: '',
      days_asked_at: now, updated_at: now
    })) {
      return { status: 500, message: 'The interview ask did not land in the store — ' +
                                     'the interviewer was not asked for days.' };
    }
  } else {
    interviewAskWrite_(askId, { days_asked_at: now });
  }
  var freshAsk = interviewAskOpenFor_(cid) || ask;

  var sup = interviewSupervisorFor_(freshAsk || { candidateid: cid, candidatename: candName });
  if (!sup || (!sup.email && !sup.phone)) {
    return { status: 200, data: { sent: false, reason: 'no_interviewer',
             detail: (sup && str_(sup.by)) || 'nobody holds the INTERVIEWER badge' } };
  }
  var link = INTERVIEW_LINK_BASE + interviewDaysTokenFor_(askId) + '&m=days';
  var rehearsal = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);
  var subject = idWords_('email_subject', 'interviewer_days_subject',
                         '{name} is ready for an interview — which days can you take?');
  var bodyText = idWords_('email_text', 'interviewer_days_body',
      'Hi {interviewer},\n\n{name} has finished the phone screening and is ready to meet ' +
      'you.\n\nOpen {link} and choose the days that suit you. The candidate picks a time ' +
      'inside the days you choose, so nothing lands on you unannounced.');
  // THE SWITCH AND THE WORDS ARE A SITUATION ROW — this has to be set in smart comms.
  var idSit = (typeof interviewSituation_ === 'function')
    ? interviewSituation_(commSituationId_('hiring.interview.days_request', 'interview_days_ask')) : null;
  var idWords_ = function (sitKey, cfgKey, floor) {
    var v = str_(idSit && idSit[sitKey]);
    if (!v && typeof simText_ === 'function') v = simText_(cfgKey, '');
    return String(v || floor)
      .replace(/\{name\}/g, candName)
      .replace(/\{interviewer\}/g, str_(sup.name))
      .replace(/\{link\}/g, link);
  };
  var out = { sent: false, emailed: false, smsed: false, link: link,
              interviewer: sup.name, failures: [] };
  if (sup.email) {
    var html = mailShell_({
      eyebrow: 'ASA Hub — Hiring',
      title: 'Which days work for you?',
      preheader: candName + ' is ready to book — choose the open days first.',
      blocks: bodyText.split(/\n{2,}/).map(function (p) { return mailPara_(mailEsc_(p).replace(/\n/g, '<br>')); }),
      cta: { label: 'Choose my days', href: link },
      footnote: 'Days you do not choose paint gray and blocked on the candidate\'s calendar.'
    });
    var rm = rpcCall_('emailSend', {
      to: sup.email,
      subject: (rehearsal && typeof simTagSubject_ === 'function') ? simTagSubject_(subject) : subject,
      body: bodyText, html: html,
      cc: (rehearsal && typeof simCcFor_ === 'function') ? simCcFor_(sup.email) : '',
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.days_choice', ''), { id: cid })
    }, { idempotency_key: 'iask_days_mail_' + askId });
    if (rm && rm.ok && rm.sent) { out.emailed = true; out.sent = true; }
    else out.failures.push('email: ' + str_((rm && (rm.error || rm.reason || rm.detail)) || 'send_failed'));
  }
  if (sup.phone) {
    var smsBody = idWords_('sms_text', 'interviewer_days_sms',
      'ASA LifeCare hiring — {name} is ready for an interview. Open {link} and pick the ' +
      'days you can take; the candidate then chooses a time inside them.');
    var rs = rpcCall_('smsSend', {
      to: sup.phone, body: smsBody,
      reason: hiringRenderMail_(bookText_('Strings', 'ledger.iv.days_choice', ''), { id: cid })
    }, { idempotency_key: 'iask_days_sms_' + askId });
    if (rs && rs.ok && rs.sent) { out.smsed = true; out.sent = true; }
    else out.failures.push('sms: ' + str_((rs && (rs.error || rs.reason || rs.detail)) || 'send_failed'));
  }
  journeyLog_({ candidate_id: cid, name: candName, step: 'interviewer_days',
                channel: 'email+sms', ok: out.sent, rehearsal: rehearsal,
                detail: out.sent
                  ? 'the interviewer (' + sup.name + ') was sent her days-link — e-mail and OpenPhone text together; the candidate\'s calendar WAITS for her choice'
                  : ('nothing went — ' + out.failures.join('; ')),
                by: str_(user && user.email) });
  // AND THE ASKING ENTERS THE BOOK — SEVEN asks arrive, one every half hour, and while nobody answers they keep…
  if (out.sent && typeof simTrackSend_ === 'function') {
    try { simTrackSend_('interview_days', cid, 'interviewDaysAskSend', { candidate_id: cid }); }
    catch (eT) { /* a lost book entry costs a retry, not a message */ }
  }
  // the rehearsal answers itself: the actor picks days through the REAL door
  var auto = null;
  try { if (typeof simAutoInterviewerDays_ === 'function') auto = simAutoInterviewerDays_(cid, askId); } catch (eAu) {}
  return { status: 200, data: { sent: out.sent, emailed: out.emailed, smsed: out.smsed,
           interviewer: sup.name, link: link, failures: out.failures, auto: auto || undefined } };
};
