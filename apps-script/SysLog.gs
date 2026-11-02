// A batch holds its log and event rows here and writes them once; null means append now.
var HUB_LOG_DEFER = null;

// A leftover buffer means a killed execution (globals survive warm starts): flush it before replacing.
function hubLogDeferBegin_() {
  if (HUB_LOG_DEFER) { try { hubLogDeferFlush_(); } catch (eStale) { HUB_LOG_DEFER = null; } }
  HUB_LOG_DEFER = { logs: [], events: [] };
  return true;
}

function hubLogDeferFlush_() {
  var held = HUB_LOG_DEFER;
  HUB_LOG_DEFER = null;            // released first: a failing flush must not leave the next write deferred
  if (!held) return { logs: 0, events: 0 };
  var wrote = { logs: 0, events: 0 };
  if (held.logs.length) {
    try {
      var ls = logsSheet_();
      ls.getRange(ls.getLastRow() + 1, 1, held.logs.length, LOGS_HEADER.length)
        .setValues(held.logs);
      wrote.logs = held.logs.length;
    } catch (eL) {}
  }
  if (held.events.length) {
    try {
      var es = eventsSheet_();
      es.getRange(es.getLastRow() + 1, 1, held.events.length, EVENTS_HEADER.length)
        .setValues(held.events);
      wrote.events = held.events.length;
      try { cacheBump_(cacheScope_(EVENTS_TAB)); } catch (eB) {}
    } catch (eE) {}
  }
  return wrote;
}

var LOGS_TAB = 'system_logs';
var LOGS_HEADER = ['timestamp', 'actor', 'action', 'target', 'ok', 'detail',
                   'area', 'outcome', 'summary', 'actor_name',
                   // blank tenant means headquarters
                   'tenant'];

// Matched by prefix, longest wins: `doc_review:verified` beats `doc_review`.
var LOG_VOCAB = [
  { key: 'authLogin', area: 'Access', verb: 'signed in' },
  { key: 'authLogout', area: 'Access', verb: 'signed out' },
  { key: 'authMe', area: 'Access', verb: 'resumed a session' },
  { key: 'login', area: 'Access', verb: 'signed in' },
  { key: 'logout', area: 'Access', verb: 'signed out' },
  { key: 'userCreate', area: 'Settings', verb: 'created a user account' },
  { key: 'people_merge', area: 'People', verb: 'merged duplicate people' },
  { key: 'people_sync_platform', area: 'People', verb: 'refreshed the roster from the platform' },
  { key: 'users_contact_merge_error', area: 'Settings', verb: 'could not merge platform contacts' },
  { key: 'users_contact_merge', area: 'Settings', verb: 'merged platform contacts into accounts' },
  { key: 'behavior_signals_ingest', area: 'People', verb: 'filed behaviour signals' },
  { key: 'behavior_reading', area: 'People', verb: 'composed a behaviour reading' },
  { key: 'lead_read', area: 'Leads', verb: 'read a texted lead' },
  { key: 'userUpdate', area: 'Settings', verb: 'changed a user account' },
  { key: 'userDelete', area: 'Settings', verb: 'removed a user account' },
  { key: 'profileUpdate', area: 'Settings', verb: 'updated their own profile' },
  { key: 'platformMemberAsk', area: 'Access', verb: 'asked to bring in' },
  { key: 'platformMemberAuthorize', area: 'Access', verb: 'was let in by' },
  { key: 'platformMemberRemove', area: 'Access', verb: 'ended the link with' },
  { key: 'platformMemberLeave', area: 'Access', verb: 'left the platform of' },
  { key: 'platformMemberSweep', area: 'Access', verb: 'swept the invitations for' },
  { key: 'myWorldAccessSet', area: 'Access', verb: 'changed who may open their world —' },
  { key: 'doc_upload', area: 'Documents', verb: 'uploaded' },
  { key: 'doc_review:verified', area: 'Documents', verb: 'verified' },
  { key: 'doc_review:returned', area: 'Documents', verb: 'returned' },
  { key: 'doc_review', area: 'Documents', verb: 'reviewed' },
  { key: 'docFeedback', area: 'Library', verb: 'rated a document' },
  { key: 'collectionCreate', area: 'Library', verb: 'created a collection' },
  { key: 'onboarding_window', area: 'Onboarding', verb: 'changed new-hire access for' },
  { key: 'interviewSave', area: 'Hiring', verb: 'recorded an interview scorecard for' },
  { key: 'interviewSetWindow', area: 'Hiring', verb: 'changed interviewer access for' },
  { key: 'hubIntake', area: 'Hiring', verb: 'added a candidate' },
  { key: 'hubMoveStage', area: 'Hiring', verb: 'moved' },
  { key: 'screenSave', area: 'Hiring', verb: 'saved a phone screen for' },
  { key: 'screenAnalyze', area: 'Hiring', verb: 'ran the phone-screen analysis for' },
  { key: 'screenAutoCollect', area: 'Comms', verb: 'collected a screening call' },
  { key: 'screenPullTranscript', area: 'Comms', verb: 'pulled a call transcript for' },
  { key: 'commsSync', area: 'Comms', verb: 'refreshed the phone window' },
  { key: 'resume', area: 'Hiring', verb: 'handled a resume for' },
  { key: 'cjisUpload', area: 'Hiring', verb: 'filed a background report for' },
  { key: 'app_badge_access_set', area: 'Settings', verb: 'changed which badges reach' },
  { key: 'app_shelf_set', area: 'Settings', verb: 'rearranged the workspace sections' },
  { key: 'user_menu_links_set', area: 'Settings', verb: 'set the company menu' },
  { key: 'guardians_to_roster', area: 'People', verb: 'lifted the plans\' guardians onto the roster' }
];

