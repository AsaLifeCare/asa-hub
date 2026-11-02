// Never reads message, document or client-name content, and never ranks one person against another.
var BEHAVIOR_SIGNALS_TAB = 'behavior_signals';
var BEHAVIOR_READINGS_TAB = 'behavior_readings';

// Must match tools/mint_behavior_houses.py; used only when a tab has to be created.
var BEHAVIOR_SIGNALS_HEADER = ['id', 'createdAt', 'updatedAt',
  'subject_kind', 'subject_key', 'subject_name',
  'signal', 'value', 'unit', 'detail',
  'at', 'window', 'source', 'tenant', 'payload'];

var BEHAVIOR_READINGS_HEADER = ['id', 'createdAt', 'updatedAt',
  'subject_kind', 'subject_key', 'subject_name', 'role',
  'window_days', 'computed_at', 'signals_hash',
  'metrics', 'top_apps', 'franchises',
  'site_verdict', 'site_why', 'shift_verdict', 'shift_why', 'reach_verdict',
  'reading', 'highlights', 'tags', 'ai_model', 'ai_via', 'ai_at',
  'cortex_note', 'cortex_at', 'sources'];

var BEHAVIOR_AI_REQUEST = 'ai_behavior_reading';

var BEHAVIOR_INGEST_CAP = 900;
var BEHAVIOR_EVALUATE_CAP = 6;

var BEHAVIOR_SWEEP_STAMP = 'BEHAVIOR_SWEEP_AT';
var BEHAVIOR_SWEEP_HOURS = 6;

// Fallback only: the live prompt is the `Prompts` tab cell under this key.
var BEHAVIOR_PROMPT_FLOOR = [
  'You are reading how one person uses an internal care-agency platform, to',
  'help their manager notice STRAIN and support them. This is a wellbeing',
  'reading, never a performance score and never a disciplinary note.',
  '',
  'You are given only counted facts. Rules, all of them absolute:',
  '- Use ONLY the facts given. Never invent a number, a habit or a cause.',
  '- Never compare this person to anybody else, and never rank them.',
  '- "quiet" means the platform recorded little — say that plainly; it is not',
  '  a criticism and it may simply mean their work happens off the platform.',
  '- Nights, weekends and long unbroken runs are worth naming kindly, as',
  '  something a manager might ask about, never as an accusation.',
  '- If the facts are too thin to say anything, say exactly that.',
  '- Write about what the person DOES, never about what they are.',
  '- Courses and requirements describe PAPER, not character. An expired',
  '  certificate means a renewal date passed — say it as something to book,',
  '  never as neglect, risk or a reason to doubt anyone. Never suggest',
  '  removing someone from work, and never treat a missing record as proof',
  '  the training did not happen; our filing is incomplete, not the person.',
  '- What somebody was trained to do is context for their rhythm: it may',
  '  explain which apps they live in. Use it that way.',
  '',
  'Answer with JSON only, no prose outside it:',
  '{"reading":"two or three sentences, plain English, addressed to a manager",',
  ' "highlights":["at most 3 short factual observations"],',
  ' "tags":["at most 4 one-or-two-word tags, lowercase"]}',
  '',
  'THE FACTS:',
  '{facts}'
].join('\n');

// Pure half: no sheet, no clock (self-tested).
function behaviorStr_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function behaviorJson_(raw, fallback) {
  var s = behaviorStr_(raw);
  if (!s) return fallback;
  try {
    var v = JSON.parse(s);
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) { return fallback; }
}

