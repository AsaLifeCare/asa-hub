// Hired graduation: the team is told, the person stays on the pipeline's LAST step for one more day, then moves to…
// THE MOVEMENT IS UNCONDITIONAL; only the alert changes — "all documentation OK" or the exact missing items per…

var HIRED_SHOWCASE_MS = 24 * 60 * 60 * 1000;

// One transport for every team alert: SMS on the Automations line + email, each recipient best-effort (shared with…
function hubTeamNotify_(subject, text, alsoSms, mail) {
  // Recipients come from Settings → Hiring rules (AlertsConfig.gs); the hardcoded lists are only the floor under an…
  var to = hubAlertRecipients_();
 // THE E-MAIL LEG MAY DRESS DIFFERENTLY (the Smart Comms move): `mail` = { text, html } carries the situation row's…
  var mailText = (mail && str_(mail.text)) || text;
  var mailHtml = (mail && str_(mail.html)) || '';
  // `mail.legs`, when a situation row names its channels: a leg it does not name is not sent.
  var legs = (mail && Array.isArray(mail.legs)) ? mail.legs : null;
  var smsLeg = !legs || legs.indexOf('sms') !== -1;
  var mailLeg = !legs || legs.indexOf('email') !== -1;
  // TEST MODE REACHES HERE TOO: these call sites never pass through rpcSend_, so a redirect living only there would…
  var redir = (typeof hubTestRedirect_ === 'function')
    ? hubTestRedirect_() : { sms: [], emails: [], sheet: true, unreadable: true };
  // TEST MODE ON SENDS NOTHING, AND THE WORDS ARE KEPT.
  if (redir && redir.sheet) {
    try {
      if (typeof hubRehearsalHeld_ === 'function') {
        hubRehearsalHeld_({
          channel: 'team', to: to.sms.concat(to.emails).concat(alsoSms || []).join(', '),
          subject: subject, body: text, reason: 'team notice: ' + String(subject || ''),
          pass_by: 'asa-hub:team-notify', to_name: 'the hiring team',
          held_by: 'test mode is on — nothing leaves the platform'
        });
      }
    } catch (eH) { /* nothing was sent either way, which is the part that matters */ }
    return { sms: 0, email: 0, rehearsed: true };
  }
  if (redir) {
    var banner = (typeof hubTestBanner_ === 'function' ? hubTestBanner_('the hiring team') : '[TEST] ');
    text = banner + text;
    mailText = banner + mailText;
    // The layout travels WITH its warning, like rpcSend_'s rehearsals.
    if (mailHtml && typeof hubTestBannerHtml_ === 'function') {
      mailHtml = hubTestBannerHtml_('the hiring team') + mailHtml;
    }
    to = { sms: redir.sms.slice(), emails: redir.emails.slice() };
    alsoSms = [];
  }
  // alsoSms is ADDED, never substituted: it must widen the audience and can never narrow it (the packet amber…
  if (alsoSms && alsoSms.length) {
    var have = {};
    to.sms.forEach(function (n) { have[String(n).replace(/\D/g, '').slice(-10)] = true; });
    alsoSms.forEach(function (n) {
      var k = String(n).replace(/\D/g, '').slice(-10);
      if (k && !have[k]) { have[k] = true; to.sms.push(n); }
    });
  }
  var reached = { sms: 0, email: 0 };
  if (!smsLeg) to.sms = [];
  if (!mailLeg) to.emails = [];
  try {
    var apiKey = to.sms.length ? hubProp_(SCRAPER_OPENPHONE_PROP) : '';
    if (apiKey) {
      var from = '', senderUserId = '';
      try {
        var phones = UrlFetchApp.fetch('https://api.openphone.com/v1/phone-numbers', {
          headers: { Authorization: apiKey }, muteHttpExceptions: true
        });
        if (phones.getResponseCode() === 200) {
          var list = (JSON.parse(phones.getContentText()).data) || [];
          for (var p = 0; p < list.length; p++) {
            if (String(list[p].name) === 'Automations') {
              from = list[p].number || '';
              if (list[p].users && list[p].users[0]) senderUserId = list[p].users[0].id || '';
            }
          }
        }
      } catch (eP) { /* no line → SMS skipped, email still goes */ }
      if (from) {
        to.sms.forEach(function (num) {
          try {
            var body = { content: text, from: from, to: [num] };
            if (senderUserId) body.userId = senderUserId;
            var r = UrlFetchApp.fetch('https://api.openphone.com/v1/messages', {
              method: 'post', contentType: 'application/json',
              headers: { Authorization: apiKey }, muteHttpExceptions: true,
              payload: JSON.stringify(body)
            });
            // Count the OUTCOME, not the attempt: a 4xx is a message that did not go.
            if (r.getResponseCode() < 400) reached.sms++;
          } catch (eS) { /* next recipient */ }
        });
      }
    }
  } catch (eSms) { /* SMS lane down — email below still fires */ }
  // One email PER recipient (a dead address never silences the rest); the footer names the whole distribution so…
  var footer = '\n\n(Automated alert from the ASA Hub hiring pipeline.\n' +
    'Sent individually to: ' + to.emails.join(', ') +
    (to.sms.length ? ' — SMS to: ' + to.sms.join(', ') : '') + ')';
  to.emails.forEach(function (addr) {
    try {
      platformMailOut_(addr, subject, mailText + footer, mailHtml || '');
      reached.email++;
    } catch (eM) { /* next recipient */ }
  });
  return reached;
}

// EVERY TEAM NOTICE THROUGH THE DOOR THAT CARRIES THE BRAKES.
function hubTeamAlert_(what) {
  var w = what || {};
  var params = {
    subject: str_(w.subject),
    body: str_(w.body),
    reason: str_(w.reason) || ('team notice: ' + str_(w.subject))
  };
  var also = (w.also || []).filter(String);
  if (also.length) params.to = also.join(',');
  if (str_(w.html)) params.html = str_(w.html);
  if (str_(w.mail_text)) params.mail_text = str_(w.mail_text);
  if (str_(w.legs)) params.legs = str_(w.legs);
  var res;
  try {
    res = rpcCall_('teamAlert', params, { idempotency_key: str_(w.key) });
  } catch (e) {
    return { sms: 0, email: 0, held: false, ok: false, told: false, deduplicated: false,
             quiet: false, done: false, state: 'failed',
             why: String((e && e.message) || e).slice(0, 200) };
  }
  var reach = hubTeamReach_(res && res.receipt);
  var told = !!(res && res.ok && res.sent && (reach.sms + reach.email) > 0);
  var dedup = !!(res && res.deduplicated);
  var quiet = !!(res && res.quiet);
  var held = !!(res && res.ok && !res.sent && !dedup);
  var state = told ? 'told' : (dedup ? 'deduplicated' : (quiet ? 'quiet' : (held ? 'held' : 'failed')));
  return { sms: reach.sms, email: reach.email, ok: !!(res && res.ok),
           told: told, deduplicated: dedup, quiet: quiet, held: held,
           done: told || dedup, state: state,
           why: str_(res && (res.detail || res.reason || res.error)) };
}

// ONE-SHOT TEAM ALERTS THE QUIET WINDOW HELD, KEPT FOR 08:00.
function hubTeamAlertOwe_(kind, key, data, at) {
  var d = {};
  for (var k in (data || {})) if (Object.prototype.hasOwnProperty.call(data, k)) d[k] = data[k];
  d.kind = String(kind || '');
  try { return (typeof hubQuietOwe_ === 'function') && hubQuietOwe_('team_alert', key, d, at); }
  catch (e) { return false; }
}

// The morning carrier for `team_alert` entries (Hotline.gs hands it to hubQuietOwedCarry_).
function hubTeamAlertQuietCarry_(data, entry) {
  var d = data || {};
  var carrier = null;
  if (d.kind === 'hired') carrier = hubHiredQuietCarry_;
  else if (d.kind === 'date_accepted' && typeof hubDateAcceptedQuietCarry_ === 'function') carrier = hubDateAcceptedQuietCarry_;
  else if (d.kind === 'ai_keys' && typeof aiKeyNoticeQuietCarry_ === 'function') carrier = aiKeyNoticeQuietCarry_;
  if (!carrier) return { state: 'stale', why: 'no carrier for the team alert `' + String(d.kind || '') + '` in this build' };
  try {
    return carrier(d, entry);
  } catch (e) {
    var why = 'its facts could not be read (' + String((e && e.message) || e).slice(0, 120) + ')';
    var kept = hubTeamAlertOwe_(d.kind, str_(entry && entry.key), d, str_(entry && entry.at));
    return kept ? { state: 'kept', why: why + ' — kept for the next pass' }
                : { state: 'stale', why: why + ' — and it could not be kept' };
  }
}

/** 'team:1sms+3email' as counts; anything else is nobody. */
function hubTeamReach_(receipt) {
  var m = /^team:(\d+)sms\+(\d+)email$/.exec(String(receipt || ''));
  return m ? { sms: parseInt(m[1], 10), email: parseInt(m[2], 10) } : { sms: 0, email: 0 };
}

// Is this person actually staff now?
function hubBecomingStaffDone_(c) {
  var missing = [];
  var cid = str_(c.candidateid);

  // 1. the account exists
  var uid = str_(c.staffuserid);
  var armed = false;
  if (!uid && str_(c.graduationheld)) {
    missing.push('staff account held: ' + str_(c.graduationheld));
  } else if (!uid) {
    missing.push('staff account not created yet');
  } else {
    // 2.
    try {
      var u = null;
      var urows = (typeof usersAll_ === 'function')
        ? usersAll_()
        : readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), 'users');
      for (var i = 0; i < urows.length; i++) {
        if (str_(urows[i].userid) === uid) { u = urows[i]; break; }
      }
      // Same question Auth.gs asks: a passhash exists, or it does not.
      armed = !!(u && str_(u.passhash));
    } catch (eU) {
      // Unreadable users tab: do NOT claim armed and do not claim held — say we could not tell, so nobody is…
      missing.push('could not read the users tab to check the password');
    }
    if (!armed && missing.length === 0) missing.push('no password set — they cannot sign in');
  }

  // 3. the ASA Employee Database carries where they came from
  var idAt = str_(c.internaldocsat);
  var idNote = str_(c.internaldocsnote).toLowerCase();
  if (!idAt) missing.push('ASA Employee Database not written yet');
  else if (idNote.indexOf('not filled') === 0) missing.push('ASA Employee Database: ' + str_(c.internaldocsnote).slice(0, 90));

  return { done: missing.length === 0, missing: missing };
}

