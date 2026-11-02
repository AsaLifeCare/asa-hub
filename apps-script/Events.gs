// Append-only (never update or delete a row) and read only through the newest window.

var EVENTS_TAB = 'events';
var EVENTS_HEADER = ['event_id', 'type', 'actor', 'subject_type', 'subject_key',
                     'subject_name', 'payload', 'source', 'at', 'tenant'];
var EVENTS_READ_WINDOW = 500;
var EVENTS_PAYLOAD_MAX = 2000;

function eventsSheet_() {
  var sheet = ensureTab_(EVENTS_TAB, EVENTS_HEADER);
  ensureHeader_(sheet, EVENTS_HEADER);
  return sheet;
}

// Best-effort: a failed event must never break the lane it describes.
function eventAppend_(type, subject, payload, source) {
  try {
    var id = 'evt_' + randomHex_(12);
    var body = '';
    try { body = JSON.stringify(payload || {}); } catch (eJ) { body = '{}'; }
    if (body.length > EVENTS_PAYLOAD_MAX) body = body.slice(0, EVENTS_PAYLOAD_MAX);
    var sub = subject || {};
    var where = '';
    try { where = tenantStamp_(); } catch (eT) { where = ''; }
    var row = [
      id, str_(type), str_(sub.actor || ''),
      str_(sub.type || ''), str_(sub.key || ''), str_(sub.name || ''),
      body, str_(source || ''), new Date().toISOString(), where
    ];
    // Inside a batch the row waits for the HUB_LOG_DEFER flush, which also bumps the cache.
    if (typeof HUB_LOG_DEFER !== 'undefined' && HUB_LOG_DEFER) {
      HUB_LOG_DEFER.events.push(row);
      return id;
    }
    eventsSheet_().appendRow(row);
    // `events` is a routed resource carried in the bundle: every write must bump its cache.
    try { cacheBump_(cacheScope_(EVENTS_TAB)); } catch (eB) {}
    return id;
  } catch (e) {
    return '';
  }
}

// `cursor` is the event_id of the oldest event already seen; the next page continues below it.
function eventList_(filters, cursor) {
  filters = filters || {};
  var limit = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  var sheet = eventsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return { events: [], next_cursor: '' };

  var sinceMs = filters.since ? new Date(String(filters.since)).getTime() : 0;
  if (isNaN(sinceMs)) sinceMs = 0;
  var type = str_(filters.type).toLowerCase();
  var subjectKey = str_(filters.subject_key).toLowerCase();
  var actor = str_(filters.actor).toLowerCase();

  var windowStart = Math.max(2, last - EVENTS_READ_WINDOW + 1);
  var values = sheet.getRange(windowStart, 1, last - windowStart + 1, EVENTS_HEADER.length).getValues();
  var out = [], seenCursor = !cursor;
  for (var r = values.length - 1; r >= 0 && out.length < limit; r--) {
    var row = values[r];
    var id = str_(row[0]);
    if (!seenCursor) {
      if (id === str_(cursor)) seenCursor = true;
      continue;
    }
    var at = str_(row[8]);
    var atMs = at ? new Date(at).getTime() : 0;
    if (sinceMs && atMs < sinceMs) continue;
    if (type && str_(row[1]).toLowerCase() !== type) continue;
    if (subjectKey && str_(row[4]).toLowerCase() !== subjectKey) continue;
    if (actor && str_(row[2]).toLowerCase().indexOf(actor) === -1) continue;
    var payload = {};
    try { payload = JSON.parse(str_(row[6]) || '{}'); } catch (eJ) { payload = {}; }
    out.push({
      event_id: id, type: str_(row[1]), actor: str_(row[2]),
      subject_type: str_(row[3]), subject_key: str_(row[4]),
      subject_name: str_(row[5]), payload: payload,
      source: str_(row[7]), at: at, tenant: str_(row[9])
    });
  }
  return {
    events: out,
    next_cursor: out.length ? out[out.length - 1].event_id : '',
    window: EVENTS_READ_WINDOW
  };
}

/** The event log, newest first, one page at a time, filtered by type, subject or date. */
HUB_POLICY.eventsList = {
  file: 'Events.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.eventsList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  return { status: 200, data: eventList_(payload || {}, str_(payload && payload.cursor)) };
};
