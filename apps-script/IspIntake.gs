var ISP_INTAKE_TAB = 'isps';
var ISP_CONTACT_BLOCK_CHARS = 3000;

function ispIntakeFiles_() {
  var out = [];
  var id = hubId_('ISP_DOCS_FOLDER_ID');
  if (!id) return out;
  var folder;
  try { folder = DriveApp.getFolderById(id); } catch (e) { return out; }
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getMimeType()).indexOf('pdf') === -1) continue;
    if (f.isTrashed()) continue;
    out.push({ id: f.getId(), name: f.getName(), at: f.getLastUpdated() });
  }
  out.sort(function (a, b) { return a.at - b.at; });
  return out;
}

/** A file name is not a key: every 3+ letter word must match a filed client's name word for word, never as a substring. */
function ispIntakeNameWords_(text) {
  var words = String(text || '').toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/\bisp'?s?\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .split(/\s+/);
  var out = [];
  for (var i = 0; i < words.length; i++) {
    if (words[i].length >= 3 && out.indexOf(words[i]) === -1) out.push(words[i]);
  }
  return out;
}

function ispIntakeKnown_() {
  var known = { names: [], keys: {}, files: {} };
  try {
    listRows_(ISP_INTAKE_TAB, {}).forEach(function (r) {
      var src = str_(r.source_file);
      if (src) known.files[src] = true;
      var key = str_(r.client_key);
      if (key) known.keys[key] = true;
      var nm = str_(r.client_name);
      if (nm) known.names.push(ispIntakeNameWords_(nm));
    });
  } catch (e) {}
  return known;
}