// Takes finished cards off the board and tells the people responsible — everyone involved is notified and the ASA…
function hubBecomingStaffSweep_() {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var rows = readTabNormalized_(ss, TALENT_CANDIDATES_TAB);
  var moved = 0, waiting = 0;
  rows.forEach(function (c) {
    var cid = str_(c.candidateid);
    if (!cid || str_(c.archived).toLowerCase() === 'true') return;
    if (talentStage_(c.status) !== 'hired') return;   // merged 2026-08-13: the graduation lives on Hired
    if (!str_(c.hiredcompleteat)) return;            // not graduated yet
    var state = hubBecomingStaffDone_(c);
    if (!state.done) { waiting++; return; }

    var name = str_(c.candidatename);
    // A rehearsal leaves quietly: a test card must not page three real people, and it must still leave the board.
    var isTest = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(c);
    var told = true, heldWhy = '';
    if (!isTest) {
      // THE CONTEXT IS THE SITUATION ROW (hiring_ready_to_start, Smart Comms ): the words used to be literals right…
      var rSit = (typeof smartSituationOn_ === 'function')
        ? smartSituationOn_(commSituationId_('hiring.ready.notification', 'hiring_ready_to_start')) : null;
      if (!rSit) {
        hubSysLog_('auto-becoming-staff', 'ready_alert_skipped',
                   cid + ' — ' + name + ': situation_off (hiring_ready_to_start)', { status: 200 });
      } else {
        var rFallback = bookText_('Strings', 'ready_done.body.floor', '');
        var rVars = { name: name };
        var rSubject = hiringRenderMail_(str_(rSit.email_subject) ||
          bookText_('Strings', 'ready_done.subject.floor', ''), rVars);
        var rSms = hiringRenderMail_(str_(rSit.sms_text) || str_(rSit.email_text) || rFallback, rVars);
        var rMail = hiringRenderMail_(str_(rSit.email_text) || str_(rSit.sms_text) || rFallback, rVars);
        var rLetter = hiringNoticeEmail_({
          title: rSubject,
          preheader: bookText_('Strings', 'ready_done.preheader', ''),
          bodyText: rMail
        });
        var reach = hubTeamAlert_({
          subject: rSubject, body: rSms, html: rLetter.html, mail_text: rMail,
          reason: 'smart comms: ' + commSituationId_('hiring.ready.notification', 'hiring_ready_to_start'),
          key: 'ready_to_start|' + cid
        });
        // Told, or already told under this key.
        told = !!(reach && reach.done);
        heldWhy = str_(reach && reach.state) + (reach && reach.why ? ': ' + str_(reach.why) : '');
      }
    }
    if (!told) {
      // Nobody heard: the card STAYS, because archiving now would make this person vanish with no record that…
      hubSysLog_('auto-becoming-staff', 'staff_complete_not_announced',
                 cid + ' — ' + name + ': finished, but no alert reached anybody (' +
                 (heldWhy || 'no answer').slice(0, 160) + '); card kept on the board',
                 { status: 502 });
      waiting++;
      return;
    }
    try {
 // NOT archived: the finished person WAITS Ready to start until a MANAGER begins their activities (hiredStart).
      hubSetStatus_(cid, HUB_STAGE_TO_STATUS['ready'], { email: 'auto-becoming-staff' });
      moved++;
      hubSysLog_('auto-becoming-staff', 'staff_complete',
                 cid + ' — ' + name + ': account armed, Employee Database written, ' +
                 (isTest ? 'test card (team not notified)' : 'team notified') + '; card moved to Ready to start',
                 { status: 200 });
    } catch (eA) {
      hubSysLog_('auto-becoming-staff', 'staff_complete_move_failed',
                 cid + ' — ' + name + ': ' + String((eA && eA.message) || eA), { status: 500 });
    }
  });
  if (moved) hubBustTalentCache_();
  return { archived: moved, still_waiting: waiting };
}

// The last column, with a front door in the protocol — this action belongs IN the protocol.
HUB_POLICY.hiredGraduateRun = {
  file: 'Hired.gs', lane: 'write', store: 'sheet',
  idempotent: true,              // the row stamps are the memory, not the call
  cost: 'seconds',
  roles: ['admin'],
  invalidates: ['candidates', 'onboarding'],
  emits: ['teamAlert']
};
HUB_ACTIONS.hiredGraduateRun = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var out = { graduated: null, completed: null };
  try { hubHiredSweep_(); out.graduated = 'ran'; }
  catch (e) { out.graduated = 'failed: ' + String((e && e.message) || e); }
  try { out.completed = hubBecomingStaffSweep_(); }
  catch (e2) { out.completed = 'failed: ' + String((e2 && e2.message) || e2); }
  hubSysLog_(user && user.email, 'hired_graduate_run', JSON.stringify(out).slice(0, 200),
             { status: 200 });
  return { status: 200, data: out };
};

// ▶ Who is stuck in Becoming Staff, and on what.
function runBecomingStaffPreview() {
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
  var out = { ready: [], waiting: [] };
  rows.forEach(function (c) {
    if (str_(c.archived).toLowerCase() === 'true') return;
    if (talentStage_(c.status) !== 'hired') return;   // merged 2026-08-13
    var st = hubBecomingStaffDone_(c);
    var name = str_(c.candidatename) || str_(c.candidateid);
    if (st.done) out.ready.push(name);
    else out.waiting.push(name + ' — ' + st.missing.join('; '));
  });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// Throttle + try-lock wrapper — the only entry the read path calls.
HUB_POLICY.hiringSweep = {
  file: 'Hired.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: ['emailSend', 'smsSend']
};
// THE WHOLE PASS HAS A BUDGET, AND IT IS CHECKED BEFORE EACH ENGINE STARTS.
var SWEEP_ENGINE_DEADLINE_MS = 150000;

HUB_ACTIONS.hiringSweep = function (payload, user) {
  // The machine lane only: this sends letters and texts.
  if (!user || (!user.is_service && user.role !== 'admin')) return hubDenied_();
  // Scheduling's, Support Requests' and Transportation's clocks are Python's (app/scheduling_clock*,
  // app/support_desk_clock*, app/vc_clock*), rung by the relay.
  // IT SAYS WHICH OF THE THREE THINGS HAPPENED, and that is not decoration.
  var throttled = false;
  try { throttled = !!CacheService.getScriptCache().get('hired_sweep_ran'); }
  catch (eC) { throttled = false; }
  // The comm-bindings book is completed HERE, on the machine lane, and never on a read or public request (the…
  try { if (typeof commBindingsSeedMaybe_ === 'function') commBindingsSeedMaybe_(); }
  catch (eBk) { /* a book problem must not stop the sweep */ }
  // The words live only in the book now — bake its text tabs into the chunked property shadow so an outage serves…
  try { if (typeof bookKvCompileAllMaybe_ === 'function') bookKvCompileAllMaybe_(); }
  catch (eBc) { /* the previous bake keeps answering */ }
  // The matrix registry rides the same clock, for the same reason.
  try { if (typeof hiringRegistryCompileMaybe_ === 'function') hiringRegistryCompileMaybe_(); }
  catch (eRg) { /* the previous bake keeps answering */ }
  // The condition instances, the rounds' trim and the flow and runtime engines are Python's (app/hiring_engine*), rung
  // by the relay's clock.
  try {
    hubHiredSweepMaybe_();
  } catch (e) {
    hubSysLog_('asa-hub:hiring-sweep', 'hiring_sweep_error',
               String((e && e.message) || e), { status: 500 });
    return { status: 500, message: String((e && e.message) || e) };
  }
  return { status: 200, data: { swept: !throttled, throttled: throttled, runtime_judged: 0 } };
};


// ================================================================== THE ONBOARDING LADDER AND THE CONGRATULATION…

// Ask somebody whose onboarding stalled to finish it: a letter carrying the login link and the first password…
HUB_POLICY.hiringOnboardingFinishAsk = {
  file: 'Hired.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend']
};
// FINISH THE ONBOARDING: somebody whose onboarding account exists and whose steps stopped gets a letter every two…
HUB_ACTIONS.hiringOnboardingFinishAsk = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var sit = (typeof smartSituationOn_ === 'function')
    ? smartSituationOn_(commSituationId_('hiring.onboarding.finish_request', 'hiring_onboarding_finish')) : null;
  if (!sit) return { status: 200, data: { sent: false, reason: 'situation_off' } };
  if (str_(ev.cand.archived).toLowerCase() === 'true' ||
      talentStage_(str_(ev.cand.status)) !== 'onboarding') {
    try { simAskAnswer_(['onboarding_finish'], 'the card moved on — the machine lets go', cid); } catch (eG) {}
    return { status: 200, data: { sent: false, reason: 'card_moved_on' } };
  }
  var ob = hubOnboardingDone_(ev.cand);
  if (ob.q && ob.t) {
    try { simAskAnswer_(['onboarding_finish'], 'the onboarding is finished', cid); } catch (eG2) {}
    return { status: 200, data: { sent: false, reason: 'already_done' } };
  }
  var email = str_(ev.cand.email);
  if (email.indexOf('@') === -1) return { status: 200, data: { sent: false, reason: 'no_email' } };
  var name = str_(ev.cand.candidatename);
  var first = hiringGreetFirst_(name);
  var pw = str_(hubProp_('ONBOARDING_USER_PASSWORD')) || str_(hubProp_('FIRST_USER_PASSWORD'));
  var fill = function (t) {
    return String(t || '').split('{first_name}').join(first).split('{name}').join(name)
      .split('{login_link}').join(bookText_('Strings', 'onboarding_finish.login_link', ''))
      .split('{password}').join(pw || bookText_('Strings', 'onboarding_finish.password.floor', ''));
  };
  var subject = fill(str_(sit.email_subject)) ||
    bookText_('Strings', 'onboarding_finish.subject.floor', '');
  var bodyText = fill(str_(sit.email_text));
  var html = mailShell_({
    eyebrow: 'ASA LifeCare',
    title: bookText_('Strings', 'onboarding_finish.title', ''),
    preheader: bookText_('Strings', 'onboarding_finish.preheader', ''),
    blocks: bodyText.split(/\n{2,}/).map(function (pg) {
      return mailPara_(mailEsc_(pg).replace(/\n/g, '<br>'));
    }),
    cta: null, footnote: bookText_('Strings', 'onboarding_finish.footnote', '')
  });
  var res = outreachSend_({
    candidate_id: cid, name: name, step: 'onboarding_finish', to: email,
    cc: (typeof simCcFor_ === 'function') ? simCcFor_(email) : '',
    letter: { subject: subject, text: bodyText, html: html },
    reason: 'hiring: asking them to finish the onboarding', by: str_(user && user.email)
  });
  if (res && res.sent) {
    try { simTrackSend_('onboarding_finish', cid, 'hiringOnboardingFinishAsk', { candidate_id: cid }); } catch (eT) {}
  }
  return { status: 200, data: { sent: !!(res && res.sent) } };
};