// The only thing the model is shown: no id, e-mail, client name or message text ever enters.
function behaviorFactsBlock_(person, signals) {
  var by = {};
  (signals || []).forEach(function (s) {
    var name = behaviorStr_(s.signal);
    if (name) by[name] = s;
  });
  var val = function (k) { return by[k] ? behaviorStr_(by[k].value) : ''; };
  var why = function (k) { return by[k] ? behaviorStr_(by[k].detail) : ''; };
  var lines = [];
  lines.push('Person: ' + behaviorStr_(person.name || 'unnamed') +
             (person.role ? ' (' + behaviorStr_(person.role) + ')' : '') +
             (person.title ? ' — ' + behaviorStr_(person.title) : ''));
  lines.push('Window: the last ' + behaviorStr_(person.window_days || 30) + ' days.');

  if (val('site.actions')) {
    lines.push('On the platform: ' + val('site.actions') + ' recorded actions across ' +
               val('site.active_days') + ' day(s); ' + (val('site.night_actions') || '0') +
               ' between 10pm and 5am; ' + (val('site.weekend_actions') || '0') + ' at weekends; ' +
               'longest unbroken run ' + (val('site.longest_run') || '0') + ' day(s).');
  } else {
    lines.push('On the platform: nothing was recorded for this account in the window.');
  }
  var apps = [];
  Object.keys(by).forEach(function (k) {
    if (k.indexOf('app.') === 0) apps.push({ app: k.slice(4), n: Number(by[k].value) || 0 });
  });
  apps.sort(function (a, b) { return b.n - a.n; });
  if (apps.length) {
    lines.push('Where that work happened: ' + apps.slice(0, 5).map(function (a) {
      return a.app + ' (' + a.n + ')';
    }).join(', ') + '.');
  }
  if (val('habit.forms')) lines.push('Forms: ' + val('habit.forms') + ' form action(s) — they do work with forms.');
  else lines.push('Forms: no form work recorded in the window.');
  if (val('habit.images')) lines.push('Client images: ' + val('habit.images') + ' action(s) in the wellbeing/image lane.');
  else lines.push('Client images: none recorded in the window.');

  if (val('shift.count')) {
    lines.push('On the roster: ' + val('shift.count') + ' shift(s) over ' + val('shift.days') +
               ' day(s), ' + (val('shift.overnights') || '0') + ' overnight(s), longest run ' +
               (val('shift.longest_run') || '0') + ' day(s) on.');
  } else {
    lines.push('On the roster: no shift in the window.');
  }
  if (val('reach.verdict')) lines.push('Where they may stand: ' + (why('reach.verdict') || val('reach.verdict')) + '.');

  // Courses are named in full, not counted: a reading can build a sentence on a name.
  if (val('training.completed')) {
    lines.push('Courses completed: ' + (why('training.completed') || val('training.completed')) + '.');
    if (val('training.valid')) lines.push('Still in date: ' + why('training.valid') + '.');
    if (val('training.expiring')) lines.push('Renewal due within 60 days: ' + why('training.expiring') + '.');
    if (val('training.expired')) lines.push('Past its date: ' + why('training.expired') + '.');
  } else {
    lines.push('Courses completed: the estate holds no course record for this person.');
  }
  if (val('ist.done')) {
    lines.push('Client-specific training: ' + val('ist.done') + ' record(s) signed off' +
               (why('ist.done') ? ' across ' + why('ist.done') : '') +
               (val('ist.owed') ? '; ' + val('ist.owed') + ' still owed' : '') + '.');
  }
  if (val('req.ok') || val('req.missing') || val('req.expired')) {
    lines.push('Onboarding requirements: ' + (val('req.ok') || '0') + ' met, ' +
               (val('req.missing') || '0') + ' not yet on file, ' +
               (val('req.expiring') || '0') + ' expiring, ' +
               (val('req.expired') || '0') + ' expired.');
  }

  var sv = val('site.verdict'), hv = val('shift.verdict');
  if (sv) lines.push('The platform\'s own verdict on their rhythm here: ' + sv + ' — ' + why('site.verdict') + '.');
  if (hv) lines.push('And on their roster rhythm: ' + hv + ' — ' + why('shift.verdict') + '.');
  return lines.join('\n');
}

// The reading is re-bought only when this moves, so a page view never costs a completion.
function behaviorHash_(factsBlock) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(factsBlock || ''),
                                    Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < raw.length && out.length < 16; i++) {
    var b = raw[i] < 0 ? raw[i] + 256 : raw[i];
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

// A missing field stays missing, never a placeholder that could pass for a reading.
function behaviorParse_(content) {
  var parsed = null;
  try { parsed = JSON.parse(behaviorStr_(content)); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return null;
  var reading = behaviorStr_(parsed.reading).slice(0, 1200);
  if (!reading) return null;
  var list = function (v, cap, len) {
    return (Array.isArray(v) ? v : []).map(function (x) { return behaviorStr_(x).slice(0, len); })
      .filter(String).slice(0, cap);
  };
  return { reading: reading, highlights: list(parsed.highlights, 3, 160), tags: list(parsed.tags, 4, 24) };
}

// Sheet half

function behaviorSignalsSheet_() { return hubTabEnsure_(BEHAVIOR_SIGNALS_TAB, BEHAVIOR_SIGNALS_HEADER); }
function behaviorReadingsSheet_() { return hubTabEnsure_(BEHAVIOR_READINGS_TAB, BEHAVIOR_READINGS_HEADER); }

function behaviorRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { header: values[0] || [], rows: [], values: values };
  var header = values[0].map(String);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r], empty = true;
    for (var c = 0; c < line.length; c++) { if (line[c] !== '' && line[c] !== null) { empty = false; break; } }
    if (empty) continue;
    var obj = { _row: r };
    for (var h = 0; h < header.length; h++) { if (header[h] !== '') obj[header[h]] = line[h]; }
    rows.push(obj);
  }
  return { header: header, rows: rows, values: values };
}

