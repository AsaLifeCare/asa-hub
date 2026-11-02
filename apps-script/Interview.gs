// Interview scorecard: hubGate_ unlocks the move to onboarding only once one exists. One open row per candidate.

var INTERVIEW_SCORE_MIN = 0;
var INTERVIEW_SCORE_MAX = 10;

var INTERVIEW_COLUMNS = ['interviewer_name', 'score', 'comments', 'recommendation',
                         'interviewed_at', 'updated_at', 'updated_by',
                         'access_from', 'access_until'];

// Window precedence: the row, Settings, the script property, then these. Only the interviewer role is limited.
var INTERVIEW_WINDOW_BEFORE_DAYS = 1;
var INTERVIEW_WINDOW_AFTER_DAYS = 2;

function interviewWindowDays_(key, fallback) {
  var cfg = (typeof hubCfgInt_ === 'function')
    ? hubCfgInt_(String(key).toLowerCase(), null, 0, 365) : null;
  if (cfg !== null && cfg !== undefined) return cfg;
  var raw = hubProp_(key);
  var n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

// Company-timezone day edge; plain setHours closed the window an evening early.
function interviewDayBounds_(d, endOfDay) {
  if (typeof hubTzDayEdge_ === 'function') return hubTzDayEdge_(d, endOfDay);
  var x = new Date(d.getTime());
  if (endOfDay) x.setHours(23, 59, 59, 999); else x.setHours(0, 0, 0, 0);
  return x;
}

// `reason` is a token the SPA compares.
function interviewWindow_(iv) {
  if (!iv) return { open: true, from: '', until: '', reason: 'no interview row yet' };
  var from = str_(iv.accessfrom) ? new Date(str_(iv.accessfrom)) : null;
  var until = str_(iv.accessuntil) ? new Date(str_(iv.accessuntil)) : null;
  if ((from && isNaN(from.getTime())) || (until && isNaN(until.getTime()))) { from = null; until = null; }

  if (!from || !until) {
    var sched = str_(iv.scheduledfor) ? new Date(str_(iv.scheduledfor)) : null;
    if (!sched || isNaN(sched.getTime())) {
      return { open: true, from: '', until: '', reason: 'no scheduled date' };
    }
    var before = interviewWindowDays_('INTERVIEW_WINDOW_BEFORE_DAYS', INTERVIEW_WINDOW_BEFORE_DAYS);
    var after = interviewWindowDays_('INTERVIEW_WINDOW_AFTER_DAYS', INTERVIEW_WINDOW_AFTER_DAYS);
    if (!from) {
      var f = new Date(sched.getTime()); f.setDate(f.getDate() - before);
      from = interviewDayBounds_(f, false);
    }
    if (!until) {
      var u = new Date(sched.getTime()); u.setDate(u.getDate() + after);
      until = interviewDayBounds_(u, true);
    }
  }
  var now = Date.now();
  var open = now >= from.getTime() && now <= until.getTime();
  return { open: open, from: from.toISOString(), until: until.toISOString(),
           reason: open ? '' : (now < from.getTime() ? 'not open yet' : 'window closed') };
}

function interviewSheet_() {
  var sheet = hubTabEnsure_(HUB_INTERVIEWS_TAB, [
    'interview_id', 'candidate_id', 'candidate_name', 'scheduled_for',
    'source', 'status', 'created_at', 'created_by'
  ]);
  // Never widen the runtime shim's header: a positional appendRow would land every field one column off.
  if (!sheet.isRuntimeBacked) ensureHeader_(sheet, INTERVIEW_COLUMNS);
  return sheet;
}

// Keyed on the rows array's identity: a write drops the legacy memo, the new array rebuilds the index.
var INTERVIEW_INDEX_MEMO_ = null;

function interviewFor_(cid) {
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), HUB_INTERVIEWS_TAB);
  if (!INTERVIEW_INDEX_MEMO_ || INTERVIEW_INDEX_MEMO_.rows !== rows) {
    var by = {};
    for (var i = 0; i < rows.length; i++) {
      by[str_(rows[i].candidateid)] = rows[i];
    }
    INTERVIEW_INDEX_MEMO_ = { rows: rows, by: by };
  }
  return INTERVIEW_INDEX_MEMO_.by[str_(cid)] || null;
}

