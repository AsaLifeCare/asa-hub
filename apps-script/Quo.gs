// Apps Script never sees request headers, so the public door cannot check Quo's signature: it writes and never reads.

// Resource names, not tab names: createRow_ throws on a tab name, and the webhook guard would hide it.
var QUO_TRANSCRIPTS = 'quoTranscripts';
var QUO_MESSAGES = 'quoMessages';
var QUO_SUMMARIES = 'quoSummaries';
var QUO_API_BASE = 'https://api.openphone.com/v1';
var QUO_API_KEY_PROP = 'OPENPHONE_API_KEY';
var QUO_WEBHOOK_SECRET_PROP = 'OPENPHONE_WEBHOOK_SECRET';

function quoIsWebhookBody_(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.action || body.resource || body.token) return false;   // ours, not theirs
  return !!(String(body.type || '') && body.data);
}

function quoIsTranscriptType_(t) {
  var s = String(t || '');
  return s === 'call.transcript.completed' || s === 'callTranscript';
}

function quoIsSummaryType_(t) {
  var s = String(t || '');
  return s === 'call.summary.completed' || s === 'callSummary';
}

// History the relay recovered from Quo after the fact: filed, never heard — an old reply must not act on what is open today.
function quoIsHistory_(source) {
  return String(source || '') === 'relay:backfill';
}

function quoIsMessageType_(t) {
  var s = String(t || '').toLowerCase();
  if (!s) return false;
  return s.indexOf('message') !== -1 || s.indexOf('sms') !== -1;
}

function quoNames_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) !== '[object Array]') return str_(v);
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var x = v[i];
    var one = (x && typeof x === 'object')
      ? str_(x.name || x.number || x.phoneNumber || x.email || x.id)
      : str_(x);
    if (one) out.push(one);
  }
  return out.join(', ');
}

// m:ss from a turn's start in seconds, as the legacy receiver stamps it.
function quoTurnStamp_(start) {
  var sec = Math.round(Number(start) || 0);
  if (!(sec > 0)) sec = 0;
  var s = sec % 60;
  return Math.floor(sec / 60) + ':' + (s < 10 ? '0' : '') + s;
}

// Speaker lines are "[m:ss] who: said", the one shape every reader parses; a bare "+1…: said" parsed as nothing.
function quoTranscriptText_(dialogue) {
  var plain = [], spoken = [];
  var list = (dialogue && dialogue.length) ? dialogue : [];
  for (var i = 0; i < list.length; i++) {
    var turn = list[i] || {};
    var said = String(turn.content || turn.text || '').trim();
    if (!said) continue;
    plain.push(said);
    var who = String(turn.identifier || turn.userId || turn.participant || 'speaker');
    spoken.push('[' + quoTurnStamp_(turn.start) + '] ' + who + ': ' + said);
  }
  return { plain: plain.join(' '), spoken: spoken.join('\n'), turns: plain.length };
}

// Sheets reads a leading + - = @ as a formula (a number became #ERROR!): the row gets text, the ears the raw record.
function quoCellSafe_(record) {
  var out = {};
  for (var k in record) {
    if (Object.prototype.hasOwnProperty.call(record, k)) out[k] = hubCellSafe_(record[k]);
  }
  return out;
}

// Real transcript events often arrive with empty line fields; speaker labels are E.164, so lines come from the turns.
function quoNumbersFromTurns_(dialogue) {
  var lines = {}, others = {};
  var dir = null;
  try { dir = (typeof hubLineStored_ === 'function') ? hubLineStored_() : null; } catch (eD) { dir = null; }
  var known = {};
  if (dir && dir.lines) {
    for (var k = 0; k < dir.lines.length; k++) {
      var digits = String(dir.lines[k].number || '').replace(/\D/g, '');
      if (digits) known[digits.slice(-10)] = true;
    }
  }
  var list = (dialogue && dialogue.length) ? dialogue : [];
  for (var i = 0; i < list.length; i++) {
    var turn = list[i] || {};
    var who = String(turn.identifier || turn.userId || turn.participant || '');
    var d = who.replace(/\D/g, '');
    if (d.length < 10) continue;
    var ten = d.slice(-10);
    if (known[ten]) lines['+1' + ten] = true;
    else others['+1' + ten] = true;
  }
  return { lines: Object.keys(lines).join(', '), others: Object.keys(others).join(', ') };
}