// Upsert by id, never delete: a stale observation is answered by a newer one.
function behaviorUpsert_(sheet, incoming, header, values) {
  var col = {};
  for (var h = 0; h < header.length; h++) col[String(header[h])] = h;
  if (col.id === undefined) return { error: 'the house lacks an "id" column' };
  var at = {}, out = { updated: 0, inserted: 0, unchanged: 0, appended: [] };
  for (var r = 1; r < values.length; r++) {
    var id0 = behaviorStr_(values[r][col.id]);
    if (id0 && at[id0] === undefined) at[id0] = r;
  }
  var now = new Date().toISOString();
  var changed = {};
  incoming.forEach(function (item) {
    var id = behaviorStr_(item.id);
    if (!id) return;
    var row = at[id];
    if (row === undefined) {
      var line = header.map(function () { return ''; });
      line[col.id] = id;
      if (col.createdAt !== undefined) line[col.createdAt] = now;
      if (col.updatedAt !== undefined) line[col.updatedAt] = now;
      Object.keys(item).forEach(function (k) {
        if (k === 'id' || col[k] === undefined) return;
        line[col[k]] = item[k];
      });
      out.appended.push(line);
      out.inserted++;
      return;
    }
    var cur = values[row], touched = false;
    Object.keys(item).forEach(function (k) {
      if (k === 'id' || k === 'createdAt' || col[k] === undefined) return;
      var v = item[k] === null || item[k] === undefined ? '' : item[k];
      if (behaviorStr_(cur[col[k]]) !== behaviorStr_(v)) { cur[col[k]] = v; touched = true; }
    });
    if (touched) {
      if (col.updatedAt !== undefined) cur[col.updatedAt] = now;
      changed[row] = true;
      out.updated++;
    } else out.unchanged++;
  });
  var idxs = Object.keys(changed).map(Number).sort(function (a, b) { return a - b; });
  out.writes = 0;
  for (var i = 0; i < idxs.length;) {
    var start = idxs[i], end = start;
    while (i + 1 < idxs.length && idxs[i + 1] === end + 1) { i++; end = idxs[i]; }
    i++;
    var block = [];
    for (var rr = start; rr <= end; rr++) block.push(values[rr].slice(0, header.length));
    sheet.getRange(start + 1, 1, block.length, header.length).setValues(block);
    out.writes++;
  }
  if (out.appended.length) {
    bulkAppendRows_(sheet, out.appended, header.length);
    out.writes++;
  }
  return out;
}

function behaviorSignalsFor_(subjectKey) {
  var read;
  try { read = behaviorRows_(behaviorSignalsSheet_()); }
  catch (e) { return []; }
  var key = behaviorStr_(subjectKey);
  return read.rows.filter(function (r) { return behaviorStr_(r.subject_key) === key; })
    .map(function (r) {
      return { signal: behaviorStr_(r.signal), value: behaviorStr_(r.value),
               unit: behaviorStr_(r.unit), detail: behaviorStr_(r.detail),
               at: behaviorStr_(r.at), window: behaviorStr_(r.window),
               source: behaviorStr_(r.source), subject_name: behaviorStr_(r.subject_name),
               subject_kind: behaviorStr_(r.subject_kind) };
    });
}