// THE ABANDON WATCH.
function onboardingFinishSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('ob_finish_sweep')) return;
  cache.put('ob_finish_sweep', '1', 900);

  var sit = (typeof smartSituationOn_ === 'function')
    ? smartSituationOn_(commSituationId_('hiring.onboarding.finish_request', 'hiring_onboarding_finish')) : null;
  if (!sit) {
    if (typeof tpSweepIdle_ === 'function') {
      tpSweepIdle_('ob-finish', 'hiring_onboarding_finish is OFF in Smart Comms — an ' +
                   'abandoned onboarding is not asked to resume');
    }
    return;
  }
  var byCid = {};
  try {
    simAskRows_().forEach(function (r) {
      if (str_(r.step) !== 'onboarding_finish') return;
      var c = str_(r.candidateid);
      if (c) byCid[c] = r;                        // the LAST row wins
    });
  } catch (eB) { return; }                        // never press blind

  var actor = { role: 'manager', email: 'ob-finish@service.local', id: 'SVC_OB_FINISH' };
  var mins = 120;
  try { mins = simAttemptsFor_('onboarding_finish').minutes; } catch (eM) {}
  var pressed = 0, told = 0;
  var rows;
  try { rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB); }
  catch (eR) { return; }
  rows.forEach(function (c) {
    if (pressed + told >= 5) return;
    if (str_(c.archived).toLowerCase() === 'true') return;
    if (talentStage_(str_(c.status)) !== 'onboarding') return;
    var cid = str_(c.candidateid);
    if (!cid) return;
    var ob = hubOnboardingDone_(c);
    if (ob.q && ob.t) return;                     // finished — nothing to chase
    var email = str_(c.email);
    if (email.indexOf('@') === -1) return;
    var u = null;
    try { u = userByEmail_(email); } catch (eU) { u = null; }
    if (!u) return;                               // no account yet — the mint sweep's job
    var row = byCid[cid];
    if (!row) {
      // FIRST PRESS — but never minutes after the mint: the welcome letter with the same login just went.
      var born = new Date(str_(u.createdat) || 0).getTime();
      if (!isNaN(born) && born && (Date.now() - born) < mins * 60000) return;
      try {
        var r1 = HUB_ACTIONS.hiringOnboardingFinishAsk({ candidate_id: cid }, actor);
        if (r1 && r1.data && r1.data.sent) pressed++;
      } catch (eP) {
        hubSysLog_('asa-hub:ob-finish', 'ob_finish_press_failed',
                   cid + ' — ' + String((eP && eP.message) || eP), { status: 500 });
      }
      return;
    }
    if (str_(row.state) === 'exhausted') {
      // THE TEAM IS TOLD ONCE — the settle is the memo
      var stSit = (typeof smartSituationOn_ === 'function')
        ? smartSituationOn_(commSituationId_('hiring.onboarding.stalled', 'hiring_onboarding_stalled')) : null;
      if (stSit) {
        var name = str_(c.candidatename) || cid;
        var fillSt = function (t) { return String(t || '').split('{name}').join(name); };
        var reh = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(c);
        var addr = (reh && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
        var team = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [] };
        var to = (addr && addr.to) || (team.emails || []).join(', ');
        try {
          if (to) {
            rpcCall_('emailSend', {
              to: to, cc: (addr && addr.cc) || '',
              subject: (typeof simTagSubject_ === 'function')
                ? simTagSubject_(fillSt(str_(stSit.email_subject))) : fillSt(str_(stSit.email_subject)),
              body: fillSt(str_(stSit.email_text)),
              reason: 'hiring: ' + name + ' began the onboarding and did not finish'
            }, { idempotency_key: 'ob_stalled_mail_' + cid });
          }
        } catch (eS2) {
          hubSysLog_('asa-hub:ob-finish', 'ob_stalled_notice_error',
                     cid + ' — ' + String((eS2 && eS2.message) || eS2), { status: 500 });
        }
        try { simAskAnswer_(['onboarding_finish'], 'the team was told — waiting for their word', cid); } catch (eA) {}
        journeyLog_({ candidate_id: cid, name: name, step: 'onboarding_finish', channel: 'email',
                      ok: true, title: 'The team was told — onboarding begun and abandoned',
                      detail: 'seven finish-your-onboarding letters went unanswered; a reply of ' +
                              '"tente mais" restarts a fresh seven the next Ohio morning',
                      by: 'asa-hub:ob-finish' });
        told++;
      }
      return;
    }
    if (str_(row.state) === 'answered') {
      // PARKED — unless the team said "tente mais" after the stall, and the next Ohio morning has arrived (the…
      var wordAt = obTenteMaisAt_(cid, str_(c.candidatename));
      if (!wordAt) return;
      if (wordAt <= new Date(str_(row.lastsentat) || str_(row.createdat)).getTime()) return;
      if (!referralOhioMorningAfter_(new Date(wordAt))) return;
      try {
        var r2 = HUB_ACTIONS.hiringOnboardingFinishAsk({ candidate_id: cid }, actor);
        if (r2 && r2.data && r2.data.sent) {
          pressed++;
          journeyLog_({ candidate_id: cid, name: str_(c.candidatename), step: 'onboarding_finish',
                        channel: 'record', ok: true, title: 'Tente mais — a fresh seven begins',
                        detail: 'the team asked for another round; it starts this Ohio morning',
                        by: 'asa-hub:ob-finish' });
        }
      } catch (eP2) {}
    }
    // 'open' rows climb by the retry pass — nothing to do here
  });
  if (!pressed && !told && typeof tpSweepIdle_ === 'function') {
    tpSweepIdle_('ob-finish', 'nobody at Onboarding is standing still — each one is finished, ' +
                 'unminted, already in the ask book, or parked awaiting the team');
  }
}

// The newest "tente mais" from the team about this candidate, as ms — 0 when none.
function obTenteMaisAt_(cid, name) {
  var threads = [];
  try {
    var inbox = platformMailPost_('/mail/inbox', { limit: 50 });
    if (inbox && inbox.status === 200) threads = (inbox.data && inbox.data.threads) || [];
  } catch (eM) { return 0; }
  var team = [];
  try { team = (hiringTeamRecipients_().emails || []).map(function (e) { return e.toLowerCase(); }); }
  catch (eT) { team = []; }
  try {
    ((typeof simTesterKeys_ === 'function') ? simTesterKeys_() : { emails: [] })
      .emails.forEach(function (e) { if (team.indexOf(e) === -1) team.push(e); });
  } catch (eK) {}
  var best = 0;
  var needle = String(name || '').toLowerCase();
 // THE WORD LIST IS THE SAME FOR ALL FIFTY THREADS: it was compiled inside the loop, so one candidate's look cost…
  var tmWords = bookWordList_('words.ob.tente_mais');
  if (!tmWords.length) return 0;          // no words, no verdict — as before
  threads.forEach(function (t) {
    var from = str_(t.from_addr).toLowerCase();
    var ok = team.some(function (e) { return e && from.indexOf(e) !== -1; });
    if (!ok) return;
    var text = (str_(t.snippet) + ' ' + str_(t.subject)).toLowerCase();
    if (!tmWords.some(function (w) {
      return text.indexOf(w.toLowerCase()) !== -1;
    })) return;
    if (needle && text.indexOf(needle) === -1) return;   // about THIS candidate
    var at = new Date(str_(t.date)).getTime();
    if (!isNaN(at) && at > best) best = at;
  });
  return best;
}

// THE CONGRATULATION: the card reached Hired with rules' essentials — the candidate hears it, by letter AND text…
function hiredCongratsMaybe_(cid, cand) {
  var sit = (typeof smartSituationOn_ === 'function')
    ? smartSituationOn_(commSituationId_('hiring.hired.congratulations', 'hiring_hired_congrats')) : null;
  if (!sit) return;
  var already = false;
  try {
    (journeyFor_(cid) || []).forEach(function (j) {
      if (str_(j.step) === 'hired_congrats') already = true;
    });
  } catch (eJ) { return; }
  if (already) return;
  var name = str_(cand.candidatename) || cid;
  var first = hiringGreetFirst_(name);
  var fill = function (t) {
    return String(t || '').split('{first_name}').join(first).split('{name}').join(name);
  };
  var sentAny = false;
  var email = str_(cand.email);
  if (email.indexOf('@') !== -1) {
    var bodyText = fill(str_(sit.email_text));
    var rm = outreachSend_({
      candidate_id: cid, name: name, step: 'hired_congrats', to: email,
      cc: (typeof simCcFor_ === 'function') ? simCcFor_(email) : '',
      letter: { subject: fill(str_(sit.email_subject)) ||
                  bookText_('Strings', 'hired_congrats.subject.floor', ''),
                text: bodyText,
                html: mailShell_({
                  eyebrow: 'ASA LifeCare',
                  title: bookText_('Strings', 'hired_congrats.title', ''),
                  preheader: bookText_('Strings', 'hired_congrats.preheader', ''),
                  blocks: bodyText.split(/\n{2,}/).map(function (pg) {
                    return mailPara_(mailEsc_(pg).replace(/\n/g, '<br>'));
                  }),
                  cta: null, footnote: bookText_('Strings', 'hired_congrats.footnote', '')
                }) },
      reason: 'hiring: congratulating ' + name + ' — hired', by: 'asa-hub:hired-congrats'
    });
    sentAny = sentAny || !!(rm && rm.sent);
  }
  var sms = fill(str_(sit.sms_text));
  if (sms) {
    var rs = outreachSms_({
      candidate_id: cid, name: name, step: 'hired_congrats',
      to: str_(cand.phone), body: sms,
      intro: (typeof simQuoIntro_ === 'function') ? simQuoIntro_(bookText_('Strings', 'purpose.hired_congrats', '')) : '',
      reason: 'hiring: congratulating ' + name + ' — hired', by: 'asa-hub:hired-congrats'
    });
    sentAny = sentAny || !!(rs && rs.sent);
  }
  journeyLog_({ candidate_id: cid, name: name, step: 'hired_congrats', channel: 'email+sms',
                ok: sentAny, title: sentAny ? 'Congratulated — hired' : 'The congratulation could not go out',
                detail: sentAny ? 'told by letter and text: hired, and our team makes the next contact'
                                : 'neither leg went out — it retries on the next graduation pass',
                by: 'asa-hub:hired-congrats' });
}