function quoHandleTranscript_(body, source) {
  var d = body.data || {};
  var obj = d.object || d;
  var t = quoTranscriptText_(obj.dialogue);
  var fromTurns = quoNumbersFromTurns_(obj.dialogue);
  var record = {
    call_id: str_(obj.callId || obj.id),
    event_id: str_(body.id),
    event_type: str_(body.type),
    transcript_created: str_(obj.createdAt),
    event_at: str_(body.createdAt || obj.createdAt),
    duration_s: Number(obj.duration || 0) || '',
    quo_number: str_(obj.phoneNumberId),
    direction: str_(obj.direction),
    turns: t.turns,
    full_transcript: t.plain.slice(0, 45000),
    speaker_transcript: t.spoken.slice(0, 45000),
    status: str_(obj.status),
    // Same columns as the imported history, or the tab becomes two shapes under one name.
    participants: quoNames_(obj.participants) || fromTurns.others,
    team_members: fromTurns.lines ||
      (quoNames_(obj.users || obj.teamMembers).match(/\d{10}/)
        ? quoNames_(obj.users || obj.teamMembers) : ''),
    contact_ids: quoNames_(obj.contactIds),
    source: source,
    received_at: new Date().toISOString()
  };
  // Refused by return value: unchecked, the relay would drain a transcript no row holds.
  var madeT = createRow_(QUO_TRANSCRIPTS, quoCellSafe_(record));
  if (sheetDbRefused_(madeT)) throw new Error('the row was refused: ' + str_(sheetDbRefused_(madeT).message));
  if (!quoIsHistory_(source)) quoCommCallsKick_(record);
  // Never classify here: a slow webhook gets retried and dropped by the provider (commCallsSweep reads it).
  return { kind: 'transcript', id: record.call_id, turns: t.turns };
}

// Fire-and-forget: the kick must never fail the filing (the provider retries any non-200).
function quoCommCallsKick_(record) {
  try {
    var secret = String(hubProp_('HUB_SERVICE_SECRET') || '');
    if (!secret) return;
    UrlFetchApp.fetch('https://asamylife.asalifecare.com/comm-calls/transcript', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ record: record, service_secret: secret }),
      muteHttpExceptions: true
    });
  } catch (eKick) {
    try { Logger.log('quoCommCallsKick_: ' + ((eKick && eKick.message) || eKick)); } catch (eL) {}
  }
}

// Newest rows only: a retry arrives within seconds.
function quoMessageSeen_(messageId) {
  var want = String(messageId || '');
  if (!want) return false;
  try {
    var sheet = hubTabSheet_('quo_messages');
    if (!sheet) return false;
    var last = sheet.getLastRow();
    if (last < 2) return false;
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var at = header.indexOf('message_id');
    if (at === -1) return false;
    var from = Math.max(2, last - 400);
    var values = sheet.getRange(from, at + 1, last - from + 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === want) return true;
    }
  } catch (e) { }   // unreadable: filing twice beats losing a reply
  return false;
}

