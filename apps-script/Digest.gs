// ------------------------------------------------------------------ THE DIGESTER — every uploaded file becomes…
// The tracking is the decoder's, and it is never by name.

var DIGEST_PER_PASS = 12;         // ceiling per pass; the budget usually decides first
// THE SWEEP MUST NOT BE THE REASON A PERSON WAITS (measured).
var DIGEST_BUDGET_MS = 180000;
// THE SHEET IS AN INDEX, NOT AN ARCHIVE.
var DIGEST_TEXT_CAP = 1200;       // inline PREVIEW; the whole text is the .md
var DIGEST_LOCK_S = 240;          // one pass per ~4min across all triggers

// A DOCUMENT DOES NOT END AT THE CELL'S CAP.
var DIGEST_SCAN_CAP = 120000;

// DETERMINISTIC, AND SAYING SO.
var DIGEST_ALLOW_MODEL = false;
var DIGEST_VERSION = '2026-09-14.2';

// THE SEAM FOR SMART COMMS, DECLARED BEFORE IT IS USED.
var DIGEST_SMART = {
  enabled: false,
  situation: 'ai_digest_summary',
  /** below this, a document has nothing worth summarising */
  min_chars: 400,
  /** empty = every kind; otherwise only these */
  kinds: []
};

/** '' while the seam is shut — and the caller writes nothing when it is. */
function digestSmartMaybe_(facts, text) {
  if (!DIGEST_SMART || !DIGEST_SMART.enabled) return null;
  if (String(text || '').length < Number(DIGEST_SMART.min_chars || 0)) return null;
  if (DIGEST_SMART.kinds && DIGEST_SMART.kinds.length &&
      DIGEST_SMART.kinds.indexOf(String(facts.doc_kind)) === -1) return null;
  if (typeof screenAiChat_ !== 'function') {
    return null;   // the lane is not installed here; silence, never an error
  }
  try {
    var ask = 'Summarise this document for a care team in five lines or fewer. ' +
      'Facts already known: ' + JSON.stringify({
        kind: facts.doc_kind, category: facts.category,
        person: facts.person, expires_on: facts.expires_on
      }) + '\n\n' + String(text).slice(0, 12000);
    // ONE DOOR, NAMED: screenAiChat_ is the platform's model call today, and `situation` is the Smart Comms row…
    var out = screenAiChat_(ask, 0, DIGEST_SMART.situation);
    var words = String((out && (out.content || out.text)) || '').trim();
    if (!words) return null;
    return { text: words.slice(0, 2000), source: DIGEST_SMART.situation };
  } catch (e) {
    return null;   // an unavailable model is not a failed decode
  }
}

// WHOSE UPLOAD GOES FIRST — by badge: the highest badge has priority.
var DIGEST_BADGE_RANK = {
  admin: 100, platformlead: 98, administrator: 95, owner: 95, director: 90, supervisor: 90,
  // teamlead between manager and hm: it follows nobody since 2026-10-29, drawn directly over a house manager
  hr: 85, manager: 80, teamlead: 75, hm: 70, nurse: 60,
  staff: 40, employee: 40, client: 20, guardian: 15
};
var DIGEST_RANK_FLOOR = 10;
var DIGEST_RANKS = null;

function digestUploaderRank_(email) {
  var who = String(email || '').trim().toLowerCase();
  if (!who) return DIGEST_RANK_FLOOR;
  if (!DIGEST_RANKS) {
    DIGEST_RANKS = {};
    try {
      var users = listRows_('users', {}) || [];
      for (var i = 0; i < users.length; i++) {
        var mail = String(users[i].email || '').trim().toLowerCase();
        if (!mail) continue;
        var words = [String(users[i].role || ''), String(users[i].system_type || '')];
        var types = users[i].types;
        if (typeof types === 'string') words = words.concat(types.split(/[,;]/));
        else if (types && types.length) words = words.concat(types);
        var best = DIGEST_RANK_FLOOR;
        for (var w = 0; w < words.length; w++) {
          var rank = DIGEST_BADGE_RANK[String(words[w]).trim().toLowerCase()];
          if (rank && rank > best) best = rank;
        }
        DIGEST_RANKS[mail] = best;
      }
    } catch (e) { DIGEST_RANKS = {}; }
  }
  return DIGEST_RANKS[who] || DIGEST_RANK_FLOOR;
}

// The decoder's own writing lives in ITS OWN folder — never in the `Asa Hub - Form` intake folder, which its output…
var DIGEST_TEXT_FOLDER_NAME = 'ASA Hub — Digest Text';
var DIGEST_TEXT_PROP = 'HUB_DIGEST_TEXT_FOLDER_ID';

// THE LEDGERS THIS DECODER SERVES — one machine, many intakes.
var DIGEST_LEDGERS = [
  // `sub` names the column holding the submission this file rode in with — the only ledger where a PERSON typed…
  { res: 'formFiles', fileId: 'file_id', name: 'file_name', mime: 'mime_type',
    ref: 'field_key', drawer: '', sub: 'submission_id',
    anchorKey: 'anchor_id', anchorName: 'anchor_name', anchorKind: 'candidate',
    route: true, people: true, textCap: 1200, priority: [] },
  // THE LEDGER ALREADY KNOWS WHOSE FILE THIS IS.
  { res: 'clientFiles', fileId: 'drive_id', name: 'title', mime: 'mime_type',
    ref: 'client_key', drawer: 'folder', route: false, people: false,
    textCap: 1200,
    anchorKey: 'client_key', anchorName: 'client_name', anchorKind: 'client',
    // the clinical drawers first — a care plan is worth more than a lease
    priority: ['ISP & AMFM', 'Med Documents', 'MARS', 'Self-Admin Assessments',
               'MUIs', 'Personal Information'] }
];

// MAY THE DECODER MOVE THIS FILE?
function digestMayRoute_(led, row) {
  if (!led || !led.route) return false;
  if (led.anchorKey && str_(row && row[led.anchorKey])) return false;
  return true;
}

// first-hit-wins — deterministic and free; the model is only the fallback and its answer is marked as such (the…
var DIGEST_CATEGORIES = [
  ['medical', ['mars', 'medication', 'med document', 'prescription', 'pharmacy',
               'controlled drug', 'physician', 'diagnosis', 'immunization',
               'tuberculin', 'ppd test', 'tb test', 'mantoux']],
  ['receipt_invoice', ['receipt', 'invoice', 'purchase', 'order total', 'subtotal',
                       'amount due', 'payment', 'billed']],
  ['identity', ['social security', 'ssn', 'passport', "driver's license",
                'drivers license', "driver's licence", 'driver license',
                'operator license', 'state id', 'state identification',
                'birth certificate', 'medicaid']],
  ['certification_training', ['certificate', 'certification', 'training',
                              'cpr', 'first aid', 'bls', 'aed',
                              'recertification', 'completion', 'course']],
  // Staff send these the way they send a certificate — a card with a policy number and a coverage window, which is…
  ['insurance', ['insurance card', 'auto insurance', 'policy number',
                 'coverage period', 'insured', 'liability limits']],
  ['care_plan', ['individual service plan', 'isp ', 'amfm', 'care plan',
                 'behavior support', 'person-centered']],
  ['incident', ['incident', 'mui', 'unusual incident', 'injury report']],
  ['legal', ['agreement', 'contract', 'consent', 'authorization', 'waiver',
             'policy', 'court', 'background check', 'criminal records check',
             'bci&i', 'fingerprint']],
  ['timesheet', ['timesheet', 'time sheet', 'clock in', 'hours worked',
                 'pay period']]
];

// ------------------------------------------------------------------ THE VOCABULARY LEAVES THE CODE…
var DIGEST_VOCAB_TABS = {
  kinds: 'Digest Kinds', categories: 'Digest Categories', expects: 'Digest Expects',
  labels: 'Digest Labels', issuers: 'Digest Issuers',
  drawers: 'Digest Drawers',
  // The zip list is one more list that belongs outside the code, where it can be parameterised.
  zip: 'Digest Zip', settings: 'Digest Settings',
  types: 'Form File Types',
  // What a QUESTION is about.
  answers: 'Digest Answer Facts',
  // When a document of this kind arrives carrying a person's name and the information, it must be attached to that…
  credentials: 'Digest Credentials'
};
var DIGEST_VOCAB_CACHE_S = 600;
var DIGEST_VOCAB = null;

/** A tab of the words book as objects, or [] — never a throw. */
function digestVocabRows_(tabName) {
  try {
    var id = String(hubId_('HUB_GENERIC_CONFIG_ID') || '');
    if (!id) return [];
    var sh = ssOpen_(id).getSheetByName(tabName);
    if (!sh) return [];
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    var head = values[0].map(function (h) {
      return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    });
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var row = {};
      var any = false;
      for (var c = 0; c < head.length; c++) {
        if (!head[c]) continue;
        row[head[c]] = String(values[r][c] == null ? '' : values[r][c]).trim();
        if (row[head[c]]) any = true;
      }
      if (any) out.push(row);
    }
    return out;
  } catch (e) {
    return [];
  }
}

function digestVocabOn_(row) {
  var a = String((row && row.active) || 'on').toLowerCase();
  return a !== 'off' && a !== 'false' && a !== 'no' && a !== '0';
}

/** 'a, b | c' → ['a','b','c'] — commas or pipes, whichever the editor used. */
function digestVocabList_(cell) {
  return String(cell || '').split(/[,|]/).map(function (x) {
    return String(x).trim().toLowerCase();
  }).filter(Boolean);
}

function digestVocab_() {
  if (DIGEST_VOCAB) return DIGEST_VOCAB;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache) {
    try {
      var hit = cache.get('digest_vocab');
      if (hit) { DIGEST_VOCAB = JSON.parse(hit); return DIGEST_VOCAB; }
    } catch (eH) { /* a cache that cannot answer just means we read the book */ }
  }
  var v = { kinds: [], categories: [], labels: [], issuers: [], orgs: [],
            drawers: [], bad: 0, source: 'seed', v: 'seed' };

  var kinds = digestVocabRows_(DIGEST_VOCAB_TABS.kinds);
  for (var i = 0; i < kinds.length; i++) {
    var k = kinds[i];
    if (!digestVocabOn_(k)) continue;
    var needles = digestVocabList_(k.needles);
    if (!String(k.kind || '').trim() || !needles.length) { v.bad++; continue; }
    var opts = {};
    var files = digestVocabList_(k.file_hints);
    if (files.length) opts.file = files;
    var w = Number(k.weight);
    if (!isNaN(w) && w > 0 && w <= 5 && w !== 1) opts.w = w;
    v.kinds.push([String(k.kind).trim(), String(k.category || '').trim(),
                  needles, opts]);
  }

  var cats = digestVocabRows_(DIGEST_VOCAB_TABS.categories);
  cats.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  for (var c2 = 0; c2 < cats.length; c2++) {
    var cat = cats[c2];
    if (!digestVocabOn_(cat)) continue;
    var cn = digestVocabList_(cat.needles);
    if (!String(cat.category || '').trim() || !cn.length) { v.bad++; continue; }
    v.categories.push([String(cat.category).trim(), cn]);
  }

  var labels = digestVocabRows_(DIGEST_VOCAB_TABS.labels);
  labels.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  for (var l = 0; l < labels.length; l++) {
    if (!digestVocabOn_(labels[l])) continue;
    var lab = String(labels[l].label || '').trim();
    if (lab) v.labels.push(lab); else v.bad++;
  }

  var issuers = digestVocabRows_(DIGEST_VOCAB_TABS.issuers);
  for (var s2 = 0; s2 < issuers.length; s2++) {
    if (!digestVocabOn_(issuers[s2])) continue;
    var nm = String(issuers[s2].name || '').trim().toLowerCase();
    if (!nm) { v.bad++; continue; }
    v.issuers.push(nm);
    var org = String(issuers[s2].is_organisation || 'yes').toLowerCase();
    if (org !== 'no' && org !== 'false' && org !== 'off') v.orgs.push(nm);
  }

  var drawers = digestVocabRows_(DIGEST_VOCAB_TABS.drawers);
  for (var d2 = 0; d2 < drawers.length; d2++) {
    if (!digestVocabOn_(drawers[d2])) continue;
    var pre = String(drawers[d2].drawer_prefix || '').trim().toLowerCase();
    var dc = String(drawers[d2].category || '').trim();
    if (pre && dc) v.drawers.push([pre, dc]); else v.bad++;
  }

  var zips = digestVocabRows_(DIGEST_VOCAB_TABS.zip);
  v.zip = {};
  for (var z = 0; z < zips.length; z++) {
    if (!digestVocabOn_(zips[z])) continue;
    var ze = String(zips[z].ext || zips[z].extension || '').trim().toLowerCase()
      .replace(/^\./, '');
    if (ze) v.zip[ze] = 1; else v.bad++;
  }

  var sets = digestVocabRows_(DIGEST_VOCAB_TABS.settings);
  v.settings = {};
  for (var st = 0; st < sets.length; st++) {
    if (!digestVocabOn_(sets[st])) continue;
    var sk = String(sets[st].key || '').trim().toLowerCase();
    var raw = String(sets[st].value == null ? '' : sets[st].value).trim();
    var sv = Number(raw);
    // a dial is usually a number; some are a NAME (the intake folder), and a name must survive a reader that was…
    if (sk && raw !== '' && !isNaN(sv)) v.settings[sk] = sv;
    else if (sk && raw !== '') v.settings[sk] = raw;
    else if (!sk) v.bad++;
  }

  // WHAT A KIND OF PAPER OWES — the book may add a kind and say what to hunt for on it without a deploy.
  var exps = digestVocabRows_(DIGEST_VOCAB_TABS.expects);
  v.expects = [];
  for (var ex = 0; ex < exps.length; ex++) {
    if (!digestVocabOn_(exps[ex])) continue;
    var exK = String(exps[ex].doc_kind || '').trim();
    if (!exK) { v.bad++; continue; }
    v.expects.push([exK, digestVocabList_(exps[ex].must),
                    digestVocabList_(exps[ex].may)]);
  }

  var creds = digestVocabRows_(DIGEST_VOCAB_TABS.credentials);
  v.credentials = [];
  for (var cr = 0; cr < creds.length; cr++) {
    if (!digestVocabOn_(creds[cr])) continue;
    var crK = String(creds[cr].doc_kind || '').trim();
    if (!crK) { v.bad++; continue; }
    v.credentials.push([crK, String(creds[cr].doc_id || '').trim(),
                        String(creds[cr].credential || '').trim(),
                        String(creds[cr].requirement || '').trim(),
                        String(creds[cr].expires || '').trim()]);
  }

  var afs = digestVocabRows_(DIGEST_VOCAB_TABS.answers);
  afs.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  v.answers = [];
  for (var af = 0; af < afs.length; af++) {
    if (!digestVocabOn_(afs[af])) continue;
    var afF = String(afs[af].fact || '').trim();
    var afN = digestVocabList_(afs[af].needles);
    if (!afF || !afN.length) { v.bad++; continue; }
    v.answers.push([afF, afN]);
  }

  var types = digestVocabRows_(DIGEST_VOCAB_TABS.types);
  v.types = {};
  for (var ty = 0; ty < types.length; ty++) {
    if (!digestVocabOn_(types[ty])) continue;
    var te = String(types[ty].ext || '').trim().toLowerCase().replace(/^\./, '');
    var tm = String(types[ty].mime || '').trim();
    // NEVER A RUNNABLE FILE, whatever a row says.
    if (!te || !tm || DIGEST_TYPE_NEVER[te]) { v.bad++; continue; }
    v.types[te] = tm;
  }

  var read = v.kinds.length + v.categories.length + v.labels.length +
             v.issuers.length + v.drawers.length + v.answers.length +
             v.credentials.length +
             Object.keys(v.zip).length + Object.keys(v.settings).length +
             Object.keys(v.types).length;
  if (read) {
    v.source = 'book';
    v.v = 'b' + v.kinds.length + '.' + v.categories.length + '.' +
          v.labels.length + '.' + v.issuers.length + '.' + v.drawers.length +
          '.' + Object.keys(v.zip).length + '.' + Object.keys(v.types).length;
    if (v.bad) {
      try {
        hubSysLog_('auto-digest', 'digest_vocab_bad_rows',
                   v.bad + ' row(s) in the words book were skipped — a kind ' +
                   'needs needles, a weight must be 0-5, a drawer needs a category.',
                   { status: 200 });
      } catch (eL) { /* the count rides in vocab_v either way */ }
    }
  } else {
    // THE FLOOR, SAID OUT LOUD.
    try {
      hubSysLog_('auto-digest', 'digest_vocab_fallback',
                 'the words book answered nothing — decoding with the tables ' +
                 'compiled into Digest.gs (' + DIGEST_DOC_KINDS.length + ' kinds)',
                 { status: 200 });
    } catch (eL2) { /* the seed works either way */ }
  }
  if (cache) {
    try { cache.put('digest_vocab', JSON.stringify(v), DIGEST_VOCAB_CACHE_S); }
    catch (eP) { /* re-read next execution */ }
  }
  DIGEST_VOCAB = v;
  return v;
}

/** Each reader: the book when it speaks, the code's own table when it does not. */
function digestKinds_() {
  var v = digestVocab_();
  return (v.kinds && v.kinds.length) ? v.kinds : DIGEST_DOC_KINDS;
}
function digestCategoriesTable_() {
  var v = digestVocab_();
  return (v.categories && v.categories.length) ? v.categories : DIGEST_CATEGORIES;
}
function digestLabels_() {
  var v = digestVocab_();
  return (v.labels && v.labels.length) ? v.labels : DIGEST_NAME_LABELS;
}
function digestIssuers_() {
  var v = digestVocab_();
  return (v.issuers && v.issuers.length) ? v.issuers : DIGEST_ISSUERS;
}
function digestOrgNames_() {
  var v = digestVocab_();
  return (v.orgs && v.orgs.length) ? v.orgs : DIGEST_ISSUERS;
}
// WHAT MUST NEVER BE OPENED, whatever the book says.
var DIGEST_TYPE_NEVER = {
  exe: 1, msi: 1, bat: 1, cmd: 1, com: 1, scr: 1, sh: 1, bash: 1, zsh: 1,
  ps1: 1, psm1: 1, vbs: 1, jar: 1, apk: 1, app: 1, dll: 1, so: 1, dylib: 1,
  deb: 1, rpm: 1, pkg: 1, dmg: 1
};

function digestZipExts_() {
  var v = digestVocab_();
  return (v.zip && Object.keys(v.zip).length) ? v.zip : DIGEST_ZIP_EXTS;
}

// A NUMBER FROM THE BOOK, clamped by the code that has to live with it.
function digestSetting_(key, fallback, low, high) {
  var v = digestVocab_();
  var got = (v.settings || {})[String(key).toLowerCase()];
  // A DIAL CAN BE A WORD.
  if (typeof fallback === 'string') {
    return (got === undefined || got === null || String(got).trim() === '')
      ? fallback : String(got).trim();
  }
  if (got === undefined || got === null || isNaN(Number(got))) return fallback;
  var n = Number(got);
  if (low !== undefined && n < low) return fallback;
  if (high !== undefined && n > high) return fallback;
  return n;
}

/** The door's allow-list: the book's, plus what the code always carried. */
function digestFileTypes_() {
  var v = digestVocab_();
  var base = {};
  for (var k in FORM_FILE_TYPES) {
    if (Object.prototype.hasOwnProperty.call(FORM_FILE_TYPES, k)) base[k] = FORM_FILE_TYPES[k];
  }
  var extra = (v.types || {});
  for (var e in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, e) && !DIGEST_TYPE_NEVER[e]) {
      base[e] = extra[e];
    }
  }
  return base;
}

// WHAT A QUESTION IS ABOUT — the seed under the book's `Digest Answer Facts`.
var DIGEST_ANSWER_FACTS = [
  ['expires_on', ['expiration', 'expiry', 'expires', 'valid until', 'valid thru',
                  'valid through', 'good until', 'good thru', 'renewal date',
                  'renews', 'due date', 'vencimento', 'validade']],
  ['issued_on', ['issue date', 'issued on', 'date issued', 'date of issue',
                 'completion date', 'date completed', 'completed on',
                 'exam date', 'test date', 'date of test', 'date signed',
                 'signed on', 'emitido', 'emissao']],
  ['person', ['full name', 'your name', 'employee name', 'staff name',
              'legal name', 'name of employee', 'name on the document',
              'first name', 'last name', 'nome completo']],
  ['doc_kind', ['document type', 'type of document', 'kind of document',
                'which document', 'what document', 'document category',
                'tipo de documento']],
  ['client', ['client', 'individual served', 'individual name', 'consumer',
              'participant', 'person served']],
  ['house', ['house', 'home name', 'residence', 'site', 'location', 'program']],
  ['issuer', ['issued by', 'issuer', 'agency', 'institution', 'school',
              'training provider', 'employer', 'organisation', 'organization']],
  ['number', ['license number', 'licence number', 'certificate number',
              'certification number', 'id number', 'policy number',
              'document number', 'number on the']],
  /* LAST — any date is a date */
  ['date', ['date', 'data']]
];

// WHAT TO LOOK FOR ONCE YOU KNOW WHAT IT IS.
var DIGEST_EXPECTS = [
  ['cpr_first_aid',      ['person', 'expires_on'], ['issued_on', 'issuer', 'number']],
  ['dodd_certification', ['person', 'issued_on'],  ['expires_on', 'number', 'program']],
  ['med_admin_cert',     ['person', 'expires_on'], ['issued_on', 'level', 'number']],
  ['crisis_prevention',  ['person'],               ['issued_on', 'expires_on']],
  ['diploma',            ['person'],               ['issued_on', 'issuer']],
  ['training_transcript',['person'],               ['issued_on']],
  ['drivers_licence',    ['person', 'expires_on'], ['issued_on', 'born_on', 'number']],
  ['state_id',           ['person', 'expires_on'], ['issued_on', 'born_on', 'number']],
  ['ssn_card',           ['person'],               ['issued_on', 'number']],
  ['birth_certificate',  ['person', 'born_on'],    ['issuer', 'number']],
  ['background_check',   ['person'],               ['issued_on', 'issuer', 'check_result']],
  ['driver_abstract',    ['person'],               ['issued_on']],
  ['auto_insurance',     ['expires_on'],           ['person', 'issued_on', 'number']],
  ['tb_test',            ['person'],               ['issued_on']],
  ['isp',                ['person'],               ['issued_on', 'expires_on']],
  ['mar',                ['person'],               ['issued_on']],
  ['dnr',                ['person'],               ['issued_on', 'issuer']],
  ['paystub',            [],                       ['person', 'issued_on']],
  ['timesheet',          [],                       ['person', 'issued_on']]
];

function digestExpects_(docKind) {
  var v = digestVocab_();
  var table = (v.expects && v.expects.length) ? v.expects : DIGEST_EXPECTS;
  var k = String(docKind || '');
  for (var i = 0; i < table.length; i++) {
    if (table[i][0] === k) return { must: table[i][1] || [], may: table[i][2] || [] };
  }
  return null;
}

// WHAT THIS PAPER OWED AND DID NOT GIVE.
function digestMissing_(docKind, facts) {
  var want = digestExpects_(docKind);
  if (!want) return [];
  var out = [];
  for (var i = 0; i < want.must.length; i++) {
    var f = want.must[i];
    if (!String((facts && facts[f]) || '').trim()) out.push(f);
  }
  return out;
}