function hubHiredSweepMaybe_() {
  // THE MACHINE'S OWN ENTRY.
  try { if (typeof hubPropsCheck_ === 'function') hubPropsCheck_(); } catch (eB) {}
 // MACHINE READS ONLY: this sweep sends SMS and scans tabs — seconds of work a person's click must never carry.
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('hired_sweep_ran')) return;
  cache.put('hired_sweep_ran', '1', 600);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;          // a writer is busy — next pass sweeps
  try {
    // WHAT CAME BACK, BEFORE ANYTHING GOES OUT.
    try { if (typeof commsInboundSweepMaybe_ === 'function') commsInboundSweepMaybe_(); }
    catch (eIn) {
      hubSysLog_('auto-inbound', 'comms_inbound_sweep_error',
                 String((eIn && eIn.message) || eIn), { status: 500 });
    }

    // The CJIS folder, the interview start and ask, and the hiring simulation's retry pass are Python's (app/cjis*,
    // app/interview_flow*, app/hiring_sim*), rung by the relay's clock.

    // The screen redo, the referral ladder, the Added Manually machine and the director fast lane's collector are
    // Python's (app/hiring_riders*), rung by the relay's clock.

    // The standing access rows (interviews → INTERVIEWER, onboarding → ONBOARDING) — seeded once ever; the announce…
    try { if (typeof appAccessSeedDictated_ === 'function') appAccessSeedDictated_(); }
    catch (eSd) {
      hubSysLog_('auto-access-seed', 'app_access_seed_error',
                 String((eSd && eSd.message) || eSd), { status: 500 });
    }
    // family → CLIENT, left on by default — same once-ever law, its own guard; rides the same sweep.
    try { if (typeof appAccessSeedFamily_ === 'function') appAccessSeedFamily_(); }
    catch (eSf) {
      hubSysLog_('auto-access-seed', 'app_access_seed_family_error',
                 String((eSf && eSf.message) || eSf), { status: 500 });
    }
    // Simulator Hiring's seat under Talent Pipeline (STAFF section) — once.
    try { if (typeof appPlacementSeedDictated_ === 'function') appPlacementSeedDictated_(); }
    catch (eSp) {
      hubSysLog_('auto-access-seed', 'app_placement_seed_error',
                 String((eSp && eSp.message) || eSp), { status: 500 });
    }

    // Step 21's wait (the onboarding finish letter) is Python's (app/hiring_hired*), rung by the relay's clock; the
    // login it waits for is still minted here.
    try { if (typeof onboardingUserSweepMaybe_ === 'function') onboardingUserSweepMaybe_(); }
    catch (eOu) {
      hubSysLog_('auto-onboard-user', 'onboarding_user_sweep_error',
                 String((eOu && eOu.message) || eOu), { status: 500 });
    }

    // Chapters 22 and 25 (the Ready to Start watch, the deciders' ask and its ear) are Python's (app/hiring_hired*),
    // rung by the relay's clock.

    // The Talent finisher, the automatic crossing, the no-contact archive, the unasked call, the rehearsal cards, the
    // unreachable archive and the floor under the release are Python's (app/talent_riders*, app/hiring_riders*), rung
    // by the relay's clock in this order.

    // The Ready to Start parking clock is Python's (app/hiring_hired*), rung by the relay's clock.

 // The AI keys, once a week.
    try { if (typeof aiKeySweepMaybe_ === 'function') aiKeySweepMaybe_(); }
    catch (eAK) {
      hubSysLog_('auto-ai-keys', 'ai_key_sweep_error',
                 String((eAK && eAK.message) || eAK), { status: 500 });
    }

    // The eMAR history copies itself into our own tab, a page per ride, until it is done — then this is a no-op…
    try { if (typeof marImportSweepMaybe_ === 'function') marImportSweepMaybe_(); }
    catch (eMar) {
      hubSysLog_('auto-mar-import', 'mar_import_sweep_error',
                 String((eMar && eMar.message) || eMar), { status: 500 });
    }

    // The packet request, the recruitment sync, the packet hold, Hired's first pass and becoming staff are Python's
    // (app/hiring_packet*, app/talent_recruitment*, app/hiring_hired*), rung by the relay's clock in this order; the
    // graduation of a stamped card (its staff account) stays in hubHiredSweep_ below.
    // The mail ledger's collection is Python's (app/mail_log*), rung by the relay's clock.
    hubHiredSweep_();
    // The Employee Database step is Python's (app/employee_db*), rung by the relay's clock.
    // Time Reconciliation's daily import and run is Python's (app/recon.py reconAutoSweep, rung by the relay's clock).

    // THE LANE MIRRORS' CATCH-UP.
    try { if (typeof laneMirrorSweepMaybe_ === 'function') laneMirrorSweepMaybe_(); } catch (eLM) {
      hubSysLog_('asa-hub:lanemirror', 'lane_mirror_sweep_error',
                 String((eLM && eLM.message) || eLM), { status: 500 });
    }

    // AND THE FORM'S CALL-OFFS ARE CROSSED INTO THE LANE (package 2).
    try { if (typeof dupScanSweepMaybe_ === 'function') dupScanSweepMaybe_(); } catch (eDup) {
      hubSysLog_('asa-hub:dupscan', 'dup_scan_sweep_error',
                 String((eDup && eDup.message) || eDup), { status: 500 });
    }

    try { if (typeof callOffFormSweepMaybe_ === 'function') callOffFormSweepMaybe_(); } catch (eCF) {
      hubSysLog_('asa-hub:calloffform', 'calloff_form_sweep_error',
                 String((eCF && eCF.message) || eCF), { status: 500 });
    }

    // Call offs into the platform mailbox are written by Python (app/letters.py).

    // Smart Comms reminders are throttled here to save EXECUTIONS, not for safety — their own ledger already stops…
    try {
      // The EVENT sweep runs on every pass, unlike the reminders: a certification expiring is still there tomorrow…
      try {
        if (typeof smartEventSweep_ === 'function') smartEventSweep_({});
      } catch (eEv) {
        hubSysLog_('asa-hub:smartcomms', 'smart_event_sweep_error',
                   String((eEv && eEv.message) || eEv), { status: 500 });
      }
      // AND AN HOUR ON A ROW WAKES IT — the hours a situation keeps.
      var ran = cache.get('smart_comms_ran');
      var hoursWaiting = (ran && typeof smartScheduleWaiting_ === 'function')
        ? smartScheduleWaiting_() : [];
      if (typeof smartCommsSweep_ === 'function' && (!ran || hoursWaiting.length)) {
        cache.put('smart_comms_ran', '1', 21600);   // 6h — four chances a day
        if (hoursWaiting.length && typeof smartScheduleMarkRun_ === 'function') {
          smartScheduleMarkRun_(hoursWaiting);
          hubSysLog_('asa-hub:smartcomms', 'smart_hour_woke_sweep',
                     hoursWaiting.map(function (w) { return w.id + ' @ ' + w.slot; }).join(' · '),
                     { status: 200 });
        }
        smartCommsSweep_({});
      }
    } catch (eS) {
      hubSysLog_('asa-hub:smartcomms', 'smart_comms_sweep_error',
                 String((eS && eS.message) || eS), { status: 500 });
    }
  } finally {
    lock.releaseLock();
  }
}

// The one door out of the hold — is the signed packet there yet?
function hubPacketHoldSweep_() {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var held = readTabNormalized_(ss, TALENT_CANDIDATES_TAB).filter(function (c) {
    var id = str_(c.candidateid);
    if (!id || TALENT_EXCLUDE_IDS.indexOf(id) !== -1) return false;
    if (str_(c.archived).toLowerCase() === 'true') return false;
    if (talentStage_(c.status) !== 'onboarding') return false;
    return !!str_(c.packetholduntil);
  });
  if (!held.length) return;

  var rows = packetMirrorRows_();
  held.forEach(function (c) {
    var cid = str_(c.candidateid);
    var res = null;
    try { res = packetState_(c, rows); } catch (e) { return; }   // unreadable: try next pass
    if (!res || (res.state !== 'signed' && res.state !== 'waived')) {
      // Still nothing: the card stays at Onboarding and packetHold_ turns it amber on its own once the day is past…
      return;
    }
    packetStamp_(cid, res, { email: 'auto-packet-hold' });
    var moved = hubSetStatus_(cid, HUB_STAGE_TO_STATUS.hired, { email: 'auto-packet-hold' });
    packetHoldClear_(cid, { email: 'auto-packet-hold' });
    hubBustTalentCache_();
    hubSysLog_('auto-packet-hold', 'packet_hold_released',
      cid + ' — ' + str_(c.candidatename) + ': packet ' + res.state +
      (res.by ? ' (matched by ' + res.by + ')' : '') +
      (moved ? ' — moved to Hired' : ' — the card was not on the board'), { status: 200 });
  });
}

// First pass at Hired: start the one-day clock, move the card into Becoming Staff and alert the team; later passes…
function hubHiredSweep_() {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var cands = readTabNormalized_(ss, TALENT_CANDIDATES_TAB);
  var hired = [];
  cands.forEach(function (c) {
    var id = str_(c.candidateid);
    if (!id || TALENT_EXCLUDE_IDS.indexOf(id) !== -1) return;
    if (str_(c.archived).toLowerCase() === 'true') return;
    // THREE stages, not two: the board lets a card be dragged from Hired straight onto `internal-docs`, which…
    var st = talentStage_(c.status);
    if (st !== 'hired' && st !== 'becoming-staff' && st !== 'internal-docs') return;
    hired.push(c);
  });
  if (!hired.length) return;

  var now = Date.now();
  hired.forEach(function (c) {
    var cid = str_(c.candidateid);
    var stampRaw = str_(c.hiredcompleteat);
    var stamp = stampRaw ? new Date(stampRaw).getTime() : NaN;
    if (stampRaw && !isNaN(stamp)) {
      // Clock already running: make sure the card sits in the column where that is VISIBLE (a stamped card in Hired…
      if (now - stamp >= HIRED_SHOWCASE_MS) hubHiredGraduate_(c);
      return;
    }
    // The first pass at Hired (the stamp and the congratulation) is Python's (app/hiring_hired* hiredStaySweep).
  });
}

// WHAT THE HIRED ALERT SAYS ABOUT A CARD — { missing: [], manual }.
function hubHiredFacts_(c, docsAll, analyses) {
  var cid = str_(c.candidateid);
  var docs = (docsAll && docsAll[cid]) || {};
  if (str_(c.docsfolderid)) docs.__folder = true;
  var ob = hubOnboardingDone_(c);
  var analysis = (analyses && analyses[cid]) || {};
  var manualOb = ob.how === 'manual';
  var missing = [];
  if (!manualOb) {
    var docRows = onboardingChecklist_(docs, 'ready', analysis.cjisstatus);
    var missingDocs = [];
    for (var d = 0; d < docRows.length; d++) {
      if (docRows[d].status === 'done' || docRows[d].status === 'auto') continue;
      if (docRows[d].doc) missingDocs.push(docRows[d].label);
    }
    if (missingDocs.length) missing.push('Upload Documents — missing: ' + missingDocs.join(', '));
    if (!ob.q) missing.push('New Hire Questionnaire — not completed');
    if (!ob.t) missing.push('New Hire Tutorials — not completed');
  }
  return { missing: missing, manual: manualOb };
}

// THE HIRED ALERT ITSELF — { done, state, why, situation }.
function hubHiredAlert_(c, facts, tail) {
  var cid = str_(c.candidateid);
  var name = str_(c.candidatename);
  var missing = (facts && facts.missing) || [];
  var manualOb = !!(facts && facts.manual);
  var msgVars = {
    name: name, phone: hubPhoneE164_(str_(c.phone)) || '—', email: str_(c.email) || '—',
    // WHICH of the two stories, not "the button was pressed" — the button is the only way past Onboarding, so it…
    manual_note: !manualOb ? ''
      : (str_(c.manualonboardingmethod) === 'portal'
          ? ' (Confirmed on the card — the portal visit was already complete.)'
          : ' (Onboarding was completed manually, by email.)'),
    missing: '- ' + missing.join('\n- ')
  };
  var sitId = missing.length
    ? commSituationId_('hiring.hired.missing', 'hiring_hired_missing')
    : commSituationId_('hiring.hired.complete', 'hiring_hired_complete');
  var sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(sitId) : null;
  if (!sit) {
    hubSysLog_('auto-graduate', 'hired_alert_skipped',
               cid + ' — ' + name + ': situation_off (' + sitId + ')', { status: 200 });
    return { done: false, state: 'off', why: 'situation off (' + sitId + ')', situation: sitId };
  }
  var subject = hiringRenderMail_(str_(sit.email_subject) ||
    (missing.length ? 'Hub — Hired with items MISSING: {name}' : 'Hub — Hired complete: {name}'), msgVars);
  // The shipped words are the floor under an emptied cell — an alert must never go out blank (hubAlertRender_'s old…
  var fallback = missing.length
    ? 'Hub: {name} reached Hired, but these items are missing:\n{missing}\n' +
      'Phone: {phone} · Email: {email}\n' +
      'They still stay one more day on the pipeline and then move to Users as ' +
      'staff — chase the missing items in the Onboarding Tracker.'
    : 'Hub: {name} completed every Hired step — all documentation is OK.{manual_note}\n' +
      'Phone: {phone} · Email: {email}\n' +
      'They stay on the last step of the Hiring Pipeline for one more day, ' +
      'then move to Users as staff automatically.';
  var smsBody = hiringRenderMail_(str_(sit.sms_text) || str_(sit.email_text) || fallback, msgVars);
  var mailBody = hiringRenderMail_(str_(sit.email_text) || str_(sit.sms_text) || fallback, msgVars);
  var letter = hiringNoticeEmail_({
    title: subject,
    preheader: missing.length ? 'The card reached Hired with items still owed.'
                              : 'Every Hired step is green.',
    bodyText: mailBody
  });
  var reach = hubTeamAlert_({
    subject: subject, body: smsBody, html: letter.html, mail_text: mailBody,
    reason: 'smart comms: ' + sitId + (tail ? ' ' + tail : ''),
    key: 'hired_alert|' + sitId + '|' + cid
  });
  // A brake is not an off switch: the answer must not report one as the other.
  return { done: !!reach.done, state: reach.state, why: str_(reach.why) || reach.state, situation: sitId };
}