function behaviorReadingFor_(subjectKey) {
  var read;
  try { read = behaviorRows_(behaviorReadingsSheet_()); }
  catch (e) { return null; }
  var key = behaviorStr_(subjectKey), found = null;
  read.rows.forEach(function (r) { if (behaviorStr_(r.subject_key) === key) found = r; });
  if (!found) return null;
  return {
    subject_key: key,
    subject_name: behaviorStr_(found.subject_name),
    role: behaviorStr_(found.role),
    window_days: behaviorStr_(found.window_days),
    computed_at: behaviorStr_(found.computed_at),
    signals_hash: behaviorStr_(found.signals_hash),
    metrics: behaviorJson_(found.metrics, {}),
    top_apps: behaviorJson_(found.top_apps, []),
    franchises: behaviorJson_(found.franchises, []),
    site_verdict: behaviorStr_(found.site_verdict), site_why: behaviorStr_(found.site_why),
    shift_verdict: behaviorStr_(found.shift_verdict), shift_why: behaviorStr_(found.shift_why),
    reach_verdict: behaviorStr_(found.reach_verdict),
    reading: behaviorStr_(found.reading),
    highlights: behaviorJson_(found.highlights, []),
    tags: behaviorJson_(found.tags, []),
    ai_model: behaviorStr_(found.ai_model), ai_via: behaviorStr_(found.ai_via),
    ai_at: behaviorStr_(found.ai_at),
    cortex_note: behaviorStr_(found.cortex_note),
    cortex_at: behaviorStr_(found.cortex_at),
    sources: behaviorJson_(found.sources, [])
  };
}

// A dead model ladder returns the last paragraph with a note, never nothing and never an invention.
function behaviorCompose_(person, opts) {
  opts = opts || {};
  var signals = behaviorSignalsFor_(person.subject_key);
  if (!signals.length) {
    return { status: 200, data: { subject_key: person.subject_key, state: 'no-signals',
                                  message: 'Nothing has been measured for this person yet.' } };
  }
  var facts = behaviorFactsBlock_(person, signals);
  var hash = behaviorHash_(facts);
  var stored = behaviorReadingFor_(person.subject_key);
  if (stored && stored.signals_hash === hash && !opts.refresh) {
    stored.state = 'stored';
    return { status: 200, data: stored };
  }

  var template = '';
  try { template = bookText_('Prompts', BEHAVIOR_AI_REQUEST, BEHAVIOR_PROMPT_FLOOR); }
  catch (eP) { template = BEHAVIOR_PROMPT_FLOOR; }
  if (!template) template = BEHAVIOR_PROMPT_FLOOR;
  var ask = template.split('{facts}').join(facts);
  var chat = screenAiChat_(ask, 0.2, BEHAVIOR_AI_REQUEST);
  var parsed = (chat && chat.ok) ? behaviorParse_(chat.content) : null;
  if (!parsed) {
    if (stored && stored.reading) {
      stored.state = 'stale';
      stored.note = 'The model could not be reached (' +
        behaviorStr_((chat && chat.error) || 'no answer') + ') — this is the last reading.';
      return { status: 200, data: stored };
    }
    return { status: 200, data: { subject_key: person.subject_key, state: 'unread',
                                  message: 'The model could not be reached (' +
                                    behaviorStr_((chat && chat.error) || 'no answer') +
                                    ') — the measured facts stand on their own.' } };
  }

  var now = new Date().toISOString();
  var row = {
    id: 'BHR_' + behaviorStr_(person.subject_key),
    subject_kind: behaviorStr_(person.subject_kind || 'person'),
    subject_key: behaviorStr_(person.subject_key),
    subject_name: behaviorStr_(person.name),
    role: behaviorStr_(person.role),
    window_days: behaviorStr_(person.window_days || 30),
    computed_at: now,
    signals_hash: hash,
    metrics: JSON.stringify(person.metrics || {}),
    top_apps: JSON.stringify(person.top_apps || []),
    franchises: JSON.stringify(person.franchises || []),
    site_verdict: behaviorStr_(person.site_verdict), site_why: behaviorStr_(person.site_why),
    shift_verdict: behaviorStr_(person.shift_verdict), shift_why: behaviorStr_(person.shift_why),
    reach_verdict: behaviorStr_(person.reach_verdict),
    reading: parsed.reading,
    highlights: JSON.stringify(parsed.highlights),
    tags: JSON.stringify(parsed.tags),
    ai_model: behaviorStr_(chat.model || ''), ai_via: behaviorStr_(chat.via || ''), ai_at: now,
    // Kept across a recompose; only the cortex button replaces it.
    cortex_note: behaviorStr_(stored ? stored.cortex_note : ''),
    cortex_at: behaviorStr_(stored ? stored.cortex_at : ''),
    sources: JSON.stringify(['behavior_signals'])
  };
  var sheet = behaviorReadingsSheet_();
  var read = behaviorRows_(sheet);
  behaviorUpsert_(sheet, [row], read.header, read.values);
  var out = behaviorReadingFor_(person.subject_key) || row;
  out.state = 'fresh';
  return { status: 200, data: out };
}