function interviewScored_(iv) {
  if (!iv) return false;
  return !!str_(iv.interviewername) && str_(iv.score) !== '';
}

// Never widen signing to hubIsWriter_: the scorecard attests that a person sat with the candidate.

function interviewScorecardEmails_() {
  try {
    var raw = (typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {}).interview_scorecard_emails;
    return String(raw == null ? '' : raw).split(/[,;\n]+/)
      .map(function (x) { return String(x).trim().toLowerCase(); })
      .filter(function (x) { return x.indexOf('@') !== -1; });
  } catch (e) { return []; }
}

function interviewCanRecord_(user) {
  if (!user) return false;
  if (str_(user.role) === 'interviewer') return true;
  if (user.overrides && user.overrides['hiring.interview'] === true) return true;
  if (typeof userTypesCanInterview_ === 'function' &&
      userTypesCanInterview_(user.types || [])) return true;
  var email = str_(user.email).toLowerCase();
  return !!email && interviewScorecardEmails_().indexOf(email) !== -1;
}

// By route, so the screen can warn that removing an address leaves a grant in place.
function interviewWhoCanRecord_() {
  var out = { by_role: [], by_list: interviewScorecardEmails_(), by_grant: [] };
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), 'users').forEach(function (u) {
      if (str_(u.active).toLowerCase() === 'false') return;
      var email = str_(u.email).toLowerCase();
      if (!email) return;
      if (str_(u.role) === 'interviewer') { out.by_role.push(email); return; }
      if (typeof userTypesCanInterview_ === 'function' &&
          userTypesCanInterview_(str_(u.types))) { out.by_role.push(email); return; }
      var ov = {};
      try { ov = JSON.parse(str_(u.permoverrides) || '{}') || {}; } catch (e) { ov = {}; }
      if (ov['hiring.interview'] === true) out.by_grant.push(email);
    });
  } catch (eU) { out.unreadable = true; }
  return out;
}

HUB_POLICY.interviewGet = {
  file: 'Interview.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // perm admits the HM types route: granting the type writes the override.
  roles: ['admin', 'manager', 'interviewer'], perm: 'hiring.interview',
  invalidates: [], emits: []
};
HUB_ACTIONS.interviewGet = function (payload, user) {
  if (!user || user.is_service ||
      (['admin', 'manager', 'interviewer', 'director'].indexOf(str_(user.role)) === -1 &&
       !interviewCanRecord_(user))) {
    return hubDenied_();
  }
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  var iv = interviewFor_(cid);
  var win = interviewWindow_(iv);
  var limited = str_(user.role) === 'interviewer';
  return { status: 200, data: {
    exists: !!iv,
    candidate_name: str_(ev.cand.candidatename),
    scheduled_for: iv ? str_(iv.scheduledfor) : '',
    status: iv ? str_(iv.status) : '',
    interviewer_name: iv ? str_(iv.interviewername) : '',
    score: iv ? str_(iv.score) : '',
    comments: iv ? str_(iv.comments) : '',
    recommendation: iv ? str_(iv.recommendation) : '',
    interviewed_at: iv ? str_(iv.interviewedat) : '',
    window_open: win.open, window_from: win.from, window_until: win.until,
    window_reason: win.reason,
    window_applies: limited,
    can_extend: hubIsWriter_(user),
    can_record: interviewCanRecord_(user) && (!limited || win.open)
  } };
};