// THE MORNING, FOR A HIRED ALERT THE QUIET WINDOW HELD.
function hubHiredQuietCarry_(data) {
  var cid = str_((data || {}).cid);
  if (!cid) return { state: 'stale', why: 'the entry names no card' };
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var c = null;
  readTabNormalized_(ss, TALENT_CANDIDATES_TAB).forEach(function (row) {
    if (str_(row.candidateid) === cid) c = row;
  });
  if (!c) return { state: 'stale', why: cid + ' is no longer on the candidates tab' };
  if (str_(c.archived).toLowerCase() === 'true') return { state: 'stale', why: cid + ' was archived overnight' };
  var st = talentStage_(c.status);
  if (st !== 'hired' && st !== 'becoming-staff' && st !== 'internal-docs') {
    return { state: 'stale', why: cid + ' left the Hired stay overnight (' + str_(c.status) + ')' };
  }
  if (typeof commsIsTestCandidate_ === 'function' && commsIsTestCandidate_(c)) {
    return { state: 'stale', why: cid + ' is a test card' };
  }
  var analyses = {};
  readTabNormalized_(ss, TALENT_RESUME_TAB).forEach(function (a) {
    var id = str_(a.candidateid);
    if (id) analyses[id] = a;
  });
  var said = hubHiredAlert_(c, hubHiredFacts_(c, onboardingDocIndex_(), analyses),
                            '(held overnight by the quiet window)');
  return { state: 'carried', why: said.done ? 'the team was told' : ('not told: ' + said.why) };
}

// The move itself: a staff account in Users, UNARMED — it is armed by hand with a password, and this code never…
function hubHiredGraduate_(c) {
  var cid = str_(c.candidateid);
  var name = str_(c.candidatename);
  var email = str_(c.email).toLowerCase();

  var made = false, skippedWhy = '';
  if (typeof commsIsTestCandidate_ === 'function' && commsIsTestCandidate_(c)) {
    skippedWhy = 'test card — no staff account is ever minted from a rehearsal';
  } else if (!email || email.indexOf('@') === -1) {
    skippedWhy = 'no email on the candidate — create the account by hand';
  } else if (userByEmail_(email)) {
 // THE LIFECYCLE: the account made at onboarding entry is THE SAME PERSON — finishing onboarding PROMOTES it to…
    var existing = userByEmail_(email);
    if (existing && str_(existing.role) === 'onboarding') {
      var pSheet = hubSheet_(USERS_TAB);
      var pVals = pSheet.getDataRange().getValues();
      var pHdr = pVals[0].map(normKey_);
      var pIdI = pHdr.indexOf('userid'), pRoleI = pHdr.indexOf('role');
      for (var pr = pVals.length - 1; pr >= 1; pr--) {
        if (str_(pVals[pr][pIdI]) !== str_(existing.userid) &&
            str_(pVals[pr][pHdr.indexOf('email')]).toLowerCase() !== email) continue;
        pSheet.getRange(pr + 1, pRoleI + 1).setValue('staff');
        break;
      }
      try {
        ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB), ['staff_user_id']);
        hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid,
          { staff_user_id: str_(existing.userid) }, { email: 'auto-graduate' }, false);
      } catch (eSU) { /* the promotion still happened */ }
 // FINISHING ONBOARDING ASSIGNS STAFF: ONBOARDING badge leaves with the stage, STAFF arrives with it — any other…
      try {
        var gradTypes = userTypesFromRaw_(str_(existing.types)).types
          .filter(function (t) { return t !== 'ONBOARDING'; });
        if (gradTypes.indexOf('STAFF') === -1) gradTypes.push('STAFF');
        hubUserTypesSet_(str_(existing.userid), gradTypes);
      } catch (eT) { /* the role already carries the truth */ }
      made = true;
      hubSysLog_('auto-graduate', 'onboarding_user_promoted',
                 cid + ' — ' + name + ': the onboarding account became staff (same login, same password)',
                 { status: 200 });
    } else {
      skippedWhy = 'already a user';
    }
  } else {
    ensureUserProfileColumns_();
    var usersSheet = hubSheet_(USERS_TAB);
    ensureHeader_(usersSheet, ['candidate_id']);
    var uHdr = usersSheet.getDataRange().getValues()[0].map(normKey_);
    var uCol = {};
    ['userid', 'email', 'displayname', 'role', 'active', 'createdat', 'title', 'phone', 'candidateid',
     'hometenant']
      .forEach(function (k) { uCol[k] = uHdr.indexOf(k); });
    // ONE appendRow carrying everything (the PeopleMerge lesson: a second write into getLastRow() can land on…
    var line = [];
    for (var i = 0; i < uHdr.length; i++) line.push('');
    line[uCol.userid] = 'USR_' + randomHex_(12).toUpperCase();
    line[uCol.email] = email;
    line[uCol.displayname] = name;
    line[uCol.role] = 'staff';
    line[uCol.active] = 'true';
    line[uCol.createdat] = new Date().toISOString();
    if (uCol.title !== -1) line[uCol.title] = 'Direct Support Professional';
    if (uCol.phone !== -1) line[uCol.phone] = str_(c.phone);
    if (uCol.candidateid !== -1) line[uCol.candidateid] = cid;
    // born where the graduation happened (Tenant.gs) — blank = headquarters
    if (uCol.hometenant !== undefined && uCol.hometenant !== -1 && hubAwayTenant_()) {
      line[uCol.hometenant] = tenantStamp_();
    }
    usersSheet.appendRow(line);
 // born at graduation = born STAFF
    try { hubUserTypesSet_(line[uCol.userid], ['STAFF']); } catch (eT2) { /* display only */ }
    made = true;
    // Remembered on the card so the last column can ask whether the account is armed without scanning the users tab…
    try {
      ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB), ['staff_user_id']);
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid,
        { staff_user_id: line[uCol.userid] }, { email: 'auto-graduate' }, false);
    } catch (eSU) { /* the sweep re-derives it from the users tab */ }
  }

  // THE SKIP HAS TO BE VISIBLE, not just logged: with no account created the person is STUCK, so the card stays in…
  if (!made && skippedWhy && skippedWhy.indexOf('test card') === -1) {
    ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB), ['graduation_held']);
    hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid,
      { graduation_held: skippedWhy }, { email: 'auto-graduate' }, false);
    hubBustTalentCache_();
    hubSysLog_('auto-graduate', 'hired_graduation_held',
      cid + ' — ' + name + ': ' + skippedWhy, { status: 200 });
    return;
  }

  // THE CARD STAYS IN BECOMING STAFF until the work is done — never archived here, and it does not move to a second…
  hubBustTalentCache_();
  hubSysLog_('auto-graduate', 'hired_graduated',
    cid + ' — ' + name + (made ? '; staff account created (awaiting password)' : '; account skipped: ' + skippedWhy) +
    '; held in Hired until the account is armed and the Employee Database is written',
    { status: 200 });
}

// THE MANAGER'S HAND: the last stage waits.
HUB_POLICY.hiredStart = {
  file: 'Hired.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};
HUB_ACTIONS.hiredStart = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  if (talentStage_(ev.cand.status) !== 'ready') {
    return { status: 409, message: 'Only a card at Ready to start can begin activities — this one is at "' +
             str_(ev.cand.status) + '".' };
  }
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid,
    { archived: 'true' }, { email: str_(user && user.email) }, false);
  try {
    hubSysLog_(str_(user && user.email), 'hired_start',
               str_(ev.cand.candidatename) + ' — activities started; card left the board', { status: 200 });
  } catch (eL) {}
  try { hubBustTalentCache_(); } catch (eB) {}
  return { status: 200, data: { started: true } };
};


// ENTERING ONBOARDING CREATES THEIR OWN DOOR: shared onboarding@ login is retired — the person signs in with THEIR…
function onboardingEmailValid_(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim().toLowerCase());
}

/** Dedupe candidate e-mails, keeping each first source label. Pure. */
function onboardingEmailDedupe_(list) {
  var seen = {}, out = [];
  (list || []).forEach(function (c) {
    var e = String((c && c.email) || '').trim().toLowerCase();
    if (!onboardingEmailValid_(e) || seen[e]) return;
    seen[e] = true;
    out.push({ email: e, source: String((c && c.source) || '') });
  });
  return out;
}

// FIND THE PERSON'S REAL E-MAIL: the onboarding account logs them in with the address they actually use, so every…
function onboardingFindEmail_(cand, analysis) {
  var found = [];
  found.push({ email: str_(cand.email), source: 'candidate card' });
  if (analysis) found.push({ email: str_(analysis.email), source: 'resume analysis' });
  var nameKey = '';
  try { nameKey = clientNameKey_(str_(cand.candidatename)); } catch (e0) { nameKey = ''; }
  var digits = str_(cand.phone).replace(/\D/g, '').slice(-10);
  try {
    listRows_('people', {}).forEach(function (p) {
      var pKey = '';
      try { pKey = clientNameKey_(str_(p.name)); } catch (e1) { pKey = ''; }
      var pDigits = str_(p.phone).replace(/\D/g, '').slice(-10);
      if ((nameKey && pKey === nameKey) || (digits.length === 10 && pDigits === digits)) {
        found.push({ email: str_(p.email), source: 'people roster (' + str_(p.name) + ')' });
      }
    });
  } catch (e2) { /* no roster, no matches */ }
  var distinct = onboardingEmailDedupe_(found);
  if (!distinct.length) return null;
  if (distinct.length === 1) return distinct[0];
  // Several candidates: the AI adjudicates, bounded to the found list.
  try {
    var ptpl = bookText_('Prompts', 'ai_find_email', '')
      .split('{name}').join(str_(cand.candidatename))
      .split('{phone}').join(str_(cand.phone))
      .split('{candidates}').join(JSON.stringify(distinct));
    var chat = ptpl ? screenAiChat_(ptpl, 0, 'ai_find_email') : null;
    var pick = '';
    try { pick = String((JSON.parse(str_(chat && chat.content)) || {}).email || '').toLowerCase(); } catch (eJ) { pick = ''; }
    for (var i = 0; i < distinct.length; i++) {
      if (chat && chat.ok && distinct[i].email === pick) return distinct[i];
    }
  } catch (eA) { /* the card's own address stands */ }
  return distinct[0];
}

// THE QUIET WINDOW AND THE LOGIN LETTER (Rpc.gs hubQuietHolds_).
var ONBOARDING_QUIET_MARGIN_MS = 5 * 60 * 1000;