// Badges come from `behavior_all_badges` config; an empty row means the master alone, never everyone.
function behaviorSeesAll_(user) {
  if (!user || user.is_service) return false;
  try {
    return hubGrantedFeatureOn_('behavior_all_badges', user.types, str_(user.email), user.role);
  } catch (e) { return str_(user.role) === 'admin'; }
}

function behaviorMayRead_(user) {
  return !!user && !user.is_service && !!str_(user.id);
}

// Narrows silently to the caller: a refusal would reveal that the other person exists.
function behaviorSubjectFor_(user, wanted) {
  var own = str_(user && user.id);
  if (!behaviorSeesAll_(user)) return own;
  var asked = behaviorStr_(wanted);
  return asked || own;
}

// Must stay named in SERVICE_SWEEP_ACTIONS or the relay's machine write is refused.
HUB_POLICY.behaviorSignalsIngest = {
  file: 'Behavior.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { rows: { required: true, type: 'array' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.behaviorSignalsIngest = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || str_(user.role) !== 'admin')) return hubDenied_();
  // GATED (gate_behavior_signals_ingest, SmartGate.gs).
  var behaviorGate = (typeof hubIngestGate_ === 'function')
    ? hubIngestGate_('gate_behavior_signals_ingest',
                     { subject: 'the behaviour signals feed',
                       body: 'behaviour signals written into the live house' })
    : null;
  if (behaviorGate) return behaviorGate;
  var rows = payload && payload.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { status: 400, message: 'No rows — nothing was written.' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'The signal ingest is already running.' };
  try {
    var clean = [], seen = {};
    for (var i = 0; i < rows.length && clean.length < BEHAVIOR_INGEST_CAP; i++) {
      var r = rows[i] || {};
      var id = behaviorStr_(r.id), key = behaviorStr_(r.subject_key), sig = behaviorStr_(r.signal);
      if (!id || !key || !sig || seen[id]) continue;
      seen[id] = true;
      clean.push({
        id: id.slice(0, 40),
        subject_kind: behaviorStr_(r.subject_kind).slice(0, 24) || 'person',
        subject_key: key.slice(0, 60),
        subject_name: behaviorStr_(r.subject_name).slice(0, 80),
        signal: sig.slice(0, 60),
        value: behaviorStr_(r.value).slice(0, 200),
        unit: behaviorStr_(r.unit).slice(0, 24),
        detail: behaviorStr_(r.detail).slice(0, 400),
        at: behaviorStr_(r.at).slice(0, 40),
        window: behaviorStr_(r.window).slice(0, 24),
        source: behaviorStr_(r.source).slice(0, 60) || (isMachine ? 'relay' : str_(user.email)),
        tenant: behaviorStr_(r.tenant).slice(0, 60),
        payload: behaviorStr_(r.payload).slice(0, 8000)
      });
    }
    if (!clean.length) return { status: 400, message: 'No usable row — each needs id, subject_key and signal.' };
    var sheet = behaviorSignalsSheet_();
    var read = behaviorRows_(sheet);
    var res = behaviorUpsert_(sheet, clean, read.header, read.values);
    if (res.error) return { status: 400, message: res.error };
    try { cacheBump_(cacheScope_(BEHAVIOR_SIGNALS_TAB)); } catch (eB) {}
    if (res.updated || res.inserted) {
      try {
        hubSysLog_(isMachine ? 'asa-hub:behavior' : str_(user.email), 'behavior_signals_ingest',
                   res.inserted + ' signal(s) added, ' + res.updated + ' refreshed, ' +
                   res.unchanged + ' unchanged — ' + res.writes + ' write(s)', { status: 200 });
      } catch (eL) {}
    }
    return { status: 200, data: { inserted: res.inserted, updated: res.updated,
                                  unchanged: res.unchanged, writes: res.writes,
                                  received: rows.length, kept: clean.length } };
  } finally {
    lock.releaseLock();
  }
};

