var HIRING_EVENTS_TAB = 'entity_hiring_events';
var HIRING_EVENTS_HEADER = ['event_id', 'candidate_id', 'candidate_name', 'event_type',
                            'date', 'time', 'starts_at', 'location', 'with_name', 'notes',
                            'status', 'created_at', 'created_by', 'email_receipt'];

var HIRING_EVENT_TYPES = {
  phone_screen: 'Phone screen',
  in_person_interview: 'In-person interview',
  orientation: 'Orientation',
  start_date: 'Start date',
  doc_help: 'Document Q&A'
};

// Append only, never insert: a position is a promise; mirrored in the SPA's useHiringViewsStore.
var HIRING_VIEW_IDS = [
  'pipeline',
  'table', 'calendar', 'actions', 'documents', 'reports',
  // 'reports' stays so cells written before it merged into Documents keep parsing.
  'analysis', 'scores', 'archive'
];

// 'flow' is a legacy cell word standing for the old rail's views, so old configs keep their meaning.
var HIRING_FLOW_VIEW_IDS = ['table', 'calendar', 'actions', 'documents', 'reports'];

function hiringViewsFromRaw_(raw) {
  var all = HIRING_VIEW_IDS.slice();
  var v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!v || v === 'yes') return all;
  if (v === 'no') return [];
  var picked = v.split(/[,;\s]+/).filter(String);
  var wants = {};
  for (var i = 0; i < picked.length; i++) {
    if (picked[i] === 'flow') {
      for (var j = 0; j < HIRING_FLOW_VIEW_IDS.length; j++) wants[HIRING_FLOW_VIEW_IDS[j]] = true;
    } else {
      wants[picked[i]] = true;
    }
  }
  return all.filter(function (id) { return wants[id] === true; });
}

HUB_POLICY.hiringViewsPolicy = {
  file: 'HiringFlow.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: []
};
/** Which Hiring views exist, readable by every role; an unreadable config fails open. */
HUB_ACTIONS.hiringViewsPolicy = function (payload, user) {
  var views = HIRING_VIEW_IDS.slice();
  try {
    var cfg = (typeof hiringAlerts_ === 'function') ? hiringAlerts_() : {};
    views = hiringViewsFromRaw_(cfg.hiring_views_master);
  } catch (e) { }
  return { status: 200, data: { views: views } };
};

// Text format at birth: Sheets would coerce "14:30" into a UTC-shifted 1899 date.
function hiringEventsSheet_() {
  var existed = !!hubTabSheet_(HIRING_EVENTS_TAB);
  var sheet = hubTabEnsure_(HIRING_EVENTS_TAB, HIRING_EVENTS_HEADER);
  if (!existed) {
    sheet.getRange(1, 1, sheet.getMaxRows(), HIRING_EVENTS_HEADER.length).setNumberFormat('@');
  }
  return sheet;
}

function hiringDateText_(v) {
  var m = str_(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

// Refused, never repaired: a coerced time cell is wrong by hours.
function hiringTimeText_(v) {
  var m = str_(v).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return '';
  return (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2];
}

function hiringEventOut_(r) {
  return {
    id: str_(r.eventid),
    candidate_id: str_(r.candidateid),
    name: str_(r.candidatename),
    type: str_(r.eventtype),
    type_label: HIRING_EVENT_TYPES[str_(r.eventtype)] || str_(r.eventtype),
    date: hiringDateText_(r.date),
    time: hiringTimeText_(r.time),
    location: str_(r.location),
    with_name: str_(r.withname),
    notes: str_(r.notes),
    status: str_(r.status) || 'scheduled',
    source: 'calendar'
  };
}

// Dates checked by shape, never parsed: a UTC midnight is the previous evening in Ohio.
function hiringEventValid_(payload) {
  var p = payload || {};
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(str_(p.candidate_id))) {
    return { ok: false, error: 'invalid candidate_id' };
  }
  if (!HIRING_EVENT_TYPES[str_(p.event_type)]) {
    return { ok: false, error: 'event_type must be one of: ' + Object.keys(HIRING_EVENT_TYPES).join(', ') };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str_(p.date))) {
    return { ok: false, error: 'date must be YYYY-MM-DD' };
  }
  if (str_(p.time) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(str_(p.time))) {
    return { ok: false, error: 'time must be HH:MM (24h)' };
  }
  return { ok: true };
}

