var HIRING_JOURNEY_TAB = 'hiring_journey';
var HIRING_JOURNEY_HEADER = ['journey_id', 'candidate_id', 'candidate_name', 'step', 'title',
                             'channel', 'to', 'ok', 'detail', 'ref', 'rehearsal', 'at', 'by'];

var HIRING_JOURNEY_MAX = 400;

var HIRING_JOURNEY_STEP_IDS = [
  'welcome', 'ask', 'shortlist', 'interest', 'sim_retry', 'interest_thanks',
  'outreach_sms', 'outreach_reply', 'screen_call', 'resume_request',
  'resume_on_file', 'cjis_request', 'cjis_filed', 'phone_screen',
  'screen_done', 'decision_ask', 'decision', 'schedule_invite',
  'candidate_picked', 'interviewer_ask', 'interviewer_reply',
  'interview_booked', 'interview_scored', 'onboarding',
  'onboarding_account', 'discarded', 'hired'
];

function hiringJourneySteps_() {
  var words = (typeof bookKv_ === 'function') ? bookKv_('Steps') : {};
  var map = {};
  HIRING_JOURNEY_STEP_IDS.forEach(function (id) {
    map[id] = str_(words['journey.' + id]);
  });
  return map;
}

// Text-formatted at birth: an ISO string in a coerced cell comes back as a date.
function hiringJourneySheet_() {
  var sheet = hubTabSheet_(HIRING_JOURNEY_TAB);
  if (sheet) {
    if (!sheet.isRuntimeBacked) ensureHeader_(sheet, HIRING_JOURNEY_HEADER);
    return sheet;
  }
  sheet = hubTabEnsure_(HIRING_JOURNEY_TAB, HIRING_JOURNEY_HEADER);
  sheet.getRange(1, 1, sheet.getMaxRows(), HIRING_JOURNEY_HEADER.length).setNumberFormat('@');
  return sheet;
}

// Never throws: failures go to the system log so the step it records is never undone.
function journeyLog_(o) {
  var e = o || {};
  try {
    var step = str_(e.step);
    var row = {
      journey_id: 'JRN_' + randomHex_(8).toUpperCase(),
      candidate_id: str_(e.candidate_id),
      candidate_name: str_(e.name),
      step: step,
      title: str_(e.title) || hiringJourneySteps_()[step] || step,
      channel: str_(e.channel),
      to: str_(e.to),
      // A word, not TRUE/FALSE, which some columns turn into checkboxes.
      ok: (e.ok === false ? 'no' : 'yes'),
      detail: str_(e.detail).slice(0, 900),
      ref: str_(e.ref),
      rehearsal: e.rehearsal ? 'yes' : '',
      at: new Date().toISOString(),
      by: str_(e.by)
    };
    hiringJourneySheet_();
    hubAppendRow_(HIRING_JOURNEY_TAB, row);
    // Dual-write under the same id so the legacy tab and the runtime Events tab can be diffed.
    try {
      if (typeof hiringBookMode_ === 'function' &&
          hiringBookMode_('events').status === 'on' &&
          typeof hiringRuntimeAppend_ === 'function') {
        hiringRuntimeAppend_('Events', {
          'Event ID': row.journey_id, 'Subject ID': row.candidate_id,
          'Kind': 'journey', 'Step': row.step, 'Channel': row.channel,
          'Title': row.title, 'Detail': row.detail + (row.ref ? ' ref=' + row.ref : ''),
          'To': row.to, 'OK': row.ok, 'At': row.at, 'By': row.by,
          'Rehearsal': row.rehearsal, 'Source': 'dual-write:journeyLog_'
        });
      }
    } catch (eDW) {}
    return row.journey_id;
  } catch (err) {
    try {
      hubSysLog_('asa-hub:hiring', 'journey_log_failed',
                 str_(e.step) + ' for ' + str_(e.candidate_id) + ': ' + String((err && err.message) || err),
                 { status: 500 });
    } catch (e2) {}
    return '';
  }
}

function journeyFor_(cid) {
  var out = [];
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), HIRING_JOURNEY_TAB).forEach(function (r) {
      if (cid && str_(r.candidateid) !== str_(cid)) return;
      out.push({
        id: str_(r.journeyid),
        candidate_id: str_(r.candidateid),
        name: str_(r.candidatename),
        step: str_(r.step),
        title: str_(r.title) || hiringJourneySteps_()[str_(r.step)] || str_(r.step),
        channel: str_(r.channel),
        to: str_(r.to),
        ok: str_(r.ok).toLowerCase() !== 'no',
        detail: str_(r.detail),
        ref: str_(r.ref),
        rehearsal: str_(r.rehearsal).toLowerCase() === 'yes',
        at: str_(r.at),
        by: str_(r.by)
      });
    });
  } catch (e) {
    // null, not []: an unreadable tab is not an empty journey.
    return null;
  }
  out.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  return out.slice(-HIRING_JOURNEY_MAX);
}