/** Widen or shorten one candidate's window — recruiters only. */
HUB_POLICY.interviewSetWindow = {
  file: 'Interview.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};
HUB_ACTIONS.interviewSetWindow = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var iv = interviewFor_(cid);
  if (!iv) return { status: 404, message: bookText_('Strings', 'refuse.iv.none_scheduled', '') };

  var fields = {};
  if (payload.extend_days !== undefined) {
    var days = parseInt(payload.extend_days, 10);
    if (isNaN(days) || days < 0 || days > 365) {
      return { status: 400, message: bookText_('Strings', 'refuse.iv.extend_days', '') };
    }
    var win = interviewWindow_(iv);
    var base = win.until ? new Date(win.until) : new Date();
    if (base.getTime() < Date.now()) base = new Date();
    base.setDate(base.getDate() + days);
    fields.access_until = interviewDayBounds_(base, true).toISOString();
  }
  if (payload.open_earlier_days !== undefined) {
    var back = parseInt(payload.open_earlier_days, 10);
    if (isNaN(back) || back < 0 || back > 365) {
      return { status: 400, message: bookText_('Strings', 'refuse.iv.open_earlier_days', '') };
    }
    var w0 = interviewWindow_(iv);
    var start = w0.from ? new Date(w0.from) : new Date();
    start.setDate(start.getDate() - back);
    fields.access_from = interviewDayBounds_(start, false).toISOString();
  }
  if (payload.access_from !== undefined) {
    var f = new Date(str_(payload.access_from));
    if (isNaN(f.getTime())) return { status: 400, message: bookText_('Strings', 'refuse.iv.access_from', '') };
    fields.access_from = interviewDayBounds_(f, false).toISOString();
  }
  if (payload.access_until !== undefined && payload.extend_days === undefined) {
    var u = new Date(str_(payload.access_until));
    if (isNaN(u.getTime())) return { status: 400, message: bookText_('Strings', 'refuse.iv.access_until', '') };
    fields.access_until = interviewDayBounds_(u, true).toISOString();
  }
  if (!Object.keys(fields).length) {
    return { status: 400, message: bookText_('Strings', 'refuse.iv.nothing_to_change', '') };
  }
  // Pin both edges, so the stored window is the one the recruiter saw.
  var cur = interviewWindow_(iv);
  if (fields.access_from && !fields.access_until && cur.until) fields.access_until = cur.until;
  if (fields.access_until && !fields.access_from && cur.from) fields.access_from = cur.from;
  fields.updated_at = new Date().toISOString();
  fields.updated_by = 'asa-hub:' + user.email;

  var sheet = interviewSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iCid = hdr.indexOf('candidateid');
  var target = 0;
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iCid]) === cid) target = r + 1;
  }
  if (!target) return { status: 404, message: bookText_('Strings', 'refuse.iv.row_not_found', '') };
  for (var k in fields) {
    var i = hdr.indexOf(normKey_(k));
    if (i !== -1) sheet.getRange(target, i + 1).setValue(fields[k]);
  }
  var after = interviewWindow_(interviewFor_(cid));
  return { status: 200, data: { window_open: after.open, window_from: after.from,
           window_until: after.until, window_reason: after.reason } };
};