function logVocab_(action) {
  var a = String(action || '');
  var best = null;
  for (var i = 0; i < LOG_VOCAB.length; i++) {
    if (a.indexOf(LOG_VOCAB[i].key) === 0) {
      if (!best || LOG_VOCAB[i].key.length > best.key.length) best = LOG_VOCAB[i];
    }
  }
  if (best) return best;
  // resource.action rows from the generic router (people.update)
  if (a.indexOf('.') > 0) {
    var parts = a.split('.');
    return { area: 'Data', verb: parts[1] + ' ' + parts[0] };
  }
  return { area: 'Other', verb: a || 'did something' };
}

var LOG_NAME_CACHE = null;

function logCandidateName_(cid) {
  try {
    if (!LOG_NAME_CACHE) {
      LOG_NAME_CACHE = {};
      var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
      for (var i = 0; i < rows.length; i++) {
        LOG_NAME_CACHE[str_(rows[i].candidateid)] = str_(rows[i].candidatename);
      }
    }
    return LOG_NAME_CACHE[cid] || cid;
  } catch (e) {
    return cid;
  }
}

function logDocLabel_(docId) {
  try {
    var cat = filesCatalog_();
    for (var i = 0; i < cat.length; i++) if (cat[i].doc_id === docId) return cat[i].label;
  } catch (e) {}
  return String(docId).replace(/_/g, ' ');
}

function logFriendlyTarget_(target) {
  var t = String(target || '').trim();
  if (!t) return '';
  var pair = t.match(/^(CAN_[A-Z0-9]+)\s*:\s*([a-z0-9_]+)$/);
  if (pair) return 'the ' + logDocLabel_(pair[2]) + ' for ' + logCandidateName_(pair[1]);
  var cand = t.match(/^(CAN_[A-Z0-9]+)/);
  if (cand) return t.replace(cand[1], logCandidateName_(cand[1]));
  if (/^mem_/.test(t)) return logMemberPair_(t);
  return t;
}