// `seen` is the batch's snapshot of filed ids (quoSeenMessageIds_); without it the tab is read per event.
function quoHandleMessage_(body, source, seen) {
  var d = body.data || {};
  var obj = d.object || d;
  var record = {
    message_id: str_(obj.id),
    event_id: str_(body.id),
    event_type: str_(body.type),
    message_created: str_(obj.createdAt),
    event_at: str_(body.createdAt || obj.createdAt),
    status: str_(obj.status),
    quo_number: str_(obj.phoneNumberId),
    direction: str_(obj.direction),
    from_number: str_(obj.from),
    to_number: (obj.to && obj.to.join) ? obj.to.join(', ') : str_(obj.to),
    user_id: str_(obj.userId),
    conversation_id: str_(obj.conversationId),
    // a temporary password this platform texted is the person's alone; the filed copy keeps the words without it
    body: ((typeof resetTextScrub_ === 'function') ? resetTextScrub_(str_(obj.text || obj.body))
                                                    : str_(obj.text || obj.body)).slice(0, 20000),
    attachments: (obj.media && obj.media.length)
      ? obj.media.map(function (m) { return str_(m.url); }).join(' ') : '',
    participants: quoNames_(obj.to) || str_(obj.from),
    team_members: str_(obj.userId),
    contact_ids: quoNames_(obj.contactIds),
    message_type: str_(obj.type || body.type),
    source: source,
    received_at: new Date().toISOString()
  };
  // One message, one row: both the relay and the provider retry.
  if (record.message_id && (seen ? quoSeenHas_(seen, record.message_id) : quoMessageSeen_(record.message_id))) {
    return { kind: 'message', id: record.message_id, duplicate: true };
  }
  // createRow_ refuses by return value, not by throwing; unchecked, the relay would drain a text no row holds.
  var made = createRow_(QUO_MESSAGES, quoCellSafe_(record));
  if (made && made.error) throw new Error('the row was refused: ' + str_(made.error.message));
  if (seen && record.message_id) seen.ids[record.message_id] = true;
  // Only after the row is safe, and never able to fail this door.
  if (String(record.direction || '').toLowerCase() === 'incoming' && !quoIsHistory_(source) &&
      typeof commInboundCapture_ === 'function') {
    try {
      commInboundCapture_({ channel: 'sms', message_id: record.message_id, from: record.from_number,
                            to: record.to_number, text: record.body,
                            at: record.message_created || record.received_at,
                            thread_id: record.conversation_id, source: source });
    } catch (eC) {
      try { hubSysLog_('asa-hub:comm', 'comm_inbound_failed', String((eC && eC.message) || eC), { status: 500 }); } catch (eL) {}
    }
  }
  // After the ear, which names the person when it can; history too, since a stop is never out of date.
  if (String(record.direction || '').toLowerCase() === 'incoming') quoOptOutFloor_(record, source);
  return { kind: 'message', id: record.message_id };
}

// Our line in an incoming text's recipients, for a wrong number's scope; '' when none is ours.
function quoOurLine_(to) {
  var nums = String(to || '').split(/[,;]+/);
  for (var i = 0; i < nums.length; i++) {
    var d = nums[i].replace(/\D/g, '').slice(-10);
    if (d && inboundIsOurs_(d)) return d;
  }
  return '';
}

// THE BRAKE FOR EVERY SENDER.
function quoOptOutFloor_(record, source) {
  try {
    var intent = optOutIntent_(record.body);
    if (intent !== 'opt-out' && intent !== 'wrong-number' && intent !== 'opt-in') return '';
    var from = str_(record.from_number);
    var digits = from.replace(/\D/g, '').slice(-10);
    if (!digits || inboundIsOurs_(digits)) return '';
    if (intent === 'opt-in') {
      if (quoIsHistory_(source)) return '';
      optOutRelease_(from, { email: 'asa-hub:quo' });
      return intent;
    }
    var wrong = intent === 'wrong-number';
    optOutAdd_(from, { source: wrong ? 'wrong number' : 'sms reply', phrase: str_(record.body).slice(0, 120),
                       messageId: record.message_id, by: 'asa-hub:quo',
                       scope: wrong ? optOutScopeForLine_(quoOurLine_(record.to_number)) : '' });
    return intent;
  } catch (e) {
    try { hubSysLog_('asa-hub:quo', 'quo_opt_out_failed', String((e && e.message) || e), { status: 500 }); } catch (eL) {}
    return '';
  }
}

// Public, no session (routed by shape from Main.gs): it must never answer with anything it holds.
function quoWebhookPub_(body) {
  var source = 'webhook';
  var type = String(body.type || '');
  try {
    if (quoIsTranscriptType_(type)) {
      return { status: 200, data: quoHandleTranscript_(body, source) };
    }
    if (quoIsSummaryType_(type)) {
      return { status: 200, data: quoHandleSummary_(body, source) };
    }
    if (quoIsMessageType_(type)) {
      return { status: 200, data: quoHandleMessage_(body, source) };
    }
  } catch (e) {
    // Always 200: a retried webhook storm is an outage on a one-execution backend.
    try {
      hubSysLog_('asa-hub:quo', 'quo_webhook_failed',
                 type + ': ' + String((e && e.message) || e), { status: 500 });
    } catch (eL) { }
    return { status: 200, data: { kind: 'error', note: 'recorded in the log' } };
  }
  return { status: 200, data: { kind: 'ignored', type: type } };
}

