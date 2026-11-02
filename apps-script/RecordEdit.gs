// The guards every record edit door shares.
// One payload, { key, changes: [{ field, value, expected }] }, answered { written: [field], refused: [{ field, why…

var HUB_EDIT_MAX_CHANGES = 40;

function hubEditText_(v) {
  return v == null || typeof v === 'object' ? '' : String(v);
}

/** The payload's changes as { changes: [{ field, value, expected }] }, or { refused } (400): each field named once. */
function hubEditChanges_(payload) {
  var list = payload && payload.changes;
  if (!Array.isArray(list) || !list.length) {
    return { refused: { status: 400, message: 'changes: one or more { field, value, expected }.' } };
  }
  if (list.length > HUB_EDIT_MAX_CHANGES) {
    return { refused: { status: 400, message: 'changes: at most ' + HUB_EDIT_MAX_CHANGES + ' fields at once.' } };
  }
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i] || {};
    var field = hubEditText_(c.field).trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(field)) return { refused: { status: 400, message: 'changes: a field name is malformed.' } };
    if (seen[field]) return { refused: { status: 400, message: 'changes: "' + field + '" is named twice.' } };
    seen[field] = true;
    out.push({ field: field, value: hubEditText_(c.value).trim(), expected: hubEditText_(c.expected) });
  }
  return { changes: out };
}

/** null while the record still holds `expected`; else the 409 carrying what it holds now. */
function hubEditWitness_(field, expected, current) {
  var now = hubEditText_(current);
  if (hubEditText_(expected) === now) return null;
  return { status: 409, message: 'Changed since it was opened — reloaded, nothing was written.',
           data: { field: field, current: now } };
}

// A record's `cleared_fields` marker as { column: true }: the columns its own store blanked on purpose, so a reader…
function hubEditCleared_(cell) {
  var out = {};
  hubEditText_(cell).split(',').forEach(function (c) {
    c = c.trim();
    if (/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(c)) out[c] = true;
  });
  return out;
}

/** The marker after a write of `fields` (column → value): a blank column joins it, a filled one leaves it. */
function hubEditClearedNext_(cell, fields) {
  var now = hubEditCleared_(cell);
  Object.keys(fields || {}).forEach(function (c) {
    if (hubEditText_(fields[c]).trim()) delete now[c];
    else if (/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(c)) now[c] = true;
  });
  return Object.keys(now).sort().join(',');
}

function hubEditShort_(v) {
  var s = hubEditText_(v).replace(/\s+/g, ' ').trim();
  return '"' + (s.length > 40 ? s.slice(0, 40) + '…' : s) + '"';
}

// One audit line per edit: the record key and the field names written.
function hubEditLog_(user, action, key, written, plain) {
  var allow = {};
  (plain || []).forEach(function (f) { allow[f] = true; });
  var parts = (written || []).map(function (w) {
    return allow[w.field] ? w.field + ' ' + hubEditShort_(w.before) + ' → ' + hubEditShort_(w.after) : w.field;
  });
  hubSysLog_(hubEditText_(user && user.email), action, hubEditText_(key) + ': ' + parts.join(', '), { status: 200 });
  return parts.join(', ');
}