/** Is it inside the quiet window now, or about to be? */
function onboardingQuietSoon_() {
  if (typeof hubQuietAt_ !== 'function') return false;
  var now = (typeof hubQuietNow_ === 'function') ? hubQuietNow_() : new Date();
  return hubQuietAt_(now) || hubQuietAt_(new Date(now.getTime() + ONBOARDING_QUIET_MARGIN_MS));
}

// Was this move made by a person at a screen — never the relay, never one of the platform's own machine writers…
function onboardingByPerson_(user) {
  if (!user || user.is_service) return false;
  if (typeof HUB_IS_SERVICE_REQ !== 'undefined' && HUB_IS_SERVICE_REQ) return false;
  return /^[^@\s:]+@[^@\s]+$/.test(String(user.email || '').trim());
}

/** `opts.by_person` — a person's own click caused this mint (onboardingByPerson_). */
function onboardingEnsureUser_(cid, opts) {
  // a switched session mints no login: the move stands and the sweep (onboardingUserSweepMaybe_) mints it
  if (typeof beAnotherActive_ === 'function' && beAnotherActive_()) {
    return { made: false, why: 'the sweep mints the login' };
  }
  var byPerson = !!(opts && opts.by_person);
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { made: false, why: 'no candidate' };
 // STEP 21: with CJIS and the Dropbox packet signed, the user is created here — login, default password, BADGE…
  var isTest21 = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(ev.cand);
  if (!isTest21) {
    var a21 = ev.analysis || {};
    var cjOk21 = hubCjisCleared_(a21) || !!str_(a21.cjisreporturl);
    if (!cjOk21) {
      try {
        journeyLog_({ candidate_id: cid, name: str_(ev.cand.candidatename), step: 'onboarding',
                      channel: 'record', ok: false,
                      detail: 'the login WAITS for the CJIS report — the sweep mints it the ' +
                              'moment it lands (the folders are watched; the packet no ' +
                              'longer holds this door)',
                      by: 'asa-hub:onboard-user' });
      } catch (eJ21) {}
      return { made: false, why: 'waiting for the CJIS report' };
    }
  }
  var name = str_(ev.cand.candidatename) || cid;
  var pickedEmail = onboardingFindEmail_(ev.cand, ev.analysis);
  var email = pickedEmail ? pickedEmail.email : '';
  if (!email) {
    hubSysLog_('asa-hub:auto-onboard-user', 'onboarding_user_no_email',
               cid + ' — ' + name + ': no valid e-mail in any source, no account made', { status: 200 });
    return { made: false, why: 'no email' };
  }
  // FILL-BLANK-ONLY: a card with no e-mail learns the one we found — a card that already has one is never rewritten…
  if (!str_(ev.cand.email) && pickedEmail.source !== 'candidate card') {
    try {
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, { email: email },
                          { email: 'asa-hub:auto-onboard-user' }, false);
      hubSysLog_('asa-hub:auto-onboard-user', 'onboarding_email_filled',
                 cid + ' — ' + name + ': e-mail found in ' + pickedEmail.source, { status: 200 });
    } catch (eF) { /* the account still gets made */ }
  }
  if (userByEmail_(email)) return { made: false, why: 'exists' };
  if (!byPerson && onboardingQuietSoon_()) {
    return { made: false, why: 'the quiet window (' +
             ((typeof hubQuietWords_ === 'function') ? hubQuietWords_() : '21:31–07:59 New York') +
             ') — nobody asked for this login now; the first sweep after 08:00 mints it and sends it' };
  }
  // FIRST_USER_PASSWORD and ONBOARDING_USER_PASSWORD hold the same value — either name satisfies both doors.
  var pw = str_(hubProp_('ONBOARDING_USER_PASSWORD')) ||
           str_(hubProp_('FIRST_USER_PASSWORD'));
  if (!pw) {
    hubSysLog_('asa-hub:auto-onboard-user', 'onboarding_user_no_property',
               cid + ' — set ONBOARDING_USER_PASSWORD (or FIRST_USER_PASSWORD); no account made',
               { status: 500 });
    return { made: false, why: 'no property' };
  }
  // THE SAME GATE THE OTHER DOORS ASK.
  if (typeof userIdentityConflict_ === 'function') {
    var clash = userIdentityConflict_(name, email, str_(ev.cand && ev.cand.phone));
    if (clash) {
      hubSysLog_('asa-hub:auto-onboard-user', 'onboarding_user_already',
                 cid + ' — "' + name + '" matches "' + clash.who + '" by ' + clash.how +
                 '; no second account was made', { status: 200 });
      return { made: false, why: 'already an account: ' + clash.who + ' (' + clash.how + ')' };
    }
  }
  var salt = randomHex_(32);
  var uid = 'USR_' + randomHex_(12).toUpperCase();
  hubSheet_(USERS_TAB).appendRow([
    uid, email, name, 'onboarding', salt, hashPassword_(pw, salt),
    'true', new Date().toISOString(), ''
  ]);
 // THE DEFAULT IS A KEY FOR ONE USE — it is what staff and onboarding accounts get when their login is created.
  try { userSetFields_(uid, { must_change: 'true' }); }
  catch (eM) { /* the account stands; the first sign-in stamps it anyway */ }
  if (hubAwayTenant_()) {
    try { userSetFields_(uid, { home_tenant: tenantStamp_() }); }
    catch (eT) { /* the account stands; the stamp can be set by hand */ }
  }
 // IN ONBOARDING = the ONBOARDING badge — swapped for STAFF by hubHiredGraduate_ the day the onboarding finishes.
  try { hubUserTypesSet_(uid, ['ONBOARDING']); } catch (eT) { /* display only */ }
  hubSysLog_('asa-hub:auto-onboard-user', 'onboarding_user_created',
             cid + ' — ' + name + ' can now sign in as ' + email + ' (role onboarding)',
             { status: 200 });

 // AND THE PERSON IS TOLD — card step 15: at this phase an automatic login e-mail is created for them.
  var told = false;
  try {
    var obFirst = (typeof hiringGreetFirst_ === 'function')
      ? hiringGreetFirst_(name) : (String(name || '').split(/\s+/)[0] || String(name || ''));
    var letter = onboardingWelcomeLoginEmail_({
      name: name, email: email, password: pw,
      subject: ((typeof simText_ === 'function') ? simText_('onboarding_subject', '') : '')
        .replace(/\{first_name\}/g, obFirst).replace(/\{name\}/g, String(name || '')),
      bodyText: ((typeof simText_ === 'function') ? simText_('onboarding_body', '') : '')
        .replace(/\{first_name\}/g, obFirst).replace(/\{name\}/g, String(name || ''))
    });
    // A SIGN-IN LETTER (Rpc.gs HUB_QUIET_EXEMPT) ONLY WHEN A PERSON CAUSED IT (onboardingByPerson_).
    var quietExempt = byPerson ? 'sign_in' : '';
    var rMail = rpcCall_('emailSend', {
      to: email, subject: letter.subject, body: letter.text, html: letter.html,
      reason: 'onboarding: the new hire is told about their own account'
    }, { idempotency_key: 'onb_login_' + cid, quiet_exempt: quietExempt });
    told = !!(rMail && rMail.ok && rMail.sent);
 // STEP 23: the login goes BY TEXT TOO — the same address and first password land on their phone beside the letter.
    var obPhone = (typeof simSendablePhone_ === 'function')
      ? simSendablePhone_(str_(ev.cand.phone)) : str_(ev.cand.phone);
    var smsTold = false;
    if (obPhone) {
      try {
        var smsBody23 = ((typeof simText_ === 'function') ? simText_('onboarding_sms', '') : '')
            .replace(/\{first_name\}/g, obFirst).replace(/\{email\}/g, email)
            .replace(/\{password\}/g, pw) ||
          ('Your ASA LifeCare onboarding login: ' + email + ' — first-time password: ' + pw +
           ' (you will choose your own at sign-in). Sign in at https://asamylife.asalifecare.com/');
        var rSms23 = rpcCall_('smsSend', { to: obPhone, body: smsBody23,
          reason: 'onboarding: the login by text too'
        }, { idempotency_key: 'onb_login_sms_' + cid, quiet_exempt: quietExempt });
        smsTold = !!(rSms23 && rSms23.ok && rSms23.sent);
      } catch (eS23) { smsTold = false; }
    }
    if (typeof journeyLog_ === 'function') {
      journeyLog_({ candidate_id: cid, name: name, step: 'onboarding_account',
                    channel: smsTold ? 'email+sms' : 'email', to: email, ok: told,
                    rehearsal: !!(rMail && rMail.redirected),
                    detail: told ? ('their onboarding login was sent' +
                                    (smsTold ? ' — by letter AND by text' : ''))
                                 : ('the account exists but the letter did not go — ' +
                                    str_((rMail && (rMail.reason || rMail.error)) || 'send failed')),
                    by: 'asa-hub:auto-onboard-user' });
    }
  } catch (eSend) {
    hubSysLog_('asa-hub:auto-onboard-user', 'onboarding_user_letter_failed',
               cid + ' — the account was created but the login letter failed: ' +
               String((eSend && eSend.message) || eSend), { status: 500 });
  }
  return { made: true, told: told };
}

// STEP 21's WAIT: a candidate standing at the onboarding stage whose login could not be minted yet — the signed…
function onboardingUserSweepMaybe_() {
  // NOT INSIDE THE QUIET WINDOW (onboardingQuietSoon_): a login nobody asked for waits for the morning, and the…
  if (onboardingQuietSoon_()) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('onboarding_user_sweep')) return;
  cache.put('onboarding_user_sweep', '1', 900);
  var rows;
  try { rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB); }
  catch (e) { return; }
  rows.forEach(function (c) {
    try {
      if (talentStage_(str_(c.status)) !== 'onboarding') return;
      var got = onboardingEnsureUser_(str_(c.candidateid));
      if (got && got.made) {
        journeyLog_({ candidate_id: str_(c.candidateid), name: str_(c.candidatename),
                      step: 'onboarding', channel: 'record', ok: true,
                      detail: 'the second piece landed — the onboarding login was minted by ' +
                              'the sweep (signed packet + CJIS report both on record)',
                      by: 'asa-hub:onboard-user-sweep' });
      }
    } catch (e2) { /* the next candidate still gets its try */ }
  });
}