function quoHandleSummary_(body, source) {
  var d = body.data || {};
  var obj = d.object || d;
  var record = {
    call_id: str_(obj.callId || obj.id),
    event_id: str_(body.id),
    event_type: str_(body.type),
    summary_created: str_(obj.createdAt),
    event_at: str_(body.createdAt || obj.createdAt),
    quo_number: str_(obj.phoneNumberId),
    direction: str_(obj.direction),
    duration_s: Number(obj.duration || 0) || '',
    summary: (obj.summary && obj.summary.join ? obj.summary.join('\n') : str_(obj.summary)).slice(0, 45000),
    next_steps: (obj.nextSteps && obj.nextSteps.join ? obj.nextSteps.join('\n') : str_(obj.nextSteps)),
    jobs: (obj.jobs && obj.jobs.join ? obj.jobs.join('\n') : str_(obj.jobs)),
    status: str_(obj.status),
    participants: quoNames_(obj.participants),
    team_members: quoNames_(obj.users || obj.teamMembers),
    source: source,
    received_at: new Date().toISOString()
  };
  var madeS = createRow_(QUO_SUMMARIES, quoCellSafe_(record));
  if (sheetDbRefused_(madeS)) throw new Error('the row was refused: ' + str_(sheetDbRefused_(madeS).message));
  return { kind: 'summary', id: record.call_id };
}

// --- The relay's door: events whose signature the relay has verified ---

HUB_POLICY.quoIngest = {
  file: 'Quo.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  // `object`, not `json`: the validator compares against typeof.
  params: { event: { required: true, type: 'object' } },
  invalidates: [], emits: []
};
// The public webhook door stays live on purpose, so re-pointing Quo can be undone in one call.
HUB_ACTIONS.quoIngest = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || str_(user.role) !== 'admin')) return hubDenied_();
  var event = payload && payload.event;
  if (!event || !event.type) return { status: 400, message: 'No event.' };
  var verified = str_(payload && payload.verified) || 'relay';
  try {
    var type = String(event.type || '');
    if (quoIsTranscriptType_(type)) return { status: 200, data: quoHandleTranscript_(event, verified) };
    if (quoIsSummaryType_(type)) return { status: 200, data: quoHandleSummary_(event, verified) };
    if (quoIsMessageType_(type)) return { status: 200, data: quoHandleMessage_(event, verified) };
  } catch (e) {
    try {
      hubSysLog_('asa-hub:quo', 'quo_ingest_failed',
                 String(event.type) + ': ' + String((e && e.message) || e), { status: 500 });
    } catch (eL) { }
    return { status: 200, data: { kind: 'error', note: 'recorded in the log' } };
  }
  return { status: 200, data: { kind: 'ignored', type: String(event.type) } };
};

// --- The relay's inbox, handed over in batches ---

// Under the relay's own wait and the six-minute ceiling, so an answer always comes back.
var QUO_BATCH_BUDGET_MS = 270 * 1000;
var QUO_BATCH_MAX = 25;
var QUO_BATCH_SEEN_ROWS = 2000;

// null (never an empty set) when unreadable, or every text in the batch would read as new.
function quoSeenMessageIds_(depth) {
  try {
    var sheet = hubTabSheet_('quo_messages');
    if (!sheet) return null;
    var last = sheet.getLastRow();
    var cols = sheet.getLastColumn();
    if (last < 1 || cols < 1) return null;
    var header = sheet.getRange(1, 1, 1, cols).getValues()[0].map(String);
    var at = header.indexOf('message_id');
    if (at === -1) return null;
    var snap = { ids: {}, sheet: sheet, col: at + 1, last: 1 };
    var from = Math.max(2, last - Math.max(1, Number(depth) || QUO_BATCH_SEEN_ROWS) + 1);
    if (last >= 2) quoSeenRead_(snap, from, last);
    return snap;
  } catch (e) { return null; }
}

function quoSeenRead_(snap, from, to) {
  var values = snap.sheet.getRange(from, snap.col, to - from + 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (id) snap.ids[id] = true;
  }
  snap.last = Math.max(snap.last, to);
}

// Reads rows landed since the snapshot first (a concurrent execution); a failed read throws rather than file blind.
function quoSeenHas_(snap, id) {
  var last = snap.sheet.getLastRow();
  if (last > snap.last) quoSeenRead_(snap, snap.last + 1, last);
  return !!snap.ids[id];
}