// WHICH OBLIGATION A DOCUMENT SPEAKS FOR — the seed under `Digest Credentials`.
var DIGEST_CREDENTIALS = [
  ['dodd_certification', 'dodd_8hr',         'dodd', 'dodd_8hr',         'yes'],
  ['cpr_first_aid',      'cpr_first_aid',    'cpr',  'cpr',              'yes'],
  ['med_admin_cert',     'med_del',          '',     'med_del',          'yes'],
  ['drivers_licence',    'drivers_id',       '',     'drivers_license',  'yes'],
  ['state_id',           'drivers_id',       '',     'drivers_license',  'yes'],
  ['ssn_card',           'ss_birth',         '',     'ss_birth',         'no'],
  ['birth_certificate',  'ss_birth',         '',     'ss_birth',         'no'],
  ['diploma',            'hs_diploma',       '',     'hs_diploma',       'no'],
  ['background_check',   'background_check', '',     'background_check', 'no'],
  ['auto_insurance',     'car_insurance',    '',     'car_insurance',    'yes']
];

function digestCredentials_() {
  var v = digestVocab_();
  return (v.credentials && v.credentials.length) ? v.credentials : DIGEST_CREDENTIALS;
}

/** The obligation row for a decoded kind, or null — never a guess. */
function digestCredentialFor_(docKind) {
  var k = String(docKind || '').trim();
  if (!k) return null;
  var table = digestCredentials_();
  for (var i = 0; i < table.length; i++) {
    if (table[i][0] === k) {
      return { doc_kind: k, doc_id: table[i][1],
               credential: table[i][2], requirement: table[i][3],
               expires: String(table[i][4] || '').toLowerCase() === 'yes' };
    }
  }
  return null;
}

/** Words that are a shrug, not an answer. */
var DIGEST_ANSWER_NOTHING = {
  'other': 1, 'others': 1, 'unknown': 1, 'not sure': 1, 'unsure': 1,
  'na': 1, 'n a': 1, 'none': 1, 'no': 1, 'nao sei': 1, 'i dont know': 1,
  'dont know': 1, 'not applicable': 1, 'nenhum': 1, 'outro': 1
};

function digestAnswerFacts_() {
  var v = digestVocab_();
  return (v.answers && v.answers.length) ? v.answers : DIGEST_ANSWER_FACTS;
}

// The fact a question feeds: what it DECLARES, else what it ASKS.
function digestAnswerFactOf_(key, label, declared) {
  var d = String(declared || '').trim();
  if (d) return d;
  var asked = (String(label || '') + ' ' + String(key || ''))
    .toLowerCase().replace(/[_\-]+/g, ' ');
  var table = digestAnswerFacts_();
  for (var i = 0; i < table.length; i++) {
    var needles = table[i][1];
    for (var n = 0; n < needles.length; n++) {
      if (asked.indexOf(needles[n]) !== -1) return table[i][0];
    }
  }
  return '';
}

function digestDrawers_() {
  var v = digestVocab_();
  return (v.drawers && v.drawers.length) ? v.drawers : DIGEST_DRAWERS;
}

// The drawer names as a TABLE — the if-chain it replaces is the seed below it.
var DIGEST_DRAWERS = [
  ['mars', 'medical'], ['med document', 'medical'], ['self-admin', 'medical'],
  ['isp', 'care_plan'], ['amfm', 'care_plan'],
  ['mui', 'incident'], ['fund', 'receipt_invoice'],
  ['personal information', 'identity'], ['lease', 'legal'],
  ['tracking', 'timesheet']
];

// THE DECODER'S ffmpeg ARM — by way of the relay.
function digestDocProbe_(fileId) {
  var key = '';
  try { key = String(hubProp_('HUB_MEDIA_PROBE_KEY') || '').trim(); } catch (eK) { key = ''; }
  if (!key) return null;
  var base = (typeof PLATFORM_MAIL_RELAY !== 'undefined' && PLATFORM_MAIL_RELAY)
    ? PLATFORM_MAIL_RELAY : 'https://asamylife.asalifecare.com';
  try {
    var res = UrlFetchApp.fetch(base + '/media-probe', {
      method: 'post', contentType: 'application/json',
      headers: { 'X-Media-Key': key },
      payload: JSON.stringify({ file_id: String(fileId), document: true, frames: 8 }),
      muteHttpExceptions: true });
    if (res.getResponseCode() >= 400) return null;
    var got = JSON.parse(res.getContentText() || '{}');
    return (got && got.ok) ? got : null;
  } catch (e) {
    return null;
  }
}

function digestMediaProbe_(fileId, queued) {
  var key = '';
  try { key = String(hubProp_('HUB_MEDIA_PROBE_KEY') || '').trim(); } catch (eK) { key = ''; }
  if (!key) return null;
  var base = (typeof PLATFORM_MAIL_RELAY !== 'undefined' && PLATFORM_MAIL_RELAY)
    ? PLATFORM_MAIL_RELAY : 'https://asamylife.asalifecare.com';
  try {
    var res = UrlFetchApp.fetch(base + '/media-probe', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Media-Key': key },
      // four frames, not six: Apps Script gives a fetch about a minute and a clip spends most of it.
      payload: JSON.stringify({ file_id: String(fileId),
                                frames: digestSetting_('probe_frames', 4, 1, 8),
                                queue: queued ? true : false }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 400) return null;
    var got = JSON.parse(res.getContentText() || '{}');
    if (got && got.ok) return got;
    /* the second channel took it: not an answer, and not a failure either */
    if (got && got.queued) return { queued: true };
    return null;
  } catch (e) {
    return null;   // the arm is a tool; a tool that is out is not a failure
  }
}

// A CLIP HAS NO WORDS, AND THAT IS NOT A FAILURE.
function digestIsMedia_(mime, filename) {
  var m = String(mime || '').toLowerCase();
  var ext = String(filename || '').toLowerCase().replace(/^.*\./, '');
  if (m.indexOf('video/') === 0 || m.indexOf('audio/') === 0) return true;
  return ['mp4', 'mov', 'm4v', 'webm', '3gp', 'm4a', 'mp3', 'wav', 'ogg']
    .indexOf(ext) !== -1;
}

function digestMediaFacts_(fileId, mime) {
  var facts = { kind: (String(mime || '').indexOf('audio/') === 0)
                       ? 'audio_clip' : 'video_clip' };
  try {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId +
      '?fields=size,createdTime,videoMediaMetadata(width,height,durationMillis)' +
      '&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true });
    if (res.getResponseCode() < 400) {
      var got = JSON.parse(res.getContentText() || '{}');
      var v = got.videoMediaMetadata || {};
      if (v.durationMillis) facts.seconds = Math.round(Number(v.durationMillis) / 1000);
      if (v.width && v.height) facts.frame = v.width + 'x' + v.height;
      if (got.size) facts.bytes = Number(got.size);
      if (got.createdTime) facts.taken_at = String(got.createdTime);
    }
  } catch (e) { /* a clip with no metadata is still a clip */ }
  return facts;
}

// UNIVERSAL TEXT: any file the platform accepts becomes words.
var DIGEST_ZIP_TEXT_EXTS = {
  txt: 1, md: 1, csv: 1, tsv: 1, json: 1, xml: 1, log: 1, srt: 1, vtt: 1,
  html: 1, htm: 1, js: 1, mjs: 1, cjs: 1, ts: 1, tsx: 1, jsx: 1,
  css: 1, py: 1, sql: 1, yml: 1, yaml: 1, ini: 1, conf: 1
};

function digestReadZip_(fileId) {
  var out = [];
  var named = [];
  try {
    var entries = Utilities.unzip(DriveApp.getFileById(fileId).getBlob());
    for (var i = 0; i < entries.length && out.join('\n').length < DIGEST_SCAN_CAP; i++) {
      var entryName = String(entries[i].getName() || 'entry');
      named.push(entryName);
      var entryExt = entryName.toLowerCase().replace(/^.*\./, '');
      if (!DIGEST_ZIP_TEXT_EXTS[entryExt]) continue;
      var words = '';
      try { words = String(entries[i].getDataAsString() || ''); } catch (eE) { words = ''; }
      if (!words) continue;
      out.push('# ' + entryName + '\n' + words);
    }
  } catch (e) {
    return '';
  }
  if (!out.length && named.length) {
    /* nothing readable inside, but WHAT is inside is worth saying */
    return '# archive contents\n' + named.slice(0, 200).join('\n');
  }
  return out.join('\n\n').slice(0, DIGEST_SCAN_CAP);
}

/** `strict`: a conversion Drive refused throws instead of reading as no words (digestReadPaper_). */
function digestReadText_(fileId, mime, filename, strict) {
  var m = String(mime || '').toLowerCase();
  var ext = String(filename || '').toLowerCase().replace(/^.*\./, '');
  // a clip is not converted: the copy would cost a minute and come back empty
  if (digestIsMedia_(mime, filename)) return '';
  if (ext === 'zip' || m.indexOf('zip') !== -1) return digestReadZip_(fileId);
  try {
    if (m.indexOf('text/') === 0 || ext === 'txt' || ext === 'csv' || ext === 'md' ||
        ext === 'json' || ext === 'xml' || ext === 'tsv' || m.indexOf('json') !== -1 ||
        ['html', 'htm', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'py',
         'sql', 'yml', 'yaml', 'log'].indexOf(ext) !== -1) {
      return String(DriveApp.getFileById(fileId).getBlob().getDataAsString() || '')
        .slice(0, 500000);
    }
  } catch (eT) { /* fall through to the converters */ }
  if (ext === 'xlsx' || ext === 'xlsm' ||
      m.indexOf('spreadsheetml') !== -1) {
    return digestConvertRead_(fileId, 'application/vnd.google-apps.spreadsheet',
      function (id) {
        var out = [];
        var ss = SpreadsheetApp.openById(id);
        var tabs = ss.getSheets();
        for (var s = 0; s < tabs.length; s++) {
          out.push('# Sheet: ' + tabs[s].getName());
          var vals = tabs[s].getDataRange().getValues();
          for (var r = 0; r < vals.length; r++) {
            var cells = vals[r].filter(function (c) { return String(c).trim(); });
            if (cells.length) out.push(cells.join(' | '));
          }
        }
        return out.join('\n');
      }, strict);
  }
  // pdf, images, docx — the Docs conversion (OCR included)
  return digestConvertRead_(fileId, 'application/vnd.google-apps.document',
    function (id) {
      var token = ScriptApp.getOAuthToken();
      var exp = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text%2Fplain',
        { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      if (exp.getResponseCode() < 400) return exp.getContentText();
      if (strict) throw new Error('Drive would not export the converted text (HTTP ' + exp.getResponseCode() + ')');
      return '';
    }, strict);
}

// Copy → convert → read → ALWAYS trash the scratch copy (the four-clone law, kept in the one place the clones are…
function digestConvertRead_(fileId, targetMime, reader, strict) {
  var token = ScriptApp.getOAuthToken();
  var auth = { Authorization: 'Bearer ' + token };
  var copy = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?supportsAllDrives=true',
    { method: 'post', contentType: 'application/json', headers: auth,
      payload: JSON.stringify({ mimeType: targetMime, name: DIGEST_TMP_NAME }),
      muteHttpExceptions: true });
  if (copy.getResponseCode() >= 400) {
    if (strict) throw new Error('Drive would not convert the file (HTTP ' + copy.getResponseCode() + ')');
    return '';
  }
  var copyId = '';
  try {
    copyId = JSON.parse(copy.getContentText()).id;
    return String(reader(copyId) || '');
  } catch (e) {
    if (strict) throw e;
    return '';
  } finally {
    if (copyId) {
      try {
        UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + copyId +
          '?supportsAllDrives=true',
          { method: 'delete', headers: auth, muteHttpExceptions: true });
      } catch (eDel) { /* trash-able scratch; non-fatal */ }
    }
  }
}

// A scratch copy holds a paper's words: the conversion deletes it, and one whose delete failed is deleted by the…
var DIGEST_TMP_NAME = 'digest-tmp';
var DIGEST_TMP_OLD_MS = 3600000;
var DIGEST_TMP_PER_PASS = 20;

/** The Drive search for scratch copies left behind: this account's own converted Docs and Sheets by that name, older than `beforeIso`. */
function digestTmpQuery_(beforeIso) {
  return "title = '" + DIGEST_TMP_NAME + "' and trashed = false and 'me' in owners and modifiedDate < '" +
         String(beforeIso) + "' and (mimeType = 'application/vnd.google-apps.document' or " +
         "mimeType = 'application/vnd.google-apps.spreadsheet')";
}

/** Deletes scratch copies a conversion could not; `left` answers the milliseconds the pass has. */
function digestTmpTidy_(left) {
  var before = new Date(new Date().getTime() - DIGEST_TMP_OLD_MS).toISOString();
  var it = null;
  try { it = DriveApp.searchFiles(digestTmpQuery_(before)); } catch (eS) { return 0; }
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var gone = 0;
  while (gone < DIGEST_TMP_PER_PASS && it.hasNext()) {
    if (typeof left === 'function' && left() < 30000) break;
    var f = it.next();
    if (String(f.getName()) !== DIGEST_TMP_NAME) continue;
    try {
      var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '?supportsAllDrives=true',
                                  { method: 'delete', headers: auth, muteHttpExceptions: true });
      if (res.getResponseCode() < 400) gone++;
    } catch (eD) { /* the next pass tries again */ }
  }
  return gone;
}

// Category: the lexicon first; the model ONLY when the lexicon sees nothing, its answer marked 'model' — and no…
function digestCategory_(filename, text) {
  var hay = (String(filename) + ' ' + String(text).slice(0, 4000)).toLowerCase();
  var table = digestCategoriesTable_();
  for (var i = 0; i < table.length; i++) {
    var needles = table[i][1];
    for (var n = 0; n < needles.length; n++) {
      if (hay.indexOf(needles[n]) !== -1) {
        return { category: table[i][0], source: 'lexicon' };
      }
    }
  }
  if (DIGEST_ALLOW_MODEL && String(text).trim() && typeof screenAiChat_ === 'function') {
    try {
      var cats = digestCategoriesTable_().map(function (c) { return c[0]; }).concat(['other']);
      var out = screenAiChat_(
        'Classify the document. Answer JSON {"category": one of ' + cats.join(', ') +
        '}. If unsure use "other".\n\n' + String(filename) + '\n\n' +
        String(text).slice(0, 6000), 0, 'ai_digest_category');
      var got = JSON.parse(String(out && out.content || '{}'));
      var cat = String(got.category || '').toLowerCase();
      if (cats.indexOf(cat) !== -1 && cat !== 'other') {
        return { category: cat, source: 'model' };
      }
    } catch (eA) { /* an unreadable answer is a non-answer */ }
  }
  return { category: 'other', source: 'none' };
}

/** ISO dates out of the filename and the text head — never invented. */
function digestDates_(filename, text) {
  return digestDatesIn_(String(filename) + '\n' +
                        String(text).slice(0, DIGEST_SCAN_CAP));
}

// Every date in a piece of text, ISO, sorted.
var DIGEST_MONTH_WORDS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12
};

/** The last day of a month — what a date without a day means on a card. */
function digestLastDay_(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// EVERY DATE ON THE PAGE, WHATEVER SHAPE IT CAME IN — whatever line it sits on, it has to be caught.
function digestDatesIn_(s) {
  s = String(s || '');
  var out = {};
  var m;
  function put(y, mo, d) {
    if (mo < 1 || mo > 12 || y < 1900 || y > 2100) return;
    if (d < 1 || d > 31) return;
    out[y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2)] = 1;
  }
  /* 1. day, month, year — 7/29/2026, 29-07-26, 7.29.2026 */
  var reUs = /\b(\d{1,2})[\/_\-.](\d{1,2})[\/_\-.]((?:19|20)\d{2}|\d{2})\b/g;
  while ((m = reUs.exec(s)) !== null) {
    put(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]));
  }
  /* 2. ISO */
  var reIso = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = reIso.exec(s)) !== null) out[m[1] + '-' + m[2] + '-' + m[3]] = 1;
  // 3.
  var reMo = /(^|[^0-9\/\-.])(\d{1,2})[\/\-.](20\d{2})(?![0-9\/\-.])/g;
  while ((m = reMo.exec(s)) !== null) {
    var mo3 = Number(m[2]), y3 = Number(m[3]);
    if (mo3 >= 1 && mo3 <= 12) put(y3, mo3, digestLastDay_(y3, mo3));
  }
  /* 4. A MONTH WRITTEN OUT — "September 3, 2026", "July 2028", "Jul-2028" */
  var reWord = /\b([A-Za-z]{3,9})\.?[\s,\-]+(?:(\d{1,2})(?:st|nd|rd|th)?[\s,\-]+)?((?:19|20)\d{2})\b/g;
  while ((m = reWord.exec(s)) !== null) {
    var mo4 = DIGEST_MONTH_WORDS[String(m[1]).toLowerCase()];
    if (!mo4) continue;
    var y4 = Number(m[3]);
    put(y4, mo4, m[2] ? Number(m[2]) : digestLastDay_(y4, mo4));
  }
  return Object.keys(out).sort().slice(0, 12);
}

// ANCHORS ARE IDS, NEVER NAMES — it is never by name.
function digestIds_(text) {
  var s = String(text).slice(0, DIGEST_SCAN_CAP);
  var out = {};
  var m;
  var rePlat = /\b(?:CL|USR|CAN|FRM|SUB)_[A-Za-z0-9]{4,24}\b/g;
  while ((m = rePlat.exec(s)) !== null) out[m[0]] = 1;
  var reDodd = /\bDODD\s*(?:ID|#|No\.?|Number)?\s*[:\-]?\s*(\d{5,12})\b/gi;
  while ((m = reDodd.exec(s)) !== null) out['DODD:' + m[1]] = 1;
  return Object.keys(out).slice(0, 12);
}

// WHAT THE PERSON TYPED, so the decoder can say when the document disagrees with them.
var DIGEST_SUBS = null;

// Returns { dates: [...], note: '' } — and the NOTE is the point.
var DIGEST_FORMS = null;

// The QUESTIONS of a form, by key — label, kind, and the fact it declares.
function digestFormFields_(slug) {
  if (!DIGEST_FORMS) {
    DIGEST_FORMS = {};
    try {
      var rows = listRows_('forms', {}) || [];
      for (var i = 0; i < rows.length; i++) {
        var fs = rows[i].fields;
        if (typeof fs === 'string') {
          try { fs = JSON.parse(fs || '[]'); } catch (eP) { fs = []; }
        }
        if (!fs || !fs.length) continue;
        var map = {};
        for (var f = 0; f < fs.length; f++) {
          var k = str_(fs[f].key);
          if (!k) continue;
          map[k] = { label: str_(fs[f].label), kind: str_(fs[f].kind),
                     fact: str_(fs[f].fact) };
        }
        DIGEST_FORMS[str_(rows[i].slug).toLowerCase()] = map;
      }
    } catch (e) { DIGEST_FORMS = {}; }
  }
  return DIGEST_FORMS[String(slug || '').toLowerCase()] || {};
}

function digestAnswers_(subId, fileId) {
  var key = String(subId || '').trim();
  if (!DIGEST_SUBS) {
    DIGEST_SUBS = {};
    try {
      var all = listRows_('formSubmissions', {}) || [];
      for (var i = 0; i < all.length; i++) DIGEST_SUBS[str_(all[i].id)] = all[i];
    } catch (e) {
      return { dates: [], note: 'submissions unreadable' };
    }
  }
  var row = key ? DIGEST_SUBS[key] : null;
  if (!row && fileId) {
    // THE DIRECT LINK.
    var ids = Object.keys(DIGEST_SUBS);
    for (var n = 0; n < ids.length; n++) {
      if (String(DIGEST_SUBS[ids[n]].answers || '').indexOf(String(fileId)) !== -1) {
        row = DIGEST_SUBS[ids[n]];
        break;
      }
    }
  }
  if (!row) return { dates: [], note: 'no submission row' };
  // THE CELL COMES BACK ALREADY PARSED.
  var answers = row.answers;
  if (typeof answers === 'string') {
    try { answers = JSON.parse(answers || '{}'); }
    catch (eJ) { return { dates: [], note: 'answers unreadable' }; }
  }
  if (!answers || typeof answers !== 'object') {
    return { dates: [], note: 'no answers' };
  }
  // WHAT THE PERSON SAID, question by question.
  var fields = digestFormFields_(str_(row.form_slug));
  var said = [];
  var out = {};
  var keys = Object.keys(answers);
  for (var k = 0; k < keys.length; k++) {
    var raw = answers[keys[k]];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'object') continue;
    var value = String(raw).trim();
    if (!value || value.charAt(0) === '[' || value.charAt(0) === '{') continue;
    var meta = fields[keys[k]] || {};
    var fact = digestAnswerFactOf_(keys[k], meta.label, meta.fact);
    var found = digestDatesIn_(value);
    for (var dI = 0; dI < found.length; dI++) out[found[dI]] = 1;
    said.push({
      key: keys[k],
      label: meta.label || keys[k],
      kind: meta.kind || '',
      fact: fact,
      value: value.slice(0, 160),
      dates: found
    });
    if (said.length >= 40) break;
  }
  var dates = Object.keys(out).sort().slice(0, 6);
  return {
    dates: dates, said: said, slug: str_(row.form_slug),
    note: dates.length ? '' : 'nobody typed a date'
  };
}