// STEP 22's EXIT: a person stays at Ready to Start UNTIL they are found with a schedule in the Shift Board app…
function readyToStartSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('ready_start_sweep')) return;
  cache.put('ready_start_sweep', '1', 900);
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var cands;
  try { cands = readTabNormalized_(ss, TALENT_CANDIDATES_TAB); } catch (e) { return; }
  var ready = cands.filter(function (c) {
    return str_(c.archived).toLowerCase() !== 'true' &&
           talentStage_(str_(c.status)) === 'ready';
  });
  if (!ready.length) return;
  var byName = {};
  try {
    readTabNormalized_(ss, 'shiftCards').forEach(function (s) {
      var n = str_(s.personname) || str_(s.staffname) || str_(s.staff) || str_(s.name);
      var k = n.toLowerCase().replace(/[^a-z]/g, '');
      if (k) byName[k] = n;
    });
  } catch (e2) { return; }   // an unreadable board releases nobody
  ready.forEach(function (c) {
    if (typeof commsIsTestCandidate_ === 'function' && commsIsTestCandidate_(c)) return;
    var key = str_(c.candidatename).replace(/^\s*\[test\]\s*/i, '')
      .toLowerCase().replace(/[^a-z]/g, '');
    if (!key || !byName[key]) return;
    try {
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, str_(c.candidateid),
                          { archived: 'true' }, { email: 'asa-hub:ready-watch' }, false);
      hubBustTalentCache_();
      journeyLog_({ candidate_id: str_(c.candidateid), name: str_(c.candidatename),
                    step: 'ready', channel: 'record', ok: true,
                    detail: 'found on the Shift Board with a schedule (' + byName[key] +
                            ') — Ready to Start released by itself',
                    by: 'asa-hub:ready-watch' });
      hubSysLog_('asa-hub:ready-watch', 'ready_to_start_released',
                 str_(c.candidateid) + ' — ' + str_(c.candidatename) +
                 ' is scheduled on the Shift Board', { status: 200 });
    } catch (e3) { /* the next person still gets their look */ }
  });
}

// THE PARKING MACHINE — seven days, but configurable, and the shape of "extended" is the clock and a notice.
function readyParkedSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('ready_parked_sweep')) return;
  cache.put('ready_parked_sweep', '1', 900);
  // A Smart Comms situation (hiring_ready_parked): off, the machine is not even armed.
  if (!hubLaneSituation_('hiring_ready_parked').on) return;

  var cfg = (typeof simAttemptsFor_ === 'function')
    ? simAttemptsFor_('ready_parked') : { attempts: 4, minutes: 10080 };
  var lengthMs = Math.max(5, cfg.minutes) * 60000;

  var ss;
  var rows;
  try {
    ss = ssOpen_(hubId_('HUB_DB_ID'));
    rows = readTabNormalized_(ss, TALENT_CANDIDATES_TAB);
  } catch (e) { return; }

  // THE BOOK FIRST, AND NEVER PRESS BLIND: an unreadable ask book would re-tell every already-told card off its…
  var book = {};
  try {
    simAskRows_().forEach(function (a) {
      if (str_(a.step) !== 'ready_parked') return;
      var bid = str_(a.candidateid);
      if (bid) book[bid] = a;                       // last row wins
    });
  } catch (eB) { return; }

  var props = PropertiesService.getScriptProperties();
  var armedAt = str_(props.getProperty('READY_PARKED_ARMED_AT'));
  if (!armedAt) {
    armedAt = new Date().toISOString();
    try {
      props.setProperty('READY_PARKED_ARMED_AT', armedAt);
      hubSysLog_('asa-hub:ready-parked', 'ready_parked_machine_armed',
                 'only people who reach Ready to Start after ' + armedAt +
                 ' enter the parking clock', { status: 200 });
    } catch (eArm) { return; }                      // unstamped = unarmed
  }

  var arrivals = (typeof talentStageArrivals_ === 'function') ? talentStageArrivals_(ss) : {};
  var standing = {};
  var due = [];
  rows.forEach(function (c) {
    var cid = str_(c.candidateid);
    if (!cid || str_(c.archived).toLowerCase() === 'true') return;
    if (talentStage_(str_(c.status)) !== 'ready') return;
    standing[cid] = true;
    var since = str_((arrivals[cid] || {}).ready);
    if (!since || since < armedAt) return;          // unwritten, or older than the arming
    var ask = book[cid];
    // AN ASK FROM AN EARLIER PARKING IS HISTORY.
    if (ask && str_(ask.createdat) < since) ask = null;
    if (ask && str_(ask.state) !== 'open') return;   // closed during THIS stay — let go
    var sent = ask ? (parseInt(str_(ask.sentcount), 10) || 0) : 0;
    if (sent >= cfg.attempts) return;               // bounded
    // The clock runs from the LAST NOTICE once there has been one — that is what renewing it means — and from the…
    var from = new Date(str_(ask && ask.lastsentat) || since).getTime();
    if (isNaN(from) || (Date.now() - from) < lengthMs) return;
    due.push({ c: c, cid: cid, since: since, sent: sent });
  });

  // THE EVIDENCE THAT CLOSES IT: the card is no longer standing at Ready.
  for (var openCid in book) {
    if (standing[openCid]) continue;
    if (str_(book[openCid].state) !== 'open') continue;
    try { simAskAnswer_(['ready_parked'], 'the card left Ready to Start — the machine lets go', openCid); }
    catch (eC) { /* the next one still closes */ }
  }

  due.slice(0, 10).forEach(function (d) {           // budget — the next pass takes the next ten
    try { readyParkedNotify_(d.c, d.cid, d.since, d.sent + 1, cfg.attempts); }
    catch (eN) {
      hubSysLog_('asa-hub:ready-parked', 'ready_parked_notify_failed',
                 d.cid + ' — ' + String((eN && eN.message) || eN), { status: 500 });
    }
  });
}

// One parking notice: the deciders, letter and Quo together, then the book and the journey.
function readyParkedNotify_(c, cid, since, attempt, ofN) {
  var sit = hubLaneSituation_('hiring_ready_parked');
  if (!sit.on) return;
  var name = str_(c.candidatename);
  var days = Math.max(1, Math.floor((Date.now() - new Date(since).getTime()) / 86400000));
  var day = (typeof talentIsoDay_ === 'function') ? talentIsoDay_(since) : str_(since).slice(0, 10);
  var rehearsal = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(c);
  var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
  var team = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [] };
  var to = (addr && addr.to) || team.emails.join(', ');
  var link = mailPlatformUrl_() + '/app/hiring/candidate?id=' + cid;
  var fill = function (s) {
    return String(s || '').replace(/\{name\}/g, name).replace(/\{days\}/g, String(days))
      .replace(/\{since\}/g, day).replace(/\{link\}/g, link);
  };
  var rpVars = { name: name, days: String(days), since: day, link: link };
  var subject = sit.word('email_subject',
    fill((typeof simText_ === 'function') ? simText_('ready_parked_subject', '') : '') ||
    fill(bookText_('Strings', 'ready_parked.subject.floor', '')), rpVars);
  var bodyText = sit.word('email_text',
    fill((typeof simText_ === 'function') ? simText_('ready_parked_body', '') : '') ||
    fill(bookText_('Strings', 'ready_parked.body.floor', '')), rpVars);
  var html = mailShell_({
    eyebrow: 'ASA Hub — Hiring',
    title: fill(bookText_('Strings', 'ready_parked.title', '')),
    preheader: fill(bookText_('Strings', 'ready_parked.preheader', '')),
    blocks: [
      mailFact_(bookText_('Strings', 'notice.fact.candidate', ''), name, false),
      mailFact_(bookText_('Strings', 'ready_parked.fact.since_label', ''), day + ' — ' + days + ' days', false),
      mailPara_(bookText_('Strings', 'ready_parked.para', ''))
    ],
    cta: { label: bookText_('Strings', 'notice.cta.open_candidate', ''), href: link },
    footnote: bookText_('Strings', 'ready_parked.footnote', '')
      .split('{attempt}').join(String(attempt)).split('{of}').join(String(ofN))
  });
  var subjOut = (rehearsal && typeof simTagSubject_ === 'function') ? simTagSubject_(subject) : subject;
  var sent = false;
  if (to && sit.leg('email')) {
    try {
      var rm = rpcCall_('emailSend', { to: to, cc: (addr && addr.cc) || '', subject: subjOut,
        body: bodyText, html: html, reason: 'smart comms: hiring_ready_parked'
      }, { idempotency_key: 'ready_parked_mail_' + cid + '_' + attempt });
      sent = !!(rm && rm.ok && rm.sent);
    } catch (eM) { /* the Quo half below still tries */ }
  }
  var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
  var numbers = (actors && actors.decider_sms && sit.leg('sms')) ? actors.decider_sms : [];
  var smsBody = sit.word('sms_text',
    fill((typeof simText_ === 'function') ? simText_('ready_parked_sms', '') : '') ||
    (name + ' has been at Ready to Start for ' + days + ' days with nobody scheduling them. ' +
     'Nothing to answer — this stops when they are on the Shift Board.'), rpVars);
  numbers.forEach(function (n) {
    try {
      var rs = rpcCall_('smsSend', { to: n, body: smsBody,
        reason: 'smart comms: hiring_ready_parked'
      }, { idempotency_key: 'ready_parked_sms_' + cid + '_' + attempt + '_' + String(n).replace(/\D/g, '') });
      if (rs && rs.ok && rs.sent) sent = true;
    } catch (eS) { /* next number */ }
  });
  // THE STAMP FIRST, THE MEMO AFTER: the book is what renews the clock, and a notice that went out without one…
  if (typeof simTrackSend_ === 'function') {
    try { simTrackSend_('ready_parked', cid, '', { candidate_id: cid }); } catch (eT) {}
  }
  journeyLog_({ candidate_id: cid, name: name, step: 'ready_parked', channel: 'email+sms',
                ok: sent, rehearsal: rehearsal,
                detail: sent
                  ? 'parked at Ready to Start since ' + day + ' (' + days + ' days) — the ' +
                    'deciders were told (letter + Quo), notice ' + attempt + ' of ' + ofN +
                    '; the clock is renewed for another turn'
                  : 'parked at Ready to Start since ' + day + ' — the notice could not leave',
                by: 'asa-hub:ready-parked' });
}