function hiringTeamRecipients_() {
  var raw = '';
  try { raw = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {}).hiring_team_emails); }
  catch (e) { raw = ''; }
  var emails = raw.split(/[,;]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x.indexOf('@') !== -1; });
  if (!emails.length) {
    try { emails = staffAlertRecipients_('late_show') || []; } catch (e2) { emails = []; }
  }
  var names = {};
  try {
    usersAll_().forEach(function (u) {
      if (str_(u.mergedinto)) return;
      var mine = [str_(u.email)];
      try {
        var extra = JSON.parse(str_(u.emails) || '[]');
        if (extra && extra.length) mine = mine.concat(extra.map(String));
      } catch (eJ) {}
      mine.forEach(function (addr) {
        var key = String(addr).trim().toLowerCase();
        if (key && !names[key]) names[key] = str_(u.displayname);
      });
    });
  } catch (e3) {}
  return { emails: emails, names: names };
}

function hiringTeamName_(email) {
  var t = hiringTeamRecipients_();
  return t.names[String(email || '').trim().toLowerCase()] || '';
}

// Role or badge `interviewer`; narrower than userTypesCanInterview_ (no HM): who may sign is not who is asked.
function hiringInterviewersByBadge_() {
  var out = [];
  try {
    usersAll_().forEach(function (u) {
      if (str_(u.mergedinto)) return;
      if (str_(u.active).toLowerCase() !== 'true') return;
      var types = str_(u.types).toUpperCase();
      var role = str_(u.role).toLowerCase();
      var wears = role === 'interviewer' ||
                  types.split(/[,;|]+/).some(function (t) { return t.trim() === 'INTERVIEWER'; });
      if (!wears) return;
      var phone = str_(u.phone);
      if (!phone) {
        try {
          var list = JSON.parse(str_(u.phones) || '[]');
          if (list && list.length) phone = str_(list[0] && list[0].number);
        } catch (eJ) { phone = ''; }
      }
      out.push({
        user_id: str_(u.userid),
        name: str_(u.displayname),
        email: str_(u.email),
        phone: (typeof packetSendableNumber_ === 'function') ? packetSendableNumber_(phone) : phone,
        role: role,
        types: str_(u.types)
      });
    });
  } catch (e) { return []; }
  return out;
}

// The config name only orders the badge holders; it never grants the right to interview.
function hiringInterviewerPick_(preferName) {
  var all = hiringInterviewersByBadge_();
  if (!all.length) return { name: '', email: '', phone: '', by: 'nobody holds the INTERVIEWER badge' };

  var want = str_(preferName);
  if (!want) {
    try { want = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {}).interview_supervisor_name); }
    catch (e) { want = ''; }
  }
  // The config cell may carry a phone override after the name.
  var override = '';
  var m = want.match(/[+\d][\d\s().-]{9,}/);
  if (m) {
    override = (typeof packetSendableNumber_ === 'function') ? packetSendableNumber_(m[0]) : m[0];
    want = want.replace(m[0], '');
  }
  want = want.replace(/[,;]+\s*$/, '').trim();

  var picked = null;
  if (want) {
    all.forEach(function (p) {
      if (!picked && p.name && p.name.toLowerCase() === want.toLowerCase()) picked = p;
    });
  }
  var by = 'named in interview_supervisor_name and holds the badge';
  if (!picked) {
    var withEmail = all.filter(function (p) { return !!p.email; });
    picked = withEmail[0] || all[0];
    by = want
      ? '"' + want + '" does not hold the INTERVIEWER badge — asked the badge holder instead'
      : 'holds the INTERVIEWER badge';
  }
  return {
    name: picked.name, email: picked.email,
    phone: override || picked.phone,
    user_id: picked.user_id, by: by
  };
}

/** What happened in the hiring journey, per candidate or across the pipeline. */
HUB_POLICY.hiringJourneyList = {
  file: 'HiringJourney.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'interviewer'],
  params: { candidate_id: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.hiringJourneyList = function (payload, user) {
  var cid = str_(payload && payload.candidate_id);
  var rows = journeyFor_(cid);
  if (rows === null) {
    return { status: 200, data: { journey: null, unreadable: true,
             note: 'the hiring_journey tab could not be read — this is not an empty journey' } };
  }
  return { status: 200, data: { journey: rows, steps: hiringJourneySteps_() } };
};

/** Who the platform would write to, right now. */
HUB_POLICY.hiringTeamDirectory = {
  file: 'HiringJourney.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.hiringTeamDirectory = function (payload, user) {
  var team = hiringTeamRecipients_();
  var interviewers = hiringInterviewersByBadge_();
  var pick = hiringInterviewerPick_('');
  var test = null;
  try { test = (typeof hubTestModeState_ === 'function') ? hubTestModeState_() : null; }
  catch (e) { test = null; }
  return { status: 200, data: {
    team: team.emails,
    team_names: team.names,
    interviewers: interviewers,
    interviewer: pick,
    test_mode: test ? { on: !!test.on, sms: test.sms || [], emails: test.emails || [] } : null
  } };
};