// THE MERGE — of what the form already carries: its text, its choices and its expiry date.
function digestAnswerCheck_(said, found) {
  var out = [];
  var fill = {};
  var agree = '';
  var yes = 0, no = 0;
  for (var i = 0; i < said.length; i++) {
    var it = said[i];
    if (!it.fact) continue;
    // AN ANSWER THAT SAYS NOTHING IS NOT A DISAGREEMENT.
    if (DIGEST_ANSWER_NOTHING[it.value.toLowerCase().replace(/[^a-z ]+/g, '').trim()]) continue;
    var verdict = '';
    var mine = '';
    var why = '';
    if (it.fact === 'expires_on' || it.fact === 'issued_on' || it.fact === 'date') {
      if (!it.dates.length) { continue; }         // a date question, no date in it
      var target = it.fact === 'expires_on' ? found.expires
                 : (it.fact === 'issued_on' ? found.issued : '');
      mine = target;
      if (target) {
        verdict = it.dates.indexOf(target) !== -1 ? 'yes' : 'no';
        why = verdict === 'no' ? 'the paper says ' + target : '';
      } else if (found.dates.length) {
        // the paper carries dates but never labelled this one — a match is still a match, and a miss is only "not…
        var hit = '';
        for (var d = 0; d < it.dates.length; d++) {
          if (found.dates.indexOf(it.dates[d]) !== -1) { hit = it.dates[d]; break; }
        }
        verdict = hit ? 'yes' : '';
        mine = hit || '';
        if (!hit) why = 'not printed on the paper';
        if (!hit && it.fact !== 'date') fill[it.fact] = it.dates[0];
      } else {
        why = 'the paper carries no date';
        if (it.fact !== 'date') fill[it.fact] = it.dates[0];
      }
    } else if (it.fact === 'person') {
      mine = found.person;
      if (!mine) { why = 'the paper prints no name'; fill.person = it.value; }
      else verdict = digestSameName_(it.value, mine) ? 'yes' : 'no';
      if (verdict === 'no') why = 'the paper says ' + mine;
    } else if (it.fact === 'doc_kind') {
      mine = found.doc_kind;
      var typedKind = it.value.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (!mine) { why = 'the paper did not say what it is'; fill.doc_kind = typedKind; }
      else if (typedKind === mine) verdict = 'yes';
      else {
        // "CPR card" against cpr_card, "TB test" against tb_test — the words of one inside the other is agreement…
        var a = typedKind.split('_'), hits = 0;
        for (var w = 0; w < a.length; w++) {
          if (a[w].length > 2 && mine.indexOf(a[w]) !== -1) hits++;
        }
        verdict = hits ? 'yes' : 'no';
        if (verdict === 'no') why = 'the paper reads as ' + mine;
      }
    } else if (it.fact === 'issuer') {
      mine = found.issuer;
      if (!mine) { why = 'no issuer on the paper'; }
      else {
        // PEOPLE TYPE THE SHORT NAME.
        var tv = it.value.toLowerCase();
        verdict = (mine.indexOf(tv) !== -1 || tv.indexOf(mine) !== -1) ? 'yes' : '';
        if (!verdict) {
          var tw = tv.split(/[^a-z0-9]+/);
          for (var iW = 0; iW < tw.length; iW++) {
            if (tw[iW].length > 3 && mine.indexOf(tw[iW]) !== -1) { verdict = 'yes'; break; }
          }
          if (!verdict) verdict = 'no';
        }
        if (verdict === 'no') why = 'the paper says ' + mine;
      }
    } else if (it.fact === 'number') {
      var digits = it.value.replace(/\D+/g, '');
      if (digits.length < 4) continue;   // too short to mean anything
      var nums = found.numbers || [];
      verdict = 'no';
      for (var nI = 0; nI < nums.length; nI++) {
        // A CARD PRINTS THE NUMBER; A PERSON TYPES IT WITH ITS DASHES AND SOMETIMES ITS YEAR.
        var mineDigits = String(nums[nI]).replace(/\D+/g, '');
        if (mineDigits.length >= 4 &&
            (mineDigits.indexOf(digits) !== -1 || digits.indexOf(mineDigits) !== -1)) {
          verdict = 'yes'; mine = String(nums[nI]); break;
        }
      }
      if (verdict === 'no') {
        if (!nums.length) { verdict = ''; why = 'the paper prints no number'; }
        else why = 'no number on the paper matches';
      }
    } else {
      // house and client are ANSWERED BY NAME and anchored BY ID — the two cannot be compared until an invite says…
      why = 'name answered, id not established';
    }
    if (verdict === 'yes') yes++;
    if (verdict === 'no') no++;
    out.push({ key: it.key, label: it.label, kind: it.kind, fact: it.fact,
               said: it.value, found: mine, agree: verdict, note: why });
  }
  if (no) agree = 'no'; else if (yes) agree = 'yes';
  return { items: out, agree: agree, fill: fill, yes: yes, no: no };
}

// WHAT KIND OF DOCUMENT THIS IS — finer than the category, because nobody is going to tell us what it is, and for…
var DIGEST_DOC_KINDS = [
  // --- training and certification -------------------------------------- A DO-NOT-RESUSCITATE ORDER IS NOT A CPR…
  ['dnr', 'medical',
   ['do not resuscitate', 'dnr comfort care', 'dnrcc', 'dnr order',
    'do-not-resuscitate'],
   { file: ['dnr'] }],
  ['cpr_first_aid', 'certification_training',
   ['cpr', 'first aid', 'bls', 'basic life support', 'aed certification',
    'heartsaver', 'cpr aed', 'adult first aid'],
   { file: ['cpr', 'firstaid', 'bls', 'aed', 'heartsaver'] }],
  // "The Mandt System" is how that certificate names itself in its first line — without it the generic "certificate…
  ['crisis_prevention', 'certification_training',
   ['cpi', 'crisis prevention', 'mandt', 'handle with care', 'de-escalation', 'the mandt system']],
  ['med_admin_cert', 'certification_training',
   ['medication administration certification', 'category 1 medication',
    'delegated nursing', 'med cert']],
  // THE WORDS THAT PAPER ACTUALLY CARRIES, read off Malik Conner's own certificate once the second reader could…
  ['dodd_certification', 'certification_training',
   ['dodd certification', 'provider certification', 'certification number ci',
    'direct support professional', 'dsp', 'oac 5123', 'orc 5123',
    'initial certification', 'nadsp'],
   { file: ['dodd', 'dsp'] }],
  // THE SHAPE A TRAINING PLATFORM PRINTS (2026-09-11).
  ['training_transcript', 'certification_training',
   ['training record', 'course completion', 'continuing education', 'ceu',
    'in-service', 'this certificate is proudly presented to', 'for completing',
    'the following topics are covered in this module', 'total seat time',
    'annual training', 'additional annual training', 'skills development']],
  ['diploma', 'certification_training',
    // file hints below: the onboarding lane names these files for the slot they were uploaded into, which is a…
   ['diploma', 'ged certificate', 'associate of', 'bachelor of', 'transcript',
    'has completed the prescribed requirements for graduation',
    'satisfactorily completed all requirements for graduation',
    'board of education', 'west african examinations council', 'waecdirect',
    'wassce', 'waec', 'senior high school', 'course of study recommended by the state'],
   { file: ['diploma', 'hsdiploma', 'ged', 'highschool', 'wassce', 'waec'] }],
  // --- medical ---------------------------------------------------------- THE WORDS THE OFFICE TYPES WHEN IT SAVES…
  ['mar', 'medical',
   ['medication administration record', 'mar sheet', 'mars'],
   { file: ['mar', 'mars'] }],
  ['prescription', 'medical',
   ['prescription', 'refills', 'dispense as written', 'sig:', 'rx #'],
   // "Finney's Packing Slip" is 407 titles out of 417 and names a document.
   { file: ['prescription', 'rx'] }],
  ['physician_order', 'medical',
   ["physician's order", 'physician order', 'provider order', 'signed order',
    'plan of care order'],
   /* "physican" without the second i is how the office spells it, 23 times */
   { file: ['physician orders', 'physican orders', 'orders'] }],
  ['lab_result', 'medical',
   ['laboratory report', 'lab result', 'reference range', 'specimen',
    'hemoglobin', 'a1c']],
  ['tb_test', 'medical',
   ['tuberculin', 'ppd', 'mantoux', 'tb test', 'tb skin test', 'quantiferon'],
   { file: ['tb', 'ppd', 'mantoux'] }],
  ['immunization', 'medical',
   ['immunization', 'vaccination record', 'vaccine', 'influenza', 'covid-19 vaccin'],
   { file: ['vax', 'vaccine', 'covid', 'flu', 'immunization'] }],
  ['physical_exam', 'medical',
   ['physical examination', 'history and physical', 'annual physical',
    'fit for duty'],
   { file: ['physical'] }],
  ['drug_screen', 'medical',
   ['drug screen', 'urinalysis', 'panel drug test', 'negative dilute']],
  ['therapy_eval', 'medical',
   ['physical therapy', 'occupational therapy', 'speech therapy',
    'pt evaluation', 'ot evaluation', 'slp']],
  ['nursing_assessment', 'medical',
   ['nursing assessment', 'rn assessment', 'skilled nursing', 'nursing delegation']],
  ['seizure_protocol', 'medical',
   ['seizure protocol', 'seizure action plan', 'rescue medication']],
  ['dietary_plan', 'medical',
   ['dietary order', 'nutrition plan', 'texture modified', 'thickened liquid',
    'dysphagia']],
  ['discharge_summary', 'medical',
   ['discharge summary', 'hospital discharge', 'after visit summary']],
  ['appointment_summary', 'medical',
   ['visit summary', 'appointment summary', 'follow-up appointment',
    // the office note as the clinic's own system prints it — Cerner's "Result type: Urology New Patient Office…
    'office visit note', 'office note', 'progress note', 'clinical note',
    'result type:', 'after visit summary', 'visit note'],
   { file: ['visitsummary', 'officenote', 'visitnote'] }],
  ['dental_vision', 'medical',
   ['dental exam', 'dentist', 'optometry', 'vision exam', 'audiology']],
  /* --- the person's plan ------------------------------------------------ */
  ['isp', 'care_plan',
   ['individual service plan', 'person-centered plan', 'isp effective',
    'outcomes and supports', 'service and support administrator',
    // OISP is what this company calls it, and "service plan" is what the filename says — one plan came back a…
    'oisp', 'service plan', 'ohio individual service plan',
    'outcome and support', 'ssa signature'],
   { file: ['isp', 'oisp', 'serviceplan'] }],
  ['behavior_plan', 'care_plan',
   ['behavior support plan', 'behavior plan', 'functional behavior', 'bsp'],
   { file: ['bsp', 'behavior', 'behavior assessment', 'behavior support'] }],
  ['amfm', 'care_plan', ['amfm', 'acuity assessment', 'assessment matrix'],
   { file: ['amfm'] }],
  ['iep', 'care_plan', ['individualized education', 'iep team']],
  /* --- incidents -------------------------------------------------------- */
  ['mui', 'incident', ['major unusual incident', 'mui report', 'mui number'],
   { file: ['mui'] }],
  ['unusual_incident', 'incident',
   ['unusual incident', 'ui report', 'mui reporting form'],
   { file: ['ui', 'mui reporting', 'reporting form'] }],
  ['restraint_report', 'incident',
   ['restraint', 'seclusion', 'physical intervention']],
  ['incident_followup', 'incident',
   ['root cause', 'corrective action', 'incident follow-up']],
  /* --- who somebody is -------------------------------------------------- */
  ['drivers_licence', 'identity',
   ['driver license', "driver's license", 'driver licence', 'operator license',
    'dl no', 'class d']],
  ['state_id', 'identity', ['state identification', 'identification card']],
  // A DRIVING RECORD IS NOT A LICENCE (2026-09-11).
  ['driver_abstract', 'legal',
   ['driving record', 'driver abstract', "driver's abstract", 'driver record',
    'unofficial 2-year driving record', 'license status as of', 'mvr report',
    'abstract of driving record'],
   { file: ['abstract', 'mvr', 'drivingrecord'] }],
  ['ssn_card', 'identity', ['social security card', 'social security number'],
   { file: ['ssn', 'socialsecurity'] }],
  ['birth_certificate', 'identity',
   ['certificate of live birth', 'birth certificate', 'certificate of birth',
    'state file number', 'registrar of vital statistics', 'place of birth'],
   { file: ['birthcertificate', 'birthcert'] }],
  ['passport', 'identity', ['passport no', 'united states of america passport']],
  ['work_authorization', 'identity',
   ['employment eligibility verification', 'i-9', 'permanent resident',
    'work authorization'],
   { file: ['i9', 'i-9'] }],
  ['medicaid_card', 'identity',
   ['medicaid', 'managed care plan', 'medical card'],
   { file: ['medicaid'] }],
  ['medicare_card', 'identity', ['medicare'], { file: ['medicare'] }],
  /* --- insurance -------------------------------------------------------- */
  ['auto_insurance', 'insurance',
   ['auto insurance', 'insurance identification card', 'policy number',
    'coverage period', 'liability limits']],
  ['liability_insurance', 'insurance',
   ['general liability', 'certificate of insurance', 'acord']],
  ['health_insurance', 'insurance',
   ['subscriber id', 'group number', 'health plan member']],
  // --- legal and housing ------------------------------------------------ CJIS is what this company calls it, and…
  ['background_check', 'legal',
   ['cjis', 'bci', 'fbi', 'background check', 'criminal records check',
    'bureau of criminal', 'records check', 'fingerprint', 'webcheck',
    'rap back', 'court record'],
   { file: ['cjis', 'bci', 'fbi', 'bg', 'background'] }],
  ['guardianship', 'legal',
   ['guardianship', 'guardian of the person', 'probate court'],
   { file: ['guardianship', 'probate'] }],
  ['court_order', 'legal', ['court order', 'judgment entry', 'case no']],
  ['consent_release', 'legal',
   ['authorization to release', 'release of information', 'hipaa',
    'photo release', 'consent form'],
   { file: ['consent', 'consent form', 'release form'] }],
  // NOT bare "tenant": this platform's own architecture papers are full of multi-tenant talk, and one of them came…
  ['lease', 'legal',
   ['lease agreement', 'landlord', 'rent due', 'tenancy', 'security deposit',
    'monthly rent'],
   { file: ['lease', 'apartment lease'] }],
  /* --- money and time --------------------------------------------------- */
  ['timesheet', 'timesheet',
   ['timesheet', 'time sheet', 'hours worked', 'pay period', 'clock in'],
   { file: ['timesheet', 'hours'] }],
  ['paystub', 'timesheet',
   ['pay stub', 'earnings statement', 'gross pay', 'net pay', 'ytd'],
   { file: ['paystub', 'pay stub'] }],
  ['tax_form', 'timesheet',
   ['w-2', 'wage and tax statement', '1099', 'w-4', 'withholding certificate',
    'it-4'],
   { file: ['w2', 'w4', 'w-2', 'w-4', '1099', 'it4'] }],
  ['bank_statement', 'receipt_invoice',
   ['bank statement', 'beginning balance', 'ending balance',
    'statement of account'],
   // the card the money actually arrives on: "True Link Statement" is 108 titles out of 108, and…
   { file: ['true link', 'link statement', 'statement', 'activity'] }],
  ['benefit_letter', 'receipt_invoice',
   ['social security administration', 'benefit verification', 'award letter',
    'supplemental nutrition assistance', 'snap benefits', 'job and family services',
    'food assistance', 'notice of approval', 'benefits notice',
    'ssi payment', 'ssdi', 'food bank', 'commodity supplemental food program',
    'csfp'],
   { file: ['snap', 'jfs', 'foodbank'] }],
  ['utility_bill', 'receipt_invoice',
   ['service address', 'electric bill', 'water bill', 'gas bill',
    'amount of your bill']],
  /* --- the house and the fleet ------------------------------------------ */
  ['fire_drill', 'other', ['fire drill', 'evacuation drill', 'drill log']],
  ['inspection', 'other',
   ['inspection report', 'fire marshal', 'health department',
    'safety inspection']],
  ['vehicle', 'other',
   // NOT 'vin ' — it lives inside Kevin, Melvin and Calvin, which is how a service plan became a vehicle title
   ['vehicle registration', 'odometer reading', 'certificate of title',
    'vehicle identification number', 'license plate'],
   { file: ['vehicle', 'title', 'registration'] }],
  // --- hiring ----------------------------------------------------------- A RÉSUMÉ ANNOUNCES ITSELF IN STRUCTURE.
  ['application_resume', 'other',
   ['employment application', 'work history', 'curriculum vitae', 'resume',
    'professional summary', 'work experience', 'employment history',
    'skills', 'references available', 'career objective', 'education'],
   { file: ['resume', 'cv', 'application'] }],
  ['reference_check', 'other',
   ['reference check', 'professional reference', 'employment verification']],
  ['offer_letter', 'other',
   ['offer of employment', 'offer letter', 'rate of pay', 'start date of']],
  // --- the generic words, LAST ------------------------------------------ --- THE BENCH'S FIRST BATCH (2026-09-14)…
  ['appointment_form', 'medical',
   ['medical appointment form', 'have the provider fill out',
    'appointment form', 'bring this form', 'orders if applicable'],
   { file: ['appointmentform', 'appointment'] }],
  ['tracking_sheet', 'medical',
   ['tracking sheet', 'weight tracker', 'blood sugar log', 'bathroom tracker',
    'daily weight', 'blood sugar', 'bowel movement', 'sleep log', 'seizure log',
    'vitals log', 'intake and output', 'u/bm'],
   { file: ['trackingsheet', 'trackingsheets', 'tracker', 'bloodsugar'] }],
  ['packing_slip', 'medical',
   ['packing slip', 'delivery route', 'nursing station', 'medication label',
    'shipping tote', 'deliver to'],
   { file: ['packingslip', 'packing'] }],
  ['self_admin_assessment', 'medical',
   ['self administration assessment', 'self-administration assessment',
    'self administration of medication', 'self-administer',
    'self admin assessment'],
   { file: ['selfadmin', 'selfadministration'] }],
  // A "PINK SLIP" HERE IS THE PHARMACY'S MISSING MEDICATION NOTIFICATION — Finney's tells the house what did not…
  ['missing_medication', 'medical',
   ['missing medication notification', 'missing medication', 'pink slip',
    'the following medications are not', 'not included in this delivery',
    'medications are not included'],
   { file: ['pinkslip', 'missingmedication', 'missingmed'] }],
  ['insurance_eob', 'insurance',
   ['explanation of benefits', 'this is not a bill', 'dual complete',
    'unitedhealthcare', 'hmo-pos', 'summary of benefits', 'claims paid'],
   { file: ['unitedhealthcare', 'eob', 'uhc'] }],
  ['summary_of_services', 'care_plan',
   ['summary of services and updates', 'summary of services & updates'],
   { file: ['summaryofservices'] }],
  ['prior_authorization', 'care_plan',
   ['your request for prior authorization', 'request for prior authorization',
    'prior authorization has been', 'prior authorization request form'],
   { file: ['priorauthor', 'priorauth'] }],
  ['privacy_notice', 'legal',
   ['notice of privacy practices', 'how medical information about you',
    'may be used and disclosed', 'hipaa'],
   { file: ['privacypractices', 'privacynotice'] }],
  ['daily_checklist', 'other',
   ['daily checklist', 'shift checklist', 'house checklist', 'chore list'],
   { file: ['dailychecklist', 'checklist'] }],
  // --- THE BENCH'S SECOND ROUND (2026-09-14, afternoon) ------------------ 373 papers still had real text and no…
  ['hospice_note', 'medical',
   ['hospice nurse notes', 'hospice notes', 'hospice visit note',
    'crossroads hospice', 'hospice aide visit', 'hospice fax'],
   { file: ['hospicenotes', 'hospicenurse', 'hospicenote'] }],
  ['daily_report', 'other',
   ['daily report', 'shift report', 'shift notes', 'daily notes',
    'end of shift'],
   { file: ['dailyreport', 'daily-report', 'shiftreport'] }],
  ['funds_ledger', 'receipt_invoice',
   ['date of transaction', 'transaction type', 'transaction category',
    'amount of transaction', 'description of transaction', 'funds ledger',
    'personal funds', 'individual funds record', 'individual funds',
    'waiver recipient'],
   { file: ['transactions', 'fundsledger', 'spending'] }],
  ['medication_list', 'medical',
   ['medication list', 'current medications', 'active medications',
    'medication reconciliation', 'list of medications'],
   { file: ['medicationlist', 'medlist'] }],
  ['receipt', 'receipt_invoice',
   ['receipt', 'amount due', 'subtotal', 'total paid', 'change due'],
   // the weight stays low — "receipt" is a word a hundred documents use — but a title that SAYS receipt is a claim…
   { w: 0.5, file: ['receipt', 'amazon'] }],
  ['invoice', 'receipt_invoice', ['invoice', 'bill to', 'remit to'], { w: 0.5 }],
  ['certificate', 'certification_training',
   ['certificate of completion', 'certificate', 'certification'], { w: 0.4 }],
  ['agreement', 'legal', ['agreement', 'contract', 'waiver', 'acknowledgment'],
   { w: 0.3 }]
];

// { kind, category, alt } — SCORED, not first-hit-wins.
function digestPlainDashes_(s) {
  return String(s || '').replace(/[\u2010-\u2015\u2212\u00ad]/g, '-');
}

function digestDocKind_(filename, text) {
  var name = digestPlainDashes_(String(filename || '').toLowerCase());
  // THE FILENAME'S OWN WORDS.
  var words = ' ' + name.replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  var tight = name.replace(/[^a-z0-9]+/g, '');
  var body = digestPlainDashes_(String(text || '').slice(0, DIGEST_SCAN_CAP).toLowerCase());
  var head = body.slice(0, 2000);
  /* THE LETTERHEAD: the first lines, where a paper says what it is. */
  var lead = body.slice(0, 300);
  var bodyWeight = body.length > 20000 ? 0.5 : 1;
  var best = null, second = null, spoke = null;
  var kinds = digestKinds_();
  for (var i = 0; i < kinds.length; i++) {
    var needles = kinds[i][2];
    var opts = kinds[i][3] || {};
    var score = 0;
    var matched = 0;
    var nameHit = false;
    var leadHit = false;
    for (var n = 0; n < needles.length; n++) {
      var needle = needles[n];
      var seen = false;
      if (name.indexOf(needle) !== -1) { score += 5; seen = true; nameHit = true; }
      if (head.indexOf(needle) !== -1) { score += 3; seen = true; }
      if (needle.length >= 8 && lead.indexOf(needle) !== -1) leadHit = true;
      // A MENTION IS NOT A SUBJECT.
      var at = body.indexOf(needle), hits = 0;
      while (at !== -1 && hits < 3) { hits++; at = body.indexOf(needle, at + needle.length); }
      score += hits * bodyWeight;
      if (hits) seen = true;
      if (seen) matched++;
    }
    // the abbreviations, in the filename only
    for (var h = 0; h < (opts.file || []).length; h++) {
      var hint = String(opts.file[h]);
      var found = /[^a-z0-9]/.test(hint)
        ? name.indexOf(hint) !== -1
        : words.indexOf(' ' + hint + ' ') !== -1;
      // A LONG HINT IS THE TITLE'S WORDS RUN TOGETHER.
      if (!found && hint.length >= 7 && /^[a-z0-9]+$/.test(hint)) {
        found = tight.indexOf(hint) !== -1;
      }
      if (found) { score += 6; nameHit = true; }
    }
    // SEVERAL DIFFERENT MARKERS BEAT ONE WORD REPEATED.
    if (matched > 1) score += (matched - 1) * 3;
    // A GENERIC WORD IS A WEAK REASON.
    if (opts.w !== undefined) score = score * opts.w;
    if (!score) continue;
    var entry = { kind: kinds[i][0], category: kinds[i][1], score: score,
                  named: nameHit, lead: leadHit };
    // A TIE IS BROKEN BY THE TITLE.
    if (!best || score > best.score ||
        (score === best.score && nameHit && !best.named)) {
      second = best; best = entry;
    } else if (!second || score > second.score) { second = entry; }
    if (leadHit && (!spoke || score > spoke.score)) spoke = entry;
  }
  if (!best) return { kind: '', category: '', alt: '' };
  // A PAPER THAT NAMES ITSELF IN ITS FIRST LINES OUTRANKS ONE THAT IS ONLY MENTIONED.
  if (spoke && spoke !== best && !best.lead && !best.named &&
      spoke.score >= best.score * 0.75) {
    second = best; best = spoke;
  }
  return { kind: best.kind, category: best.category,
           alt: second ? second.kind + ':' + second.score : '',
           score: best.score };
}

// "7/2028" →.
function digestMonthEnd_(raw) {
  var m = /^(\d{1,2})[\/\-.]((?:20)?\d{2})$/.exec(String(raw || '').trim());
  if (!m) return '';
  var mo = Number(m[1]);
  var y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return '';
  var last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + last).slice(-2);
}

/** One date string, US or ISO, into ISO — or '' rather than a wrong day. */
function digestOneDate_(raw) {
  var s = String(raw || '').trim();
  if (/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(s)) return s;
  // (?:19|20) and not just 20: a date of birth is the one date on a card that is NOT in this century, and the…
  var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]((?:19|20)?\d{2})$/.exec(s);
  if (!m) return '';
  var y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  var mo = Number(m[1]), d = Number(m[2]);
  // 1900, NOT 2000.
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