/** Record the interview scorecard: Decline ends the run, Advance with a green gate moves it on. */
HUB_POLICY.interviewSave = {
  // 'tool', not 'write': the interviewer must see the real outcome (declined, moved, refused), not a receipt.
  file: 'Interview.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'interviewer'], perm: 'hiring.interview',
  invalidates: ['candidates', 'onboarding'], emits: ['emailSend']
};
// Signed under the candidate's decision claim, so two presses cannot sign at once.
HUB_ACTIONS.interviewSave = function (payload, user) {
  if (!interviewCanRecord_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var claim = hubDecisionClaim_(cid);
  if (claim !== 'claimed') return hubDecisionRefusal_(claim);
  try {
    return interviewSaveHeld_(payload, user, cid);
  } finally {
    hubDecisionRelease_(cid);
  }
};

function interviewSaveHeld_(payload, user, cid) {
  var ev = hubEvidenceFresh_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (talentStage_(ev.cand.status) !== 'interview') {
    return { status: 409, message: bookText_('Strings', 'refuse.iv.wrong_stage', '') };
  }
  if (str_(user.role) === 'interviewer') {
    var win = interviewWindow_(interviewFor_(cid));
    if (!win.open) {
      return { status: 403, message: win.reason === 'not open yet'
        ? hiringRenderMail_(bookText_('Strings', 'refuse.iv.window_not_open', ''),
                            { date: String(win.from).slice(0, 10) })
        : hiringRenderMail_(bookText_('Strings', 'refuse.iv.window_closed', ''),
                            { date: String(win.until).slice(0, 10) }) };
    }
  }

  var name = str_(payload.interviewer_name);
  if (!name) return { status: 400, message: bookText_('Strings', 'refuse.iv.name_required', '') };
  var scoreRaw = payload.score;
  var score = parseInt(scoreRaw, 10);
  if (isNaN(score) || score < INTERVIEW_SCORE_MIN || score > INTERVIEW_SCORE_MAX) {
    return { status: 400, message: hiringRenderMail_(
      bookText_('Strings', 'refuse.iv.score_range', ''),
      { min: String(INTERVIEW_SCORE_MIN), max: String(INTERVIEW_SCORE_MAX) }) };
  }
  var comments = str_(payload.comments);
  if (comments.length < 10) {
    return { status: 400, message: bookText_('Strings', 'refuse.iv.comments_required', '') };
  }
  var rec = str_(payload.recommendation);
  if (['Advance', 'Decline', 'Hold'].indexOf(rec) === -1) {
    return { status: 400, message: bookText_('Strings', 'refuse.iv.recommendation', '') };
  }

  var sheet = interviewSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iCid = hdr.indexOf('candidateid');
  var now = new Date().toISOString();
  var fields = {
    interviewer_name: name.slice(0, 120),
    score: String(score),
    comments: comments.slice(0, 4000),
    recommendation: rec,
    interviewed_at: now,
    status: rec === 'Decline' ? 'Declined' : 'Completed',
    updated_at: now,
    updated_by: 'asa-hub:' + user.email
  };
  // Fill a blank scheduled_for from the signature (a blank one freezes the card); never overwrite a booked slot.
  var existingIv = interviewFor_(cid);
  if (!existingIv || !str_(existingIv.scheduledfor)) fields.scheduled_for = now;
  var target = 0;
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iCid]) === cid) target = r + 1;
  }
  if (target) {
    for (var k in fields) {
      var i = hdr.indexOf(normKey_(k));
      if (i !== -1) sheet.getRange(target, i + 1).setValue(fields[k]);
    }
  } else {
    var row = hdr.map(function (h) {
      if (h === 'interviewid') return 'INT_' + randomHex_(10).toUpperCase();
      if (h === 'candidateid') return cid;
      if (h === 'candidatename') return str_(ev.cand.candidatename);
      if (h === 'source') return 'manual';
      if (h === 'createdat') return now;
      if (h === 'createdby') return 'asa-hub:' + user.email;
      for (var key in fields) { if (normKey_(key) === h) return fields[key]; }
      return '';
    });
    sheet.appendRow(row);
  }

  var declined = rec === 'Decline';
  if (declined) {
    hubSetStatus_(cid, 'Not Hiring', user);
    if (typeof hiringArchiveAndTell_ === 'function') {
      hiringArchiveAndTell_(cid, 'Interview declined by ' + name.slice(0, 120) +
                            ' — score ' + score + '. ' + comments.slice(0, 300),
                            user, 'interview');
    }
  }
  try {
    var evN = hubEvidence_(cid);
    var candName = evN && evN.cand ? str_(evN.cand.candidatename) : cid;
    var rehearsal19 = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);
    var addr19 = (rehearsal19 && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
    var team19 = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [] };
    var to19 = (addr19 && addr19.to) || team19.emails.join(', ');
    var sc30 = (typeof smartSituationOn_ === 'function')
      ? smartSituationOn_(commSituationId_('hiring.interview.scorecard_report', 'hiring_scorecard_report')) : { id: 'on' };
    if (to19 && sc30) {
      var sc30fill = function (t) {
        return String(t || '').split('{name}').join(candName)
          .split('{interviewer}').join(name).split('{score}').join(String(score))
          .split('{decision}').join(rec).split('{comments}').join(comments || '-');
      };
      var subj19 = sc30fill(str_(sc30.email_subject)) ||
        ((typeof simText_ === 'function') ? simText_('interview_done_subject', '') : '')
          .replace(/\{name\}/g, candName).replace(/\{interviewer\}/g, name) ||
        hiringRenderMail_(bookText_('Strings', 'iv.done.subject', ''), { name: candName });
      var body19 = sc30fill(str_(sc30.email_text)) ||
        ((typeof simText_ === 'function') ? simText_('interview_done_body', '') : '')
          .replace(/\{name\}/g, candName).replace(/\{interviewer\}/g, name)
          .replace(/\{score\}/g, String(score)).replace(/\{comments\}/g, comments)
          .replace(/\{recommendation\}/g, rec) ||
        hiringRenderMail_(bookText_('Strings', 'iv.done.body', ''), {
          interviewer: name, name: candName, score: String(score), recommendation: rec,
          comments: comments
            ? '\n' + hiringRenderMail_(bookText_('Strings', 'iv.done.comments_line', ''),
                                       { comments: comments })
            : ''
        });
      var ivWord = function (k) { return bookText_('Strings', 'iv.done.' + k, ''); };
      var html19 = mailShell_({
        eyebrow: ivWord('eyebrow'),
        title: hiringRenderMail_(bookText_('Strings', 'iv.done.subject', ''), { name: candName }),
        preheader: hiringRenderMail_(bookText_('Strings', 'iv.done.preheader', ''),
                                     { interviewer: name, name: candName, score: String(score) }),
        blocks: [
          mailFact_(ivWord('fact.interviewer'), name, false),
          mailFact_(ivWord('fact.candidate'), candName, false),
          mailFact_(ivWord('fact.score'), String(score), false),
          mailFact_(ivWord('fact.recommendation'), rec, false),
          comments ? mailPara_(mailEsc_(comments)) : mailPara_(mailEsc_(ivWord('no_comments'))),
          mailPara_(mailEsc_(ivWord('informs_only')))
        ],
        cta: null,
        footnote: ivWord('footnote')
      });
      var subjOut19 = (rehearsal19 && typeof simTagSubject_ === 'function') ? simTagSubject_(subj19) : subj19;
      rpcCall_('emailSend', {
        to: to19, cc: (addr19 && addr19.cc) || '',
        subject: subjOut19, body: body19, html: html19,
        reason: bookText_('Strings', 'iv.done.reason', '')
      }, { idempotency_key: 'iv_done_' + cid + '_' + String(score) });
      journeyLog_({ candidate_id: cid, name: candName, step: 'interview_scored', channel: 'email',
                    ok: true, rehearsal: rehearsal19,
                    detail: hiringRenderMail_(
                      bookText_('Strings', 'journey.interview_scored.detail', ''),
                      { interviewer: name, score: String(score), recommendation: rec }),
                    by: str_(user && user.email) });
    }
  } catch (e19) {}

  hubBustTalentCache_();
  var gate = hubGate_(hubEvidence_(cid));
  var advanced = false;
  if (!declined && rec === 'Advance' && gate.ok) {
    advanced = hubSetStatus_(cid, HUB_STAGE_TO_STATUS['onboarding'], user);
    if (advanced) hubBustTalentCache_();
    // CJIS ask once per candidate (the journey line is the memo), only when the report is absent.
    try {
      var evCj = hubEvidence_(cid);
      var aCj = (evCj && evCj.analysis) || {};
      var cjHere = hubCjisCleared_(aCj) || !!str_(aCj.cjisreporturl);
      if (advanced && !cjHere) {
        var toldCj = false;
        (journeyFor_(cid) || []).forEach(function (j) {
          if (str_(j.step) === 'cjis_gate') toldCj = true;
        });
        var sitCj = (typeof smartSituationOn_ === 'function')
          ? smartSituationOn_(commSituationId_('hiring.cjis.missing_at_interview', 'hiring_cjis_gate')) : null;
        if (!toldCj && sitCj) {
          var candCj = evCj && evCj.cand ? str_(evCj.cand.candidatename) : cid;
          var fillCj = function (t) { return String(t || '').split('{name}').join(candCj || cid); };
          var rhCj = (typeof commsIsTestCandidate_ === 'function') && evCj && commsIsTestCandidate_(evCj.cand);
          var adCj = (rhCj && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
          var tmCj = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [], sms: [] };
          var toCj = (adCj && adCj.to) || (tmCj.emails || []).join(', ');
          var reasonCj = hiringRenderMail_(bookText_('Strings', 'cjis_gate.reason', ''),
                                           { name: candCj || cid });
          var sentCj = false;
          if (toCj) {
            var rmCj = rpcCall_('emailSend', {
              to: toCj, cc: (adCj && adCj.cc) || '',
              subject: (typeof simTagSubject_ === 'function')
                ? simTagSubject_(fillCj(str_(sitCj.email_subject))) : fillCj(str_(sitCj.email_subject)),
              body: fillCj(str_(sitCj.email_text)),
              reason: reasonCj
            }, { idempotency_key: 'cjis_gate_mail_' + cid });
            sentCj = sentCj || !!(rmCj && rmCj.sent);
          }
          var smCj = fillCj(str_(sitCj.sms_text));
          if (smCj) {
            (tmCj.sms || []).forEach(function (nCj) {
              var numCj = (typeof simSendablePhone_ === 'function') ? simSendablePhone_(nCj) : nCj;
              if (!numCj) return;
              var rsCj = rpcCall_('smsSend', { to: numCj, body: smCj, reason: reasonCj },
                { idempotency_key: 'cjis_gate_sms_' + cid + '_' + String(numCj).replace(/\D/g, '') });
              sentCj = sentCj || !!(rsCj && rsCj.sent);
            });
          }
          journeyLog_({ candidate_id: cid, name: candCj, step: 'cjis_gate', channel: 'email+sms',
                        ok: sentCj,
                        title: bookText_('Strings', 'journey.cjis_gate.title', ''),
                        detail: bookText_('Strings', sentCj
                          ? 'journey.cjis_gate.sent' : 'journey.cjis_gate.unsent', ''),
                        by: 'asa-hub:cjis-gate' });
        }
      }
    } catch (eCj30) {
      hubSysLog_('asa-hub:cjis-gate', 'cjis_gate_error',
                 cid + ' — ' + String((eCj30 && eCj30.message) || eCj30), { status: 500 });
    }
  }
  return { status: 200, data: { saved: true, declined: declined, advanced: advanced,
           gate_passed: !declined && gate.ok, to_stage: gate.to, missing: gate.reasons } };
}