function quoMessageFiledAnywhere_(messageId) {
  return quoFiledAnywhere_('quo_messages', 'message_id', messageId);
}

// Whole column, for `recheck` events only; null when unreadable.
function quoFiledAnywhere_(tab, field, id) {
  var want = String(id || '').trim();
  if (!want) return false;
  try {
    var sheet = hubTabSheet_(tab);
    if (!sheet) return null;
    var last = sheet.getLastRow();
    var cols = sheet.getLastColumn();
    if (last < 2) return false;
    var header = sheet.getRange(1, 1, 1, cols).getValues()[0].map(String);
    var at = header.indexOf(field);
    if (at === -1) return null;
    var column = sheet.getRange(2, at + 1, last - 1, 1);
    if (typeof column.createTextFinder === 'function') {
      return !!column.createTextFinder(want).matchCase(true).matchEntireCell(true).findNext();
    }
    var values = column.getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === want) return true;
    }
    return false;
  } catch (e) { return null; }
}

// Must read the id exactly where quoHandleMessage_ reads it.
function quoEventMessageId_(event) {
  var d = (event && event.data) || {};
  var obj = d.object || d;
  return str_(obj.id);
}

// Must read the id exactly where quoHandleTranscript_ and quoHandleSummary_ read it.
function quoEventCallId_(event) {
  var d = (event && event.data) || {};
  var obj = d.object || d;
  return str_(obj.callId || obj.id);
}

// The relay drains an event only on filed/already; refused/error keep it for another try.
function quoBatchOutcome_(data) {
  var d = data || {};
  if (d.duplicate) return { result: 'already', why: 'this ' + (d.kind || 'event') + ' id is already filed' };
  if (d.kind === 'message' || d.kind === 'transcript' || d.kind === 'summary') return { result: 'filed', why: '' };
  if (d.kind === 'error') return { result: 'error', why: str_(d.note) || 'the handler failed' };
  return { result: 'refused', why: 'no handler files type ' + (str_(d.type) || '(none)') };
}

HUB_POLICY.quoIngestBatch = {
  file: 'Quo.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  params: { events: { required: true, type: 'array' } },
  invalidates: [], emits: []
};
/** Many verified events, one execution: the relay's inbox, handed over after it was kept. */
HUB_ACTIONS.quoIngestBatch = function (payload, user) {
  if (!(user && user.is_service)) return hubDenied_();
  var events = payload && payload.events;
  if (Object.prototype.toString.call(events) !== '[object Array]') {
    return { status: 400, message: 'events must be a list.' };
  }
  var started = Date.now();
  var seen = null, seenRead = false;
  var results = [];
  var total = Math.min(events.length, QUO_BATCH_MAX);
  var i = 0;
  for (; i < total; i++) {
    if (Date.now() - started > QUO_BATCH_BUDGET_MS) break;
    var item = events[i] || {};
    var event = item.event;
    var id = str_(item.id), type = str_(item.type);
    if (!event || typeof event !== 'object' || !event.type) {
      results.push({ id: id, type: type, result: 'refused', why: 'no event' });
      continue;
    }
    var source = 'relay:' + (str_(item.source) || 'inbox');
    try {
      var kind = String(event.type || '');
      var data;
      if (quoIsTranscriptType_(kind) || quoIsSummaryType_(kind)) {
        // A call row has no id check of its own: a re-offered one is looked up before it is filed twice.
        var isTr = quoIsTranscriptType_(kind);
        var filed = false;
        if (item.recheck === true) {
          filed = quoFiledAnywhere_(isTr ? 'quo_transcripts' : 'quo_summaries', 'call_id', quoEventCallId_(event));
          if (filed === null) throw new Error('the filed call ids could not be read to recheck it');
        }
        data = filed ? { kind: isTr ? 'transcript' : 'summary', id: quoEventCallId_(event), duplicate: true }
             : isTr ? quoHandleTranscript_(event, source) : quoHandleSummary_(event, source);
      } else if (quoIsMessageType_(kind)) {
        // A re-offered event may be older than any window; unreadable is never "new".
        var anywhere = false;
        if (item.recheck === true) {
          anywhere = quoMessageFiledAnywhere_(quoEventMessageId_(event));
          if (anywhere === null) throw new Error('the filed ids could not be read to recheck it');
        }
        if (!anywhere && !seenRead) { seen = quoSeenMessageIds_(QUO_BATCH_SEEN_ROWS); seenRead = true; }
        data = anywhere ? { kind: 'message', id: quoEventMessageId_(event), duplicate: true }
                        : quoHandleMessage_(event, source, seen || undefined);
      } else data = { kind: 'ignored', type: kind };
      var out = quoBatchOutcome_(data);
      results.push({ id: id, type: type, result: out.result, why: out.why });
    } catch (e) {
      try {
        hubSysLog_('asa-hub:quo', 'quo_ingest_failed',
                   type + ' ' + id + ': ' + String((e && e.message) || e), { status: 500 });
      } catch (eL) { }
      results.push({ id: id, type: type, result: 'error', why: String((e && e.message) || e).slice(0, 200) });
    }
  }
  return { status: 200, data: {
    results: results, reached: results.length, left: events.length - i,
    stopped_early: i < total, ms: Date.now() - started
  } };
};