/** Every stored reading this caller may see — everybody's for a badged reader, their own alone for everyone else. */
HUB_POLICY.behaviorReadings = {
  file: 'Behavior.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.behaviorReadings = function (payload, user) {
  if (!behaviorMayRead_(user)) return hubDenied_();
  var all = behaviorSeesAll_(user), own = str_(user.id);
  var read;
  try { read = behaviorRows_(behaviorReadingsSheet_()); }
  catch (e) { return { status: 200, data: { readings: [], sees_all: all, note: 'No reading has been composed yet.' } }; }
  var out = read.rows.filter(function (r) {
    return all || behaviorStr_(r.subject_key) === own;
  }).map(function (r) {
    return { subject_key: behaviorStr_(r.subject_key), subject_name: behaviorStr_(r.subject_name),
             computed_at: behaviorStr_(r.computed_at), signals_hash: behaviorStr_(r.signals_hash),
             site_verdict: behaviorStr_(r.site_verdict), shift_verdict: behaviorStr_(r.shift_verdict),
             reading: behaviorStr_(r.reading), tags: behaviorJson_(r.tags, []),
             ai_via: behaviorStr_(r.ai_via), ai_at: behaviorStr_(r.ai_at),
             cortex_note: behaviorStr_(r.cortex_note), cortex_at: behaviorStr_(r.cortex_at) };
  });
  return { status: 200, data: { readings: out, sees_all: all } };
};

// For badged non-admins, who have no slice: a slice file is admin-only because it cannot check a badge.
HUB_POLICY.behaviorBoard = {
  file: 'Behavior.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.behaviorBoard = function (payload, user) {
  if (!behaviorMayRead_(user)) return hubDenied_();
  var all = behaviorSeesAll_(user), own = str_(user.id);
  var read;
  try { read = behaviorRows_(behaviorSignalsSheet_()); }
  catch (e) { return { status: 200, data: { rows: [], sees_all: all, note: 'Nothing has been measured yet.' } }; }
  var rows = [];
  read.rows.forEach(function (r) {
    if (behaviorStr_(r.signal) !== 'profile.snapshot') return;
    var key = behaviorStr_(r.subject_key);
    if (!all && key !== own) return;
    var snap = behaviorJson_(r.payload, null);
    if (!snap || typeof snap !== 'object') return;
    snap.subject_key = key;
    snap.subject_name = behaviorStr_(r.subject_name);
    snap.subject_kind = behaviorStr_(r.subject_kind) || 'person';
    snap.computed_at = behaviorStr_(r.at);
    rows.push(snap);
  });
  return { status: 200, data: { rows: rows, sees_all: all, own: own } };
};

/** One person: every signal the house holds, their stored reading, and what the cortex last said about them. */
HUB_POLICY.behaviorProfile = {
  file: 'Behavior.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.behaviorProfile = function (payload, user) {
  if (!behaviorMayRead_(user)) return hubDenied_();
  var key = behaviorSubjectFor_(user, payload && payload.subject_key);
  if (!key) return { status: 400, message: 'There is no account behind this session.' };
  var signals = behaviorSignalsFor_(key);
  var reading = behaviorReadingFor_(key);
  var snapshot = null;
  for (var i = 0; i < signals.length; i++) {
    if (signals[i].signal === 'profile.snapshot') { snapshot = behaviorJson_(signals[i].payload, null); break; }
  }
  return { status: 200, data: {
    subject_key: key,
    subject_name: (signals[0] && signals[0].subject_name) || (reading && reading.subject_name) || '',
    sees_all: behaviorSeesAll_(user),
    own: str_(user.id),
    snapshot: snapshot,
    signals: signals.filter(function (s) { return s.signal !== 'profile.snapshot'; }),
    reading: reading
  } };
};