function debugInterviewGate(cid) {
  var out = hubGate_(hubEvidence_(cid));
  Logger.log(JSON.stringify(out));
  return out;
}

/** Interview-stage candidates with their slot and scorecard state, gated by the pen that signs. */

HUB_POLICY.interviewMineList = {
  file: 'Interview.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'interviewer'], perm: 'hiring.interview',
  invalidates: [], emits: []
};
HUB_ACTIONS.interviewMineList = function (payload, user) {
  var isMaster = !!(user && typeof hubIsMaster_ === 'function' && hubIsMaster_(str_(user.email)));
  if (!interviewCanRecord_(user) && !isMaster) return hubDenied_();
  var rows;
  try { rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB); }
  catch (e) { return { status: 500, message: bookText_('Strings', 'refuse.candidates_tab_unreadable', '') }; }
  var asksByCid = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INTERVIEW_ASKS_TAB).forEach(function (a) {
      var k = str_(a.candidateid);
      if (k) asksByCid[k] = a;
    });
  } catch (e2) {}
  var out = [];
  rows.forEach(function (c) {
    if (str_(c.archived).toLowerCase() === 'true') return;
    if (talentStage_(str_(c.status)) !== 'interview') return;
    var cid = str_(c.candidateid);
    var iv = null;
    try { iv = interviewFor_(cid); } catch (e3) { iv = null; }
    var ask = asksByCid[cid] || null;
    var slot = '';
    if (ask) {
      slot = str_(ask.confirmeddate)
        ? (str_(ask.confirmeddate) + ' ' + str_(ask.confirmedtime))
        : (str_(ask.pickeddate) ? (str_(ask.pickeddate) + ' ' + str_(ask.pickedtime)) : '');
    }
    out.push({
      candidate_id: cid,
      name: str_(c.candidatename),
      slot: slot,
      ask_state: ask ? str_(ask.state) : '',
      scored: !!(iv && interviewScored_(iv)),
      score: iv ? str_(iv.score) : '',
      interviewer_name: iv ? str_(iv.interviewername) : ''
    });
  });
  return { status: 200, data: { rows: out, can_record: interviewCanRecord_(user) } };
};