// ISSUED and EXPIRES, when the document itself says which is which.
var DIGEST_DATE_ROLE_WORDS = {
  born: ['date\\s+of\\s+birth', 'birth\\s*date', 'd\\.?o\\.?b\\.?', 'born(?:\\s+on)?'],
  expires: ['expires?(?:\\s+on)?', 'expiration(?:\\s+date)?', 'expiry(?:\\s+date)?',
            'exp\\b', 'valid\\s+(?:through|thru|until|to)', 'good\\s+(?:through|thru|until)',
            'renew(?:al)?\\s+(?:by|date|on)', 'recertification\\s+due',
            'coverage\\s+ends(?:\\s+on)?', 'period\\s+ends(?:\\s+on)?', 'ends\\s+on'],
  issued: ['issued?(?:\\s+on)?', 'issue\\s+date', 'date\\s+of\\s+issue', '(?:4a\\s*)?iss\\b',
           'class\\s+completion\\s+date', 'completion\\s+date', 'date\\s+completed',
           'completed(?:\\s+on)?', 'bci\\s+completion\\s+date', 'date\\s+processed',
           'date\\s+of\\s+search', 'search\\s+date', 'valid\\s+from',
           'licen[sc]e\\s+status\\s+as\\s+of', 'status\\s+as\\s+of', 'as\\s+of',
           'date\\s+printed', 'report\\s+date',
           'effective(?:\\s+date)?(?:\\s+from)?', 'coverage\\s+begins(?:\\s+on)?',
           'date\\s+signed', 'date\\s+(?:record\\s+)?filed(?:\\s+by\\s+registrar)?',
           'course\\s+date', 'date\\s+of\\s+(?:course|class)']
};
// every shape a printed date takes, as one alternation — the numeric ones first, then the written-out month, then…
var DIGEST_DATE_TOKEN =
  '(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.](?:19|20)?\\d{2}(?![0-9])' +
  '|(?:19|20)\\d{2}-\\d{2}-\\d{2}' +
  '|\\d{1,2}[\\/\\-.](?:19|20)\\d{2}(?![0-9\\/\\-.])' +
  '|[A-Za-z]{3,9}\\.?,?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}' +
  '|[A-Za-z]{3,9}\\.?,?\\s+(?:19|20)\\d{2}' +
  '|\\d{1,2}(?:st|nd|rd|th)?\\s+day\\s+of\\s+[A-Za-z]{3,9},?\\s+(?:19|20)\\d{2})';

/** One printed date, whatever its shape, as ISO — '' when it is not one. */
function digestAnyDate_(raw) {
  var s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  var iso = digestOneDate_(s);
  if (iso) return iso;
  var m = /^(\d{1,2})[\/\-.]((?:19|20)\d{2})$/.exec(s);
  if (m) return digestMonthEnd_(s);
  m = /^([A-Za-z]{3,9})\.?,?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?((?:19|20)\d{2})$/.exec(s);
  if (m) {
    var mo = DIGEST_MONTH_WORDS[m[1].toLowerCase()];
    if (!mo) return '';
    var y = Number(m[3]);
    var d = m[2] ? Number(m[2]) : digestLastDay_(y, mo);
    if (d < 1 || d > 31) return '';
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]{3,9}),?\s+((?:19|20)\d{2})$/i.exec(s);
  if (m) {
    var mo2 = DIGEST_MONTH_WORDS[m[2].toLowerCase()];
    if (!mo2) return '';
    return m[3] + '-' + ('0' + mo2).slice(-2) + '-' + ('0' + Number(m[1])).slice(-2);
  }
  return '';
}

// A CAPTION ROW ABOVE A VALUE ROW.
function digestDateRowPairs_(s) {
  var out = {};
  var lines = String(s).split('\n');
  var labelRe = [];
  var roleOf = [];
  for (var role in DIGEST_DATE_ROLE_WORDS) {
    if (role === 'born') continue;
    for (var w = 0; w < DIGEST_DATE_ROLE_WORDS[role].length; w++) {
      labelRe.push(DIGEST_DATE_ROLE_WORDS[role][w]);
      roleOf.push(role);
    }
  }
  var anyLabel = new RegExp('(' + labelRe.join(')|(') + ')', 'gi');
  var anyDate = new RegExp(DIGEST_DATE_TOKEN, 'g');
  for (var i = 0; i < lines.length; i++) {
    var cap = lines[i];
    if (!cap || cap.length > 160) continue;
    anyDate.lastIndex = 0;
    if (anyDate.test(cap)) continue;              // a value line is not a caption line
    var labels = [];
    var m;
    anyLabel.lastIndex = 0;
    while ((m = anyLabel.exec(cap)) !== null) {
      for (var g = 1; g < m.length; g++) {
        if (m[g] !== undefined) { labels.push(roleOf[g - 1]); break; }
      }
    }
    if (!labels.length) continue;
    for (var j = i + 1; j < lines.length && j <= i + 2; j++) {
      var val = lines[j];
      if (!val || !val.trim()) continue;
      anyLabel.lastIndex = 0;
      if (anyLabel.test(val)) break;              // the next caption row, not values
      var dates = [];
      var d;
      anyDate.lastIndex = 0;
      while ((d = anyDate.exec(val)) !== null) {
        var iso = digestAnyDate_(d[1]);
        if (iso) dates.push(iso);
      }
      if (!dates.length) continue;
      if (dates.length !== labels.length) break;
      for (var k = 0; k < labels.length; k++) {
        if (!out[labels[k]]) out[labels[k]] = dates[k];
      }
      break;
    }
  }
  return out;
}

function digestDateRoles_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP).replace(/\r/g, '\n');
  var found = { issued: '', expires: '', born: '', how: {} };
  var used = {};
  function take(role, iso, how) {
    if (!iso || found[role] || used[iso]) return false;
    found[role] = iso;
    found.how[role] = how;
    used[iso] = role;
    return true;
  }
  /* the shapes that carry two dates in one breath */
  var range = new RegExp('(?:effective|valid|coverage|period|term)\\s*(?:dates?)?\\s*(?:from|:)?\\s*' +
                         DIGEST_DATE_TOKEN + '\\s*(?:to|through|thru|until|-|–)\\s*' +
                         DIGEST_DATE_TOKEN, 'i').exec(s);
  if (range) {
    take('issued', digestAnyDate_(range[1]), 'range');
    take('expires', digestAnyDate_(range[2]), 'range');
  }
  var rows = digestDateRowPairs_(s);
  // born goes first on purpose: a date of birth must never become an issue date, and it is printed on every…
  var order = ['born', 'expires', 'issued'];
  for (var r = 0; r < order.length; r++) {
    var role = order[r];
    if (rows[role]) take(role, rows[role], 'row');
    if (found[role]) continue;
    var best = null;
    var words = DIGEST_DATE_ROLE_WORDS[role];
    for (var w = 0; w < words.length; w++) {
      var re = new RegExp(words[w], 'gi');
      var m;
      while ((m = re.exec(s)) !== null) {
        var at = m.index, end = at + m[0].length;
        // FORWARD: the label, then punctuation or a line break, then the date.
        var fwd = new RegExp('^([^0-9A-Za-z]{0,12})' + DIGEST_DATE_TOKEN, 'i').exec(s.slice(end, end + 48));
        if (fwd) {
          var isoF = digestAnyDate_(fwd[2]);
          if (isoF && !used[isoF]) {
            var dist = fwd[1].length - (fwd[1].indexOf(':') !== -1 ? 1 : 0);
            if (!best || dist < best.dist) best = { iso: isoF, dist: dist, how: 'forward' };
          }
        }
        // BACKWARD: the date, then at most one short word, then the caption.
        var back = new RegExp(DIGEST_DATE_TOKEN + '([^0-9A-Za-z]{0,4}(?:[A-Za-z]{2,10}[^0-9A-Za-z]{0,3})?)$', 'i')
          .exec(s.slice(Math.max(0, at - 48), at));
        if (back) {
          var isoB = digestAnyDate_(back[1]);
          if (isoB && !used[isoB]) {
            var distB = back[2].length + 1;
            if (!best || distB < best.dist) best = { iso: isoB, dist: distB, how: 'backward' };
          }
        }
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    if (best) take(role, best.iso, best.how);
  }
  /* an expiry before its own issue date is a misread, not a fact */
  if (found.issued && found.expires && found.expires < found.issued) {
    found.how.conflict = found.expires + ' before ' + found.issued;
    found.expires = '';
  }
  return found;
}

/** ISO + months, the day clamped to the month it lands in. */
function digestAddMonths_(iso, months) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m || !months) return '';
  var y = Number(m[1]), mo = Number(m[2]) - 1 + Number(months), d = Number(m[3]);
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  var last = digestLastDay_(y, mo + 1);
  if (d > last) d = last;
  return y + '-' + ('0' + (mo + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
}

// HOW LONG A PAPER STAYS GOOD WHEN IT DOES NOT SAY.
var DIGEST_RENEWAL_FLOOR = { dodd_8hr: 12, cpr_first_aid: 24, med_del: 12, car_insurance: 12 };
function digestRenewalMonths_(docId) {
  var id = String(docId || '');
  if (!id) return 0;
  try {
    if (typeof filesCatalog_ === 'function') {
      var cat = filesCatalog_() || [];
      for (var i = 0; i < cat.length; i++) {
        if (String(cat[i].doc_id) === id) return Number(cat[i].renewal_months) || 0;
      }
    }
  } catch (e) { /* the floor answers */ }
  return DIGEST_RENEWAL_FLOOR[id] || 0;
}

/** Papers that print ONE date and mean it: the day they were granted. */
var DIGEST_SINGLE_DATE_KINDS = {
  dodd_certification: 1, diploma: 1, cpr_first_aid: 1, med_admin_cert: 1,
  crisis_prevention: 1, training_transcript: 1, ssn_card: 1, background_check: 1,
  // the bench's first batch (2026-09-14): a delivery slip, a tracker, a visit form, a benefit notice each carry the…
  packing_slip: 1, missing_medication: 1, tracking_sheet: 1, appointment_form: 1,
  self_admin_assessment: 1, benefit_letter: 1, insurance_eob: 1, daily_checklist: 1,
  daily_report: 1
};

// THE DATES A PAPER MEANS WHEN ITS LABELS DID NOT SURVIVE THE SCAN.
function digestRolesFinish_(docKind, roles, dates, today) {
  var out = { issued: roles.issued || '', expires: roles.expires || '',
              born: roles.born || '', how: roles.how || {}, source: '' };
  if (out.expires) out.source = 'paper';
  var now = String(today || new Date().toISOString().slice(0, 10));
  var cred = digestCredentialFor_(docKind);
  var clean = [];
  for (var i = 0; i < (dates || []).length; i++) {
    var d = dates[i];
    if (!d || d === out.born || d < '1990-01-01') continue;
    if (clean.indexOf(d) === -1) clean.push(d);
  }
  clean.sort();
  if (!out.issued && !out.expires && clean.length === 2 && cred && cred.expires) {
    out.issued = clean[0];
    out.expires = clean[1];
    out.how.issued = 'pair';
    out.how.expires = 'pair';
    out.source = 'pair';
  }
  if (!out.issued && !out.expires && clean.length === 1 && DIGEST_SINGLE_DATE_KINDS[docKind]) {
    if (clean[0] <= now) { out.issued = clean[0]; out.how.issued = 'single'; }
    else if (cred && cred.expires) { out.expires = clean[0]; out.how.expires = 'single'; out.source = 'single'; }
  }
  if (!out.expires && out.issued && cred && cred.expires) {
    var months = digestRenewalMonths_(cred.doc_id);
    if (months) {
      var got = digestAddMonths_(out.issued, months);
      if (got) { out.expires = got; out.how.expires = 'derived'; out.source = 'derived:' + months + 'm'; }
    }
  }
  return out;
}

// WHICH CATEGORY OF MEDICATION ADMINISTRATION.
function digestMedLevel_(text) {
  var rows = digestCertGrid_(text);
  var live = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].status === 'certified' && live.indexOf(rows[i].level) === -1) live.push(rows[i].level);
  }
  if (live.length) { live.sort(); return live.join(','); }
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP);
  var m = /\bcat(?:egory)?\s*[\-–:]?\s*(1|2|3|i{1,3})\b/i.exec(s);
  return m ? digestRoman_(m[1]) : '';
}

function digestRoman_(v) {
  var t = String(v || '').toLowerCase();
  if (t === 'i') return '1';
  if (t === 'ii') return '2';
  if (t === 'iii') return '3';
  return /^[123]$/.test(t) ? t : '';
}

// THE CERTIFICATION GRID — one paper, several credentials.
function digestCertGrid_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP).replace(/\r/g, '\n');
  var lines = s.split('\n');
  var re = /cat(?:egory)?\s*[\-–]?\s*(i{1,3}|[123])\b[^0-9A-Za-z]{0,6}([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})[^0-9A-Za-z]{0,6}([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i;
  var out = [];
  for (var i = 0; i < lines.length && out.length < 16; i++) {
    var m = re.exec(lines[i]);
    if (!m) continue;
    var level = digestRoman_(m[1]);
    if (!level) continue;
    var st = /(certified|expired|revoked|pending|active)/i.exec(lines[i]);
    out.push({ level: level,
               effective: digestOneDate_(m[2]),
               expires: digestOneDate_(m[3]),
               status: st ? st[1].toLowerCase() : '' });
  }
  return out;
}

/** Which DODD training a certificate of completion is for. */
function digestProgram_(text) {
  var s = String(text || '').slice(0, 4000).toLowerCase();
  if (/8\s*[- ]?\s*hour\s+(?:\d{4}\s+)?annual\s+training|annual\s+training/.test(s)) return 'dodd_8hr';
  if (/training\s+for\s+new\s+direct\s+support|initial\s+training|initial\s+certification/.test(s)) return 'dodd_initial';
  return '';
}

/** WHAT A BACKGROUND CHECK SAID: clear, records, or nothing readable. */
function digestCheckResult_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP).toLowerCase();
  // SPELLED OUT AS WELL AS ABBREVIATED: an FBI letter is headed "Federal Bureau of Investigation" and never says…
  var isBci = /\bbci\b|bureau\s+of\s+criminal\s+investigation|webcheck/.test(s);
  var isFbi = /\bfbi\b|federal\s+bureau\s+of\s+investigation|identity\s+history\s+summary/.test(s);
  var agency = (isBci ? 'BCI' : '') + (isFbi ? (isBci ? '/FBI' : 'FBI') : '');
  var result = '';
  if (/no\s+(?:bci\s+|fbi\s+)?(?:convictions?|criminal\s+record|record|arrest\s+record|prior\s+arrest)|no\s+record\s+found|not\s+found|no\s+results|no\s+disqualifying|no\s+matching|none\s+found|is\s+clear|cleared/.test(s)) {
    result = 'clear';
  } else if (/convictions?\s+on\s+file|record\s+found|criminal\s+history\s+(?:record\s+)?(?:follows|attached)|disqualifying\s+offen[cs]e/.test(s)) {
    result = 'records';
  }
  return { agency: agency, result: result };
}

// A SECRET IS NEVER STORED IN THE CLEAR.
function digestRedact_(text, docKind) {
  var last4 = [];
  var s = String(text || '');
  function mask(all, a, b, c) {
    if (last4.indexOf(c) === -1) last4.push(c);
    return '***-**-' + c;
  }
  // THE FORM'S OWN SHAPE, always: three, two, four.
  s = s.replace(/\b(\d{3})[\s\-.](\d{2})[\s\-.](\d{4})\b/g, mask);
  // AND THE SHAPE AN OCR ACTUALLY PRODUCES.
  var says = /social\s*security|this\s+number\s+has\s+been\s+established/i.test(s.slice(0, 4000));
  if (says || String(docKind || '') === 'ssn_card') {
    s = s.replace(/\b(\d{3})[\s\-.](\d{3})[\s\-.](\d{4})\b/g, mask);
    s = s.replace(/\b(\d{3})[\s\-.]?(\d{2})[\s\-.]?(\d{4})\b/g, mask);
  }
  return { text: s, ssn_last4: last4 };
}

// WHOSE DOCUMENT IT IS — written as an ID, never a name, by law.
var DIGEST_ROSTER = null;

// AN ORGANISATION IS NOT A MEMBER OF STAFF.
function digestIsOrganisation_(name) {
  var n = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return true;
  var orgs = digestOrgNames_();
  for (var i = 0; i < orgs.length; i++) {
    if (n === orgs[i] || n.indexOf(orgs[i]) !== -1) return true;
  }
  return /\b(llc|inc|incorporated|corp|company|services|solutions|agency|center|centre|clinic|hospital|pharmacy|department|bureau|association|foundation|university|college|school|county|state of)\b/.test(n);
}