// A slow tool: a button and a sweep, never a page load.
HUB_POLICY.behaviorEvaluate = {
  file: 'Behavior.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.behaviorEvaluate = function (payload, user) {
  if (!behaviorMayRead_(user)) return hubDenied_();
  var key = behaviorSubjectFor_(user, payload && payload.subject_key);
  if (!key) return { status: 400, message: 'There is no account behind this session.' };
  var person = {
    subject_key: key,
    subject_kind: behaviorStr_(payload.subject_kind) || 'person',
    name: behaviorStr_(payload.subject_name),
    role: behaviorStr_(payload.role),
    title: behaviorStr_(payload.title),
    window_days: behaviorStr_(payload.window_days) || '30',
    metrics: (payload && payload.metrics) || {},
    top_apps: (payload && payload.top_apps) || [],
    franchises: (payload && payload.franchises) || [],
    site_verdict: behaviorStr_(payload.site_verdict), site_why: behaviorStr_(payload.site_why),
    shift_verdict: behaviorStr_(payload.shift_verdict), shift_why: behaviorStr_(payload.shift_why),
    reach_verdict: behaviorStr_(payload.reach_verdict)
  };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { status: 409, message: 'A reading is already being composed.' };
  try {
    var out = behaviorCompose_(person, { refresh: !!(payload && payload.refresh),
                                         cortex_note: behaviorStr_(payload && payload.cortex_note) });
    try {
      if (out && out.data && out.data.state === 'fresh') {
        hubSysLog_(str_(user.email), 'behavior_reading',
                   'a reading composed for ' + (person.name || key) + ' via ' +
                   behaviorStr_(out.data.ai_via), { status: 200 });
      }
    } catch (eL) {}
    return out;
  } finally {
    lock.releaseLock();
  }
};

/** Keep what the cortex said: the answer is stored on the person's row and shown until the button is pressed again. */
HUB_POLICY.behaviorCortexNote = {
  file: 'Behavior.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.behaviorCortexNote = function (payload, user) {
  if (!behaviorMayRead_(user)) return hubDenied_();
  var key = behaviorSubjectFor_(user, payload && payload.subject_key);
  if (!key) return { status: 400, message: 'There is no account behind this session.' };
  var note = behaviorStr_(payload && payload.note).slice(0, 4000);
  if (!note) return { status: 400, message: 'Nothing to keep.' };
  var now = new Date().toISOString();
  var sheet = behaviorReadingsSheet_();
  var read = behaviorRows_(sheet);
  var row = { id: 'BHR_' + key, cortex_note: note, cortex_at: now };
  var exists = false;
  read.rows.forEach(function (r) { if (behaviorStr_(r.subject_key) === key) exists = true; });
  if (!exists) {
    // Asking the cortex does not require a composed reading, so the row is minted here.
    row.subject_key = key;
    row.subject_kind = behaviorStr_(payload && payload.subject_kind) || 'person';
    row.subject_name = behaviorStr_(payload && payload.subject_name);
  }
  behaviorUpsert_(sheet, [row], read.header, read.values);
  return { status: 200, data: { subject_key: key, saved: true, cortex_at: now } };
};

// Rides the hourly contact clock (contactAutoSweep) behind its own window, a handful per execution.
function behaviorSweepDue_() {
  var last = 0;
  try { last = Number(hubProp_(BEHAVIOR_SWEEP_STAMP) || 0) || 0; } catch (e) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) < BEHAVIOR_SWEEP_HOURS * 3600000) return false;
  try { hubPropSet_(BEHAVIOR_SWEEP_STAMP, String(now)); } catch (eS) {}
  return true;
}

function behaviorSweepMaybe_() {
  if (!behaviorSweepDue_()) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var read;
    try { read = behaviorRows_(behaviorSignalsSheet_()); }
    catch (eR) { return; }
    var order = [], seen = {};
    for (var i = read.rows.length - 1; i >= 0; i--) {
      var key = behaviorStr_(read.rows[i].subject_key);
      if (!key || seen[key]) continue;
      seen[key] = true;
      order.push({ subject_key: key, name: behaviorStr_(read.rows[i].subject_name),
                   subject_kind: behaviorStr_(read.rows[i].subject_kind) || 'person' });
    }
    var made = 0;
    for (var p = 0; p < order.length && made < BEHAVIOR_EVALUATE_CAP; p++) {
      var out;
      try { out = behaviorCompose_(order[p], {}); }
      catch (eC) { continue; }
      if (out && out.data && out.data.state === 'fresh') made++;
    }
    if (made) {
      hubSysLog_('asa-hub:behavior', 'behavior_reading',
                 made + ' reading(s) composed on the clock', { status: 200 });
    }
  } finally {
    lock.releaseLock();
  }
}