var LOG_MEMBER_CACHE = null;
function logMemberPair_(mid) {
  try {
    if (!LOG_MEMBER_CACHE) {
      LOG_MEMBER_CACHE = {};
      var names = {};
      var users = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB);
      for (var u = 0; u < users.length; u++) {
        names[str_(users[u].userid)] = str_(users[u].displayname) || str_(users[u].email);
      }
      var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), PLATFORM_MEMBERS_TAB);
      for (var i = 0; i < rows.length; i++) {
        var member = names[str_(rows[i].memberuserid)] || str_(rows[i].memberemail);
        var owner = names[str_(rows[i].owneruserid)] || '';
        LOG_MEMBER_CACHE[str_(rows[i].memberid)] =
          member ? (member + (owner ? ", on " + owner + "'s platform" : '')) : '';
      }
    }
    return LOG_MEMBER_CACHE[mid] || mid;
  } catch (e) {
    return mid;
  }
}

function logActorName_(actor) {
  var email = String(actor || '').replace(/^asa-hub:/, '');
  if (!email) return 'Someone';
  if (email.indexOf('@') === -1) {
    return email === 'system' ? 'The system' : 'An automation (' + email + ')';
  }
  try {
    var u = userByEmail_(email);
    if (u && str_(u.displayname)) return str_(u.displayname);
  } catch (e) {}
  return email;
}

// Not routed through hubTabEnsure_: it would start a second feed in HUB_DB, away from HUB_LOGS_ID.
function logsSheet_() {
  var ss = ssOpen_(hubId_('HUB_LOGS_ID'));
  var sheet = ss.getSheetByName(LOGS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LOGS_TAB);
    sheet.getRange(1, 1, 1, LOGS_HEADER.length).setValues([LOGS_HEADER]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var hdr = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (hdr[0]) {
    var missing = LOGS_HEADER.filter(function (h) { return hdr.indexOf(h) === -1; });
    if (missing.length) sheet.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
  } else {
    sheet.getRange(1, 1, 1, LOGS_HEADER.length).setValues([LOGS_HEADER]);
  }
  return sheet;
}

// `opt.who` names the actor when the actor string is composite and logActorName_ could not read it.
function hubSysLog_(actor, action, target, env, opt) {
  try {
    // Service-identity reads and tools are bookkeeping, not audited acts; its writes still land.
    var laneOf = '';
    try { laneOf = ((typeof HUB_POLICY !== 'undefined' && HUB_POLICY[action]) || {}).lane || ''; }
    catch (eL) { laneOf = ''; }
    if (String(actor || '').indexOf('@service.local') !== -1 &&
        (laneOf === 'read' || laneOf === 'tool')) return;
    // chat's reads run on every beat and every open conversation; its sends, reactions and marks are the acts
    if (action === 'chatPing' || action === 'chatOverview' || action === 'chatMessages') return;
    var whoFixed = opt && opt.who ? String(opt.who) : '';
    // The master's session switch leaves no line: neither its own actions nor anything done inside it.
    if (/^beAnother/.test(String(action || '')) ||
        (typeof beAnotherActive_ === 'function' && beAnotherActive_())) return;
    if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX &&
        typeof HUB_CALLER !== 'undefined' && HUB_CALLER && HUB_CALLER.email) {
      // During a member visit `actor` is the visited person; log the signed-in caller instead.
      actor = String(HUB_CALLER.email) + ' (visiting ' + String(HUB_MEMBER_CTX.email || HUB_MEMBER_CTX.userId || '') + ')';
    }
    var sheet = HUB_LOG_DEFER ? null : logsSheet_();
    var ok = env ? env.status < 400 : true;
    var status = env && env.status ? env.status : (ok ? 200 : 500);
    var outcome = ok ? 'ok' : (status === 401 || status === 403 ? 'denied' : 'failed');
    var detail = env && env.message ? String(env.message).slice(0, 300) : '';
    var v = logVocab_(action);
    var who = whoFixed || logActorName_(actor);
    var what = logFriendlyTarget_(target);
    var summary = who + ' ' + v.verb + (what ? ' ' + what : '');
    if (!ok) summary += outcome === 'denied' ? ' — not allowed' : ' — it failed';
    var where = '';
    try { where = tenantStamp_(); } catch (eT) { where = ''; }
    var row = [new Date().toISOString(), String(actor || ''), String(action || ''),
               String(target || ''), ok ? 'true' : 'false', detail,
               v.area, outcome, summary, who, where];
    if (HUB_LOG_DEFER) HUB_LOG_DEFER.logs.push(row);
    else sheet.appendRow(row);
    // The same fact also lands in the immutable events trail, or the two records diverge.
    if (typeof eventAppend_ === 'function') {
      eventAppend_(String(action || ''), {
        actor: String(actor || ''),
        type: 'action',
        key: String(target || ''),
        name: what
      }, { ok: ok, outcome: outcome, area: v.area, summary: summary, detail: detail },
      'hubSysLog_');
    }
  } catch (err) { /* logging must never break the lane */ }
}