function digestWhoIs_(text, filename) {
  if (!DIGEST_ROSTER) {
    DIGEST_ROSTER = [];
    // BOTH ROSTERS, because both kinds of document arrive through the same door: an ISP is about a CLIENT, a CPR…
    try {
      var staff = listRows_('people', {}) || [];
      for (var i = 0; i < staff.length; i++) {
        var sd = String(staff[i].name || '').trim().replace(/\s+/g, ' ');
        var sid = str_(staff[i].id);
        // a single word is not a person: too many false hits in a document
        if (sid && sd.indexOf(' ') !== -1 && !digestIsOrganisation_(sd)) {
          DIGEST_ROSTER.push({ id: 'people:' + sid, name: sd.toLowerCase(),
                               display: sd, kind: 'staff' });
        }
      }
    } catch (e) { /* the roster is a lookup, never a requirement */ }
    try {
      var clients = listRows_('clients', {}) || [];
      for (var c = 0; c < clients.length; c++) {
        var cd = String(clients[c].name || '').trim().replace(/\s+/g, ' ');
        var ck = String(clients[c].client_key || '').trim() || str_(clients[c].id);
        if (ck && cd.indexOf(' ') !== -1) {
          DIGEST_ROSTER.push({ id: 'client:' + ck, name: cd.toLowerCase(),
                               display: cd, kind: 'client' });
        }
      }
    } catch (e2) { /* same */ }
  }
  if (!DIGEST_ROSTER.length) return null;
  // THE FILENAME IS PART OF THE DOCUMENT for this purpose: "ISP - Sarina Bunting - 2025.pdf" says whose it is more…
  var hay = ' ' + (String(filename || '') + ' ' +
                   String(text).slice(0, DIGEST_SCAN_CAP)).toLowerCase()
    .replace(/['’\-]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ';
  var hit = null;
  for (var r = 0; r < DIGEST_ROSTER.length; r++) {
    var needle = ' ' + DIGEST_ROSTER[r].name.replace(/['’\-]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (hay.indexOf(needle) === -1) {
      // "MALIK DEEOZ CONNER" is Malik Conner: up to two middle words between a two-word roster name, and the card's…
      var parts = needle.trim().split(' ');
      if (parts.length !== 2) continue;
      var mid = new RegExp(' ' + parts[0] + ' (?:[a-z0-9]+ ){0,2}' + parts[1] + ' ');
      if (!mid.test(hay)) continue;
    }
    if (hit && hit.id !== DIGEST_ROSTER[r].id) return null;
    hit = DIGEST_ROSTER[r];
  }
  return hit;
}

// THE PERSON'S FULL NAME, even when this platform has never heard of them — the person's full name has to be…
var DIGEST_NAME_STOPWORDS = {
  isp: 1, mar: 1, mars: 1, cpr: 1, cjis: 1, bci: 1, fbi: 1, tb: 1, id: 1,
  copy: 1, scan: 1, final: 1, signed: 1, form: 1, doc: 1, document: 1,
  report: 1, plan: 1, card: 1, cert: 1, certificate: 1, licence: 1,
  license: 1, insurance: 1, receipt: 1, invoice: 1, new: 1, updated: 1,
  asa: 1, lifecare: 1, dawn: 1, brighter: 1, pdf: 1, jpg: 1, png: 1, docx: 1,
  // the words a FILENAME uses about the document, which a first cut read as names: "TB_Test_Corn_2026.pdf" is not a…
  test: 1, tests: 1, result: 1, results: 1, screen: 1, screening: 1,
  wassce: 1, waec: 1, abstract: 1, mvr: 1, bmv: 1, dodd: 1, meddel: 1,
  check: 1, checks: 1, record: 1, records: 1, front: 1, back: 1, side: 1,
  dl: 1, ss: 1, ssn: 1, w2: 1, w4: 1, i9: 1, ppd: 1, mui: 1, ui: 1,
  ohio: 1, state: 1, county: 1, current: 1, expired: 1, renewal: 1,
  upload: 1, file: 1, files: 1, photo: 1, image: 1, img: 1, scanned: 1,
  /* what the corpus calls its own paperwork */
  video: 1, clip: 1, recording: 1, screen: 1, tracking: 1, time: 1, psi: 1,
  database: 1, roster: 1, master: 1, list: 1, export: 1, backup: 1,
  report: 1, reports: 1, client: 1, clients: 1, staff: 1, data: 1,
  assessment: 1, assessments: 1, evaluation: 1, review: 1, summary: 1,
  note: 1, notes: 1, update: 1, annual: 1, quarterly: 1, monthly: 1,
  addendum: 1, revised: 1, draft: 1, packet: 1, packets: 1
};

function digestNameFromTitle_(filename) {
  // A NAME DOES NOT SPAN A DASH.
  var base = String(filename || '').replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\(\d+\)/g, ' ');
  // The underscore is a SPACE, not a separator: "CJIS_Alanna_Corn" is one phrase where the dash in "Bethany Foster…
  var segments = base.replace(/_+/g, ' ').split(/[\-–—|]+/);
  for (var sgi = 0; sgi < segments.length; sgi++) {
    var seg = segments[sgi].replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!seg) continue;
    var words = seg.split(' ');
    var run = [];
    var best = [];
    for (var i = 0; i <= words.length; i++) {
      var w = i < words.length ? words[i] : '';
      var clean = w.replace(/[^A-Za-z']/g, '');
      var ok = clean.length > 1 && /^[A-Z]/.test(clean) &&
               !DIGEST_NAME_STOPWORDS[clean.toLowerCase()];
      if (ok) {
        run.push(clean);
      } else {
        if (run.length >= 2 && run.length > best.length) best = run.slice();
        run = [];
      }
    }
    if (best.length >= 2) return best.slice(0, 3).join(' ');
  }
  return '';
}

// THE NAME PRINTED INSIDE THE DOCUMENT, found by the label in front of it.
var DIGEST_NAME_LABELS = [
  'name\\s+of\\s+(?:employee|participant|individual|client|patient|staff)',
  'employee\\s+name', 'staff\\s+member', 'participant\\s+name',
  'individual\\s*(?:\'s)?\\s+name', 'client\\s+name', 'patient\\s+name',
  'applicant\\s+name', 'resident\\s+name', 'student\\s+name',
  'candidate\\s+name', 'printed\\s+name', 'full\\s+name',
  'employee', 'participant', 'individual', 'client', 'patient', 'applicant',
  'resident', 'candidate', 'name'
];

/** Two to three capitalised words — a person, not a sentence. */
var DIGEST_NAME_VALUE = '([A-Z][A-Za-z\'\\-]{1,20}(?:\\s+[A-Z][A-Za-z\'\\.\\-]{1,20}){1,2})';

// A VALUE STOPS WHERE THE FIELD STOPS.
function digestNameCut_(after) {
  var seg = String(after || '').split(/[.,;:|\n\r]|\s{2,}/)[0];
  var m = new RegExp('^\\s*"?' + DIGEST_NAME_VALUE).exec(seg);
  if (!m) return '';
  var words = String(m[1]).replace(/\s+/g, ' ').trim().split(' ');
  while (words.length > 2) {
    var tail = words[words.length - 1];
    if (tail.length <= 4 && tail === tail.toUpperCase()) { words.pop(); continue; }
    if (DIGEST_NAME_STOPWORDS[tail.toLowerCase()]) { words.pop(); continue; }
    break;
  }
  if (words.length < 2) return '';
  if (DIGEST_NAME_STOPWORDS[words[0].toLowerCase()]) return '';
  return words.join(' ');
}

// THE NAME A CERTIFICATE PRINTS WITHOUT A LABEL.
function digestNameFromPhrase_(text, kind) {
  var s = String(text || '').slice(0, 20000).replace(/\r/g, '\n');
  // [^\S\n] and not \s: a name lives on ONE line.
  var NAME = "([A-Za-z][A-Za-z'’\\-]{1,24}(?:[^\\S\\n]+[A-Za-z][A-Za-z'’.\\-]{0,24}){1,3})";
  function clean(raw) {
    var words = String(raw || '').replace(/\s+/g, ' ').trim().split(' ');
    var out = [];
    for (var i = 0; i < words.length && out.length < 4; i++) {
      var w = words[i].replace(/^[^A-Za-z]+|[^A-Za-z.'’\-]+$/g, '');
      if (!w || DIGEST_NAME_STOPWORDS[w.toLowerCase()]) break;
      if (/^(has|have|having|is|was|signature|date|dob|born|sex|address|the)$/i.test(w)) break;
      if (w.length > 1 && w === w.toUpperCase()) {
        /* WILLIAMS-MCLEOD is two names, and only the first was being cased */
        w = w.toLowerCase().replace(/(^|[-'’ ])([a-z])/g, function (all, sep, ch) {
          return sep + ch.toUpperCase();
        });
      }
      out.push(w);
    }
    return out.length >= 2 ? out.join(' ') : '';
  }
  var after = [
    "this\\s+(?:is\\s+to\\s+)?certif(?:y|ies)\\s+that", "this\\s+number\\s+has\\s+been\\s+established\\s+for",
    // a training platform's certificate: "THIS CERTIFICATE IS PROUDLY PRESENTED TO / Deanna Williams / For…
    "this\\s+certificate\\s+is\\s+proudly\\s+presented\\s+to",
    "this\\s+diploma\\s+is\\s+hereby\\s+awarded\\s+to",
    "certificate\\s+of\\s+completion",
    "awarded\\s+to", "presented\\s+to", "conferred\\s+upon", "is\\s+hereby\\s+granted\\s+to"
  ];
  if (kind === 'birth_certificate') {
    after = ["child'?s?\\s+name(?:\\s*\\([^)]*\\))?", "name\\s+of\\s+child", "(?:^|\\n)\\s*name\\b(?!\\s+of\\b)"].concat(after);
  }
  for (var a = 0; a < after.length; a++) {
    var m = new RegExp(after[a] + "[^A-Za-z\\n]{0,4}\\n?\\s*" + NAME, 'i').exec(s);
    if (m) { var got = clean(m[1]); if (got) return got; }
  }
  /* the line BEFORE "has completed / has demonstrated / having completed" */
  var before = /([^\n]{3,60})\n+\s*(?:has|have|having)\s+(?:successfully\s+|satisfactorily\s+)?(?:completed|demonstrated|satisfied)/i.exec(s);
  if (before) { var got2 = clean(before[1]); if (got2 && !/\d/.test(before[1])) return got2; }
  /* "DE'AHNI J WHEAT - DD00337028": the name in front of a DODD number */
  var dodd = new RegExp(NAME + "\\s*[-–]\\s*DD\\d{8}").exec(s);
  if (dodd) { var got3 = clean(dodd[1]); if (got3) return got3; }
  return '';
}

function digestNameFromText_(text, kind) {
  var s = String(text || '').slice(0, 20000);
  var phrase = digestNameFromPhrase_(s, kind);
  if (phrase) return phrase;
  // "Name: CORN, ALANNA" — SURNAME first, comma, given names.
  var flip = /\b(?:name|Name|NAME)\s*[:\-]\s*([A-Z][A-Za-z'’\-]{1,24})\s*,\s*([A-Z][A-Za-z'’.\-]{1,24}(?:[^\S\n]+[A-Z][A-Za-z'’.\-]{0,24})?)/.exec(s);
  if (flip) {
    var last = flip[1], first = String(flip[2]).replace(/\s+/g, ' ').trim();
    function caseIt(w) {
      return w.length > 1 && w === w.toUpperCase()
        ? w.toLowerCase().replace(/(^|[-'’ ])([a-z])/g, function (a, sep, ch) { return sep + ch.toUpperCase(); })
        : w;
    }
    if (!DIGEST_NAME_STOPWORDS[last.toLowerCase()] &&
        !DIGEST_NAME_STOPWORDS[first.split(' ')[0].toLowerCase()]) {
      return first.split(' ').map(caseIt).join(' ') + ' ' + caseIt(last);
    }
  }
  // "Last Name: Corn First Name: Alanna" — the two-field form, which is how most official paperwork asks it.
  var last = /last\s*name\s*[:\-]?\s*"?([A-Z][A-Za-z'\-]{1,24})/i.exec(s);
  var first = /first\s*name\s*[:\-]?\s*"?([A-Z][A-Za-z'\-]{1,24})/i.exec(s);
  if (last && first) {
    var pair = first[1] + ' ' + last[1];
    if (!DIGEST_NAME_STOPWORDS[String(first[1]).toLowerCase()] &&
        !DIGEST_NAME_STOPWORDS[String(last[1]).toLowerCase()]) return pair;
  }
  var labels = digestLabels_();
  for (var i = 0; i < labels.length; i++) {
    var re = new RegExp(labels[i] + '\\s*[:\\-]\\s*', 'i');
    var at = re.exec(s);
    if (!at) continue;
    var got = digestNameCut_(s.slice(at.index + at[0].length));
    if (got) return got;
  }
  return '';
}

// A RÉSUMÉ PUTS THE NAME ON THE FIRST LINE, above the town and the phone number, and prints no label at all — which…
function digestNameFromHead_(text) {
  var lines = String(text || '').slice(0, 600).split(/\n+/);
  for (var i = 0; i < lines.length && i < 4; i++) {
    var line = lines[i].replace(/\s+/g, ' ').trim();
    if (!line || line.length > 48 || /\d|@/.test(line)) continue;
    var got = digestNameCut_(line);
    if (got) return got;
  }
  return '';
}

function digestNameFromPairs_(pairs) {
  var want = ['name', 'full_name', 'client', 'client_name', 'employee',
              'employee_name', 'participant', 'individual', 'student',
              'staff', 'patient', 'member'];
  for (var w = 0; w < want.length; w++) {
    for (var p = 0; p < (pairs || []).length; p++) {
      if (String(pairs[p].k) !== want[w]) continue;
      var v = String(pairs[p].v || '').trim();
      // a name is words, not a number and not a sentence
      if (/^[A-Za-z][A-Za-z '.\-]{3,48}$/.test(v) && v.split(' ').length <= 4) {
        return v.replace(/\s+/g, ' ');
      }
    }
  }
  return '';
}

// WHAT THE FILE CITES — as anchors, never names.
var DIGEST_HOUSES = null;

function digestHouses_() {
  if (DIGEST_HOUSES) return DIGEST_HOUSES;
  DIGEST_HOUSES = [];
  try {
    var rows = listRows_('istHouses', {}) || [];
    for (var i = 0; i < rows.length; i++) {
      var code = '';
      var addr = '';
      for (var k in rows[i]) {
        if (!Object.prototype.hasOwnProperty.call(rows[i], k)) continue;
        var key = String(k).toLowerCase();
        var val = str_(rows[i][k]);
        if (!val) continue;
        if (!code && /(^|_)(house|code|house_code|id)$/.test(key) &&
            /^[A-Z]{2,3}\d{3,6}$/.test(val)) code = val;
        if (!addr && key.indexOf('address') !== -1) addr = val;
      }
      if (!code) {
        /* the registry sometimes carries the code inside a label */
        for (var k2 in rows[i]) {
          var m2 = /\b([A-Z]{2,3}\d{3,6})\b/.exec(str_(rows[i][k2]));
          if (m2) { code = m2[1]; break; }
        }
      }
      if (code) DIGEST_HOUSES.push({ code: code, addr: addr });
    }
  } catch (e) { DIGEST_HOUSES = []; }
  return DIGEST_HOUSES;
}

function digestMentions_(text, filename, subjectId) {
  var hay = ' ' + (String(filename || '') + ' ' +
                   String(text || '').slice(0, DIGEST_SCAN_CAP))
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  var out = [];
  var houses = digestHouses_();
  for (var h = 0; h < houses.length; h++) {
    var code = String(houses[h].code);
    var digits = code.replace(/^[A-Za-z]+/, '');
    var byCode = hay.indexOf(' ' + code.toLowerCase() + ' ') !== -1;
    // the street number is only a match WITH a street word beside it — "1305" alone is a number on a page, "1305…
    var byAddr = digits && new RegExp('\\b' + digits +
      '\\s+\\d{1,3}(st|nd|rd|th)\\s+(st|street|ave|avenue|rd|road|nw|ne|sw|se)\\b')
      .test(hay);
    if ((byCode || byAddr) && out.indexOf('house:' + code) === -1) {
      out.push('house:' + code);
    }
  }
  if (!DIGEST_ROSTER) digestWhoIs_('', '');      // fills the roster once
  for (var r = 0; r < (DIGEST_ROSTER || []).length && out.length < 12; r++) {
    var needle = ' ' + DIGEST_ROSTER[r].name.replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (hay.indexOf(needle) === -1) continue;
    if (DIGEST_ROSTER[r].id === subjectId) continue;   // the subject is not a mention
    if (out.indexOf(DIGEST_ROSTER[r].id) === -1) out.push(DIGEST_ROSTER[r].id);
  }
  return out.slice(0, 12);
}

// WHOSE KIND OF DOCUMENT IS IT?
var DIGEST_PERSON_KINDS = {
  cpr_first_aid: 1, crisis_prevention: 1, med_admin_cert: 1,
  training_transcript: 1, diploma: 1, dodd_certification: 1,
  mar: 1, prescription: 1, physician_order: 1, lab_result: 1, tb_test: 1,
  immunization: 1, physical_exam: 1, drug_screen: 1, therapy_eval: 1,
  nursing_assessment: 1, seizure_protocol: 1, dietary_plan: 1,
  discharge_summary: 1, appointment_summary: 1, dental_vision: 1,
  isp: 1, behavior_plan: 1, amfm: 1, iep: 1,
  mui: 1, unusual_incident: 1, restraint_report: 1,
  drivers_licence: 1, state_id: 1, ssn_card: 1, birth_certificate: 1,
  passport: 1, work_authorization: 1, medicaid_card: 1, medicare_card: 1,
  health_insurance: 1, auto_insurance: 1,
  background_check: 1, guardianship: 1, consent_release: 1,
  timesheet: 1, paystub: 1, tax_form: 1, benefit_letter: 1,
  application_resume: 1, reference_check: 1, offer_letter: 1
};
var DIGEST_HOUSE_KINDS = { fire_drill: 1, inspection: 1, lease: 1, utility_bill: 1 };
var DIGEST_COMPANY_KINDS = { liability_insurance: 1, bank_statement: 1, invoice: 1 };

/** Two spellings of one person: case, punctuation and "Last, First" aside. */
function digestSameName_(a, b) {
  function norm(x) {
    var t = String(x || '').toLowerCase().replace(/[^a-z ]+/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ');
    t.sort();
    return t.join(' ');
  }
  var na = norm(a), nb = norm(b);
  return !!na && na === nb;
}

// THE PAPER MAY CORRECT THE ROW — AFTER A VALID EXTRACTION.
function digestPersonCheck_(person, seen) {
  if (!seen) return { person: person, who: '', agree: '', seen: '' };
  if (!person) return { person: seen, who: '', agree: '', seen: seen };
  if (digestSameName_(person, seen)) {
    return { person: person, who: '', agree: 'yes', seen: seen };
  }
  var known = digestWhoIs_(seen, '');
  if (known) {
    return { person: known.display || seen, who: known.id,
             agree: 'corrected', seen: seen };
  }
  return { person: person, who: '', agree: 'no', seen: seen };
}

// WHAT THE FILE IS ABOUT, as a type and a name.
function digestSubject_(who, person, docKind, text, filename) {
  if (who) {
    return { type: who.kind, subject: who.display || person || '' };
  }
  var hay = (String(filename || '') + ' ' + String(text || '').slice(0, 8000));
  var house = /\b([A-Z]{2,3}\d{3,6})\b/.exec(hay);
  if (house && DIGEST_HOUSE_KINDS[docKind]) {
    return { type: 'house', subject: house[1] };
  }
  if (docKind === 'vehicle') {
    var vin = /\b([A-HJ-NPR-Z0-9]{17})\b/.exec(hay);
    return { type: 'vehicle', subject: vin ? vin[1] : '' };
  }
  if (DIGEST_COMPANY_KINDS[docKind]) return { type: 'company', subject: '' };
  // A PERSON ONLY WHERE A PERSON BELONGS: the kind says so, or the name came from somewhere better than a filename.
  if (person && DIGEST_PERSON_KINDS[docKind]) {
    return { type: 'person', subject: person };
  }
  if (house) return { type: 'house', subject: house[1] };
  return { type: '', subject: '' };
}

// EVERY LABELLED FACT ON THE PAGE — as much information as can be identified, from every document.
function digestPairs_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP).replace(/\r/g, '\n');
  var re = /(^|[\n\s])([A-Z][A-Za-z .'\/&#-]{1,32}?)\s*:\s*/g;
  var marks = [];
  var m;
  while ((m = re.exec(s)) !== null && marks.length < 60) {
    marks.push({ key: String(m[2]).trim(), start: m.index + m[1].length,
                 from: re.lastIndex });
  }
  var out = [];
  var seen = {};
  for (var i = 0; i < marks.length && out.length < 25; i++) {
    var end = (i + 1 < marks.length) ? marks[i + 1].start : s.length;
    var val = s.slice(marks[i].from, end).replace(/\s+/g, ' ').trim();
    // a value that is only punctuation, or the whole rest of a page, is not a field — the first is empty, the…
    if (!val || val.length > 160 || !/[A-Za-z0-9]/.test(val)) continue;
    var key = marks[i].key.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '').slice(0, 40);
    if (!key || seen[key]) continue;
    seen[key] = 1;
    out.push({ k: key, v: val });
  }
  return out;
}

// The numbers a document IS: certificate, licence, policy, card, record.
function digestNumbers_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP);
  // THE LABEL IS A WHOLE WORD.
  var re = /\b(certificate|cert|licen[cs]e|policy|card|member|account|authentication|employee|badge|registry|dl|id)\b\s*(?:no\.?|number|#|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,20})\b/gi;
  var out = [];
  var seen = {};
  var m;
  while ((m = re.exec(s)) !== null && out.length < 8) {
    var label = String(m[1]).toLowerCase();
    var value = String(m[2]).toUpperCase();
    if (/^(19|20)\d{2}$/.test(value)) continue;      // a year is not a number
    var key = label + ':' + value;
    if (seen[key]) continue;
    seen[key] = 1;
    out.push({ k: label, v: value });
  }
  return out;
}

// WHO ISSUED IT.
var DIGEST_ISSUERS = [
  'american heart association', 'american red cross', 'red cross',
  'national safety council', 'ohio department of developmental disabilities',
  'department of developmental disabilities', 'dodd',
  'bureau of motor vehicles', 'bmv', 'ohio attorney general',
  'bureau of criminal investigation', 'federal bureau of investigation',
  'ohio department of health', 'asa lifecare', 'a brighter dawn'
];

function digestIssuer_(text) {
  var s = String(text || '').slice(0, 4000);
  var low = s.toLowerCase();
  var known = digestIssuers_();
  for (var i = 0; i < known.length; i++) {
    var at = low.indexOf(known[i]);
    if (at !== -1) return s.substr(at, known[i].length);
  }
  // the letterhead: the first line that shouts, which is how forms are headed
  var lines = s.split(/\n+/);
  for (var n = 0; n < lines.length && n < 6; n++) {
    var line = lines[n].replace(/\s+/g, ' ').trim();
    if (line.length < 4 || line.length > 60) continue;
    var letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 4 && letters === letters.toUpperCase()) return line;
  }
  return '';
}

// Money on the page, biggest last — a receipt's total is almost always the largest number on it, and saying "the…
function digestAmounts_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP);
  var re = /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/g;
  var out = [];
  var m;
  while ((m = re.exec(s)) !== null && out.length < 12) {
    var n = Number(String(m[1]).replace(/,/g, ''));
    if (!isNaN(n) && out.indexOf(n) === -1) out.push(n);
  }
  return out.sort(function (a, b) { return a - b; });
}

/** How to reach whoever the document is about or came from. */
function digestContacts_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP);
  var out = { emails: [], phones: [] };
  var m;
  var reMail = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  while ((m = reMail.exec(s)) !== null && out.emails.length < 4) {
    if (out.emails.indexOf(m[0]) === -1) out.emails.push(m[0]);
  }
  var rePhone = /\b(?:\+1[ -]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g;
  while ((m = rePhone.exec(s)) !== null && out.phones.length < 4) {
    if (out.phones.indexOf(m[0]) === -1) out.phones.push(m[0]);
  }
  return out;
}

// THE FULL TEXT, WHERE IT CAN BE READ AND FOUND BY ID.
function digestTextFolder_(ledger) {
  var parent = null;
  var id = '';
  try { id = String(hubProp_(DIGEST_TEXT_PROP) || '').trim(); } catch (eP) { id = ''; }
  if (id) {
    try { parent = DriveApp.getFolderById(id); } catch (eI) { parent = null; }
  }
  if (!parent) {
    var home = null;
    try {
      var hid = String(hubId_('HUB_PLATFORM_FOLDER_ID') || '').trim();
      if (hid) home = DriveApp.getFolderById(hid);
    } catch (eH) { home = null; }
    if (!home) { try { home = DriveApp.getRootFolder(); } catch (eR) { return null; } }
    try {
      var it = home.getFoldersByName(DIGEST_TEXT_FOLDER_NAME);
      parent = it.hasNext() ? it.next() : home.createFolder(DIGEST_TEXT_FOLDER_NAME);
    } catch (eC) { return null; }
  }
  if (!ledger) return parent;
  try {
    var kids = parent.getFoldersByName(String(ledger));
    return kids.hasNext() ? kids.next() : parent.createFolder(String(ledger));
  } catch (eS) { return parent; }
}

function digestSpillText_(row, led, text, facts) {
  var rowId = str_(row.id) || str_(row[led.fileId]);
  if (!rowId) return null;
  var folder = digestTextFolder_(led.res);
  if (!folder) return null;
  var head = ['---',
    'row_id: ' + rowId,
    'ledger: ' + led.res,
    'file_id: ' + str_(row[led.fileId]),
    'file_name: ' + str_(row[led.name]),
    'ref: ' + (led.ref ? str_(row[led.ref]) : ''),
    'doc_kind: ' + String(facts.doc_kind || ''),
    'category: ' + String(facts.category || ''),
    'issued_on: ' + String(facts.issued_on || ''),
    'expires_on: ' + String(facts.expires_on || ''),
    'issuer: ' + String(facts.issuer || ''),
    'who: ' + String(facts.who || ''),
    'chars: ' + String(text.length),
    'digested_at: ' + new Date().toISOString(),
    '---', ''].join('\n');
  var name = rowId + '.md';
  try {
    // ONE FILE PER ROW, rewritten rather than doubled: a re-digest of the same row must not leave two versions of…
    var old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    var made = folder.createFile(name, head + text, 'text/markdown');
    return { id: made.getId(), url: made.getUrl() };
  } catch (e) {
    return null;
  }
}

// THE DECODER FILES THE DRIVE: rename `[category] date — original` and move into a category subfolder beside the…
function digestRouteFile_(fileId, category, dateIso, originalName) {
  try {
    var file = DriveApp.getFileById(fileId);
    var label = '[' + category + ']' + (dateIso ? ' ' + dateIso : '');
    var clean = String(originalName || file.getName()).replace(/^pending__/, '');
    file.setName((label + ' — ' + clean).slice(0, 180));
    var parents = file.getParents();
    if (parents.hasNext()) {
      var parent = parents.next();
      // A FILE THAT IS ALREADY FILED MUST NOT BE FILED AGAIN INSIDE ITSELF.
      var known = {};
      var cats = digestCategoriesTable_();
      for (var c = 0; c < cats.length; c++) known[String(cats[c][0])] = 1;
      var kindsTable = digestKinds_();
      for (var k = 0; k < kindsTable.length; k++) known[String(kindsTable[k][1])] = 1;
      known.media = 1; known.other = 1;
      var hops = 0;
      while (known[parent.getName()] && hops < 4) {
        var up = parent.getParents();
        if (!up.hasNext()) break;
        parent = up.next();
        hops++;
      }
      var kids = parent.getFoldersByName(category);
      var sub = kids.hasNext() ? kids.next() : parent.createFolder(category);
      if (sub.getId() !== parent.getId()) file.moveTo(sub);
    }
    return 'filed under ' + category;
  } catch (e) {
    return '';   // the row is the record; the shelf label is a bonus
  }
}

// COMPACTION AFTER A GOOD READ.
var DIGEST_ZIP_MIN_BYTES = 200 * 1024;      // under this the zip header eats the gain
var DIGEST_ZIP_EXTS = {
  txt: 1, md: 1, json: 1, csv: 1, tsv: 1, xml: 1, log: 1, srt: 1, vtt: 1,
  html: 1, htm: 1, js: 1, mjs: 1, cjs: 1, ts: 1, tsx: 1, jsx: 1,
  css: 1, py: 1, sql: 1, yml: 1, yaml: 1
};

function digestZipMaybe_(row, led, archived) {
  if (!led.route) return null;                       // the corpus is read-only
  if (!archived) return null;                        // no archive, no compaction
  var name = str_(row[led.name]) || 'file';
  var ext = String(name).toLowerCase().replace(/^.*\./, '');
  // NEVER A ZIP OF A ZIP.
  if (ext === 'zip' || ext === 'gz') return null;
  if (!digestZipExts_()[ext]) return null;
  var fileId = str_(row[led.fileId]);
  if (!fileId) return null;
  try {
    var file = DriveApp.getFileById(fileId);
    var size = Number(file.getSize() || 0);
    if (size < digestSetting_('zip_min_kb', 200, 20, 20000) * 1024) return null;
    var parent = null;
    var parents = file.getParents();
    if (parents.hasNext()) parent = parents.next();
    if (!parent) return null;
    var zipBlob = Utilities.zip([file.getBlob()], name + '.zip');
    var zipped = parent.createFile(zipBlob);
    var zipSize = Number(zipped.getSize() || 0);
    // NOTHING IS TRASHED UNTIL THE REPLACEMENT IS REAL AND SMALLER
    if (!zipSize || zipSize >= size) {
      try { zipped.setTrashed(true); } catch (eU) { /* the original stands */ }
      return null;
    }
    file.setTrashed(true);
    return { file_id: zipped.getId(), file_url: zipped.getUrl(),
             name: zipped.getName(), bytes: zipSize, was: fileId, was_bytes: size };
  } catch (e) {
    return null;   // a compaction that cannot happen is not a failed decode
  }
}

// THE FOLDER STAYS CLEAN AND CATALOGUED.
var DIGEST_TIDY_PER_PASS = 20;

// A category folder nested inside another one is the same shelf twice.
function digestUnnestMaybe_(root, known, started) {
  var fixed = 0;
  try {
    var subs = root.getFolders();
    while (subs.hasNext()) {
      var outer = subs.next();
      if (!known[outer.getName()]) continue;
      fixed += digestUnnestInto_(outer, outer, known, started, 0);
    }
  } catch (e) { /* a folder that will not answer is not a reason to stop */ }
  return fixed;
}

// EMPTY THE SHELLS FROM THE INSIDE OUT — too many folders were being created carrying the same name.
function digestUnnestInto_(home, here, known, started, depth) {
  var fixed = 0;
  if (depth > 6) return 0;              // a cycle is not a folder tree
  var shells = [];
  try {
    var subs = here.getFolders();
    while (subs.hasNext()) {
      var s = subs.next();
      if (known[s.getName()]) shells.push(s);
    }
  } catch (eL) { return 0; }
  for (var i = 0; i < shells.length; i++) {
    if (new Date().getTime() - started > DIGEST_BUDGET_MS) return fixed;
    fixed += digestUnnestInto_(home, shells[i], known, started, depth + 1);
    try {
      var files = shells[i].getFiles();
      while (files.hasNext()) {
        try { files.next().moveTo(home); fixed++; } catch (eM) { /* next pass */ }
      }
      if (!shells[i].getFiles().hasNext() && !shells[i].getFolders().hasNext()) {
        shells[i].setTrashed(true);
        fixed++;
      }
    } catch (eT) { /* an empty shell can wait for the next pass */ }
  }
  return fixed;
}

// THE FOLDER THE FILES ACTUALLY LAND IN.
function digestIntakeFolder_() {
  var where = formUploadsFolderId_('forms');
  if (!where.id) return null;
  var root;
  try { root = DriveApp.getFolderById(where.id); } catch (eR) { return null; }
  var sub = 'asa-documents';
  try {
    var named = (digestVocab_().settings || {}).documents_folder;
    if (typeof named === 'string' && named) sub = named;
  } catch (eN) { /* the default is the answer */ }
  sub = String(sub).trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (!sub) return root;
  try {
    var kids = root.getFoldersByName(sub);
    // IT NEVER CREATES ONE.
    return kids.hasNext() ? kids.next() : root;
  } catch (eK) { return root; }
}

function digestTidyMaybe_(led, rows, started) {
  if (!led.route) return 0;                       // the corpus is read-only
  var where = formUploadsFolderId_('forms');
  if (!where.id) return 0;
  var hours = digestSetting_('orphan_hours', 24, 1, 720);
  var cutoff = new Date().getTime() - hours * 3600000;
  var claimed = {};
  for (var r = 0; r < (rows || []).length; r++) {
    var fid = str_(rows[r][led.fileId]);
    if (fid) claimed[fid] = true;
  }
  var originals = '';
  try {
    var home = formOriginalsFolder_();
    if (home) originals = home.getId();
  } catch (eH) { originals = ''; }

  var touched = 0;
  var seen = 0;
  try {
    var root = DriveApp.getFolderById(where.id);
    var folders = [root];
    var subs = root.getFolders();
    while (subs.hasNext()) {
      var sub = subs.next();
      if (originals && sub.getId() === originals) continue;   // the canvases
      folders.push(sub);
    }
    // A FOLDER NOBODY FILES INTO ANY MORE GOES, once it is empty — that is how document-drop leaves: renamed out of…
    var keep = {};
    try {
      keep[String((digestVocab_().settings || {}).documents_folder ||
                  'asa-documents')] = 1;
    } catch (eKp) { keep['asa-documents'] = 1; }
    keep.Database = 1;
    try {
      var canvases = formOriginalsFolder_();
      if (canvases) keep[canvases.getName()] = 1;
    } catch (eK) { /* Database above already protects the usual name */ }
    for (var d2 = 1; d2 < folders.length; d2++) {
      if (keep[folders[d2].getName()]) continue;
      if (folders[d2].getFiles().hasNext() || folders[d2].getFolders().hasNext()) continue;
      try {
        folders[d2].setTrashed(true);
        touched++;
        hubSysLog_('auto-digest', 'digest_folder_retired',
                   'empty intake folder removed: ' + folders[d2].getName(),
                   { status: 200 });
      } catch (eR) { /* it can wait for the next pass */ }
    }
    /* the shelves first: a category inside a category is one shelf too many */
    var catNames = {};
    var catTable = digestCategoriesTable_();
    for (var cn = 0; cn < catTable.length; cn++) catNames[String(catTable[cn][0])] = 1;
    catNames.media = 1; catNames.other = 1;
    /* THE SHELVES LIVE IN THE INTAKE FOLDER, NOT BESIDE IT. */
    var intake = digestIntakeFolder_();
    if (intake) touched += digestUnnestMaybe_(intake, catNames, started);
    for (var ff = 0; ff < folders.length && touched < DIGEST_TIDY_PER_PASS; ff++) {
      touched += digestUnnestMaybe_(folders[ff], catNames, started);
    }
    for (var f = 0; f < folders.length && touched < DIGEST_TIDY_PER_PASS; f++) {
      var files = folders[f].getFiles();
      while (files.hasNext() && touched < DIGEST_TIDY_PER_PASS && seen < 400) {
        if (new Date().getTime() - started > DIGEST_BUDGET_MS) return touched;
        var file = files.next();
        seen++;
        var name = String(file.getName() || '');
        if (name.indexOf('pending__') !== 0) continue;
        if (claimed[file.getId()]) {
          /* claimed after all — file it properly instead of deleting it */
          try { file.setName(name.slice('pending__'.length)); touched++; }
          catch (eN) { /* the row is the record either way */ }
          continue;
        }
        var made = 0;
        try { made = file.getDateCreated().getTime(); } catch (eD) { made = 0; }
        if (!made || made > cutoff) continue;      // young enough to still be claimed
        try {
          file.setTrashed(true);
          touched++;
          hubSysLog_('auto-digest', 'digest_tidied',
                     'orphan removed after ' + hours + 'h: ' + name.slice(0, 120),
                     { status: 200 });
        } catch (eT) { /* it stays; the next pass tries again */ }
      }
    }
  } catch (e) { /* a folder that will not answer is not a reason to stop */ }
  return touched;
}

// A row that has been pending longer than any file needs, whose bytes are gone: it says so and somebody is told.
function digestStuckMaybe_(led, rows) {
  if (!led.sub) return 0;
  var hours = digestSetting_('stall_hours', 48, 2, 720);
  var cutoff = new Date().getTime() - hours * 3600000;
  var done = 0;
  for (var i = 0; i < (rows || []).length && done < 5; i++) {
    var row = rows[i];
    // `working` IS A CLAIM, AND A CLAIM CAN BE ABANDONED.
    var stState = str_(row.digest_state);
    if (stState !== 'pending' && stState !== 'working') continue;
    // A CLAIM EXPIRES IN MINUTES.
    if (stState === 'working') {
      var claimMin = digestSetting_('claim_minutes', 20, 2, 1440);
      var touched = Date.parse(str_(row.updatedAt)) || Date.parse(str_(row.createdAt)) || 0;
      if (touched && touched < new Date().getTime() - claimMin * 60000) {
        try {
          var rel = updateRowById_(led.res, { id: str_(row.id), digest_state: 'pending' });
          if (rel && !rel.error) done++;
        } catch (eR) { /* next pass */ }
        continue;
      }
    }
    var made = Date.parse(str_(row.createdAt));
    if (!made || made > cutoff) continue;
    var fid = str_(row[led.fileId]);
    var gone = false;
    try {
      var file = DriveApp.getFileById(fid);
      gone = file.isTrashed();
    } catch (eG) { gone = true; }
    if (!gone) continue;
    // The stalled row's letter is written by Python (app/letters.py).
    try {
      updateRowById_(led.res, { id: str_(row.id), digest_state: 'stalled',
        digest_error: ('the file is gone from Drive — please send it again').slice(0, 380) });
      done++;
    } catch (eW) { /* next pass */ }
  }
  return done;
}

// THE ARCHIVE IS WRITTEN BEFORE THE CELL IS CUT.
var DIGEST_COMPACT_PER_PASS = 10;

function digestCompactMaybe_(led, rows, started) {
  var cap = Number(led.textCap) || DIGEST_TEXT_CAP;
  var done = 0;
  for (var i = 0; i < (rows || []).length && done < DIGEST_COMPACT_PER_PASS; i++) {
    var row = rows[i];
    var text = str_(row.digest_text);
    if (text.length <= cap) continue;
    if (new Date().getTime() - started > DIGEST_BUDGET_MS) break;
    var spill = str_(row.text_file)
      ? { id: str_(row.text_file) }
      : digestSpillText_(row, led, text, {
          doc_kind: str_(row.doc_kind), category: str_(row.digest_category),
          person: str_(row.person), who: str_(row.person_id),
          issued_on: str_(row.issued_on), expires_on: str_(row.expires_on),
          issuer: '' });
    if (!spill || !spill.id) continue;      // no archive, no cut
    try {
      updateRowById_(led.res, { id: str_(row.id),
                                digest_text: text.slice(0, cap),
                                text_file: spill.id });
      done++;
    } catch (e) { /* the next pass tries again */ }
  }
  return done;
}

// WHEN A FILE GIVES UP, SOMEBODY IS TOLD — a standard "retry the files" message goes out.
function digestStalledSay_(row, led, why) {
  var name = str_(row[led.name]) || 'a file';
  try {
    hubSysLog_('auto-digest', 'digest_stalled',
               led.res + ' — ' + name + ': ' + String(why).slice(0, 200),
               { status: 200 });
  } catch (eL) { /* the row still says stalled */ }
  if (!led.sub || typeof hubLetterSend_ !== 'function') return;
  // A SMART COMMS LETTER (SmartGate.gs `form_file_stalled`) through the one door: the row's words, its own switch…
  try {
    var form = formBySlug_(str_(row.form_slug));
    var letter = digestStalledLetter_(row, led, form);
    if (!letter) return;
    var said = hubLetterSend_(letter);
    if (said && !/^(told|deduplicated)$/.test(said.state)) {
      hubSysLog_('auto-digest', 'digest_stalled_notice_not_sent',
                 led.res + ' — ' + name + ': ' + said.state + ' (' + String(said.why || '').slice(0, 140) + ')',
                 { status: 200 });
    }
  } catch (eM) { /* the log is the record; the letter is a courtesy */ }
}

/** The stalled file's letter, or null when its form names nobody to tell. */
function digestStalledLetter_(row, led, form) {
  var to = form ? str_(form.notify_to) : '';
  if (!to) return null;
  return {
    situation: 'form_file_stalled', to: to,
    vars: { form_title: str_(form.title) || 'a form', file_name: str_(row[led.name]) || 'a file' },
    subject_floor: 'A file did not go through — {file_name}',
    text_floor: 'A file sent through "{form_title}" could not be read: {file_name}.\n\n' +
                'Please send it again. If it is a long video, a shorter clip works ' +
                'better — or send the part that matters.\n\n' +
                'Nothing else about the submission was lost.',
    key: 'form_stalled|' + led.res + '|' + str_(row.id),
    facts: { res: led.res, row_id: str_(row.id) }
  };
}

// AT 08:00, THE FILE'S ROW IS READ AGAIN (SmartGate.gs hubLetterQuietCarry_).
function digestStalledRebuild_(facts) {
  var f = facts || {};
  var led = null;
  DIGEST_LEDGERS.forEach(function (l) { if (l.res === str_(f.res)) led = l; });
  if (!led || !led.sub) return { stale: 'no form ledger is called ' + str_(f.res) };
  var row = null, form = null;
  try {
    row = requireRow_(led.res, str_(f.row_id));
    if (row && !row.error) form = formBySlug_(str_(row.form_slug));
  } catch (e) {
    return { unreadable: 'the ' + led.res + ' ledger could not be read (' + String((e && e.message) || e).slice(0, 120) + ')' };
  }
  if (!row || row.error) return { stale: 'the file\'s row ' + str_(f.row_id) + ' is gone' };
  if (str_(row.digest_state) !== 'stalled') {
    return { stale: 'the file is no longer stalled (' + (str_(row.digest_state) || 'no state') + ')' };
  }
  var letter = digestStalledLetter_(row, led, form);
  return letter ? { letter: letter } : { stale: 'the form no longer names anybody to notify' };
}

// ======================================================================== REACHING THE PERSON, AND HANDING IN THE…

var DIGEST_USERS = null;

// Every way this platform can reach the human the paper is about.
function digestReach_(person, who) {
  var name = String(person || '').trim();
  var out = { name: name, nameKey: '', peopleId: '', candidateId: '', why: '' };
  if (!name) { out.why = 'no name'; return out; }
  if (typeof clientNameKey_ === 'function') out.nameKey = clientNameKey_(name);
  var id = String(who || '');
  if (id.indexOf('people:') === 0) out.peopleId = id.slice(7);
  // A DECLARED CANDIDATE IS THE END OF THE QUESTION (2026-09-11).
  if (id.indexOf('candidate:') === 0) {
    out.candidateId = id.slice(10);
    return out;
  }
  if (!DIGEST_USERS) {
    try { DIGEST_USERS = (typeof usersAll_ === 'function' ? usersAll_() : []) || []; }
    catch (e) { DIGEST_USERS = []; }
  }
  var hits = [];
  for (var i = 0; i < DIGEST_USERS.length; i++) {
    var u = DIGEST_USERS[i] || {};
    var cid = str_(u.candidate_id);
    if (!cid) continue;
    var uPeople = str_(u.people_id).replace(/^people:/, '');
    var uName = String(u.display_name || '').trim();
    var matched = (out.peopleId && uPeople && uPeople === out.peopleId) ||
                  (out.nameKey && uName &&
                   typeof clientNameKey_ === 'function' &&
                   clientNameKey_(uName) === out.nameKey);
    if (matched && hits.indexOf(cid) === -1) hits.push(cid);
  }
  if (hits.length === 1) { out.candidateId = hits[0]; }
  else if (hits.length > 1) { out.why = 'two accounts bridge to this name'; }
  return out;
}

// WHAT THIS PERSON STILL OWES on the candidate side — read from the platform's own catalog and its own document…
function digestOwesDoc_(candidateId, docId) {
  if (!candidateId || !docId) return '';
  if (typeof filesDocState_ !== 'function') return '';
  var state;
  try { state = filesDocState_(candidateId) || []; } catch (e) { return ''; }
  for (var i = 0; i < state.length; i++) {
    if (str_(state[i].doc_id) !== docId) continue;
    var st = str_(state[i].status);
    if (st === 'uploaded' || st === 'verified') return 'held';
    return state[i].required ? 'owed' : 'held';   // not required is not a debt
  }
  return '';
}

// WHETHER THE COMPLIANCE OVERLAY ALREADY HOLDS THIS CREDENTIAL.
function digestHoldsCredential_(nameKey, credential) {
  if (!nameKey || !credential) return '';
  if (typeof clearanceOverlay_ !== 'function') return '';
  var overlay;
  try { overlay = clearanceOverlay_() || {}; } catch (e) { return ''; }
  var mine = overlay[nameKey];
  if (!mine || !mine[credential]) return 'owed';
  var rec = mine[credential];
  if (String(rec.decision || '') === 'revoked') return 'owed';
  var exp = String(rec.expires_on || '').slice(0, 10);
  if (exp && exp < new Date().toISOString().slice(0, 10)) return 'owed';
  // A RECEIPT WITH NO END DATE IS NOT A CREDENTIAL HELD (2026-09-11).
  var table = (typeof digestCredentials_ === 'function') ? digestCredentials_() : [];
  for (var i = 0; i < table.length; i++) {
    if (table[i][2] !== credential) continue;
    if (String(table[i][4] || '').toLowerCase() === 'yes' && !exp) return 'owed';
  }
  return 'held';
}

var DIGEST_CLEARANCE_FILES = null;

// Every file id the compliance overlay already holds, AND THE EXPIRY IT WAS FILED WITH.
function digestClearanceFiles_() {
  if (DIGEST_CLEARANCE_FILES) return DIGEST_CLEARANCE_FILES;
  DIGEST_CLEARANCE_FILES = {};
  try {
    var values = clearanceSheet_().getDataRange().getValues();
    if (values.length < 2) return DIGEST_CLEARANCE_FILES;
    var at = -1, atExp = -1;
    for (var c = 0; c < values[0].length; c++) {
      var hName = String(values[0][c]).trim();
      if (hName === 'file_id') at = c;
      if (hName === 'expires_on') atExp = c;
    }
    if (at === -1) return DIGEST_CLEARANCE_FILES;
    for (var r = 1; r < values.length; r++) {
      var fid = String(values[r][at] || '').trim();
      if (!fid) continue;
      var exp = atExp === -1 ? '' : String(values[r][atExp] || '').trim().slice(0, 10);
      /* the LAST row wins, exactly as the overlay reads it */
      DIGEST_CLEARANCE_FILES[fid] = exp;
    }
  } catch (e) { /* an unreadable overlay means we simply cannot dedupe */ }
  return DIGEST_CLEARANCE_FILES;
}

// HAND THE PAPER IN — or say exactly why it was not handed in.
function digestSettle_(led, facts) {
  if (!led || led.people !== true) return null;
  var cred = digestCredentialFor_(facts.doc_kind);
  if (!cred) return null;
  /* three categories, three matrix columns: the paper's own level decides */
  if (cred.doc_kind === 'med_admin_cert' && facts.level) cred.credential = 'med' + facts.level;
  var out = { kind: facts.doc_kind, doc_id: cred.doc_id,
              credential: cred.credential, requirement: cred.requirement,
              name: '', candidate_id: '', name_key: '',
              candidate: '', staff: '', checked: false, did: [], why: '' };
  var mode = String(digestSetting_('distribute', 'record') || 'record');
  if (mode === 'off') { out.why = 'the dial is off'; return out; }
  // NEVER ON A GUESS.
  var floor = digestSetting_('distribute_confidence', 85, 50, 100);
  if (Number(facts.confidence || 0) < floor) {
    out.why = 'confidence ' + facts.confidence + ' is under ' + floor;
    return out;
  }
  // CONFIDENCE IS ABOUT THE ROW; THIS IS ABOUT THE KIND.
  var kindFloor = digestSetting_('distribute_kind_score', 10, 0, 100);
  if (Number(facts.kind_score || 0) < kindFloor) {
    out.why = 'the paper only whispered it (' + (facts.kind_score || 0) +
              ' under ' + kindFloor + ')';
    return out;
  }
  // A RECEIPT NOBODY CAN CHASE IS NOT A RECEIPT.
  if (cred.expires && !String(facts.expires_on || '').trim()) {
    out.why = 'this credential is an expiry date and the paper did not give one';
    return out;
  }
  if (!facts.person) { out.why = 'no person on the paper'; return out; }
  var reach = digestReach_(facts.person, facts.who);
  out.name = reach.name;
  out.name_key = reach.nameKey;
  out.candidate_id = reach.candidateId;
  if (reach.why) out.why = reach.why;
  // AN ANCHOR IS AN ID, AND HERE IT IS LOAD-BEARING.
  if (!reach.peopleId && !reach.candidateId) {
    out.why = 'the platform does not know this person by id';
    return out;
  }

  // FROM HERE ON WE ACTUALLY LOOKED.
  out.checked = true;
  // THE CANDIDATE LANE — the only side where a debt can be READ, because the catalog says what is required and the…
  if (reach.candidateId) {
    out.candidate = digestOwesDoc_(reach.candidateId, cred.doc_id);
  }
  // THE STAFF LANE — the debt itself lives in an estate this platform reads and never writes, so we do not compute…
  if (reach.nameKey && cred.credential) {
    out.staff = digestHoldsCredential_(reach.nameKey, cred.credential);
  }
  if (mode !== 'write') {
    out.why = out.why || 'recorded, not handed in — the dial is on "record"';
    return out;
  }

  if (out.candidate === 'owed' && facts.file_id &&
      typeof hubAppendRow_ === 'function' && typeof filesCatalog_ === 'function') {
    try {
      var already = false;
      var have = filesDocRows_(reach.candidateId) || [];
      for (var h = 0; h < have.length; h++) {
        if (str_(have[h].file_id) === str_(facts.file_id)) already = true;
      }
      if (!already) {
        var label = '';
        var cat = filesCatalog_() || [];
        for (var ci = 0; ci < cat.length; ci++) {
          if (str_(cat[ci].doc_id) === cred.doc_id) label = str_(cat[ci].label);
        }
        hubAppendRow_(DOCS_TAB, {
          doc_row_id: 'DOC_' + randomHex_(12).toUpperCase(),
          candidate_id: reach.candidateId,
          candidate_name: reach.name,
          doc_id: cred.doc_id,
          doc_label: label,
          // 'uploaded' AND 'verified' ARE DIFFERENT STATES AND STAY THAT WAY: a file arrived, a human has not…
          status: 'uploaded',
          review_status: 'pending',
          file_id: str_(facts.file_id),
          file_url: str_(facts.file_url),
          file_name: str_(facts.file_name),
          mime_type: str_(facts.mime_type),
          size_bytes: str_(facts.size_bytes),
          issued_on: str_(facts.issued_on),
          expires_on: str_(facts.expires_on),
          uploaded_by: 'asa-hub:auto-digest',
          uploaded_at: new Date().toISOString(),
          verified_by: '', verified_at: '', superseded_by: '',
          notes: 'read by the decoder ' + DIGEST_VERSION +
                 ' from ' + str_(facts.file_name) +
                 (facts.level ? ' · category ' + facts.level : '')
        });
        out.did.push('candidate_documents');
      }
    } catch (eC) {
      out.why = 'candidate row failed: ' + String(eC && eC.message || eC).slice(0, 90);
    }
  }
  if (out.staff === 'owed' && cred.credential && facts.file_id &&
      typeof clearanceRecordUpload_ === 'function') {
    // FILE IT WHEN IT IS NEW, OR WHEN WE NOW KNOW SOMETHING THE FILED ROW DID NOT.
    var held = digestClearanceFiles_();
    var fidKey = str_(facts.file_id);
    var wasFiled = Object.prototype.hasOwnProperty.call(held, fidKey);
    var betterNow = wasFiled && !held[fidKey] && str_(facts.expires_on);
    if (!wasFiled || betterNow) {
      var got = clearanceRecordUpload_(cred.credential, reach.name,
                                       reach.candidateId, str_(facts.file_id),
                                       str_(facts.expires_on),
                                       { email: 'auto-digest' },
                                       { source: 'hub:digest',
                                         issued_on: str_(facts.issued_on) });
      if (got) {
        held[fidKey] = str_(facts.expires_on);
        out.did.push(betterNow ? 'staff_clearance (corrected)' : 'staff_clearance');
      }
    }
  }
  if (out.did.length) {
    try {
      hubSysLog_('auto-digest', 'digest_settled',
        reach.name + ' — ' + cred.doc_kind + ' → ' + out.did.join(' + '),
        { status: 200 });
    } catch (eL) { /* the row carries it either way */ }
    // STEP FOUR, COMMITTED: the receipt is in.
    try {
      assetEvent_('asset_settled', str_(facts.asset_id),
        { type: reach.candidateId ? 'candidate' : 'person',
          key: reach.candidateId || ('people:' + reach.peopleId),
          name: reach.name, actor: 'auto-digest' },
        { doc_id: cred.doc_id, credential: cred.credential,
          requirement: cred.requirement, into: out.did,
          expires_on: str_(facts.expires_on), issued_on: str_(facts.issued_on),
          confidence: facts.confidence, file_id: str_(facts.file_id),
          late: facts.late ? true : undefined },
        facts.late ? 'digestSettleSweep_' : 'digestOne_');
    } catch (eV) { /* the trail is not the work */ }
  } else if (!out.why) {
    out.why = 'nothing was owed — this is history';
  }
  return out;
}

// SETTLING A ROW THAT WAS ALREADY READ.
function digestSettleSweep_(led, budgetLeft) {
  if (!led || led.people !== true) return 0;
  if (String(digestSetting_('distribute', 'record') || 'record') !== 'write') return 0;
  var did = 0;
  var cap = digestSetting_('settle_per_pass', 15, 1, 60);
  var rows;
  try { rows = listRows_(led.res, {}) || []; } catch (e) { return 0; }
  for (var i = 0; i < rows.length && did < cap; i++) {
    if (budgetLeft && budgetLeft() <= 0) break;
    var row = rows[i];
    if (str_(row.digest_state) !== 'done') continue;
    var meta = row.digest_json;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta || '{}'); } catch (eP) { continue; }
    }
    var was = meta && meta.settle;
    // ONLY A ROW THAT ALREADY SAID SOMETHING WAS OWED.
    if (!was) continue;
    // EXCEPT WHERE THE ROW NOW KNOWS SOMETHING THE RECEIPT DOES NOT (found by watching the whole chain run).
    var nowKnows = false;
    if (str_(row.expires_on)) {
      var cr = digestCredentialFor_(str_(row.doc_kind));
      if (cr && cr.expires) {
        var filed = digestClearanceFiles_();
        var fk = str_(row[led.fileId]);
        if (Object.prototype.hasOwnProperty.call(filed, fk) && !filed[fk]) nowKnows = true;
      }
    }
    if (!nowKnows) {
      if (was.did && was.did.length) continue;
      if (was.candidate !== 'owed' && was.staff !== 'owed') continue;
    }
    // WHEN A ROW THAT NOW KNOWS MORE STILL SETTLES NOTHING, SAY WHY .
    var tellWhy = nowKnows;
    var got = digestSettle_(led, {
      doc_kind: str_(row.doc_kind), person: str_(row.person), who: str_(row.person_id),
      confidence: Number(row.confidence || 0), kind_score: Number((meta.kind_score) || 0),
      asset_id: str_(row.asset_id),
      file_id: str_(row[led.fileId]), file_url: str_(row.file_url),
      file_name: str_(row[led.name]), mime_type: str_(row[led.mime]),
      size_bytes: str_(row.size_bytes),
      issued_on: str_(row.issued_on), expires_on: str_(row.expires_on),
      level: str_((meta && meta.level) || ''),
      late: true
    });
    if (!got) continue;
    if (tellWhy) {
      try {
        hubSysLog_('auto-digest', 'digest_settle_late',
          str_(row[led.name]) + ' — staff:' + str_(got.staff) +
          ' candidate:' + str_(got.candidate) +
          ' name_key:' + str_(got.name_key) +
          ' checked:' + String(got.checked) +
          ' did:' + (got.did || []).join('+') +
          ' why:' + str_(got.why), { status: 200 });
      } catch (eW) { /* the row still carries the answer */ }
    }
    meta.settle = got;
    // A FAILED WRITE MUST NOT BE A SILENT ONE.
    var wrote = null;
    try {
      wrote = updateRowById_(led.res, {
        id: str_(row.id),
        settles: digestSettleSay_(got),
        digest_json: JSON.stringify(meta)
      });
    } catch (eU) {
      wrote = { error: { message: String(eU && eU.message || eU) } };
    }
    if (wrote && wrote.error) {
      try {
        hubSysLog_('auto-digest', 'digest_settle_write_failed',
          str_(row[led.name]) + ' — the receipt was handed in but the row would ' +
          'not record it: ' +
          String((wrote.error && wrote.error.message) || wrote.error).slice(0, 160),
          { status: 500 });
      } catch (eL2) { /* nothing left to try */ }
    } else {
      did++;
    }
  }
  return did;
}

// The settlement in one line a person can scan.
function digestSettleSay_(st) {
  if (!st || !st.doc_id) return '';
  if (st.did && st.did.length) return st.doc_id + ' → ' + st.did.join(' + ');
  // A REFUSAL IS NOT A FINDING.
  if (!st.checked) return st.doc_id + ' · not checked · ' + (st.why || 'refused');
  var said = [];
  if (st.candidate) said.push('candidate ' + (st.candidate === 'owed' ? 'owes it' : 'holds it'));
  if (st.staff) said.push('staff ' + (st.staff === 'owed' ? 'owes it' : 'holds it'));
  if (!said.length) said.push('nobody owes this');
  return st.doc_id + ' · ' + said.join(' · ') + (st.why ? ' · ' + st.why : '');
}

// One file → its verdict columns.
function digestOne_(row, led, opts) {
  var dry = !!(opts && opts.dry);
  led = led || DIGEST_LEDGERS[0];
  var cap = Number(led.textCap) || DIGEST_TEXT_CAP;
  var name = str_(row[led.name]) || 'file';
  var fileId = str_(row[led.fileId]);
  var text = '';
  try { text = digestReadText_(fileId, str_(row[led.mime]), name); }
  catch (eR) {
    var msg = String(eR && eR.message || eR);
    // A PERMISSION REFUSAL MUST SAY SO IN WORDS.
    if (/permission|access|not found|no item/i.test(msg)) {
      msg = 'the engine account cannot open this file — share its folder with ' +
            'the platform account (read-only) · ' + msg;
    }
    return { digest_state: 'error', digest_error: ('read failed: ' + msg).slice(0, 380) };
  }
  text = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  // A CLIP GOES TO THE ARM FIRST.
  var probed = null;
  // THE SECOND PATH TO WORDS.
  if (!text && !digestIsMedia_(str_(row[led.mime]), name)) {
    var paper = digestDocProbe_(fileId);
    if (paper && paper.text && String(paper.text).trim().length > 20) {
      text = String(paper.text).replace(/\n{3,}/g, '\n\n').trim();
      probed = { facts: paper.facts, frames: [] };
    }
  }
  if (!text && digestIsMedia_(str_(row[led.mime]), name)) {
    // SMALL CLIPS ARE READ HERE; BIG ONES GO TO THE SECOND CHANNEL: a video over 10MB opens a second channel, or…
    var mediaBytes = Number(str_(row.size_bytes) || 0);
    var inlineCap = digestSetting_('media_inline_mb', 10, 1, 200) * 1024 * 1024;
    var second = mediaBytes > inlineCap;
    probed = digestMediaProbe_(fileId, second);
    if (probed && probed.queued) {
      // A PENDING ROW MUST KNOW WHETHER IT CAN GO ON.
      var waited = 0;
      try {
        var before = row.digest_json;
        if (typeof before === 'string') before = JSON.parse(before || '{}');
        waited = Number((before && before.queued_tries) || 0) + 1;
      } catch (eQ) { waited = 1; }
      var patience = digestSetting_('media_queue_tries', 8, 2, 40);
      if (waited < patience) {
        return { digest_state: 'queued_media',
                 digest_kind: (String(row[led.mime]).indexOf('audio/') === 0) ? 'audio' : 'video',
                 digest_json: JSON.stringify({
                   queued_tries: waited, second_channel: true,
                   bytes: mediaBytes, v: DIGEST_VERSION,
                   note: 'the clip is being read on the media channel; this row ' +
                         'waits and is not holding the queue' }) };
      }
      // PATIENCE SPENT. The stalled row's letter is written by Python (app/letters.py).
      return { digest_state: 'stalled',
               digest_error: ('this clip could not be read after ' + waited +
                              ' passes on the media channel — please send it again, ' +
                              'or a shorter clip').slice(0, 380),
               digest_json: JSON.stringify({ queued_tries: waited, stalled: true,
                                             bytes: mediaBytes, v: DIGEST_VERSION }) };
    }
    if (probed && probed.text && String(probed.text).trim().length > 40) {
      text = String(probed.text).replace(/\n{3,}/g, '\n\n').trim();
    }
  }
  if (!text && digestIsMedia_(str_(row[led.mime]), name)) {
    // THE CLIP'S OWN FACTS.
    var mf = (probed && probed.facts)
      ? probed.facts : digestMediaFacts_(fileId, str_(row[led.mime]));
    if (probed && probed.facts) mf.kind = mf.kind ||
      ((String(row[led.mime]).indexOf('audio/') === 0) ? 'audio_clip' : 'video_clip');
    var mWho = led.anchorKey && str_(row[led.anchorKey])
      ? String(led.anchorKind || 'client') + ':' + str_(row[led.anchorKey]) : '';
    var mPerson = mWho ? str_(row[led.anchorName]) : '';
    // A CLIP HAS NO TEXT, so a name off its title has nothing to corroborate it: "PSI - Tracking Time.mp4" became a…
    if (!mPerson) {
      var mGuess = digestNameFromTitle_(name);
      var mKnown = mGuess ? digestWhoIs_(mGuess, '') : null;
      if (mKnown) { mWho = mKnown.id; mPerson = mKnown.display || mGuess; }
    }
    // A CLIP GETS A SHELF TOO (2026-09-10).
    var mRouted = (digestMayRoute_(led, row) && !dry)
      ? digestRouteFile_(fileId, 'media', (digestDates_(name, '')[0] || ''), name)
      : '';
    return {
      digest_state: 'done',
      digest_kind: mf.kind === 'audio_clip' ? 'audio' : 'video',
      digest_category: 'media',
      digest_dates: JSON.stringify(digestDates_(name, '')),
      digest_names: JSON.stringify(mWho ? [mWho] : []),
      digest_text_chars: '0',
      digest_text: '',
      doc_kind: mf.kind,
      person: mPerson || '',
      person_id: mWho,
      subject_type: mWho ? (mWho.indexOf('client:') === 0 ? 'client' : 'staff') : '',
      subject: mPerson || '',
      confidence: String(mWho || mPerson ? 70 : 55),
      digest_json: JSON.stringify({
        media: mf, final: true, v: DIGEST_VERSION, routed: mRouted,
        vocab_v: digestVocab_().v, vocab_from: digestVocab_().source,
        person_source: mWho ? (led.anchorKey && str_(row[led.anchorKey]) ? 'ledger' : 'roster') : '',
        note: 'a clip carries no words — these are its own facts; speech ' +
              'would need the model lane, which is off by declaration'
      }),
      digest_error: ''
    };
  }
  if (!text) {
    // "SAW NOTHING" IS A VERDICT, AND A VERDICT HAS AN AUTHOR (2026-09-10).
    var eTries = 0;
    try {
      var ePrior = row.digest_json;
      if (typeof ePrior === 'string') ePrior = JSON.parse(ePrior || '{}');
      eTries = Number((ePrior && ePrior.retries) || 0) +
               (str_(row.digest_state) === 'empty' ? 1 : 0);
    } catch (eE) { eTries = 0; }
    return { digest_state: 'empty',
             confidence: '0',
             digest_json: JSON.stringify({
               note: 'extraction ran and saw nothing',
               retries: eTries, confidence: 0, v: DIGEST_VERSION,
               vocab_v: digestVocab_().v, vocab_from: digestVocab_().source }) };
  }
  // The DRAWER a file was filed in is a fact worth more than any guess: a file inside "MARS" is a MARS, whatever…
  var dataExt = String(name).toLowerCase().replace(/^.*\./, '');
  var isDataset = /^# Sheet:/.test(text) ||
    ['csv', 'tsv', 'json', 'xml'].indexOf(dataExt) !== -1;
  var cat = digestCategory_(name, text);
  var drawer = led.drawer ? str_(row[led.drawer]) : '';
  var byDrawer = drawer ? digestDrawerCategory_(drawer) : '';
  // KNOWING THE DOCUMENT BEATS RECOGNISING A WORD.
  var kindGot = isDataset
    ? { kind: 'dataset', category: 'other', alt: '', score: 0 }
    : digestDocKind_(name, text);
  // A GRID OF CATEGORIES IS A MEDICATION CERTIFICATION, whatever the page is headed.
  if (!isDataset && kindGot.kind !== 'med_admin_cert' &&
      digestCertGrid_(text).length >= 2) {
    kindGot = { kind: 'med_admin_cert', category: 'certification_training',
                alt: kindGot.kind + ':' + (kindGot.score || 0), score: 20 };
  }
  var chosen = byDrawer || kindGot.category || cat.category;
  var catSource = byDrawer ? 'drawer'
    : (isDataset ? 'dataset' : (kindGot.category ? 'doc_kind' : cat.source));
  var dates = digestDates_(name, text);
  var ids = digestIds_(text);
  if (led.ref && str_(row[led.ref])) ids.unshift('ref:' + str_(row[led.ref]));
  var routed = (digestMayRoute_(led, row) && !dry)
    ? digestRouteFile_(fileId, chosen, dates[0] || '', name)
    : '';
  // THE ONE THING ONLY THIS LANE CAN SAY: the person typed a date and the document carries dates.
  var got = led.sub ? digestAnswers_(str_(row[led.sub]), fileId)
                    : { dates: [], said: [], note: '' };
  var typed = got.dates;
  var agree = '';
  if (typed.length && dates.length) {
    agree = 'no';
    for (var t = 0; t < typed.length; t++) {
      if (dates.indexOf(typed[t]) !== -1) { agree = 'yes'; break; }
    }
  }
  // WHAT THE PAPER ITSELF SAYS, since nobody is obliged to tell us: which document this is, which of its dates is…
  var docKind = kindGot.kind || (probed ? 'screen_recording' : '');
  // THE SECRET LEAVES THE TEXT BEFORE ANYTHING FILES IT, and the kind is known by now, so an id card's looser…
  var secret = digestRedact_(text, docKind);
  text = secret.text;
  var roles = digestDateRoles_(text);
  var level = docKind === 'med_admin_cert' ? digestMedLevel_(text) : '';
  /* A GRID CARRIES ITS OWN EXPIRY, and the live row's is the one that counts. */
  var grid = docKind === 'med_admin_cert' ? digestCertGrid_(text) : [];
  for (var gi = 0; gi < grid.length; gi++) {
    if (grid[gi].status === 'certified' && grid[gi].expires > String(roles.expires || '')) {
      roles.expires = grid[gi].expires;
      roles.issued = roles.issued || grid[gi].effective;
      roles.how.expires = 'grid';
    }
  }
  var program = docKind === 'dodd_certification' ? digestProgram_(text) : '';
  var checkGot = docKind === 'background_check' ? digestCheckResult_(text) : { agency: '', result: '' };
  /* one law, both runners — the second lane calls this same function */
  var fin = digestRolesFinish_(docKind, roles, dates, '');
  roles.issued = fin.issued; roles.expires = fin.expires; roles.how = fin.how;
  var expiresSource = fin.source;
  var expired = '';
  if (roles.expires) {
    expired = roles.expires < new Date().toISOString().slice(0, 10) ? 'yes' : 'no';
  }
  var whoGot = digestWhoIs_(text, name);
  var who = whoGot ? whoGot.id : '';
  if (who) ids.unshift(who);
  var pairs = digestPairs_(text);
  var numbers = digestNumbers_(text);
  for (var sl = 0; sl < secret.ssn_last4.length; sl++) numbers.push({ k: 'ssn_last4', v: secret.ssn_last4[sl] });
  var issuer = digestIssuer_(text);
  var amounts = digestAmounts_(text);
  var contacts = digestContacts_(text);
  // WHO IT IS ABOUT, DETERMINED — in the order of how much each source can be trusted.
  var person = '';
  var personSource = '';
  // THE ROW'S OWN ANCHOR FIRST: a key this platform wrote is proof, and no reading of a title or a page can outrank…
  var anchored = led.anchorKey ? str_(row[led.anchorKey]) : '';
  if (anchored) {
    who = String(led.anchorKind || 'client') + ':' + anchored;
    person = str_(row[led.anchorName]) || '';
    personSource = 'ledger';
    if (ids.indexOf(who) === -1) ids.unshift(who);
  }
  if (!person && whoGot) {
    person = whoGot.display || '';
    personSource = 'roster';
  }
  // THE TITLE BEFORE THE PRINTED FIELD, and the CJIS check is why: that PDF carries "A Last Name: Smith / A First…
  if (!person) {
    person = digestNameFromTitle_(name);
    if (person) personSource = 'title';
  }
  if (!person) {
    person = digestNameFromText_(text, docKind) || digestNameFromPairs_(pairs);
    if (person) personSource = 'field';
  }
  /* the résumé convention: the name is the first line, unlabelled */
  if (!person && docKind === 'application_resume') {
    person = digestNameFromHead_(text);
    if (person) personSource = 'head';
  }
  // A TITLE PHRASE IS NOT A PERSON.
  if (person && personSource === 'title' && !DIGEST_PERSON_KINDS[docKind] &&
      text.toLowerCase().indexOf(person.toLowerCase()) === -1) {
    person = '';
    personSource = '';
  }
  // A NAME FOUND IN THE PAPER IS STILL WORTH AN ID: the roster is asked again with just that name, and a single…
  if (person && !who) {
    var second = digestWhoIs_(person, '');
    if (second) {
      who = second.id;
      person = second.display || person;
      personSource = personSource + '+roster';
      ids.unshift(who);
    }
  }
  // WHAT THE PAPER ITSELF SAYS THE NAME IS — read again, on its own, so it can agree with the row, disagree with…
  var seenName = isDataset ? '' :
    (digestNameFromText_(text, docKind) || digestNameFromPairs_(pairs) ||
     (docKind === 'application_resume' ? digestNameFromHead_(text) : ''));
  var checked = digestPersonCheck_(person, seenName);
  var personWas = '';
  if (checked.agree === 'corrected') {
    personWas = person;
    person = checked.person;
    who = checked.who;
    personSource = 'document';
    if (ids.indexOf(who) === -1) ids.unshift(who);
  } else if (!person && checked.person) {
    person = checked.person;
    personSource = personSource || 'field';
  }
  var subject = isDataset
    ? { type: 'dataset',
        subject: ((/^# Sheet:\s*(.+)$/m.exec(text) || ['', ''])[1] ||
                  String(name).replace(/\.[a-z0-9]+$/i, '')).slice(0, 60) }
    : digestSubject_(
        whoGot || (who ? { kind: who.indexOf('client:') === 0 ? 'client' : 'staff',
                           display: person } : null),
        person, docKind, text, name);
  if (isDataset && !anchored) { person = ''; personSource = ''; }

  // THE ANSWERS MEET THE PAPER.
  var merged = digestAnswerCheck_(got.said || [], {
    person: person, doc_kind: docKind, issuer: issuer,
    issued: roles.issued, expires: roles.expires,
    dates: dates, numbers: numbers
  });
  var filled = [];
  if (merged.fill.expires_on && !roles.expires) {
    roles.expires = merged.fill.expires_on;
    expired = roles.expires < new Date().toISOString().slice(0, 10) ? 'yes' : 'no';
    filled.push('expires_on');
    expiresSource = 'answer';
  }
  if (merged.fill.issued_on && !roles.issued) {
    roles.issued = merged.fill.issued_on;
    filled.push('issued_on');
  }
  // AND ONCE MORE AFTER THE ANSWERS, because a typed issue date can be the thing that makes a renewal period…
  if (!roles.expires) {
    var fin2 = digestRolesFinish_(docKind, roles, dates, '');
    if (fin2.expires) {
      roles.expires = fin2.expires;
      roles.how = fin2.how;
      expiresSource = fin2.source;
      expired = roles.expires < new Date().toISOString().slice(0, 10) ? 'yes' : 'no';
      filled.push('expires_on:' + fin2.source);
    }
  }
  if (merged.fill.doc_kind && !docKind) {
    docKind = merged.fill.doc_kind;
    filled.push('doc_kind');
  }
  // WHAT THE SENDER SAID THE DOCUMENT IS ABOUT.
  if (merged.fill.person && !person && DIGEST_PERSON_KINDS[docKind]) {
    person = merged.fill.person;
    personSource = 'answer';
    filled.push('person');
    if (!who) {
      var said = digestWhoIs_(merged.fill.person, '');
      if (said) {
        who = said.id;
        person = said.display || person;
        personSource = 'answer+roster';
        if (ids.indexOf(who) === -1) ids.unshift(who);
        subject = digestSubject_(said, person, docKind, text, name);
      }
    }
  }

  // HOW SURE IT IS, and the number decides whether this file is ever read again: the same file is never decoded…
  var facts = {
    doc_kind: docKind, category: chosen, category_source: catSource,
    issued_on: roles.issued, expires_on: roles.expires, issuer: issuer,
    who: who, person: person, person_source: personSource,
    subject_type: subject.type, subject: subject.subject,
    dates: dates, pairs: pairs, numbers: numbers,
    answers_yes: merged.yes, answers_no: merged.no,
    kind_score: kindGot.score || 0, person_agree: checked.agree || '',
    level: level, program: program, check_result: checkGot.result,
    chars: text.length
  };
  // WHAT THE KIND SAID THIS PAPER OWED.
  var missing = digestMissing_(docKind, {
    person: person, expires_on: roles.expires, issued_on: roles.issued,
    born_on: roles.born, issuer: issuer, level: level, program: program,
    number: (numbers && numbers.length) ? 'yes' : '',
    check_result: checkGot.result
  });
  var confidence = digestConfidence_(facts);
  var tries = 0;
  try {
    var prior = row.digest_json;
    if (typeof prior === 'string') prior = JSON.parse(prior || '{}');
    tries = Number((prior && prior.retries) || 0);
  } catch (eT2) { tries = 0; }
  if (str_(row.digest_state) === 'done') tries += 1;   // this pass IS a retry

  // THE WHOLE TEXT SURVIVES THE CELL: past the cap it goes to a Markdown file of the decoder's own, named by this…
  var spill = (text.length > cap && !dry) ? digestSpillText_(row, led, text, facts) : null;
  // THE ORIGINAL BYTES COME DOWN once its words are somewhere safe — text and source only, and never the corpus.
  var zipped = digestZipMaybe_(row, led, spill || text.length <= cap);
  // A PREVIEW WITH NO ARCHIVE BEHIND IT WOULD BE A LOSS.
  if (text.length > cap && !spill) cap = Math.max(cap, Math.min(text.length, 20000));
  // THE SEAM: shut by default, and when it is shut nothing about the row changes — the ai_* columns are simply not…
  var smart = digestSmartMaybe_(facts, text);

  // THE PAPER REACHES THE PERSON.
  var liveId = zipped ? zipped.file_id : fileId;
  var settled = dry ? null : digestSettle_(led, {
    doc_kind: docKind, person: person, who: who, confidence: confidence,
    kind_score: kindGot.score || 0,
    asset_id: str_(row.asset_id),
    file_id: liveId,
    file_url: zipped ? zipped.file_url : str_(row.file_url),
    file_name: zipped ? zipped.name : name,
    mime_type: zipped ? 'application/zip' : str_(row[led.mime]),
    size_bytes: zipped ? String(zipped.bytes) : str_(row.size_bytes),
    issued_on: roles.issued, expires_on: roles.expires
  });

  var verdict = {
    digest_state: 'done',
    digest_kind: (str_(row[led.mime]).split('/')[1] || 'file').slice(0, 20),
    digest_category: chosen,
    digest_dates: JSON.stringify(dates),
    // the column keeps its place in the schema; its CONTENT is ids — anchors are never names
    digest_names: JSON.stringify(ids),
    digest_text_chars: String(text.length),
    digest_text: text.slice(0, cap),
    // THE COLUMNS A PERSON QUERIES (2026-09-09).
    doc_kind: docKind,
    person: person,
    person_id: who,
    subject_type: subject.type,
    subject: subject.subject,
    person_seen: checked.seen || '',
    person_agree: checked.agree || '',
    // 'no' the moment ONE answer disagrees with the paper.
    answers_agree: merged.agree,
    // WHAT THIS PAPER SETTLED, in one cell a person can scan: the obligation and where the receipt went — or the…
    settles: digestSettleSay_(settled),
    mentions: JSON.stringify(digestMentions_(text, name, who)),
    issued_on: roles.issued,
    expires_on: roles.expires,
    confidence: String(confidence),
    text_file: spill ? spill.id : '',
    digest_json: JSON.stringify({
      confidence: confidence,
      retries: tries,
      category_source: catSource,
      lexicon_said: cat.category && cat.category !== chosen ? cat.category : '',
      drawer: drawer,
      text_truncated: text.length > cap,
      text_file: spill ? spill.id : '',
      text_file_url: spill ? spill.url : '',
      routed: routed,
      zipped: zipped ? { was: zipped.was, was_bytes: zipped.was_bytes,
                         bytes: zipped.bytes } : undefined,
      media: probed ? probed.facts : undefined,
      media_frames: probed ? (probed.frames || []).length : undefined,
      doc_kind: docKind,
      kind_score: kindGot.score || 0,
      kind_alt: kindGot.alt || '',
      issuer: issuer,
      issued_on: roles.issued,
      expires_on: roles.expires,
      expires_source: expiresSource,
      date_how: roles.how,
      born_on: roles.born,
      level: level || undefined,
      missing: missing.length ? missing : undefined,
      cert_grid: grid.length ? grid : undefined,
      program: program || undefined,
      check_agency: checkGot.agency || undefined,
      check_result: checkGot.result || undefined,
      ssn_last4: secret.ssn_last4.length ? secret.ssn_last4 : undefined,
      expired: expired,
      who: who,
      person_source: personSource,
      person_was: personWas,
      person_seen: checked.seen || '',
      person_agree: checked.agree || '',
      v: DIGEST_VERSION,
      vocab_v: digestVocab_().v,
      vocab_from: digestVocab_().source,
      pairs: pairs,
      numbers: numbers,
      amounts: amounts,
      contacts: contacts,
      dates_typed: typed,
      dates_agree: agree,
      typed_note: got.note || '',
      // the whole cross-check, question by question: what was said, what the paper says, and the verdict — the…
      answers: merged.items,
      answers_form: got.slug || '',
      answers_yes: merged.yes,
      answers_no: merged.no,
      answers_filled: filled,
      settle: settled || undefined
    }),
    digest_error: ''
  };
  // STEPS TWO AND THREE, COMMITTED: the paper was read, and the reading was judged against what the person said…
  try {
    var assetId = dry ? '' : str_(row.asset_id);
    if (assetId) {
      assetEvent_('asset_extracted', assetId,
        { type: 'file', key: fileId, name: name, actor: 'auto-digest' },
        { doc_kind: docKind, category: chosen, chars: text.length,
          confidence: confidence, kind_score: kindGot.score || 0,
          issued_on: roles.issued, expires_on: roles.expires,
          person: person, person_id: who, decoder: DIGEST_VERSION,
          vocab: digestVocab_().v },
        'digestOne_');
      if (merged.yes || merged.no) {
        assetEvent_('asset_qualified', assetId,
          { type: 'file', key: fileId, name: name, actor: 'auto-digest' },
          { agree: merged.agree, agreed: merged.yes, disagreed: merged.no,
            filled: filled, form: got.slug || '' },
          'digestAnswerCheck_');
      }
    }
  } catch (eAE) { /* the trail is not the work */ }
  // THE VERDICT GOES BACK BESIDE THE ANSWER IT JUDGED — not only into a JSON blob on this row.
  try {
    if (led.sub && merged.items && merged.items.length &&
        typeof formAnswersCheck_ === 'function') {
      formAnswersCheck_(str_(row[led.sub]), merged.items, {
        doc_kind: docKind, file_id: fileId, asset_id: str_(row.asset_id),
        subject_kind: subject.type, subject_key: who,
        subject_name: person, decoder_v: DIGEST_VERSION
      });
    }
  } catch (eFA) { /* the row keeps the whole cross-check either way */ }
  if (zipped) {
    verdict.file_id = zipped.file_id;
    verdict.file_url = zipped.file_url;
    verdict.file_name = zipped.name;
    verdict.mime_type = 'application/zip';
    verdict.size_bytes = String(zipped.bytes);
  }
  // THE SEAM WRITES ONLY WHEN IT IS OPEN.
  if (smart) {
    verdict.ai_summary = smart.text;
    verdict.ai_summary_at = new Date().toISOString();
    verdict.ai_source = smart.source;
  }
  return verdict;
}

// CONFIDENCE IS A COUNT OF WHAT WAS FOUND, never a feeling.
var DIGEST_CONFIDENCE_FLOOR = 85;
var DIGEST_MAX_RETRIES = 2;

// HOW SURE THE PLATFORM IS — and it used to measure the wrong thing.
function digestConfidence_(f) {
  var score = 0;
  var chars = Number(f.chars || 0);
  if (chars >= 400) score += 30;            // real words, not a stray label
  else if (chars >= 80) score += 18;
  else if (chars > 0) score += 8;
  // THE KIND IS NOT A GUESS.
  if (Number(f.kind_score || 0) >= 20) score += 8;
  // THE PERSON WAS ESTABLISHED, NOT INFERRED — and establishment means an ID.
  if (f.who && (f.person_source === 'roster' || f.person_source === 'ledger' ||
                f.person_source === 'document' || f.person_agree === 'yes')) {
    score += 5;
  }
  if (f.doc_kind) score += 25;              // it knows WHICH document
  if (f.category && f.category !== 'other') {
    score += (f.category_source === 'drawer' || f.category_source === 'doc_kind') ? 15 : 8;
  }
  if (f.expires_on || f.issued_on) score += 12;   // a LABELLED date
  else if (f.dates && f.dates.length) score += 5; // dates, unlabelled
  if (f.who) score += 10;                   // whose it is, as an id
  if (f.numbers && f.numbers.length) score += 5;
  if (f.pairs && f.pairs.length >= 3) score += 5;
  if (f.issuer) score += 3;
  // A CARD THAT IS A DATE, READ WITHOUT THE DATE, IS NOT READ (2026-09-10).
  var wants = digestCredentialFor_(f.doc_kind);
  if (wants && wants.expires && !String(f.expires_on || '').trim()) {
    score = Math.min(score, digestSetting_('no_expiry_ceiling', 60, 0, 84));
  }
  // A SECOND WITNESS.
  if (f.answers_yes) score += Math.min(12, 6 * Number(f.answers_yes));
  return Math.max(0, Math.min(100, score));
}

// ONE PAPER, READ AND WRITTEN NOWHERE: the steps digestOne_ takes over a ledger row — the text, the kind with the…
function digestReadPaper_(fileId, mime, name) {
  var n = String(name || 'file');
  var m = String(mime || '');
  try {
    var file = DriveApp.getFileById(String(fileId));
    if (!m) m = String(file.getMimeType() || '');
  } catch (eF) {
    return { state: 'error', why: String((eF && eF.message) || eF).slice(0, 300), chars: 0, v: DIGEST_VERSION };
  }
  // Drive's converter sees nothing in a HEIC photo
  if (/image\/hei[cf]/i.test(m) || /\.hei[cf]$/i.test(n)) return { state: 'heic', chars: 0, v: DIGEST_VERSION };
  var text = '';
  try { text = digestReadText_(fileId, m, n, true); }
  catch (eR) {
    return { state: 'error', why: String((eR && eR.message) || eR).slice(0, 300), chars: 0, v: DIGEST_VERSION };
  }
  text = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  var today = '';
  try { today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'); } catch (eT) { today = ''; }
  return digestPaperFromText_(text, n, today);
}

// The words of a picture or a PDF handed in as base64 that no Drive file holds yet: the bytes go up once as the…
function digestUploadText_(base64, mime, name) {
  var bytes = Utilities.base64Decode(String(base64 || ''));
  if (!bytes.length) return '';
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var boundary = 'digest' + Utilities.getUuid().replace(/-/g, '');
  var meta = JSON.stringify({ name: DIGEST_TMP_NAME, mimeType: 'application/vnd.google-apps.document' });
  var head = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
                               '\r\n--' + boundary + '\r\nContent-Type: ' + String(mime || 'application/octet-stream') +
                               '\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id' +
                             '&supportsAllDrives=true',
    { method: 'post', contentType: 'multipart/related; boundary=' + boundary, headers: auth,
      payload: head.concat(bytes).concat(tail), muteHttpExceptions: true });
  if (up.getResponseCode() >= 400) {
    throw new Error('Drive would not convert ' + String(name || 'the file') + ' (HTTP ' + up.getResponseCode() + ')');
  }
  var copyId = '';
  try {
    copyId = String(JSON.parse(up.getContentText()).id || '');
    if (!copyId) throw new Error('Drive named no converted copy');
    var exp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + copyId + '/export?mimeType=text%2Fplain',
                                { headers: auth, muteHttpExceptions: true });
    if (exp.getResponseCode() >= 400) {
      throw new Error('Drive would not export the converted text (HTTP ' + exp.getResponseCode() + ')');
    }
    return String(exp.getContentText() || '');
  } finally {
    if (copyId) {
      try {
        UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + copyId + '?supportsAllDrives=true',
                          { method: 'delete', headers: auth, muteHttpExceptions: true });
      } catch (eDel) { /* the sweep takes a scratch copy an hour old */ }
    }
  }
}

// THE DAY A RECORD WAS DRAWN.
var DIGEST_REPORT_DATE_WORDS = [
  'licen[sc]e\\s+status\\s+as\\s+of', 'status\\s+as\\s+of', 'record\\s+as\\s+of', 'as\\s+of',
  'record\\s+date', 'date\\s+of\\s+record', 'report\\s+date', 'date\\s+of\\s+report', 'date\\s+printed',
  'printed\\s+on', 'run\\s+date'
];

/** The date a report-date label names, read forward ("Record Date: 09/20/2026"), the nearest one; '' when none. */
function digestReportDate_(text) {
  var s = String(text || '').slice(0, DIGEST_SCAN_CAP).replace(/\r/g, '\n');
  var best = null;
  for (var w = 0; w < DIGEST_REPORT_DATE_WORDS.length; w++) {
    var re = new RegExp('\\b' + DIGEST_REPORT_DATE_WORDS[w] + '\\b', 'gi');
    var m;
    while ((m = re.exec(s)) !== null) {
      var end = m.index + m[0].length;
      var fwd = new RegExp('^([^0-9A-Za-z]{0,12})' + DIGEST_DATE_TOKEN, 'i').exec(s.slice(end, end + 48));
      if (fwd) {
        var iso = digestAnyDate_(fwd[2]);
        var dist = fwd[1].length - (fwd[1].indexOf(':') !== -1 ? 1 : 0);
        if (iso && (!best || dist < best.dist)) best = { iso: iso, dist: dist };
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return best ? best.iso : '';
}

/** The reading of a paper's words — pure over the text, the name and the day it is read. */
function digestPaperFromText_(text, name, today) {
  var t = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  var n = String(name || 'file');
  var out = { state: t ? 'read' : 'empty', chars: t.length, kind: '', kind_score: 0, kind_alt: '',
              issued_on: '', expires_on: '', expires_source: '', how: {}, level: '', grid: [],
              report_on: '', licence_dated: false,
              who: '', person_seen: '', facts: {}, v: DIGEST_VERSION };
  if (!t) return out;
  var kindGot = digestDocKind_(n, t);
  if (kindGot.kind !== 'med_admin_cert' && digestCertGrid_(t).length >= 2) {
    kindGot = { kind: 'med_admin_cert', category: 'certification_training',
                alt: kindGot.kind + ':' + (kindGot.score || 0), score: 20 };
  }
  var cat = digestCategory_(n, t);
  var docKind = kindGot.kind || '';
  var chosen = kindGot.category || cat.category;
  var dates = digestDates_(n, t);
  var secret = digestRedact_(t, docKind);
  t = secret.text;
  var roles = digestDateRoles_(t);
  var level = docKind === 'med_admin_cert' ? digestMedLevel_(t) : '';
  var grid = docKind === 'med_admin_cert' ? digestCertGrid_(t) : [];
  for (var gi = 0; gi < grid.length; gi++) {
    if (grid[gi].status === 'certified' && grid[gi].expires > String(roles.expires || '')) {
      roles.expires = grid[gi].expires;
      roles.issued = roles.issued || grid[gi].effective;
      roles.how.expires = 'grid';
    }
  }
  var fin = digestRolesFinish_(docKind, roles, dates, today || '');
  var pairs = digestPairs_(t);
  var numbers = digestNumbers_(t);
  for (var sl = 0; sl < secret.ssn_last4.length; sl++) numbers.push({ k: 'ssn_last4', v: secret.ssn_last4[sl] });
  var whoGot = digestWhoIs_(t, n);
  var who = whoGot ? whoGot.id : '';
  // a name the paper prints is still worth an id when the roster knows it alone
  var seen = digestNameFromText_(t, docKind) || digestNameFromPairs_(pairs);
  if (!who && seen) {
    var second = digestWhoIs_(seen, '');
    if (second) who = second.id;
  }
  out.kind = docKind;
  out.kind_score = kindGot.score || 0;
  out.kind_alt = kindGot.alt || '';
  out.issued_on = fin.issued;
  out.expires_on = fin.expires;
  out.expires_source = fin.source;
  out.how = fin.how;
  out.level = level;
  out.grid = grid;
  // the record's own day, and whether the paper labels a licence's own issue or expiry day
  out.report_on = digestReportDate_(t);
  out.licence_dated = /\blicen[sc]e\s+(?:issue|iss\b|expir|exp\b)/i.test(t);
  out.who = who;
  out.person_seen = seen || '';
  out.facts = {
    doc_kind: docKind, category: chosen,
    category_source: kindGot.category ? 'doc_kind' : cat.source,
    issued_on: fin.issued, expires_on: fin.expires, issuer: digestIssuer_(t),
    dates: dates, pairs: pairs, numbers: numbers,
    kind_score: kindGot.score || 0, chars: t.length
  };
  return out;
}

// Should a file the decoder has already read be read again?
function digestWantsRetry_(row) {
  var meta = row.digest_json;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta || '{}'); } catch (e) { return false; }
  }
  if (!meta || typeof meta !== 'object') return false;
  var spent = Number(meta.retries || 0) >=
              digestSetting_('max_retries', DIGEST_MAX_RETRIES, 0, 5);
  // A ROW WITH NO CONFIDENCE WAS READ BY AN OLDER DECODER.
  if (meta.final === true) return false;
  // A DECODER THAT LEARNED SOMETHING MUST BE ALLOWED BACK IN.
  var floorV = String(digestSetting_('reread_before_version', '', undefined, undefined) || '');
  // THE DIAL OUTRANKS THE SPENT BUDGET, on purpose.
  if (floorV && floorV <= DIGEST_VERSION && String(meta.v || '') < floorV) return true;
  if (spent) return false;
  if (meta.confidence === undefined || meta.confidence === null) return true;
  return Number(meta.confidence) < digestSetting_('confidence_floor', DIGEST_CONFIDENCE_FLOOR, 40, 100);
}

// The drawer names, mapped onto the platform's categories.
function digestDrawerCategory_(drawer) {
  var d = String(drawer || '').toLowerCase();
  if (!d) return '';
  var table = digestDrawers_();
  var best = '';
  var bestLen = 0;
  for (var i = 0; i < table.length; i++) {
    var pre = String(table[i][0]);
    if (d.indexOf(pre) === -1) continue;
    if (pre.length > bestLen) { best = table[i][1]; bestLen = pre.length; }
  }
  return best;
}

// THE SWEEP — rides the service clock beside the call-off mailer: one pass per DIGEST_LOCK_S across all triggers, a…
HUB_POLICY.digestSweep = {
  file: 'Digest.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: [], service_only: true,
  // the stalled-file letter it used to send is Python's (app/letters.py)
  params: {}, invalidates: [], emits: []
};
HUB_ACTIONS.digestSweep = function (payload, user) {
  if (!user || !user.is_service) {
    return { status: 403, message: 'The digester answers the platform clock only.' };
  }
  // THE DIGEST GATE HOLDS THIS DIGESTER TOO (SmartGate.gs gate_digest_writes).
  var digestGate = (typeof hubGateHolds_ === 'function')
    ? hubGateHolds_('gate_digest_writes', { subject: 'the engine digester',
                                            body: 'a digest sweep over the form files and client files ledgers',
                                            purpose: 'a book write this platform gated' })
    : { held: false };
  if (digestGate.held) return { status: 200, data: { swept: false, held: true, why: digestGate.why } };
  digestSweepMaybe_();
  return { status: 200, data: { swept: true } };
};

function digestSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('digest_sweep_ran')) return;
  cache.put('digest_sweep_ran', '1', DIGEST_LOCK_S);
  var started = new Date().getTime();
  var doneN = 0;
  var per = {};
  for (var L = 0; L < DIGEST_LEDGERS.length; L++) {
    var led = DIGEST_LEDGERS[L];
    if (new Date().getTime() - started > DIGEST_BUDGET_MS) break;
    var rows;
    try { rows = listRows_(led.res, {}) || []; } catch (eL) { continue; }
    // ONE FILE, ONE DECODE — unless it barely told us anything.
    var pend = [];
    var again = [];
    for (var i = 0; i < rows.length; i++) {
      var state = str_(rows[i].digest_state);
      if (state === 'pending') pend.push(rows[i]);
      // a clip on the second channel comes back with the retries, never ahead of somebody's fresh upload
      else if (state === 'queued_media') again.push(rows[i]);
      // `empty` belongs here with `done`: both are finished verdicts, and a decoder that grew a second pair of eyes…
      else if ((state === 'done' || state === 'empty') &&
               digestWantsRetry_(rows[i])) again.push(rows[i]);
    }
    // THE BADGE DECIDES WHO GOES FIRST, and age decides among equals.
    if (pend.length > 1 && led.sub) {
      pend.sort(function (a, b) {
        var ra = digestUploaderRank_(str_(a.uploaded_by_email));
        var rb = digestUploaderRank_(str_(b.uploaded_by_email));
        if (ra !== rb) return rb - ra;
        return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
      });
    }
    // FRESH FIRST IS AN INVARIANT, not an ordering hint — the drawer sort below runs over the WHOLE list, so a…
    for (var rI = 0; rI < again.length; rI++) again[rI].__digestRetry = true;
    pend = pend.concat(again);
    // A LEDGER WITH NOTHING TO DECODE STILL HAS HOUSEKEEPING (2026-09-10).
    var willDecode = pend.length > 0;
    // THE CLINICAL DRAWERS GO FIRST.
    if (led.priority && led.priority.length && led.drawer) {
      pend.sort(function (a, b) {
        function rank(r) {
          var base = r.__digestRetry ? (led.priority.length + 1) * 2 : 0;
          var d = str_(r[led.drawer]);
          for (var p = 0; p < led.priority.length; p++) {
            if (d.indexOf(led.priority[p]) === 0) return base + p;
          }
          return base + led.priority.length;
        }
        return rank(a) - rank(b);
      });
    }
    // A DOOR THAT IS SHUT IS SHUT FOR ALL OF THEM.
    var shut = 0;
    for (var n = 0; willDecode && n < pend.length && doneN < DIGEST_PER_PASS; n++) {
      if (new Date().getTime() - started > DIGEST_BUDGET_MS) break;
      var verdict;
      try { verdict = digestOne_(pend[n], led); }
      catch (eD) {
        verdict = { digest_state: 'error',
                    digest_error: String(eD && eD.message || eD).slice(0, 380) };
      }
      if (String(verdict.digest_error || '').indexOf('cannot open this file') !== -1) {
        shut++;
        if (shut >= 3) {
          try {
            hubSysLog_('auto-digest', 'digest_ledger_shut',
                       led.res + ': the engine account cannot open these files — ' +
                       'share the folder with it (read-only). ' + (pend.length - n) +
                       ' row(s) left untouched.', { status: 403 });
          } catch (eLs) { /* the log is the alarm, not the gate */ }
          break;
        }
      }
      verdict.id = str_(pend[n].id);
      verdict.digested_at = new Date().toISOString();
      // THE SAME BLINDNESS AS THE SETTLEMENT HAD (2026-09-10): this writer RETURNS { error } instead of throwing…
      var landed = null;
      try {
        landed = updateRowById_(led.res, verdict);
      } catch (eW) {
        landed = { error: { message: String(eW && eW.message || eW) } };
      }
      if (landed && landed.error) {
        try {
          hubSysLog_('auto-digest', 'digest_verdict_write_failed',
            str_(pend[n][led.name]) + ' — decoded, but the row would not take it: ' +
            String((landed.error && landed.error.message) || landed.error).slice(0, 160),
            { status: 500 });
        } catch (eL3) { /* the row stays pending either way */ }
      } else {
        doneN++;
        per[led.res] = (per[led.res] || 0) + 1;
      }
    }
    // THE OLD ROWS COME DOWN TOO, a few per pass and only with time left: everything decoded before the sheet…
    var moved = digestCompactMaybe_(led, rows, started);
    if (moved) per[led.res + ':compacted'] = moved;
    // AND THE FOLDER IS LEFT CLEAN: orphans past their hours are trashed, claimed files that kept the prefix are…
    var tidied = digestTidyMaybe_(led, rows, started);
    if (tidied) per[led.res + ':tidied'] = tidied;
    var stuck = digestStuckMaybe_(led, rows);
    if (stuck) per[led.res + ':stalled'] = stuck;
    // THE RECEIPTS THAT WERE WORKED OUT BEFORE THE KEY WAS TURNED.
    var settledLate = digestSettleSweep_(led, function () {
      return DIGEST_BUDGET_MS - (new Date().getTime() - started);
    });
    if (settledLate) per[led.res + ':settled'] = settledLate;
  }
  // THE CERTIFICATE UPLOADS WHOSE OWN READING DIED (ComplianceDocs.gs), a few per pass on what the budget leaves.
  if (typeof certDocReadSweep_ === 'function') {
    try {
      certDocReadSweep_(function () { return DIGEST_BUDGET_MS - (new Date().getTime() - started); });
    } catch (eCert) { /* each row counts its own tries; the next pass tries again */ }
  }
  // The client plans whose sections were never filed are read again by Python (app/isp_intake.py), on the relay's clock.
  try {
    var tmpGone = digestTmpTidy_(function () { return DIGEST_BUDGET_MS - (new Date().getTime() - started); });
    if (tmpGone) per['scratch:deleted'] = tmpGone;
  } catch (eTmp) { /* the next pass tries again */ }
  if (doneN || Object.keys(per).length) {
    var say = [];
    for (var k in per) say.push(per[k] + ' ' + k);
    try {
      hubSysLog_('auto-digest', 'digest_swept', say.join(' · ') + ' digested', { status: 200 });
    } catch (eLg) { /* swept either way */ }
  }
}