function ispIntakeIsKnown_(known, fileName) {
  if (known.files[fileName]) return true;
  var want = ispIntakeNameWords_(fileName);
  if (!want.length) return false;
  for (var i = 0; i < known.names.length; i++) {
    var have = known.names[i];
    var all = true;
    for (var j = 0; j < want.length; j++) {
      if (have.indexOf(want[j]) === -1) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

function ispIntakeKey_(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function ispIntakeBullets_(v) {
  if (Object.prototype.toString.call(v) === '[object Array]') {
    var lines = [];
    for (var i = 0; i < v.length; i++) {
      var s = String(v[i] == null ? '' : v[i]).trim();
      if (s) lines.push('• ' + s);
    }
    return lines.join('\n');
  }
  return String(v == null ? '' : v).trim();
}

function ispIntakeContacts_(c) {
  if (!c || typeof c !== 'object') return String(c || '').trim();
  var out = [];
  var order = ['guardian', 'ssa_qidp', 'physician', 'emergency'];
  for (var i = 0; i < order.length; i++) {
    var v = String(c[order[i]] || '').trim();
    if (!v) continue;
    var label = order[i] === 'ssa_qidp' ? 'Case manager'
      : order[i].charAt(0).toUpperCase() + order[i].slice(1);
    out.push(label + ': ' + v);
  }
  return out.join('\n');
}

/** Cut exactly like the existing rows: ispContactsSweep parses this column and needs every row alike. */
function ispIntakeContactBlock_(rawText) {
  var t = String(rawText || '');
  var at = t.indexOf('Contact Information');
  if (at === -1) return '';
  return t.substr(at, ISP_CONTACT_BLOCK_CHARS);
}

/** The relay's /isp/decode is regex-only on purpose: no model guesses at clinical fields. */
function ispIntakeDecode_(file) {
  var blob;
  try { blob = DriveApp.getFileById(file.id).getBlob(); }
  catch (e) { return { status: 502, message: 'the plan could not be opened: ' + String((e && e.message) || e) }; }
  var b64;
  try { b64 = Utilities.base64Encode(blob.getBytes()); }
  catch (e2) { return { status: 500, message: 'the plan could not be encoded' }; }
  return staffRelayPost_('/isp/decode', { pdf_b64: b64 });
}

/** One plan per run (one execution at a time); never overwrites, and a blank section stays blank. */
function ispIntakeOnce_(opts) {
  opts = opts || {};
  var files = ispIntakeFiles_();
  if (!files.length) {
    return { status: 200, data: { filed: '', pending: 0, seen: 0,
             note: 'The plans folder is empty, or its id is not set.' } };
  }
  var known = ispIntakeKnown_();
  var todo = [];
  for (var i = 0; i < files.length; i++) {
    if (opts.only) { if (files[i].name === opts.only) todo.push(files[i]); continue; }
    if (!ispIntakeIsKnown_(known, files[i].name)) todo.push(files[i]);
  }
  if (!todo.length) {
    return { status: 200, data: { filed: '', pending: 0, seen: files.length,
             note: 'Every plan in the folder is already filed.' } };
  }

  var file = todo[0];
  var env = ispIntakeDecode_(file);
  if (!env || env.status !== 200 || !env.data || !env.data.fields) {
    return { status: 502, message: 'The plan could not be read: ' +
             String((env && env.message) || 'no answer from the relay'),
             data: { filed: '', pending: todo.length, seen: files.length } };
  }
  var f = env.data.fields;
  var name = String(f.client_name || '').trim();
  if (!name) {
    return { status: 422, message: 'That plan names nobody — "' + file.name +
             '" was left where it is rather than filed against a blank person.',
             data: { filed: '', pending: todo.length, seen: files.length } };
  }
  var key = ispIntakeKey_(name);
  if (known.keys[key] && !opts.redo) {
    return { status: 409, message: name + ' already has a plan on file. ' +
             'Filing "' + file.name + '" would be a second row for one person — ' +
             'use ispIntakeRedo to replace the one that is there.',
             data: { filed: '', pending: todo.length - 1, seen: files.length } };
  }

  var raw = String(env.data.raw_text || '');
  var record = {
    id: 'ISP_' + key,
    client_key: key,
    client_name: name,
    isp_year: String(f.isp_year || ''),
    allergies: ispIntakeBullets_(f.allergies),
    medications: ispIntakeBullets_(f.medications),
    diet_nutrition: ispIntakeBullets_(f.diet_nutrition),
    safety_risks: ispIntakeBullets_(f.safety_risks),
    supervision_level: String(f.supervision_level || ''),
    behaviors: ispIntakeBullets_(f.behaviors),
    mobility: String(f.mobility || ''),
    personal_care: ispIntakeBullets_(f.personal_care),
    communication: String(f.communication || ''),
    diagnoses: ispIntakeBullets_(f.diagnoses),
    medical_summary: String(f.medical_summary || ''),
    goals_outcomes: ispIntakeBullets_(f.goals_outcomes),
    important_to: ispIntakeBullets_(f.important_to),
    important_for: ispIntakeBullets_(f.important_for),
    contacts: ispIntakeContacts_(f.contacts),
    source_file: file.name,
    page_count: Number(env.data.pages || 0) || '',
    loaded_at: new Date().toISOString(),
    contact_block: ispIntakeContactBlock_(raw)
  };

  var filedIsp = createRow_(ISP_INTAKE_TAB, record);
  if (sheetDbRefused_(filedIsp)) return sheetDbRefused_(filedIsp);
  try {
    hubSysLog_('asa-hub:isp', 'isp_filed',
               name + ' — ' + file.name + ' (' + record.page_count + ' pages)',
               { status: 200 });
  } catch (eL) {}
  // Every new plan also files its sections (routines, important people, supports) for the Clients app.
  var sections = { rows: 0, why: '' };
  try {
    var cut = clientProfileIspSectionsFrom_(key, record.isp_year, raw, file.name);
    if (cut.refused) sections.why = String(cut.refused.message || 'refused');
    else sections.rows = cut.rows;
  } catch (eSec) { sections.why = String((eSec && eSec.message) || eSec).slice(0, 160); }

  return { status: 200, data: {
    filed: name, source_file: file.name, pages: record.page_count,
    pending: todo.length - 1, seen: files.length,
    empty_sections: ispIntakeEmpty_(record),
    sections_filed: sections.rows, sections_why: sections.why
  } };
}

function ispIntakeEmpty_(record) {
  var watch = ['allergies', 'medications', 'diagnoses', 'safety_risks',
               'supervision_level', 'behaviors', 'goals_outcomes'];
  var empty = [];
  for (var i = 0; i < watch.length; i++) {
    if (!String(record[watch[i]] || '').trim()) empty.push(watch[i]);
  }
  return empty;
}

// lane 'tool', not 'write': the quick-write tier queues the body and would file a plan twice File the next plan in…
HUB_POLICY.ispIntakeSweep = {
  file: 'IspIntake.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['isps', 'clients'], emits: []
};
HUB_ACTIONS.ispIntakeSweep = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || str_(user.role) !== 'admin')) return hubDenied_();
  return ispIntakeOnce_({});
};

/** Read one named plan again, even though its person already has a row. */
HUB_POLICY.ispIntakeRedo = {
  file: 'IspIntake.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  params: { source_file: { required: true, type: 'string' } },
  invalidates: ['isps', 'clients'], emits: []
};
HUB_ACTIONS.ispIntakeRedo = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var only = str_(payload && payload.source_file);
  if (!only) return { status: 400, message: 'Which plan? Pass its file name.' };
  return ispIntakeOnce_({ only: only, redo: true });
};

/** How many plans are in the folder, how many the platform knows, and which are still waiting. */
HUB_POLICY.ispIntakeStatus = {
  file: 'IspIntake.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.ispIntakeStatus = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var files = ispIntakeFiles_();
  var known = ispIntakeKnown_();
  var waiting = [];
  for (var i = 0; i < files.length; i++) {
    if (!known[files[i].name]) waiting.push(files[i].name);
  }
  return { status: 200, data: {
    in_folder: files.length,
    filed: files.length - waiting.length,
    waiting: waiting,
    folder_set: !!hubId_('ISP_DOCS_FOLDER_ID')
  } };
};

function runIspIntake() {
  var r = ispIntakeOnce_({});
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