function hiringCalendarMerge_(events, interviews) {
  var hasInterviewEvent = {};
  events.forEach(function (ev) {
    if (ev.type === 'in_person_interview') hasInterviewEvent[ev.candidate_id] = true;
  });
  var out = events.slice();
  (interviews || []).forEach(function (iv) {
    var cid = str_(iv.candidateid);
    var when = str_(iv.scheduledfor);
    if (!cid || !when || hasInterviewEvent[cid]) return;
    // Free text like "Friday 2pm" is left out, so the candidate returns to the to-schedule queue.
    var day = hiringDateText_(when);
    if (!day) return;
    var tm = /T(\d{2}:\d{2})/.test(when) ? when.match(/T(\d{2}:\d{2})/)[1] : '';
    out.push({
      id: str_(iv.interviewid),
      candidate_id: cid,
      name: str_(iv.candidatename),
      type: 'in_person_interview',
      type_label: HIRING_EVENT_TYPES.in_person_interview,
      date: day,
      time: hiringTimeText_(tm),
      location: '',
      with_name: str_(iv.interviewername),
      notes: '',
      status: str_(iv.status) || 'Scheduled',
      source: 'interview'
    });
  });
  out.sort(function (a, b) {
    var ka = a.date + 'T' + (a.time || '00:00'), kb = b.date + 'T' + (b.time || '00:00');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

// By type only, never source, so interviews-tab rows survive.
function hiringCalendarKeep_(events) {
  return events.filter(function (ev) {
    return ev.type === 'in_person_interview' || ev.type === 'start_date';
  });
}

HUB_POLICY.hiringCalendarList = {
  file: 'HiringFlow.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'interviewer'],
  invalidates: [], emits: []
};
HUB_ACTIONS.hiringCalendarList = function (payload, user) {
  if (!user || user.is_service ||
      ['admin', 'director', 'manager', 'interviewer'].indexOf(str_(user.role)) === -1) {
    return hubDenied_();
  }
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var events = [];
  try {
    readTabNormalized_(ss, HIRING_EVENTS_TAB).forEach(function (r) {
      if (!str_(r.eventid) || str_(r.status).toLowerCase() === 'cancelled') return;
      events.push(hiringEventOut_(r));
    });
  } catch (e) { }
  var interviews = [];
  try { interviews = readTabNormalized_(ss, HUB_INTERVIEWS_TAB); } catch (e2) { }
  return { status: 200, data: {
    events: hiringCalendarKeep_(hiringCalendarMerge_(events, interviews)),
    types: HIRING_EVENT_TYPES
  } };
};

// Only an open row is restamped: a completed or scored row is history and gets a new row after it.
function hiringInterviewRestamp_(cid, cand, when, user) {
  var sheet = interviewSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iCid = hdr.indexOf('candidateid');
  var iWhen = hdr.indexOf('scheduledfor');
  var iStatus = hdr.indexOf('status');
  var iScore = hdr.indexOf('score');
  for (var r = values.length - 1; r >= 1; r--) {
    if (str_(values[r][iCid]) !== cid) continue;
    var status = str_(iStatus === -1 ? '' : values[r][iStatus]).toLowerCase();
    var scored = iScore !== -1 && str_(values[r][iScore]) !== '';
    var open = !scored && (status === '' || status === 'scheduled' || status === 'to schedule');
    if (!open) break;
    if (iWhen !== -1) sheet.getRange(r + 1, iWhen + 1).setValue(when);
    if (iStatus !== -1) sheet.getRange(r + 1, iStatus + 1).setValue('Scheduled');
    return true;
  }
  sheet.appendRow(['INT_' + randomHex_(10).toUpperCase(), cid,
    str_(cand && cand.candidatename), str_(when), 'flow-calendar', 'Scheduled',
    new Date().toISOString(), 'asa-hub:' + (user && user.email ? user.email : 'system')]);
  return true;
}

var HIRING_EVENT_MAIL_FALLBACK = {
  email_subject: '{event} — {date}{time_line}',
  email_text: 'Hi {first_name},\n\n' +
              'Your {event} with Asa LifeCare is scheduled.\n\n' +
              '  When    {date}{time_line}\n' +
              '{where_line}{with_line}' +
              '\n{notes}\n\n' +
              'If this day or time does not work, reply to this e-mail and we will move it.\n\n' +
              'Asa LifeCare'
};

// Unlike smartRender_, known keys are substituted even when empty; only a typo stays visible.
function hiringRenderMail_(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) {
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
  });
}

function hiringEventMailVars_(cand, ev) {
  var name = str_(cand && cand.candidatename) || ev.candidate_name || '';
  return {
    name: name,
    first_name: name.split(' ')[0] || name,
    event: HIRING_EVENT_TYPES[ev.event_type] || ev.event_type,
    date: ev.date,
    time: ev.time,
    time_line: ev.time ? ' at ' + ev.time : '',
    where_line: ev.location ? '  Where   ' + ev.location + '\n' : '',
    with_line: ev.with_name ? '  With    ' + ev.with_name + '\n' : '',
    location: ev.location,
    with_name: ev.with_name,
    notes: str_(ev.notes)
  };
}

function hiringEventNotify_(cand, ev, user, auto) {
  var sit = null;
  var evSitId = 'hiring_event_scheduled';
  try { evSitId = commSituationId_('hiring.event.scheduled', 'hiring_event_scheduled'); } catch (eB) {}
  try {
    smartSituations_().forEach(function (s) {
      if (str_(s.id) === evSitId) sit = s;
    });
  } catch (e) { sit = null; }
  // Fail closed: no enabled situation row, no e-mail.
  if (!sit || !smartOn_(sit.enabled)) {
    return { emailed: false, reason: 'situation_off' };
  }
  var to = str_(cand && cand.email);
  if (!to) return { emailed: false, reason: 'no_email' };

  var vars = hiringEventMailVars_(cand, ev);
  var subjectTpl = (sit && str_(sit.email_subject)) || HIRING_EVENT_MAIL_FALLBACK.email_subject;
  var bodyTpl = (sit && str_(sit.email_text)) || HIRING_EVENT_MAIL_FALLBACK.email_text;
  var subject = hiringRenderMail_(subjectTpl, vars);
  var body = hiringRenderMail_(bodyTpl, vars).replace(/\n{3,}/g, '\n\n');

  if (auto) {
    // screenAiChat_ forces JSON: raw chat.content would mail the candidate a JSON object.
    try {
      var ntpl = bookText_('Prompts', 'ai_hiring_notice', '');
      var chat = ntpl
        ? screenAiChat_(ntpl.split('{body}').join(body), 0.4, 'ai_hiring_notice')
        : null;
      var rewritten = '';
      try { rewritten = str_((JSON.parse(str_(chat && chat.content)) || {}).body); } catch (eJ) { rewritten = ''; }
      if (chat && chat.ok && rewritten) body = rewritten;
    } catch (eA) { }
  }

  // Keyed by candidate, type, day and time: a moved meeting is told again.
  var who = ev.candidate_id + ':' + ev.event_type + (ev.time ? ':' + ev.time : '');
  var key = smartLedgerKey_(evSitId, who, ev.date);
  try {
    if (smartAlreadySent_()[key]) return { emailed: false, reason: 'already_told' };
  } catch (eK) { }

  var res = rpcCall_('emailSend', {
    to: to, subject: subject, body: body,
    reason: 'hiring schedule: ' + vars.event + ' for ' + vars.name + ' on ' + ev.date +
            ' (by ' + str_(user && user.email) + ')'
  }, { idempotency_key: 'hevmail_' + str_(ev.id) });
  if (res && res.sent) {
    // A redirected send is recorded under the rehearsal key: the real person is still owed it.
    try {
      smartRecord_(res.redirected ? smartRehearsalKey_(key) : key,
                   evSitId, who, ev.date,
                   res.redirected ? 'rehearsal' : 'email');
    } catch (eR) {}
    return { emailed: true, redirected: !!res.redirected, receipt: str_(res.receipt || '') };
  }
  return { emailed: false, reason: str_((res && (res.error || res.detail)) || 'send_failed') };
}

HUB_POLICY.hiringScheduleCreate = {
  file: 'HiringFlow.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: ['emailSend']
};
/** Schedule one appointment for one candidate; the e-mail rides on it. */
HUB_ACTIONS.hiringScheduleCreate = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var valid = hiringEventValid_(payload);
  if (!valid.ok) return { status: 400, message: valid.error };

  var cid = str_(payload.candidate_id);
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };

  var type = str_(payload.event_type);
  var date = str_(payload.date);
  var time = str_(payload.time);
  var row = {
    id: 'HEV_' + randomHex_(10).toUpperCase(),
    candidate_id: cid,
    candidate_name: str_(ev.cand.candidatename),
    event_type: type,
    date: date,
    time: time,
    // assembled, never parsed — a string of parts cannot cross midnight
    starts_at: time ? date + 'T' + time + ':00' : date,
    location: str_(payload.location),
    with_name: str_(payload.with_name),
    notes: str_(payload.notes)
  };
  var sheet = hiringEventsSheet_();
  var cells = {
    eventid: row.id, candidateid: row.candidate_id, candidatename: row.candidate_name,
    eventtype: row.event_type, date: row.date, time: row.time, startsat: row.starts_at,
    location: row.location, withname: row.with_name, notes: row.notes,
    status: 'scheduled', createdat: new Date().toISOString(),
    createdby: 'asa-hub:' + str_(user && user.email), emailreceipt: ''
  };
  if (sheet.isRuntimeBacked) {
    // The runtime grid ends at getLastRow(): only appendRow lands, positionally on its own header.
    var rtHdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var before = sheet.getLastRow();
    sheet.appendRow(rtHdr.map(function (h) {
      var v = cells[normKey_(h)];
      return v === undefined ? '' : v;
    }));
    // A refused append looks like a filed one unless counted.
    if (sheet.getLastRow() === before) {
      return { status: 500, message: 'The hiring event did not land in the runtime store.' };
    }
  } else {
    // Not appendRow: appended cells revert to automatic format and times coerce.
    var atRow = sheet.getLastRow() + 1;
    if (sheet.getMaxRows() < atRow) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    var target = sheet.getRange(atRow, 1, 1, HIRING_EVENTS_HEADER.length);
    target.setNumberFormat('@');
    target.setValues([HIRING_EVENTS_HEADER.map(function (h) { return cells[normKey_(h)]; })]);
  }

  // The interviews-tab row is what opens the interviewer's scorecard window.
  if (type === 'in_person_interview') {
    try {
      if (!hubScheduleInterview_(cid, ev.cand, row.starts_at, user)) {
        hiringInterviewRestamp_(cid, ev.cand, row.starts_at, user);
      }
    } catch (eI) {
      try { hubSysLog_(str_(user && user.email), 'hiring_event_interview_stamp_failed', cid,
                       { status: 500 }); } catch (eL) {}
    }
  }

  var mail = hiringEventNotify_(ev.cand, {
    id: row.id, candidate_id: cid, candidate_name: row.candidate_name,
    event_type: type, date: date, time: time,
    location: row.location, with_name: row.with_name, notes: row.notes
  }, user, payload.auto === true);
  if (mail.emailed || mail.receipt) {
    var receipt = mail.receipt || (mail.emailed ? 'sent' : '');
    try {
      if (sheet.isRuntimeBacked) {
        // A cell write past the shim's grid resolves no subject; a fact carries its own.
        hiringLegacyWrite_(HIRING_EVENTS_TAB, row.id, { email_receipt: receipt },
                           str_(user && user.email));
      } else {
        var values = sheet.getDataRange().getValues();
        var hdr = values[0].map(normKey_);
        var iId = hdr.indexOf('eventid');
        var iRec = hdr.indexOf('emailreceipt');
        for (var r = values.length - 1; r >= 1; r--) {
          if (str_(values[r][iId]) === row.id) {
            sheet.getRange(r + 1, iRec + 1).setValue(receipt);
            break;
          }
        }
      }
    } catch (eS) { }
  }
  try {
    hubSysLog_(str_(user && user.email), 'hiring_event_create',
               row.candidate_name + ' — ' + type + ' ' + date, { status: 200 });
  } catch (eG) {}
  try { hubBustTalentCache_(); } catch (eB) {}
  return { status: 200, data: { event: {
    id: row.id, candidate_id: cid, name: row.candidate_name,
    type: type, type_label: HIRING_EVENT_TYPES[type], date: date, time: time,
    location: row.location, with_name: row.with_name, notes: row.notes,
    status: 'scheduled', source: 'calendar'
  }, mail: mail } };
};