/** The system log feed, newest first. */
HUB_POLICY.logsList = {
  file: 'SysLog.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.logsList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var sheet = logsSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { status: 200, data: { events: [], areas: [], total: 0 } };
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iAt = hdr.indexOf('timestamp'), iActor = hdr.indexOf('actor'), iAction = hdr.indexOf('action');
  var iTarget = hdr.indexOf('target'), iOk = hdr.indexOf('ok'), iDetail = hdr.indexOf('detail');
  var iArea = hdr.indexOf('area'), iOutcome = hdr.indexOf('outcome');
  var iSummary = hdr.indexOf('summary'), iName = hdr.indexOf('actor_name');
  var iTenant = hdr.indexOf('tenant');

  var area = str_(payload && payload.area).toLowerCase();
  var outcome = str_(payload && payload.outcome).toLowerCase();
  var actorQ = str_(payload && payload.actor).toLowerCase();
  var q = str_(payload && payload.q).toLowerCase();
  var since = str_(payload && payload.since);
  var sinceMs = since ? new Date(since).getTime() : 0;
  var limit = Math.min(1000, Math.max(1, parseInt(payload && payload.limit, 10) || 200));

  var events = [], areas = {};
  for (var r = values.length - 1; r >= 1; r--) {
    var row = values[r];
    var at = str_(row[iAt]);
    var rawAction = str_(row[iAction]);
    var v = logVocab_(rawAction);
    var rowArea = (iArea !== -1 && str_(row[iArea])) || v.area;
    var rowOutcome = (iOutcome !== -1 && str_(row[iOutcome])) ||
                     (str_(row[iOk]).toLowerCase() === 'false' ? 'failed' : 'ok');
    // Before the area counts, which would otherwise leak other tenants' activity.
    if (!tenantRowVisible_(iTenant === -1 ? '' : row[iTenant])) continue;
    areas[rowArea] = (areas[rowArea] || 0) + 1;

    if (area && rowArea.toLowerCase() !== area) continue;
    if (outcome && rowOutcome.toLowerCase() !== outcome) continue;
    if (sinceMs && new Date(at).getTime() < sinceMs) continue;
    var actorEmail = str_(row[iActor]);
    if (actorQ && actorEmail.toLowerCase().indexOf(actorQ) === -1) continue;

    var who = (iName !== -1 && str_(row[iName])) || logActorName_(actorEmail);
    var summary = (iSummary !== -1 && str_(row[iSummary])) ||
                  (who + ' ' + v.verb + ' ' + logFriendlyTarget_(str_(row[iTarget]))).trim();
    if (q && summary.toLowerCase().indexOf(q) === -1 && rawAction.toLowerCase().indexOf(q) === -1) continue;

    events.push({
      at: at,
      when: hubWhenLabel_(at),
      actor: actorEmail,
      actor_name: who,
      area: rowArea,
      outcome: rowOutcome,
      summary: summary,
      action: rawAction,
      target: str_(row[iTarget]),
      detail: iDetail === -1 ? '' : str_(row[iDetail])
    });
    if (events.length >= limit) break;
  }
  var areaList = [];
  for (var k in areas) areaList.push({ area: k, count: areas[k] });
  areaList.sort(function (a, b) { return b.count - a.count; });
  return { status: 200, data: { events: events, areas: areaList, total: values.length - 1 } };
};