HUB_POLICY.quoWebhookKeys = {
  file: 'Quo.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'instant',
  roles: ['admin'], invalidates: [], emits: []
};
// Service identity and master only: never an admin session or a browser.
HUB_ACTIONS.quoWebhookKeys = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && !(user && hubIsMaster_(str_(user.email)))) {
    return { status: 404, message: 'Unknown action.' };
  }
  var keys = [];
  ['QUO_WEBHOOK_KEY_TRANSCRIPTS', 'QUO_WEBHOOK_KEY_SUMMARIES',
   'QUO_WEBHOOK_KEY_MESSAGES', QUO_WEBHOOK_SECRET_PROP].forEach(function (k) {
    var v = str_(hubProp_(k));
    if (v && keys.indexOf(v) === -1) keys.push(v);
  });
  return { status: 200, data: { keys: keys, count: keys.length } };
};

HUB_POLICY.quoStatus = {
  file: 'Quo.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: []
};
/** Is the platform catching its own calls yet, and is what arrives signed? */
HUB_ACTIONS.quoStatus = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var count = function (tab) {
    var total = 0, newest = '';
    try {
      (listRows_(tab, {}) || []).forEach(function (r) {
        total++;
        var at = str_(r.received_at);
        if (at > newest) newest = at;
      });
    } catch (e) { }
    return { total: total, newest: newest };
  };
  return { status: 200, data: {
    transcripts: count(QUO_TRANSCRIPTS),
    messages: count(QUO_MESSAGES),
    summaries: count(QUO_SUMMARIES),
    api_key_set: !!str_(hubProp_(QUO_API_KEY_PROP)),
    webhook_secret_set: !!str_(hubProp_(QUO_WEBHOOK_SECRET_PROP)),
    signature_checked: false,
    note: 'Point the Quo webhook at this deployment\'s /exec. The signature ' +
          'cannot be checked from Apps Script — the headers are not passed to ' +
          'a web app — so the next move is the same door on the relay.'
  } };
};

HUB_POLICY.quoLines = {
  file: 'Quo.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: []
};
/** The lines this company owns, asked of Quo directly: proof the key works and the platform can collect with no one else in the middle. */
HUB_ACTIONS.quoLines = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var key = str_(hubProp_(QUO_API_KEY_PROP));
  if (!key) return { status: 503, message: 'OPENPHONE_API_KEY is not set.' };
  var r;
  try {
    r = UrlFetchApp.fetch(QUO_API_BASE + '/phone-numbers', {
      method: 'get', headers: { Authorization: key }, muteHttpExceptions: true
    });
  } catch (e) { return { status: 502, message: 'Quo did not answer: ' + String((e && e.message) || e) }; }
  if (r.getResponseCode() !== 200) {
    return { status: 502, message: 'Quo answered ' + r.getResponseCode() + '.' };
  }
  var got = {};
  try { got = JSON.parse(r.getContentText() || '{}'); } catch (eJ) { got = {}; }
  var lines = (got.data || []).map(function (p) {
    return { id: str_(p.id), number: str_(p.number), name: str_(p.name),
             users: (p.users || []).length };
  });
  return { status: 200, data: { lines: lines } };
};
