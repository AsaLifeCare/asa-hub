// Own tab, not `events`: that one is windowed to 500 rows and re-read by the bundle every cycle.

var ASSET_EVENTS_TAB = 'asset_events';
var ASSET_EVENTS_HEADER = ['event_id', 'type', 'actor', 'subject_type',
                           'subject_key', 'subject_name', 'asset_id',
                           'payload', 'source', 'at', 'tenant'];
var ASSET_EVENTS_PAYLOAD_MAX = 2000;

function assetEventsSheet_() {
  var sheet = ensureTab_(ASSET_EVENTS_TAB, ASSET_EVENTS_HEADER);
  ensureHeader_(sheet, ASSET_EVENTS_HEADER);
  return sheet;
}

// Best-effort and append-only; `type` names what completed, never what was attempted.
function assetEvent_(type, assetId, subject, payload, source) {
  try {
    var id = 'ase_' + randomHex_(12);
    var body = '';
    try { body = JSON.stringify(payload || {}); } catch (eJ) { body = '{}'; }
    if (body.length > ASSET_EVENTS_PAYLOAD_MAX) body = body.slice(0, ASSET_EVENTS_PAYLOAD_MAX);
    var sub = subject || {};
    var where = '';
    try { where = tenantStamp_(); } catch (eT) { where = ''; }
    assetEventsSheet_().appendRow([
      id, str_(type), str_(sub.actor || ''),
      str_(sub.type || ''), str_(sub.key || ''), str_(sub.name || ''),
      str_(assetId), body, str_(source || ''),
      new Date().toISOString(), where
    ]);
    return id;
  } catch (e) {
    return '';
  }
}

function assetEventsOf_(assetId) {
  var want = String(assetId || '').trim();
  if (!want) return [];
  var out = [];
  try {
    var values = assetEventsSheet_().getDataRange().getValues();
    if (values.length < 2) return [];
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var at = hdr.indexOf('asset_id');
    if (at === -1) return [];
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][at] || '').trim() !== want) continue;
      var row = {};
      for (var c = 0; c < hdr.length; c++) row[hdr[c]] = values[r][c];
      out.push(row);
    }
  } catch (e) { return []; }
  return out;
}