// STEP 25: when the onboarding is FINISHED, Ty and Arthur are told — e-mail AND OpenPhone — with the candidate's…
function onboardingDoneAskSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('ob_done_ask_sweep')) return;
  cache.put('ob_done_ask_sweep', '1', 900);
  // A Smart Comms situation (hiring_ready_ask): off, nobody is asked and nothing is booked.
  var sit = hubLaneSituation_('hiring_ready_ask');
  if (!sit.on) return;
  var rows;
  try { rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB); }
  catch (e) { return; }
  var asked = {};
  try {
    simAskRows_().forEach(function (a) {
      if (str_(a.step) === 'ready_ask') asked[str_(a.candidateid)] = true;
    });
  } catch (eA) {}
  rows.forEach(function (c) {
    var cid = str_(c.candidateid);
    if (!cid || str_(c.archived).toLowerCase() === 'true') return;
    if (talentStage_(str_(c.status)) !== 'onboarding') return;
    // SEVEN TIMES, NOT ONCE.
    var raDue = (typeof simLadderDue_ === 'function')
      ? simLadderDue_('ready_ask', cid) : { due: !asked[cid], sent: 0, of: 1 };
    if (!raDue.due) return;
    var ob = hubOnboardingDone_(c);
    if (!ob.q || !ob.t) return;                   // not finished yet
    var name = str_(c.candidatename);
    var rehearsal = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(c);
    var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
    var team = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [] };
    var to = (addr && addr.to) || team.emails.join(', ');
    if (!to) return;
    var notes = 'New Hire Questionnaire: done · Tutorials: done' +
      (str_(c.internaldocsat) ? ' · Employee Database: written' : '');
    // Chapter 26: the deciders read the interview and the onboarding notes too.
    try {
      var iv25 = interviewFor_(cid);
      if (interviewScored_(iv25)) {
        notes += ' · Interview: ' + str_(iv25.score) + '/10 by ' + str_(iv25.interviewername) +
                 (str_(iv25.recommendation) ? ' — ' + str_(iv25.recommendation) : '');
      }
    } catch (eIv) { /* the ask still goes */ }
    try {
      var obRow25 = onboardingRowFor_(cid);
      if (obRow25 && str_(obRow25.notes)) notes += ' · Notes: ' + str_(obRow25.notes);
    } catch (eOn) { /* the ask still goes */ }
    // The profile deep link, off the platform's own base URL.
    var link = mailPlatformUrl_() + '/app/hiring/candidate?id=' + cid;
    var fillRa = function (s) {
      return String(s || '').replace(/\{name\}/g, name)
        .replace(/\{notes\}/g, notes).replace(/\{link\}/g, link);
    };
    var raVars = { name: name, notes: notes, link: link };
    var subject = sit.word('email_subject',
      fillRa((typeof simText_ === 'function') ? simText_('ready_ask_subject', '') : '') ||
      fillRa(bookText_('Strings', 'ready_ask.subject.floor', '')), raVars);
    var bodyText = sit.word('email_text',
      fillRa((typeof simText_ === 'function') ? simText_('ready_ask_body', '') : '') ||
      fillRa(bookText_('Strings', 'ready_ask.body.floor', '')), raVars);
    var html = mailShell_({
      eyebrow: 'ASA Hub — Hiring',
      title: fillRa(bookText_('Strings', 'ready_ask.title', '')),
      preheader: bookText_('Strings', 'ready_ask.preheader', ''),
      blocks: [
        mailFact_(bookText_('Strings', 'notice.fact.candidate', ''), name, false),
        mailFact_(bookText_('Strings', 'ready_ask.fact.notes_label', ''), notes, false),
        mailPara_(bookText_('Strings', 'ready_ask.para', ''))
      ],
      // Chapter 26: the letter opens the whole person — sign in and see the history.
      cta: { label: bookText_('Strings', 'notice.cta.open_candidate', ''), href: link },
      footnote: bookText_('Strings', 'ready_ask.footnote', '')
    });
    var subjOut = (rehearsal && typeof simTagSubject_ === 'function') ? simTagSubject_(subject) : subject;
    var sent = false;
    if (sit.leg('email')) {
      try {
        var rm = rpcCall_('emailSend', { to: to, cc: (addr && addr.cc) || '', subject: subjOut,
          body: bodyText, html: html, reason: 'smart comms: hiring_ready_ask'
        }, { idempotency_key: 'ready_ask_mail_' + cid });
        sent = !!(rm && rm.ok && rm.sent);
      } catch (eM) { /* the Quo half below still tries */ }
    }
    var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
    var numbers = (actors && actors.decider_sms && sit.leg('sms')) ? actors.decider_sms : [];
    var smsBody = sit.word('sms_text', ((typeof simText_ === 'function') ? simText_('ready_ask_sms', '') : '')
        .replace(/\{name\}/g, name).replace(/\{link\}/g, link) ||
      (name + ' finished onboarding — may I move them to Ready to Start? A YES here does it.'), raVars);
    numbers.forEach(function (n) {
      try {
        var rs = rpcCall_('smsSend', { to: n, body: smsBody,
          reason: 'smart comms: hiring_ready_ask'
        }, { idempotency_key: 'ready_ask_sms_' + cid + '_' + String(n).replace(/\D/g, '') });
        if (rs && rs.ok && rs.sent) sent = true;
      } catch (eS) { /* next number */ }
    });
    if (sent && typeof simTrackSend_ === 'function') {
      try { simTrackSend_('ready_ask', cid, '', { candidate_id: cid }); } catch (eT) {}
    }
    journeyLog_({ candidate_id: cid, name: name, step: 'ready_ask', channel: 'email+sms',
                  ok: sent, rehearsal: rehearsal,
                  detail: sent
                    ? 'onboarding finished — the deciders were asked (letter + Quo together): may I move ' +
                      name + ' to Ready to Start? A YES makes the move by itself'
                    : 'onboarding finished but the ask could not leave',
                  by: 'asa-hub:ready-ask' });
  });
}

// CHAPTER 26's STAMP: the moment a decider says YES, the interview score and the onboarding results land on the…
function readyApprovalStamp_(cid, by) {
  var sheet = hubSheet_(TALENT_CANDIDATES_TAB);
  ensureHeader_(sheet, ['interview_score', 'interview_recommendation', 'interview_by',
                        'onboarding_result', 'approved_ready_at', 'approved_ready_by']);
  var cand = null;
  readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (str_(c.candidateid) === cid) cand = c;                    // last row wins
  });
  if (!cand || str_(cand.approvedreadyat)) return false;          // write-once
  var iv = null;
  try { iv = interviewFor_(cid); } catch (eI) { /* no scorecard, blank stamp */ }
  var ob = null;
  try { ob = hubOnboardingDone_(cand); } catch (eO) { /* blank stamp */ }
  var result = 'New Hire Questionnaire: ' + (ob && ob.q ? 'done' : 'open') +
               ' · Tutorials: ' + (ob && ob.t ? 'done' : 'open') +
               (str_(cand.internaldocsat) ? ' · Employee Database: written' : '');
  // Blank-only PER COLUMN — a value anybody typed by hand stays theirs.
  var fields = {
    interview_score: iv ? str_(iv.score) : '',
    interview_recommendation: iv ? str_(iv.recommendation) : '',
    interview_by: iv ? str_(iv.interviewername) : '',
    onboarding_result: result,
    approved_ready_at: new Date().toISOString(),
    approved_ready_by: str_(by)
  };
  var normOf = { interview_score: 'interviewscore', interview_recommendation: 'interviewrecommendation',
                 interview_by: 'interviewby', onboarding_result: 'onboardingresult',
                 approved_ready_at: 'approvedreadyat', approved_ready_by: 'approvedreadyby' };
  var keep = {};
  for (var k in fields) { if (!str_(cand[normOf[k]])) keep[k] = fields[k]; }
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, keep, { email: 'asa-hub:ready-ask-ear' }, false);
  return true;
}

// THE ONLY EAR ON THIS CHAIN THAT NEVER LOOKED AT A CLOCK.
var READY_ASK_EAR_EVERY_S = 900;
function readyAskScanSweepMaybe_() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('ready_ask_scan')) return;
    cache.put('ready_ask_scan', '1', READY_ASK_EAR_EVERY_S);
  } catch (eG) { /* an unreadable cache listens, never skips */ }
  return readyAskScanRun_();
}

// STEP 25's EAR (chapter 26 grew both answers): a decider's YES moves the person to Ready to Start, stamps the…
function readyAskScanRun_() {
  var out = { checked: 0, moved: 0, stays: 0 };
  var rows;
  try {
    rows = simAskRows_().filter(function (r) {
      return str_(r.step) === 'ready_ask' &&
             ['open', 'exhausted'].indexOf(str_(r.state)) !== -1;
    });
  } catch (e) { return out; }
  if (!rows.length) return out;
  var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
  var numbers = (actors && actors.decider_sms) ? actors.decider_sms : [];
  var keys = {};
  numbers.forEach(function (n) {
    var k = String(n).replace(/\D/g, '').slice(-10);
    if (k) keys[k] = true;
  });

  // ONE CONVERSATION PER DECIDER, NOT ONE PER OPEN ASK.
  numbers.forEach(function (n) {
    try { quoInboundPull_(str_(rows[0].candidateid), 'a decider', n); } catch (eP) {}
  });

  // AND THE TAB IS READ ONCE, AFTER THE PULLS.
  var inbound = [];
  try { inbound = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB); }
  catch (eIn) { return out; }              // unreadable inbound: nobody is judged
  var rdY = bookWordsRegex_('words.ready.yes', 'start');
  var rdN = bookWordsRegex_('words.ready.no', 'start');

  rows.forEach(function (r) {
    var cid = str_(r.candidateid);
    out.checked++;
    var since = str_(r.lastsentat) || str_(r.createdat);
    var verdict = '', by = '';
    inbound.forEach(function (m) {
      if (!keys[str_(m.fromkey)]) return;
      if (str_(m.receivedat) < since) return;
      var s = str_(m.body).trim().toLowerCase().replace(/[!.\s]+$/, '');
      if (rdY && rdY.test(s)) { verdict = 'yes'; by = str_(m.fromnumber); }
      else if (rdN && rdN.test(s)) { verdict = 'no'; by = str_(m.fromnumber); }
    });
    if (!verdict) return;
    var evName = '';
    try { var ev2 = hubEvidence_(cid); evName = ev2 && ev2.cand ? str_(ev2.cand.candidatename) : ''; } catch (eE) {}
    if (verdict === 'yes') {
      out.moved++;
      try {
        hubSetStatus_(cid, (typeof HUB_STAGE_TO_STATUS !== 'undefined' && HUB_STAGE_TO_STATUS['ready']) || 'Ready to Start',
                      { email: 'asa-hub:ready-ask-ear', role: 'manager' });
        hubBustTalentCache_();
      } catch (eW) {}
      simAskAnswer_(['ready_ask'], 'a decider answered YES (' + by + ') — moved to Ready to Start', cid);
      journeyLog_({ candidate_id: cid, name: evName, step: 'ready_ask', channel: 'sms', ok: true,
                    detail: 'the decider said YES — moved to Ready to Start by the word alone; the Shift Board watch takes it from here',
                    by: 'asa-hub:ready-ask-ear' });
 // CHAPTER 26: after the move, the YES also STAMPS the approval on the profile — once, ever.
      try {
        if (readyApprovalStamp_(cid, by)) {
          journeyLog_({ candidate_id: cid, name: evName, step: 'ready_ask', channel: 'record', ok: true,
                        detail: 'the interview score and the onboarding results are stamped on the profile',
                        by: 'asa-hub:ready-ask-ear' });
        }
      } catch (eSt) { /* the ear never dies for the stamp */ }
      // THE MASTER WRITE RIDES THE SWEEP'S OWN ARM (empdbStepSweep_, this very pass — its gate now admits 'ready')…
      journeyLog_({ candidate_id: cid, name: evName, step: 'ready_ask', channel: 'record', ok: true,
                    detail: 'the Asa Employee Database (Master) write follows on the sweep\'s arm — ' +
                            'blanks only, a row a person started is left alone, a rehearsal never touches the real book',
                    by: 'asa-hub:ready-ask-ear' });
    } else {
      out.stays++;
      simAskAnswer_(['ready_ask'], 'a decider answered NO (' + by + ') — the profile moves to the Archive', cid);
 // CHAPTER 26: a NO ARCHIVES the profile — hidden, never deleted — and NO letter goes to the candidate.
      try {
        ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                      ['archived', 'archived_at', 'archived_by', 'archived_reason']);
        hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
          archived: 'TRUE', archived_at: new Date().toISOString(),
          archived_by: 'asa-hub:ready-ask-ear',
          archived_reason: 'A decider said NO to Ready to Start'
        }, { email: 'asa-hub:ready-ask-ear' }, false);
        hubBustTalentCache_();
      } catch (eArc) { /* the answer above still stands */ }
      journeyLog_({ candidate_id: cid, name: evName, step: 'ready_ask', channel: 'sms', ok: true,
                    detail: 'the decider said NO — the profile moves to the Archive (a click on the name still opens the whole person)',
                    by: 'asa-hub:ready-ask-ear' });
    }
  });
  return out;
}