function candidateRawRow_(cid) {
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
  var hit = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].candidateid) === cid) hit = rows[i];
  }
  return hit;
}

// `cand` must be the RAW row: the flags and stamps live only there.
function candidateProfileExtras_(cid, cand) {
  var interview = null;
  try {
    var iv = interviewFor_(cid);
    if (iv) {
      interview = {
        interviewer_name: str_(iv.interviewername),
        score: str_(iv.score),
        comments: str_(iv.comments),
        recommendation: str_(iv.recommendation),
        scheduled_for: str_(iv.scheduledfor),
        interviewed_at: str_(iv.interviewedat)
      };
    }
  } catch (eIv) { interview = null; }
  var ob = null;
  try { if (typeof onboardingRowFor_ === 'function') ob = onboardingRowFor_(cid); }
  catch (eOb) { ob = null; }
  var done = null;
  try { if (typeof hubOnboardingDone_ === 'function' && cand) done = hubOnboardingDone_(cand); }
  catch (eDn) { done = null; }
  var q = !!(done && done.q), t = !!(done && done.t);
  var readyAt = str_(cand && cand.approvedreadyat);
  var readyBy = str_(cand && cand.approvedreadyby);
  var onboarding = null;
  if (ob || q || t || readyAt || readyBy) {
    onboarding = {
      starting_status: ob ? str_(ob.startingstatus) : '',
      earliest_start_date: ob ? str_(ob.earlieststartdate) : '',
      start_date: ob ? str_(ob.startdate) : '',
      house: ob ? str_(ob.house) : '',
      notes: ob ? str_(ob.notes) : '',
      date_moved: ob ? str_(ob.datemovedtoonboarding) : '',
      questionnaire_done: q,
      tutorials_done: t,
      approved_ready_at: readyAt,
      approved_ready_by: readyBy
    };
  }
  return { interview: interview, onboarding: onboarding };
}