var HIRING_STAGE_PURPOSES = {
  'new': 'Capture identity and contact facts; resume on file and background started.',
  'phone-screen': 'The recruiter call — transcript, AI report, a date accepted, an advance decision.',
  'interview': 'The in-person evaluation — scheduled, held, scored.',
  'onboarding': 'The new-hire packet — seven documents, one signature.',
  'hired': 'The graduation: account created, password set, Employee Database written.',
  'ready': 'Finished and waiting — a manager begins their activities.'
};

HUB_POLICY.hiringFlowControl = {
  file: 'HiringFlow.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
/** Flow Control: stage purposes, each Smart Comms switch, and what the ledger actually sent. */
HUB_ACTIONS.hiringFlowControl = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var stages = TALENT_STAGE_ORDER.map(function (id) {
    return { id: id, purpose: HIRING_STAGE_PURPOSES[id] || '' };
  });
  var situations = [];
  try {
    smartSituations_().forEach(function (s) {
      situations.push({
        id: str_(s.id), label: str_(s.label) || str_(s.id),
        enabled: smartOn_(s.enabled), kind: str_(s.kind), event: str_(s.event),
        channels: str_(s.channels), to: str_(s.to), days_before: str_(s.days_before)
      });
    });
  } catch (e) { }

  var bySituation = {}, byPerson = {}, recent = [], total = 0;
  try {
    var sheet = smartLedgerSheet_();
    var last = sheet.getLastRow();
    if (last > 1) {
      var rows = sheet.getRange(2, 1, last - 1, 6).getValues();
      rows.forEach(function (r) {
        var sit = String(r[1] || '').trim();
        var person = String(r[2] || '').trim();
        var at = String(r[5] || '').trim();
        if (!sit) return;
        total++;
        var s = bySituation[sit] = bySituation[sit] || { count: 0, last: '' };
        s.count++;
        if (at > s.last) s.last = at;
        // Candidate ledger rows carry the id, sometimes suffixed ':type'.
        var cid = /^CAN_/.test(person) ? person.split(':')[0] : '';
        if (cid) {
          var p = byPerson[cid] = byPerson[cid] || { count: 0, last: '' };
          p.count++;
          if (at > p.last) p.last = at;
        }
      });
      recent = rows.slice(-20).reverse().map(function (r) {
        return { situation: String(r[1] || ''), person: String(r[2] || ''),
                 channel: String(r[4] || ''), at: String(r[5] || '') };
      });
    }
  } catch (eL) { }

  var rehearsing = false;
  try { rehearsing = !!hubTestRedirect_(); } catch (eT) { rehearsing = false; }

  return { status: 200, data: {
    stages: stages,
    situations: situations,
    ledger: { total: total, bySituation: bySituation, byPerson: byPerson, recent: recent },
    rehearsing: rehearsing
  } };
};