/** One candidate's full board row — the single door every profile screen reads. */
HUB_POLICY.candidateProfileGet = {
  file: 'Interview.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Empty on purpose: the handler's three-way gate admits people no roles list can name.
  roles: [], perm: 'hiring.interview',
  invalidates: [], emits: []
};
HUB_ACTIONS.candidateProfileGet = function (payload, user) {
  var isMaster = !!(user && typeof hubIsMaster_ === 'function' && hubIsMaster_(str_(user.email)));
  var isTeam = !!(user && typeof talentLiveAllowed_ === 'function' && talentLiveAllowed_(user));
  if (!interviewCanRecord_(user) && !isMaster && !isTeam) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!cid) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id_required', '') };
  var rows;
  // Sweep-free read: a profile click must send nothing.
  try { rows = talentCandidatesRead_(); }
  catch (e) { return { status: 500, message: bookText_('Strings', 'refuse.candidates_board_unreadable', '') }; }
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].id) === cid) {
      var tp = null;
      try {
        if (typeof candidateTpRow_ === 'function') {
          tp = candidateTpRow_(cid, str_(rows[i].name), str_(rows[i].tpCandidateId || ''));
        }
      } catch (eTp) { tp = null; }
      var cand = null;
      try { cand = candidateRawRow_(cid); } catch (eC) { cand = null; }
      var x = candidateProfileExtras_(cid, cand);
      return { status: 200, data: { row: rows[i], tp: tp,
                                    interview: x.interview, onboarding: x.onboarding } };
    }
  }
  // The board reader drops archived rows; the raw tab answers for them with a minimal card.
  var raw;
  try { raw = candidateRawRow_(cid); }
  catch (e2) { return { status: 500, message: bookText_('Strings', 'refuse.candidates_tab_unreadable', '') }; }
  if (raw) {
    var name = str_(raw.candidatename) ||
      (str_(raw.firstname) + ' ' + str_(raw.lastname)).trim() || cid;
    var row = {
      id: cid, name: name, avatar: '', role: 'Direct Support Professional',
      stage: talentStage_(str_(raw.status)) || '', status: str_(raw.status),
      archived: str_(raw.archived).toLowerCase() === 'true',
      archived_at: str_(raw.archivedat), archived_reason: str_(raw.archivedreason),
      email: str_(raw.email), phone: str_(raw.phone),
      city: str_(raw.city), state: str_(raw.state),
      source: str_(raw.source), appliedAt: str_(raw.createdat), score: null,
      resumeLink: str_(raw.resumelink),
      resumeFileLabel: str_(raw.resumelink) ? 'Open resume' : '',
      tpCandidateId: str_(raw.tpcandidateid),
      summaryTimeline: [], checklist: []
    };
    var tpA = null;
    try {
      if (typeof candidateTpRow_ === 'function') {
        tpA = candidateTpRow_(cid, name, str_(raw.tpcandidateid));
      }
    } catch (eTpA) { tpA = null; }
    var xA = candidateProfileExtras_(cid, raw);
    return { status: 200, data: { row: row, tp: tpA,
                                  interview: xA.interview, onboarding: xA.onboarding } };
  }
  return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
};
