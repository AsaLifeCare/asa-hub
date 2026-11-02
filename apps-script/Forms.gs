// ------------------------------------------------------------------ FORMS — a link somebody fills in, landing in…
// That way the platform adapts to demand and stays the single one for the whole company.

// THE RESOURCE NAME, NOT THE TAB NAME.
var FORMS_RES = 'forms';
var FORM_SUBMISSIONS_RES = 'formSubmissions';

// THE KIND ENGINE — file is the HARDEST kind and goes first, but list inputs, selection tables and richer designs…
var FORM_KINDS = {
  text: {}, long: {}, number: {}, date: {}, time: {},
  phone: {}, email: {}, yes_no: {},
  choice: { needsOptions: true },
  multi: { needsOptions: true },
  scale: { needsOptions: true },
  heading: { heading: true },
  file: {
    composite: true,
    // GOOGLE CANNOT AUTHOR THIS ONE.
    platformOnly: true,
    validate: function (f) { return formFileFieldCheck_(f); },
    answer: function (f, raw, ctx) { return formFileAnswer_(f, raw, ctx); }
  }
};
// What a question may be.
var FORM_FIELD_KINDS = Object.keys(FORM_KINDS);

// WHAT A QUESTION FEEDS — the text a form already has, the choices it already has and an expiry date get merged…
var FORM_FIELD_FACTS = {
  person: { of: ['text'], column: 'person' },
  doc_kind: { of: ['choice', 'text'], column: 'doc_kind' },
  expires_on: { of: ['date', 'text'], column: 'expires_on' },
  issued_on: { of: ['date', 'text'], column: 'issued_on' },
  // the declared rule: an expiry field is really ANY date to us, so a form may say so and the decoder keeps it as a…
  date: { of: ['date', 'text'], column: '' },
  house: { of: ['choice', 'text'], column: '' },
  client: { of: ['choice', 'text'], column: '' }
};

var FORM_MAX_FIELDS = 60;
var FORM_MAX_ANSWER_CHARS = 4000;
var FORM_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

// ================================================================== 1 — THE DEFINITION…

function formsAll_() {
  try { return listRows_(FORMS_RES, {}) || []; } catch (e) { return []; }
}

// The live row already holding this Google source, or null — ONE SOURCE, ONE ROW ("eu carrego 1 e vem 2"): a…
function formBySourceUrl_(u) {
  var want = String(u || '').trim();
  if (!want) return null;
  var rows = listRows_(FORMS_RES, {});
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].source_url).trim() === want &&
        str_(rows[i].archived).toLowerCase() !== 'true') return rows[i];
  }
  return null;
}

// A REIMPORT MIRRORS THE ORIGINAL — EXCEPT WHERE THE ORIGINAL CANNOT SPEAK.
function formKeepPlatformFields_(oldFields, fresh) {
  var freshKinds = {}, freshKeys = {};
  for (var i = 0; i < fresh.length; i++) {
    freshKinds[String(fresh[i].kind || 'text')] = 1;
    freshKeys[String(fresh[i].key || '')] = 1;
  }
  // A DECLARATION IS NOT A QUESTION, so a reimport must not erase it.
  var wasFact = {};
  for (var w = 0; w < (oldFields || []).length; w++) {
    var wf = oldFields[w] || {};
    if (wf.key && wf.fact) wasFact[String(wf.key)] = String(wf.fact);
  }
  for (var m = 0; m < fresh.length; m++) {
    var mk = String(fresh[m].key || '');
    if (mk && !fresh[m].fact && wasFact[mk]) fresh[m].fact = wasFact[mk];
  }
  var out = fresh.slice();
  for (var j = 0; j < (oldFields || []).length; j++) {
    var f = oldFields[j] || {};
    var kind = String(f.kind || 'text');
    var spec = FORM_KINDS[kind] || {};
    if (!spec.platformOnly) continue;
    if (freshKinds[kind] || freshKeys[String(f.key || '')]) continue;
    out.push(f);
  }
  return out;
}

var FORMS_REREAD_DONE = false;

// THE FORM FOR A SLUG — AND A MISS IS NEVER TRUSTED.
function formBySlug_(slug) {
  var want = String(slug || '').trim().toLowerCase();
  if (!want) return null;
  var rows = formsAll_();
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].slug).toLowerCase() === want) return rows[i];
  }
  if (FORMS_REREAD_DONE) return null;
  FORMS_REREAD_DONE = true;
  try {
    cacheBump_(cacheScope_(tabFor_(FORMS_RES)));
    var fresh = listRows_(FORMS_RES, {}) || [];
    for (var f = 0; f < fresh.length; f++) {
      if (str_(fresh[f].slug).toLowerCase() === want) {
        try {
          hubSysLog_('asa-hub:form', 'form_found_on_reread',
                     want + ' — the cached list did not have it yet',
                     { status: 200 });
        } catch (eL) { /* found either way */ }
        return fresh[f];
      }
    }
  } catch (e) { /* the cached answer stands: no such form */ }
  return null;
}

// The questions, parsed.
function formFields_(row) {
  var raw = row && row.fields;
  if (!raw) return [];
  if (Object.prototype.toString.call(raw) === '[object Array]') return raw;
  try {
    var got = JSON.parse(String(raw));
    return Object.prototype.toString.call(got) === '[object Array]' ? got : [];
  } catch (e) { return []; }
}

/** 24 characters of real randomness — the part of the link that is a key. */
function formMintToken_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var raw = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + ':' + new Date().getTime()));
  var out = '';
  for (var i = 0; i < raw.length && out.length < 24; i++) {
    var c = raw.charAt(i);
    if (alphabet.indexOf(c) !== -1) out += c;
  }
  while (out.length < 24) out += alphabet.charAt(out.length % alphabet.length);
  return out;
}

/** The link a person is sent. */
function formPublicUrl_(row) {
  var base = (typeof PLATFORM_MAIL_RELAY !== 'undefined')
    ? PLATFORM_MAIL_RELAY : 'https://asamylife.asalifecare.com';
  return base + '/form.html?f=' + encodeURIComponent(str_(row.slug)) +
         '&t=' + encodeURIComponent(str_(row.token));
}

/** Refuse a definition rather than store one that cannot be drawn. */
function formCheckFields_(fields) {
  if (Object.prototype.toString.call(fields) !== '[object Array]') {
    return 'The questions must be a list.';
  }
  if (!fields.length) return 'A form with no questions collects nothing.';
  var seen = {};
  var questions = 0; // headings render, but they are not questions and do not count
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i] || {};
    var key = String(f.key || '').trim();
    if (!/^[a-z0-9_]{1,40}$/.test(key)) {
      return 'Question ' + (i + 1) + ' needs a key of lower-case letters, digits ' +
             'and underscores — it is the column the answer is stored under.';
    }
    if (seen[key]) return 'Two questions both call themselves "' + key + '".';
    seen[key] = true;
    var kind = String(f.kind || 'text');
    var spec = FORM_KINDS[kind];
    if (!spec) {
      return '"' + kind + '" is not a kind of question. Use one of: ' +
             FORM_FIELD_KINDS.join(', ') + '.';
    }
    if (spec.heading) {
      // A SECTION: a title and/or a text, never an answer, never required.
      if (!String(f.label || '').trim() && !String(f.help || '').trim()) {
        return 'Heading ' + (i + 1) + ' says nothing — give it a title or a text.';
      }
      continue;
    }
    questions++;
    if (!String(f.label || '').trim()) {
      return 'Question "' + key + '" has no label, so nobody would know what to answer.';
    }
    if (spec.needsOptions && !(f.options && f.options.length)) {
      return 'Question "' + key + '" offers a choice of nothing.';
    }
    if (spec.validate) {
      var bad = spec.validate(f);
      if (bad) return bad;
    }
    // A DECLARED FACT MUST BE ONE THE PLATFORM CARRIES, and must sit on a question that can answer it — a date fact…
    var factName = String(f.fact || '').trim();
    if (factName) {
      var fact = FORM_FIELD_FACTS[factName];
      if (!fact) {
        return 'Question "' + key + '" says it feeds "' + factName +
               '", which this platform does not carry. One of: ' +
               Object.keys(FORM_FIELD_FACTS).join(', ') + '.';
      }
      if (fact.of.indexOf(kind) === -1) {
        return 'Question "' + key + '" feeds "' + factName + '", which needs ' +
               fact.of.join(' or ') + ' — not ' + kind + '.';
      }
    }
  }
  if (!questions) return 'A form with no questions collects nothing.';
  if (questions > FORM_MAX_FIELDS) {
    return 'That is ' + questions + ' questions. Sixty is the cap — past it ' +
           'nobody finishes the form and the answers stop being worth having.';
  }
  return '';
}

// ================================================================== 2 — THE PUBLIC HALF (no session, and it never…

function formPubThrottled_(kind, cap) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get('form_pub_' + kind) || '0');
    if (n >= cap) return true;
    cache.put('form_pub_' + kind, String(n + 1), 3600);
  } catch (e) { /* cache down: the door stays open rather than shut */ }
  return false;
}

// WHAT THE PAGE DRAWS.
function formPublicGetPub_(payload) {
  if (formPubThrottled_('get', 600)) {
    return { status: 429, message: 'Too many requests right now — please try again in a few minutes.' };
  }
  var row = formBySlug_(payload && payload.f);
  var token = String((payload && payload.t) || '');
  // ONE ANSWER FOR "no such form", "wrong key" AND "archived": telling them apart says which slugs exist, and a…
  if (!row || !token || token !== str_(row.token) ||
      str_(row.archived).toLowerCase() === 'true') {
    return { status: 404, message: 'This link is not valid. Ask whoever sent it for a fresh one.' };
  }
  var state = str_(row.status).toLowerCase() || 'draft';
  // 'testing' answers like open — a debug run walks the REAL lane end to end; only the badge tells them apart.
  if (state !== 'open' && state !== 'testing') {
    return { status: 410, message: str_(row.closed_message) ||
             'This form is closed. Thank you for your interest.' };
  }
  return { status: 200, data: {
    slug: str_(row.slug),
    title: str_(row.title),
    intro: str_(row.intro),
    fields: formFields_(row),
    thank_you: str_(row.thank_you) || 'Thank you — this has reached the team.',
    // OPT-IN, never a default: every one of our masks carried a header with Your Name, E-mail and Phone that the…
    asks_contact: str_(row.asks_contact).toLowerCase() === 'yes'
  } };
}

// ONE ANSWER, FILED.
function formPublicSubmitPub_(payload) {
  if (formPubThrottled_('submit', 240)) {
    return { status: 429, message: 'Too many submissions right now — please try again shortly.' };
  }
  var row = formBySlug_(payload && payload.f);
  var token = String((payload && payload.t) || '');
  if (!row || !token || token !== str_(row.token) ||
      str_(row.archived).toLowerCase() === 'true') {
    return { status: 404, message: 'This link is not valid. Ask whoever sent it for a fresh one.' };
  }
  if (['open', 'testing'].indexOf(str_(row.status).toLowerCase()) === -1) {
    return { status: 410, message: str_(row.closed_message) || 'This form is closed.' };
  }

  var fields = formFields_(row);
  var given = (payload && payload.answers) || {};
  var answers = {};
  var missing = [];
  // side effects a composite kind wants filed AFTER the submission lands (the file kind pushes its ledger rows here)
  var ctx = { row: row, after: [] };
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i] || {};
    var key = String(f.key || '');
    var spec = FORM_KINDS[String(f.kind || 'text')] || {};
    if (spec.heading) continue;
    var v;
    if (spec.answer) {
      // A COMPOSITE KIND shapes its own answer (compact JSON) and may refuse the whole submission with a plain…
      var got = spec.answer(f, given[key], ctx);
      if (got && got.error) return { status: 400, message: got.error };
      v = String((got && got.v) || '').slice(0, FORM_MAX_ANSWER_CHARS);
    } else {
      v = given[key];
      if (Object.prototype.toString.call(v) === '[object Array]') v = v.join(', ');
      v = String(v == null ? '' : v).trim().slice(0, FORM_MAX_ANSWER_CHARS);
    }
    // A QUESTION THE FORM DID NOT ASK IS NOT STORED.
    if (v) answers[key] = v;
    if (String(f.required) === 'true' && !v) missing.push(String(f.label || key));
  }
  if (missing.length) {
    return { status: 400, message: 'Still needed: ' + missing.join(', ') + '.' };
  }
  if (!Object.keys(answers).length) {
    return { status: 400, message: 'Nothing was filled in.' };
  }

  var who = {
    name: String((payload && payload.name) || '').trim().slice(0, 120),
    email: String((payload && payload.email) || '').trim().slice(0, 160),
    phone: String((payload && payload.phone) || '').trim().slice(0, 40)
  };
  // WHO IS SIGNED IN ON THIS DEVICE — two empty columns that were meant to carry the USER SIGNED IN TO THE SYSTEM.
  if (!who.name || !who.email) {
    try {
      var signed = sessionUser_(String((payload && payload.session) || ''));
      // an acting session (BeAnother.gs) is not the person filling the form: the columns stay blank
      var actingSigner = typeof beAnotherActive_ === 'function' && !!beAnotherActive_();
      // this public door acts as nobody for the rest of the request
      HUB_BE_ANOTHER = null;
      if (signed && !actingSigner) {
        who.name = who.name || str_(signed.display_name);
        who.email = who.email || str_(signed.email);
      }
    } catch (eSess) { /* nobody signed in, or the session has gone */ }
  }
  var record = {
    form_id: str_(row.id),
    form_slug: str_(row.slug),
    form_title: str_(row.title),
    submitted_at: new Date().toISOString(),
    name: who.name, email: who.email, phone: who.phone,
    answers: JSON.stringify(answers),
    state: 'new', handled_by: '', handled_at: '', note: ''
  };
  var filed;
  try { filed = createRow_(FORM_SUBMISSIONS_RES, record); }
  catch (e) {
    return { status: 503, message: 'That did not save — please try again in a moment.' };
  }
  if (filed && filed.error) {
    return { status: 503, message: 'That did not save — please try again in a moment.' };
  }

  // the composite kinds' side effects, now that the submission is real — a failure here never unsays the filed…
  for (var a = 0; a < ctx.after.length; a++) {
    try { ctx.after[a](filed); } catch (eA) {
      try { hubSysLog_('asa-hub:form', 'form_side_effect_failed',
                       str_(row.slug) + ' — ' + String(eA).slice(0, 160), { status: 500 });
      } catch (eL2) { /* the submission stands either way */ }
    }
  }

  // WHAT THE PERSON SAID, ONE ROW PER QUESTION.
  try {
    if (typeof formAnswersAppend_ === 'function') {
      formAnswersAppend_(row, str_(filed && filed.id), answers, who);
    }
  } catch (eAns) {
    try { hubSysLog_('asa-hub:form', 'form_answers_failed',
                     str_(row.slug) + ' — ' + String(eAns).slice(0, 160), { status: 500 });
    } catch (eL3) { /* the submission stands */ }
  }

  // The answer's notice is written by Python from the filed row (app/letters.py).
  try {
    hubSysLog_('asa-hub:form', 'form_submitted',
               str_(row.title) + (who.name ? ' — ' + who.name : ''), { status: 200 });
  } catch (eL) { /* filed either way */ }

  return { status: 200, data: {
    filed: true,
    thank_you: str_(row.thank_you) || 'Thank you — this has reached the team.'
  } };
}

// Tell whoever the form names.
function formNotify_(row, record, answers, submissionId) {
  if (!str_(row.notify_to)) return null;
  if (typeof hubLetterSend_ !== 'function') return null;
  var said = hubLetterSend_(formNoticeLetter_(row, record, answers, submissionId));
  if (said && !/^(told|deduplicated)$/.test(said.state)) {
    try {
      hubSysLog_('asa-hub:form', 'form_notice_not_sent',
                 str_(row.slug) + ' — ' + said.state + ': ' + String(said.why || '').slice(0, 160), { status: 200 });
    } catch (eL) { /* the row is filed either way */ }
  }
  return said;
}

/** The answer's notice as a letter: the words' variables, and the facts that read it again. */
function formNoticeLetter_(row, record, answers, submissionId) {
  var lines = [];
  var fields = formFields_(row);
  for (var i = 0; i < fields.length; i++) {
    var k = String(fields[i].key || '');
    if (answers && answers[k]) lines.push(String(fields[i].label || k) + ': ' + answers[k]);
  }
  var head = [];
  if (record.name) head.push('From: ' + record.name);
  if (record.email) head.push('E-mail: ' + record.email);
  if (record.phone) head.push('Phone: ' + record.phone);
  var sub = str_(submissionId);
  return {
    situation: 'form_answer_notice', to: str_(row.notify_to),
    vars: { form_title: str_(row.title), answers: head.concat([''], lines).join('\n') },
    subject_floor: '{form_title} — a new answer', text_floor: '{answers}',
    key: 'form_answer|' + (sub || (str_(row.slug) + '|' + str_(record.submitted_at))),
    // an answer with no id has no row to read again: the morning list says so and keeps nothing
    facts: sub ? { form_slug: str_(row.slug), submission_id: sub } : null
  };
}

// AT 08:00, THE ANSWER IS READ AGAIN (SmartGate.gs hubLetterQuietCarry_).
function formNoticeRebuild_(facts) {
  var f = facts || {};
  var form = null, sub = null;
  try {
    form = formBySlug_(str_(f.form_slug));
    sub = requireRow_(FORM_SUBMISSIONS_RES, str_(f.submission_id));
  } catch (e) {
    return { unreadable: 'the form or its answers could not be read (' + String((e && e.message) || e).slice(0, 120) + ')' };
  }
  if (!form) return { stale: 'the form ' + str_(f.form_slug) + ' is gone' };
  if (!str_(form.notify_to)) return { stale: 'the form no longer names anybody to notify' };
  if (!sub || sub.error) return { stale: 'the answer ' + str_(f.submission_id) + ' is no longer filed' };
  var answers = {};
  try {
    answers = typeof sub.answers === 'string' ? JSON.parse(sub.answers || '{}') : (sub.answers || {});
  } catch (eJ) { answers = {}; }
  return { letter: formNoticeLetter_(form, { name: str_(sub.name), email: str_(sub.email), phone: str_(sub.phone),
                                             submitted_at: str_(sub.submitted_at) },
                                     answers, str_(f.submission_id)) };
}

// ================================================================== 3 — THE DOORS A SIGNED-IN PERSON USES…

/** Every form, with its link and how many answers it has taken. */
HUB_POLICY.formsList = {
  file: 'Forms.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'instant',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
/** Every form, with its link and how many answers it has taken. */
HUB_ACTIONS.formsList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var subs = {};
  try {
    (listRows_(FORM_SUBMISSIONS_RES, {}) || []).forEach(function (s) {
      var k = str_(s.form_slug);
      if (!k) return;
      subs[k] = subs[k] || { total: 0, unhandled: 0 };
      subs[k].total++;
      if (str_(s.state) !== 'handled') subs[k].unhandled++;
    });
  } catch (e) { /* a form with no answers yet is the common case */ }
  // Archived forms leave the list (the house rule: an archived cell, never a deleted row); pass archived:true to…
  var wantArchived = !!(payload && payload.archived === true);
  var rows = formsAll_().filter(function (r) {
    return (str_(r.archived).toLowerCase() === 'true') === wantArchived;
  }).map(function (r) {
    var count = subs[str_(r.slug)] || { total: 0, unhandled: 0 };
    return {
      id: str_(r.id), slug: str_(r.slug), title: str_(r.title),
      intro: str_(r.intro), status: str_(r.status) || 'draft',
      notify_to: str_(r.notify_to), thank_you: str_(r.thank_you),
      fields: formFields_(r),
      // headings render, but they are not questions — the card's count is honest
      field_count: formFields_(r).filter(function (f) { return String(f.kind) !== 'heading'; }).length,
      url: formPublicUrl_(r),
      submissions: count.total, unhandled: count.unhandled,
      source_url: str_(r.source_url),
      updatedAt: str_(r.updatedAt)
    };
  });
  return { status: 200, data: { forms: rows, kinds: FORM_FIELD_KINDS } };
};

HUB_POLICY.formSave = {
  file: 'Forms.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { slug: { required: true, type: 'string' },
            title: { required: true, type: 'string' },
            // a STRING: the screen sends JSON.stringify(fields) and the handler parses it.
            fields: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
// Create or change one form.
HUB_ACTIONS.formSave = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var p = payload || {};
  var slug = String(p.slug || '').trim().toLowerCase();
  if (!FORM_SLUG_RE.test(slug)) {
    return { status: 400, message:
      'The link name must be lower-case letters, digits and hyphens — it is what people will see.' };
  }
  var title = String(p.title || '').trim();
  if (!title) return { status: 400, message: 'The form needs a title.' };

  var fields = p.fields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch (e) { fields = null; }
  }
  var bad = formCheckFields_(fields);
  if (bad) return { status: 400, message: bad };

  var status = String(p.status || 'draft').toLowerCase();
  if (['draft', 'open', 'closed', 'testing'].indexOf(status) === -1) status = 'draft';

  var existing = formBySlug_(slug);
  // An archived slug must not resurrect through a save — and formBySlug_ still finding it is what stops this create…
  if (existing && str_(existing.archived).toLowerCase() === 'true') {
    return { status: 409, message: 'This form is archived — restore it first (Archived filter on the Forms screen).' };
  }
  var record = {
    slug: slug, title: title,
    intro: String(p.intro || '').trim(),
    fields: JSON.stringify(fields),
    status: status
  };
  // A status flip from the list sends no settings — and must not blank the thank-you, the closed message or…
  if (p.notify_to !== undefined) record.notify_to = String(p.notify_to || '').trim();
  if (p.thank_you !== undefined) record.thank_you = String(p.thank_you || '').trim();
  if (p.closed_message !== undefined) record.closed_message = String(p.closed_message || '').trim();
  if (p.asks_contact !== undefined) {
    record.asks_contact = (p.asks_contact === false || p.asks_contact === 'no') ? 'no' : 'yes';
  }
  if (existing) {
    record.id = str_(existing.id);
    record.token = str_(existing.token) || formMintToken_();
    updateRowById_(FORMS_RES, record);
  } else {
    record.token = formMintToken_();
    record.created_by = str_(user.email);
    var madeF = createRow_(FORMS_RES, record);
    if (sheetDbRefused_(madeF)) return sheetDbRefused_(madeF);
  }
  var saved = formBySlug_(slug) || record;
  try {
    hubSysLog_(str_(user.email), 'form_saved',
               title + ' (' + fields.length + ' questions, ' + status + ')', { status: 200 });
  } catch (eL) { /* saved either way */ }
  return { status: 200, data: {
    slug: slug, status: status, url: formPublicUrl_(saved),
    field_count: fields.length,
    note: status === 'open' ? 'The link is live — anybody holding it can fill it in.'
                            : 'Saved as ' + status + '. The link answers nothing until it is open.'
  } };
};

HUB_POLICY.formImportGoogle = {
  file: 'Forms.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { // url optional ON PURPOSE: a reimport resolves its own source
            url: { required: false, type: 'string' },
            title: { required: false, type: 'string' },
            notify_to: { required: false, type: 'string' },
            reimport_slug: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
// BRING A GOOGLE FORM IN BY ITS LINK — the Forms app lacked "Importar", and the app exists to REPLACE Google Forms…
HUB_ACTIONS.formImportGoogle = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var p = payload || {};
  var url = String(p.url || '').trim();

  // REIMPORT NEVER ASKS FOR A LINK — it is THE SAME LINK, a reimport of the same form.
  var reSlug = String(p.reimport_slug || '').trim().toLowerCase();
  var reRow = null;
  if (reSlug) {
    reRow = formBySlug_(reSlug);
    if (!reRow) return { status: 404, message: 'No form by that name to reimport.' };
    if (str_(reRow.archived).toLowerCase() === 'true') {
      return { status: 409, message: 'This form is archived — restore it first.' };
    }
    if (!url) url = str_(reRow.source_url);
    if (!url) url = formImportFindByTitle_(str_(reRow.title));
    if (!url) {
      return { status: 409, message: 'The Google original for "' + str_(reRow.title) +
        '" could not be found in Drive by its title. Open Import once with its link — it is remembered from then on.' };
    }
  }
  if (!url) return { status: 400, message: 'Paste the Google Forms link first.' };

  // ANY LINK THE PERSON HAS works: the editor URL opens with FormApp; the SEND link (/d/e/…viewform) and the short…
  var u = formImportNormalizeUrl_(url);
  var items = null, srcTitle = '', intro = '', via = '';
  try {
    var gf = FormApp.openByUrl(u);
    items = formImportAppItems_(gf);
    try { srcTitle = String(gf.getTitle() || '').trim(); } catch (eT) { srcTitle = ''; }
    try { intro = String(gf.getDescription() || '').trim(); } catch (eD) { intro = ''; }
    via = 'edit link';
  } catch (e) {
    var openErr = String(e && e.message ? e.message : e);
    var pub = formImportPublicFetch_(formImportPublicUrl_(u));
    if (pub) {
      items = pub.items; srcTitle = pub.title; intro = pub.intro; via = 'public link';
    } else {
      try { hubSysLog_('forms', 'form_import_open_failed',
                       url.slice(0, 120) + ' — ' + openErr.slice(0, 200), { status: 422 });
      } catch (eL) { /* the refusal stands either way */ }
      return { status: 422, message:
        'That link does not open and its public page has no form in it. Paste the ' +
        'form’s link — the short forms.gle one, the send link, or the edit link all ' +
        'work — and only a form that is visible to anyone with the link can be imported.' };
    }
  }

  var title = String(p.title || '').trim() || srcTitle;
  if (!title) {
    return { status: 422, message: 'The form has no title — give it one in the title field.' };
  }

  // THE HONEST MAPPING onto FORM_FIELD_KINDS: text · long · choice · multi · date · time ·…
  var fields = [];
  var skipped = [];
  var kept = {};      // per-kind tally: the import answer says what it made
  var usedKeys = {};
  function mintKey_(base, fallback) {
    var key = String(base || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '').slice(0, 40) || fallback;
    var root = key, n = 2;
    while (usedKeys[key]) {
      var suf = '_' + n++;
      key = root.slice(0, 40 - suf.length) + suf;
    }
    usedKeys[key] = true;
    return key;
  }
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var label = String(it.label || '').trim();
    if (it.type === 'furniture') continue;
    if (it.skip) {
      skipped.push(it.skip + (label ? ' — "' + label + '"' : ''));
      continue;
    }
    if (it.type === 'heading') {
      // A SECTION IS THE FORM'S VOICE: its title and its instructions render as a heading exactly where the…
      if (!label && !it.help) continue;
      fields.push({ key: mintKey_(label, 'section_' + (i + 1)), label: label,
                    kind: 'heading', required: 'false', help: it.help || '' });
      kept.heading = (kept.heading || 0) + 1;
      continue;
    }
    // 'scale' is a first-class kind since 2026-09-07: the page draws it as Google does — a horizontal row of…
    var kind = it.type;
    var options = it.options || null;
    // A NEVER-CONFIGURED CHOICE IS NOT A CHOICE.
    if ((kind === 'choice' || kind === 'multi') && options && options.length &&
        options.every(function (o) { return /^Option \d+$/.test(String(o).trim()); })) {
      kind = 'text';
      options = null;
    }
    if ((kind === 'choice' || kind === 'multi' || kind === 'scale') &&
        !(options && options.length)) {
      skipped.push('choice of nothing' + (label ? ' — "' + label + '"' : ''));
      continue;
    }
    var field = {
      key: mintKey_(label, 'q' + (i + 1)),
      label: label || ('Question ' + (i + 1)), kind: kind,
      required: it.required ? 'true' : 'false'
    };
    if (it.help) field.help = it.help;
    if (options) field.options = options;
    if (it.left) field.left = it.left;
    if (it.right) field.right = it.right;
    if (it.style) field.style = it.style;
    fields.push(field);
    kept[kind] = (kept[kind] || 0) + 1;
  }
  // THE SECTION'S WORDS STAY IN THE SECTION — where a header sits above a typing area, nothing is replicated: the…
  var breakdown = Object.keys(kept).map(function (k) { return kept[k] + ' ' + k; }).join(' · ');
  var nQuestions = fields.length - (kept.heading || 0);

  // THE CONTACT BLOCK IS NOT STACKED ON TOP OF ITSELF: a form that already asks who is answering — "Your name"…
  var asksSelf = false;
  for (var ci = 0; ci < fields.length; ci++) {
    if (String(fields[ci].kind) === 'heading') continue;
    var cl = String(fields[ci].label || '').trim().toLowerCase();
    if (/^(your\s+)?(full\s+)?name$/.test(cl) ||
        /^(evaluator|respondent|reviewer|applicant)('?s)?\s+(full\s+)?name/.test(cl) ||
        /^(your\s+)?e-?mail(\s+address)?$/.test(cl)) { asksSelf = true; break; }
  }

  var bad = formCheckFields_(fields);
  if (bad) {
    return { status: 422, message: fields.length
      ? bad
      : 'Nothing importable: every question in that form is a kind this platform ' +
        'does not carry (' + skipped.join('; ') + ').' };
  }

  // REIMPORT — for when the forms get updates: the questions are RE-COPIED onto the EXISTING row.
  if (reSlug && reRow) {
    // the file question the canvas cannot carry stays (see the helper)
    fields = formKeepPlatformFields_(formFields_(reRow), fields);
    updateRowById_(FORMS_RES, {
      id: str_(reRow.id),
      title: title, intro: intro,
      fields: JSON.stringify(fields),
      // asks_contact is an ASA-side setting — the comment above always said it stays; now it does (opt-in world)
      source_url: u
    });
    try {
      hubSysLog_(str_(user.email), 'form_reimported_google',
                 title + ' (kept: ' + (breakdown || 'nothing') +
                 (skipped.length ? '; skipped: ' + skipped.join('; ').slice(0, 300) : '') +
                 ', via ' + via + ')', { status: 200 });
    } catch (eL0) { /* refreshed either way */ }
    return { status: 200, data: {
      slug: reSlug, title: title, questions: nQuestions, skipped: skipped,
      breakdown: breakdown,
      url: formPublicUrl_(formBySlug_(reSlug) || reRow),
      note: 'Questions refreshed — the link, the status and every answer stayed.'
    } };
  }

  // ONE SOURCE, ONE ROW — forms was creating duplicates: one upload came back as two.
  var lock = null;
  try { lock = LockService.getScriptLock(); lock.waitLock(20000); } catch (eLk) { lock = null; }
  try {
    var prior = formBySourceUrl_(u);
    if (prior) {
      fields = formKeepPlatformFields_(formFields_(prior), fields);
      updateRowById_(FORMS_RES, {
        id: str_(prior.id),
        title: title, intro: intro,
        fields: JSON.stringify(fields),
        source_url: u
      });
      try {
        hubSysLog_(str_(user.email), 'form_import_deduped',
                   title + ' — this Google form is already "' + str_(prior.slug) +
                   '"; its questions were refreshed instead of doubling it', { status: 200 });
      } catch (eL1) { /* refreshed either way */ }
      return { status: 200, data: {
        slug: str_(prior.slug), title: title, questions: nQuestions, skipped: skipped,
        breakdown: breakdown,
        url: formPublicUrl_(formBySlug_(str_(prior.slug)) || prior),
        note: 'This Google form was already imported — its questions were refreshed on the existing link.'
      } };
    }

    // The slug comes off the title — the override wins over the form's own — and never collides with a form already…
    var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 49);
    if (!FORM_SLUG_RE.test(slug)) slug = 'imported-form';
    var slugBase = slug, sn = 2;
    while (formBySlug_(slug)) {
      var ssuf = '-' + sn++;
      slug = (slugBase.slice(0, 49 - ssuf.length) + ssuf).replace(/-+$/g, '');
    }

    var record = {
      slug: slug, title: title, intro: intro,
      fields: JSON.stringify(fields),
      status: 'open',
      notify_to: String(p.notify_to || '').trim(),
 /* the ASA contact block is OPT-IN — no import turns it on */
      asks_contact: 'no',
      token: formMintToken_(),
      created_by: str_(user.email),
      /* remembered so Reimport is one press, never a re-paste */
      source_url: u
    };
    var madeI = null;
    try { madeI = createRow_(FORMS_RES, record); }
    catch (eC) {
      return { status: 503, message: 'That did not save — please try again in a moment.' };
    }
    if (sheetDbRefused_(madeI)) return sheetDbRefused_(madeI);
  } finally {
    try { if (lock) lock.releaseLock(); } catch (eUn) { /* released on return */ }
  }
  try {
    hubSysLog_(str_(user.email), 'form_imported_google',
               title + ' (kept: ' + (breakdown || 'nothing') +
               (skipped.length ? '; skipped: ' + skipped.join('; ').slice(0, 300) : '') +
               ', via ' + via + (asksSelf ? ', contact block off — the form asks its own' : '') + ')',
               { status: 200 });
  } catch (eL) { /* imported either way */ }
  return { status: 200, data: {
    slug: slug, title: title, questions: nQuestions, skipped: skipped,
    breakdown: breakdown,
    contact_block: 'off — opt-in per form since 2026-09-08',
    url: formPublicUrl_(record)
  } };
};

// WHAT "THE LINK" MAY LOOK LIKE.
function runFormsAuthProbe() {
  var id = '1Zgx48KojJ-n4ro32OdnO2MIDqYZxhCIsj4hDE6OL2j8';
  var me = '';
  try { me = Session.getActiveUser().getEmail(); } catch (eU) { me = '(unknown)'; }
  try {
    var gf = FormApp.openById(id);
    Logger.log('OK as ' + me + ' — opened "' + gf.getTitle() + '" (' +
               gf.getItems().length + ' items). The grant works for this account.');
  } catch (e) {
    Logger.log('REFUSED as ' + me + ' — ' + (e && e.message ? e.message : e));
  }
}

// WHERE THE ORIGINALS LIVE — inside Asa Hub - Form, under Database.
var FORM_ORIGINALS_PROP = 'HUB_FORM_ORIGINALS_FOLDER_ID';
var FORM_ORIGINALS_NAME = 'Database';

function formOriginalsFolder_() {
  var id = '';
  try { id = String(hubProp_(FORM_ORIGINALS_PROP) || '').trim(); } catch (eP) { id = ''; }
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (eI) { /* moved or trashed: resolve by name */ }
  }
  var where = (typeof formUploadsFolderId_ === 'function')
    ? formUploadsFolderId_('forms') : { id: '' };
  if (!where.id) return null;
  try {
    var parent = DriveApp.getFolderById(where.id);
    var kids = parent.getFoldersByName(FORM_ORIGINALS_NAME);
    return kids.hasNext() ? kids.next() : parent.createFolder(FORM_ORIGINALS_NAME);
  } catch (eD) { return null; }
}

// THE ORIGINAL, MADE HERE — the same form as yesterday's, but with a REAL Google form behind it and a file input…
HUB_POLICY.formCanvasMint = {
  file: 'Forms.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: [], service_only: true,
  params: { slug: { required: true, type: 'string' } },
  invalidates: ['forms'], emits: []
};
HUB_ACTIONS.formCanvasMint = function (payload, user) {
  if (!user || !user.is_service) {
    return { status: 403, message: 'The canvas mint answers the platform only.' };
  }
  var slug = String((payload || {}).slug || '').trim().toLowerCase();
  if (!slug) return { status: 400, message: 'Which form? Pass a slug.' };
  var row = formBySlug_(slug);
  if (!row) return { status: 404, message: 'No form called "' + slug + '".' };
  if (str_(row.source_url)) {
    return { status: 200, data: { slug: slug, already: true,
             edit_url: str_(row.source_url),
             message: 'That form already names its Google original.' } };
  }
  var fields = formFields_(row);
  if (!fields.length) {
    return { status: 409, message: 'That form has no questions to draw.' };
  }
  var title = str_(row.title) || slug;
  var form;
  try { form = FormApp.create(title); }
  catch (e) {
    return { status: 503, message: 'Google would not make the form: ' +
             String(e && e.message || e).slice(0, 160) };
  }
  var drew = 0;
  try { drew = formSpecToGoogle_(form, fields); } catch (eD) { drew = 0; }
  /* IT LANDS IN THE CABINET, not in My Drive. */
  var where = 'My Drive (the originals folder did not answer)';
  try {
    var home = formOriginalsFolder_();
    if (home) {
      DriveApp.getFileById(form.getId()).moveTo(home);
      where = home.getName();
    }
  } catch (eM) { /* the form exists either way; the shelf is a courtesy */ }
  var edit = 'https://docs.google.com/forms/d/' + form.getId() + '/edit';
  try { updateRowById_(FORMS_RES, { id: str_(row.id), source_url: edit }); }
  catch (eU) { /* the link is in the answer either way */ }
  try {
    hubSysLog_('asa-hub:form', 'form_canvas_minted',
               title + ' — ' + drew + ' question(s) drawn into ' + where,
               { status: 200 });
  } catch (eL) { /* drawn either way */ }
  return { status: 200, data: {
    slug: slug, form_id: form.getId(), drawn: drew, folder: where,
    edit_url: edit, respond_url: form.getPublishedUrl(),
    note: 'A file question cannot exist in Google — it lives in the ASA mask only.'
  } };
};

function runFormCanvas() {
  var me = '';
  try { me = Session.getActiveUser().getEmail(); } catch (eU) { me = '(unknown)'; }

  // THE NEWEST FORM STILL WITHOUT A CANVAS.
  var rows = formsAll_();
  var pick = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (str_(r.archived).toLowerCase() === 'true') continue;
    if (str_(r.source_url)) continue;
    if (!pick || str_(r.createdAt) > str_(pick.createdAt)) pick = r;
  }
  if (!pick) {
    Logger.log('NOTHING TO DO as ' + me +
               ' — every live form already names its Google original.');
    return;
  }

  var title = str_(pick.title) || str_(pick.slug);
  // ONE SOURCE, ONE FORM — the same law the importer keeps.
  try {
    var found = DriveApp.getFilesByName(title);
    if (found.hasNext()) {
      Logger.log('ALREADY IN DRIVE as ' + me + ' — "' + title + '" ' +
                 found.next().getUrl() +
                 '\nNothing was created. Import that link, or rename one of them.');
      return;
    }
  } catch (eD) { /* no Drive answer: carry on and let create speak */ }

  var fields = formFields_(pick);
  var form = FormApp.create(title);
  var intro = str_(pick.intro);
  if (intro) form.setDescription(intro);
  try { form.setRequireLogin(false); } catch (eL) { /* personal account: no such switch */ }
  try { form.setCollectEmail(false); } catch (eC) { /* same */ }
  var drew = formSpecToGoogle_(form, fields);

  // IT LANDS IN THE CABINET, not in My Drive: FormApp.create puts a new form in the account's root, so the very…
  var where = 'My Drive (the originals folder did not answer)';
  var home = formOriginalsFolder_();
  if (home) {
    try {
      DriveApp.getFileById(form.getId()).moveTo(home);
      where = home.getName() + ' (' + home.getId() + ')';
    } catch (eM) { /* the form exists either way; the log says where it is */ }
  }

  var edit = form.getEditUrl();
  // THE TWO HALVES ARE NOW ONE FORM: the row remembers its canvas, so Reimport is a press rather than a re-paste…
  try { updateRowById_(FORMS_RES, { id: str_(pick.id), source_url: edit }); }
  catch (eU2) { /* the canvas exists; the link can be pasted by hand once */ }

  var live = '';
  try { live = form.getPublishedUrl(); } catch (eP) { live = ''; }
  Logger.log('CANVAS CREATED as ' + me + ' for "' + title + '" (' + str_(pick.slug) + ')' +
             '\n  filed:   ' + where +
             '\n  edit:    ' + edit +
             '\n  send:    ' + live +
             '\n  drawn:   ' + drew.drawn + ' question(s)' +
             (drew.skipped.length
               ? '\n  ours:    ' + drew.skipped.join(', ') +
                 ' — Google cannot author these; the mask keeps them'
               : '') +
             '\nThe row now points at this canvas: edit it in Google, press ' +
             'Reimport on the Forms screen, and the mask follows.');
}

// A PLATFORM DEFINITION, DRAWN ON A GOOGLE CANVAS.
function formSpecToGoogle_(form, fields) {
  var drawn = 0;
  var skipped = [];
  for (var i = 0; i < (fields || []).length; i++) {
    var f = fields[i] || {};
    var kind = String(f.kind || 'text');
    var spec = FORM_KINDS[kind] || {};
    var label = String(f.label || '').trim();
    var help = String(f.help || '').trim();
    var req = String(f.required) === 'true' || f.required === true;
    var opts = (f.options || []).map(String).filter(Boolean);

    if (spec.platformOnly) { skipped.push(label || String(f.key || kind)); continue; }

    if (kind === 'heading') {
      var head = form.addSectionHeaderItem().setTitle(label);
      if (help) head.setHelpText(help);
      drawn++;
      continue;
    }

    var item = null;
    if (kind === 'long') {
      item = form.addParagraphTextItem();
    } else if (kind === 'date') {
      item = form.addDateItem();
    } else if (kind === 'time') {
      item = form.addTimeItem();
    } else if (kind === 'multi') {
      item = form.addCheckboxItem().setChoiceValues(opts.length ? opts : ['Yes']);
    } else if (kind === 'yes_no') {
      item = form.addMultipleChoiceItem().setChoiceValues(['Yes', 'No']);
    } else if (kind === 'choice') {
      // a long list is a dropdown, as Google's own editor would have it
      item = (opts.length > 6 ? form.addListItem() : form.addMultipleChoiceItem())
        .setChoiceValues(opts.length ? opts : ['Yes', 'No']);
    } else if (kind === 'scale') {
      if (String(f.style || '') === 'star') {
        try {
          item = form.addRatingItem()
            .setRatingScaleLevel(Math.max(3, Math.min(10, opts.length || 5)))
            .setRatingIcon(FormApp.RatingIconType.STAR);
        } catch (eR) { item = null; }   // older runtime: fall through to a scale
      }
      if (!item) {
        var nums = opts.map(Number).filter(function (n) { return !isNaN(n); });
        var lo = nums.length ? Math.min.apply(null, nums) : 1;
        var hi = nums.length ? Math.max.apply(null, nums) : 5;
        // Google's own bounds: the floor is 0 or 1, the ceiling 2 to 10
        item = form.addScaleItem().setBounds(lo <= 0 ? 0 : 1,
                                             Math.max(2, Math.min(10, hi)));
        if (f.left || f.right) {
          item.setLabels(String(f.left || ''), String(f.right || ''));
        }
      }
    } else {
      item = form.addTextItem();
      try {
        if (kind === 'number') {
          item.setValidation(FormApp.createTextValidation().requireNumber().build());
        } else if (kind === 'email') {
          item.setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
        }
      } catch (eV) { /* a validation Google will not take is not worth the form */ }
    }

    if (!item) { skipped.push(label || String(f.key || kind)); continue; }
    item.setTitle(label);
    try { if (help) item.setHelpText(help); } catch (eH) { /* optional */ }
    try { if (req) item.setRequired(true); } catch (eQ) { /* optional */ }
    drawn++;
  }
  return { drawn: drawn, skipped: skipped };
}

// The Google original of a form this account owns — the self-heal for rows imported before source_url existed.
function formImportFindByTitle_(title) {
  var want = formImportTitleKey_(title);
  if (!want) return '';

  var esc = function (s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  };
  var base = 'mimeType = "application/vnd.google-apps.form" and ' +
             'trashed = false and ';
  var queries = ['title = "' + esc(String(title).trim()) + '"'];
  var chunk = formImportAsciiChunk_(title);
  if (chunk) queries.push('title contains "' + esc(chunk) + '"');

  /* candidates: id + a cheap rank off the Drive NAME — no opens yet */
  var MAX_SCAN = 30, MAX_OPENS = 10;
  var seen = {}, cand = [];
  for (var qi = 0; qi < queries.length && cand.length < MAX_SCAN; qi++) {
    try {
      var it = DriveApp.searchFiles(base + queries[qi]);
      while (it.hasNext() && cand.length < MAX_SCAN) {
        var f = it.next();
        var id = f.getId();
        if (seen[id]) continue;
        seen[id] = true;
        var nameKey = formImportTitleKey_(
          String(f.getName() || '').replace(/\s*\([^()]*\)\s*$/, ''));
        var rank = (nameKey === want) ? 0
          : (nameKey && (nameKey.indexOf(want) === 0 ||
                         want.indexOf(nameKey) === 0)) ? 1 : 2;
        cand.push({ id: id, rank: rank });
      }
    } catch (eQ) { /* a broken query lane is silence, not a crash */ }
  }
  cand.sort(function (a, b) { return a.rank - b.rank; });

  /* identity: open the best few and ask each form its OWN title */
  var hit = '';
  for (var i = 0; i < cand.length && i < MAX_OPENS; i++) {
    var gt = '';
    try { gt = String(FormApp.openById(cand[i].id).getTitle() || ''); }
    catch (eO) { continue; } /* not openable as this account — not it */
    if (formImportTitleKey_(gt) !== want) continue;
    if (hit) return ''; /* two originals answer to this title — refuse */
    hit = cand[i].id;
  }
  return hit ? 'https://docs.google.com/forms/d/' + hit + '/edit' : '';
}

// One title, one key: what "the same title" means when the same string was typed twice by different hands.
function formImportTitleKey_(s) {
  return String(s || '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[  -   　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// The longest plain [A-Za-z0-9 ] run in a title, 8+ chars once trimmed: a Drive-safe probe for `title contains`…
function formImportAsciiChunk_(s) {
  var runs = String(s || '').split(/[^A-Za-z0-9 ]+/);
  var best = '';
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i].replace(/\s+/g, ' ').trim();
    if (r.length > best.length) best = r;
  }
  return best.length >= 8 ? best : '';
}

function formImportNormalizeUrl_(url) {
  var u = String(url || '').trim();
  if (/^https?:\/\/forms\.gle\//.test(u)) {
    try {
      var resp = UrlFetchApp.fetch(u, { followRedirects: false, muteHttpExceptions: true });
      var loc = resp.getHeaders()['Location'] || resp.getHeaders()['location'];
      if (loc) u = String(loc);
    } catch (e) { /* keep the original; the lanes below answer honestly */ }
  }
  return u.split('#')[0].split('?')[0];
}

// THE PUBLIC FACE of whatever link was pasted.
function formImportPublicUrl_(u) {
  var m = /^(https?:\/\/docs\.google\.com\/forms(?:\/u\/\d+)?\/d\/e\/[^\/]+)/.exec(u);
  if (m) return m[1] + '/viewform';
  m = /^(https?:\/\/docs\.google\.com\/forms(?:\/u\/\d+)?\/d\/[^\/]+)/.exec(u);
  if (m) return m[1] + '/viewform';
  return u;
}

// THE EDITOR LANE: FormApp items flattened to the neutral shape the mapping loop reads — { label, type, required…
function formImportAppItems_(gf) {
  var T = FormApp.ItemType;
  var out = [];
  var items = [];
  try { items = gf.getItems(); } catch (e) { items = []; }
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var type = String(it.getType());
    var one = { label: String(it.getTitle() || '').trim(),
                required: false, options: null, help: '', skip: '' };
    try { one.required = !!it.isRequired(); } catch (eR) { /* optional */ }
    try { one.help = String(it.getHelpText() || '').trim(); } catch (eH) { /* none */ }
    // THE ENUM NAMES ARE THE API'S, NOT THE EDITOR'S.
    if (type === String(T.PAGE_BREAK) || type === String(T.SECTION_HEADER)) {
      // A SECTION HEADER: its title and instructions are part of the form.
      one.type = 'heading';
    } else if (type === String(T.IMAGE) || type === String(T.VIDEO)) {
      one.type = 'furniture';
    } else if (type === 'TEXT') {
      one.type = 'text';
      try { one.required = !!it.asTextItem().isRequired(); } catch (eQ) { }
    } else if (type === 'PARAGRAPH_TEXT') {
      one.type = 'long';
      try { one.required = !!it.asParagraphTextItem().isRequired(); } catch (eQ2) { }
    } else if (type === 'MULTIPLE_CHOICE' || type === 'LIST') {
      one.type = 'choice';
      var mc = (type === 'LIST') ? it.asListItem() : it.asMultipleChoiceItem();
      try { one.required = !!mc.isRequired(); } catch (eQ3) { }
      one.options = mc.getChoices().map(function (c) { return String(c.getValue()); }).filter(Boolean);
    } else if (type === 'CHECKBOX') {
      one.type = 'multi';
      var cb = it.asCheckboxItem();
      try { one.required = !!cb.isRequired(); } catch (eQ4) { }
      one.options = cb.getChoices()
        .map(function (c) { return String(c.getValue()); }).filter(Boolean);
    } else if (type === 'SCALE') {
      one.type = 'scale';
      var sc = it.asScaleItem();
      try { one.required = !!sc.isRequired(); } catch (eQ5) { }
      one.options = [];
      for (var b = sc.getLowerBound(); b <= sc.getUpperBound(); b++) one.options.push(String(b));
      // The anchors ARE the scale's meaning ("Poor … Excellent") — carried as their own halves so the page can draw…
      try { one.left = String(sc.getLeftLabel() || '').trim(); } catch (eA1) { }
      try { one.right = String(sc.getRightLabel() || '').trim(); } catch (eA2) { }
    } else if (type === 'DATE') {
      one.type = 'date';
      try { one.required = !!it.asDateItem().isRequired(); } catch (eQ6) { }
    } else if (type === 'TIME') {
      one.type = 'time';
      try { one.required = !!it.asTimeItem().isRequired(); } catch (eQ7) { }
    } else if (type === 'GRID' || type === 'CHECKBOX_GRID') {
      // A GRID IS N QUESTIONS WEARING ONE TITLE — the whole body of the 360° evaluation.
      var gi = (type === 'CHECKBOX_GRID') ? it.asCheckboxGridItem() : it.asGridItem();
      var gCols = gi.getColumns().map(String);
      var gRows = gi.getRows().map(String);
      var gReq = false;
      try { gReq = !!gi.isRequired(); } catch (eQ8) { }
      for (var gr = 0; gr < gRows.length; gr++) {
        out.push({
          label: (one.label ? one.label + ' — ' : '') + gRows[gr],
          required: gReq, help: gr === 0 ? one.help : '',
          options: gCols.slice(),
          // a radio grid row IS a likert row — Google draws its columns horizontally, and 'scale' is this…
          type: (type === 'CHECKBOX_GRID') ? 'multi' : 'scale', skip: ''
        });
      }
      continue;
    } else if (type === 'RATING') {
      // Star ratings are a scale WEARING STARS — and the mask draws the stars — wherever there is a star, a star is…
      one.type = 'scale';
      one.style = 'star';
      var ri = it.asRatingItem();
      try { one.required = !!ri.isRequired(); } catch (eQ9) { }
      one.options = [];
      var lvl = Number(ri.getRatingScaleLevel()) || 5;
      for (var rb = 1; rb <= lvl; rb++) one.options.push(String(rb));
    } else if (type === 'FILE_UPLOAD') {
 // A REAL KIND NOW: the Hub carries its own upload lane, so a file question imports as one instead of being skipped.
      one.type = 'file';
      try { one.required = !!it.asFileUploadItem().isRequired(); } catch (eQF) { }
    } else if (type === 'DATETIME') {
      one.skip = 'date and time';
    } else if (type === 'DURATION') {
      one.skip = 'duration';
    } else {
      one.skip = type.toLowerCase().replace(/_/g, ' ');
    }
    out.push(one);
  }
  return out;
}

// THE PUBLIC LANE: the responder page carries the whole form definition in `var FB_PUBLIC_LOAD_DATA_ = [...]`…
function formImportPublicFetch_(u) {
  var html = '';
  try {
    var resp = UrlFetchApp.fetch(u, { followRedirects: true, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    html = resp.getContentText();
  } catch (e) { return null; }
  var m = html.match(/var FB_PUBLIC_LOAD_DATA_ = ([\s\S]*?);\s*<\/script>/);
  if (!m) return null;
  var data;
  try { data = JSON.parse(m[1]); } catch (eJ) { return null; }
  var info = data && data[1];
  if (!info || !(info[1] instanceof Array)) return null;
  var TYPES = { 0: 'text', 1: 'long', 2: 'choice', 3: 'choice', 4: 'multi',
                5: 'scale', 9: 'date', 10: 'time',
 // 13 = file upload — a real kind (the Hub's own upload lane carries it)
                13: 'file',
                // 18 = star rating on the public payload — a scale wearing stars; options fall back to 1..5 when…
                18: 'scale' };
  var SKIPPABLE = {};
  // THE HEADER'S REAL INDEXES (verified live on five public payloads, ): info[8] is the TITLE and data[3] the…
  var out = { title: String(info[8] || (data && data[3]) || '').trim(),
              intro: String(info[0] || '').trim(), items: [] };
  var raw = info[1];
  for (var i = 0; i < raw.length; i++) {
    var it = raw[i];
    if (!(it instanceof Array) || it.length < 4) continue;
    // 6 = title-and-description, 8 = section break — their words ARE the form: they import as headings.
    if (it[3] === 6 || it[3] === 8) {
      var hLab = String(it[1] || '').trim();
      var hTxt = String(it[2] || '').trim();
      if (hLab || hTxt) {
        out.items.push({ label: hLab, help: hTxt, required: false,
                         options: null, type: 'heading', skip: '' });
      }
      continue;
    }
    if (it[3] === 11 || it[3] === 12) continue;
    // GRIDS (7): one sub-entry per ROW, the row's columns as its choices, the row label at entry[3][0] — and the…
    if (it[3] === 7) {
      var gTitle = String(it[1] || '').trim();
      var gSubs = (it[4] instanceof Array) ? it[4] : [];
      var made = 0;
      for (var g = 0; g < gSubs.length; g++) {
        var srow = gSubs[g];
        if (!(srow instanceof Array)) continue;
        var gOpts = (srow[1] instanceof Array)
          ? srow[1].map(function (c) { return String(c && c[0] || ''); }).filter(Boolean)
          : [];
        if (!gOpts.length) continue;
        var rLab = (srow[3] instanceof Array && srow[3].length) ? String(srow[3][0]) : ('Row ' + (g + 1));
        var gMulti = (srow[11] instanceof Array) && Number(srow[11][0]) === 1;
        out.items.push({ label: (gTitle ? gTitle + ' — ' : '') + rLab,
                         help: g === 0 ? String(it[2] || '').trim() : '',
                         required: srow[2] === 1, options: gOpts,
                         type: gMulti ? 'multi' : 'scale', skip: '' });
        made++;
      }
      if (!made) out.items.push({ label: gTitle, help: '', required: false, options: null, skip: 'grid' });
      continue;
    }
    var sub = (it[4] && it[4][0]) || [];
    var tname = TYPES[it[3]];
    var one = { label: String(it[1] || '').trim(),
                help: String(it[2] || '').trim(),
                required: sub[2] === 1, options: null, skip: '' };
    if (tname === undefined) {
      one.skip = 'unknown kind ' + it[3];
    } else if (SKIPPABLE[tname]) {
      one.skip = tname;
    } else {
      one.type = tname;
    }
    // 5 too: a linear scale's values ride the same choices array — leaving them out turned every public-lane scale…
    if ((it[3] === 2 || it[3] === 3 || it[3] === 4 || it[3] === 5) && sub[1] instanceof Array) {
      one.options = sub[1].map(function (c) { return String(c && c[0] || ''); }).filter(Boolean);
    }
    // A type-5 scale carries its anchor words in sub[3] as [left, right] — the page draws them at the row's ends…
    if (it[3] === 5 && sub[3] instanceof Array) {
      one.left = String(sub[3][0] || '').trim();
      one.right = String(sub[3][1] || '').trim();
    }
    if (it[3] === 18) {
      one.style = 'star';
      if (!(one.options && one.options.length)) {
        one.options = ['1', '2', '3', '4', '5'];
      }
    }
    out.items.push(one);
  }
  return out;
}

HUB_POLICY.formSubmissions = {
  file: 'Forms.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { slug: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
// THE ANSWERS, AND THE SHAPE TO DRAW THEM IN.
HUB_ACTIONS.formSubmissions = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var slug = String((payload && payload.slug) || '').trim().toLowerCase();
  var rows = [];
  try { rows = listRows_(FORM_SUBMISSIONS_RES, {}) || []; } catch (e) { rows = []; }
  if (slug) rows = rows.filter(function (r) { return str_(r.form_slug).toLowerCase() === slug; });
  rows.sort(function (a, b) { return str_(a.submitted_at) < str_(b.submitted_at) ? 1 : -1; });

  var out = rows.slice(0, 500).map(function (r) {
    var ans = {};
    try { ans = JSON.parse(str_(r.answers) || '{}') || {}; } catch (e) { ans = {}; }
    var flat = {
      id: str_(r.id), form_slug: str_(r.form_slug), form_title: str_(r.form_title),
      submitted_at: str_(r.submitted_at), name: str_(r.name), email: str_(r.email),
      phone: str_(r.phone), state: str_(r.state) || 'new',
      handled_by: str_(r.handled_by), note: str_(r.note)
    };
    for (var k in ans) { if (flat[k] === undefined) flat[k] = ans[k]; }
    return flat;
  });

  var form = slug ? formBySlug_(slug) : null;
  return { status: 200, data: {
    slug: slug, total: out.length,
    fields: form ? formFields_(form) : [],
    title: form ? str_(form.title) : '',
    submissions: out
  } };
};

HUB_POLICY.formSubmissionHandle = {
  file: 'Forms.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { id: { required: true, type: 'string' },
            state: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
/** Mark one answer dealt with — or put it back. */
HUB_ACTIONS.formSubmissionHandle = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which answer?' };
  var state = String((payload && payload.state) || 'handled').toLowerCase();
  if (['new', 'handled'].indexOf(state) === -1) state = 'handled';
  updateRowById_(FORM_SUBMISSIONS_RES, {
    id: id, state: state,
    handled_by: state === 'handled' ? str_(user.email) : '',
    handled_at: state === 'handled' ? new Date().toISOString() : '',
    note: String((payload && payload.note) || '').trim()
  });
  return { status: 200, data: { id: id, state: state } };
};

HUB_POLICY.formRotateToken = {
  file: 'Forms.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  params: { slug: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
// A NEW KEY, AND EVERY LINK ALREADY SENT STOPS WORKING.
HUB_ACTIONS.formRotateToken = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var row = formBySlug_(payload && payload.slug);
  if (!row) return { status: 404, message: 'No form by that name.' };
  var token = formMintToken_();
  updateRowById_(FORMS_RES, { id: str_(row.id), token: token });
  try {
    hubSysLog_(str_(user.email), 'form_token_rotated', str_(row.title), { status: 200 });
  } catch (eL) { /* rotated either way */ }
  row.token = token;
  return { status: 200, data: { slug: str_(row.slug), url: formPublicUrl_(row),
           note: 'Every link handed out before now answers 404.' } };
};

HUB_POLICY.formArchive = {
  file: 'Forms.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { slug: { required: true, type: 'string' },
            archived: { required: false, type: 'boolean' },
            reason: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
// NOTHING IS DELETED — the house rule (talentPoolArchive's shape).
HUB_ACTIONS.formArchive = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var row = formBySlug_(payload && payload.slug);
  if (!row) return { status: 404, message: 'No form by that name.' };
  var hide = !(payload && payload.archived === false);
  updateRowById_(FORMS_RES, {
    id: str_(row.id),
    archived: hide ? 'true' : 'false',
    archived_at: hide ? new Date().toISOString() : '',
    archived_by: hide ? str_(user.email) : '',
    archived_reason: hide ? String((payload && payload.reason) || '').slice(0, 200) : '',
    status: hide ? 'closed' : str_(row.status)
  });
  try {
    hubSysLog_(str_(user.email), hide ? 'form_archived' : 'form_restored',
               str_(row.title), { status: 200 });
  } catch (eL) { /* archived either way */ }
  return { status: 200, data: { slug: str_(row.slug), archived: hide,
           note: hide ? 'Archived — the link answers 404; the answers stay filed.'
                      : 'Restored — reopen it from the editor when ready.' } };
};

HUB_POLICY.formRename = {
  file: 'Forms.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { slug: { required: true, type: 'string' },
            title: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
// Rename one form — the TITLE only, so a name can be edited in Forms.
HUB_ACTIONS.formRename = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var row = formBySlug_(payload && payload.slug);
  if (!row) return { status: 404, message: 'No form by that name.' };
  var title = String((payload && payload.title) || '').trim();
  if (!title) return { status: 400, message: 'The form needs a name.' };
  if (title === str_(row.title)) {
    return { status: 200, data: { slug: str_(row.slug), title: title } };
  }
  updateRowById_(FORMS_RES, { id: str_(row.id), title: title });
  try {
    hubSysLog_(str_(user.email), 'form_renamed',
               str_(row.title) + ' → ' + title, { status: 200 });
  } catch (eL) { /* renamed either way */ }
  return { status: 200, data: { slug: str_(row.slug), title: title } };
};

// THE CANDIDATE-PENDING CANVAS — an ordinary form in that folder, carrying the listed items, named 'Hiring Pipeline…
var CANDIDATE_PENDING_TITLE = 'Hiring Pipeline Candidate Pending 1';
var CANDIDATE_PENDING_FOLDER = '1Qg2Yv2Lz-1bz_DFu3fbbWqboCmtYoyZ8';

/** The panel, as a form spec. Labels match the drawer word for word. */
function candidatePendingSpec_() {
  return [
    { key: 'pending_here', kind: 'heading', label: 'Pending here',
      help: 'What this candidate still owes at this stage.' },
    { key: 'resume', kind: 'file', label: 'Resume',
      help: 'The CV on file. Missing until a document lands.',
      accept: ['pdf', 'doc', 'docx'] },
    { key: 'cjis_result', kind: 'file', label: 'CJIS / Background result',
      help: 'The background check result, as issued.',
      accept: ['pdf', 'png', 'jpg'] },
    { key: 'resume_decision', kind: 'choice', label: 'Resume decision',
      help: 'The call that moves this person on — or off the board.',
      required: 'true', options: ['Accept', 'Decline'] }
  ];
}

function runCandidatePendingCanvas() {
  var me = '';
  try { me = Session.getActiveUser().getEmail(); } catch (eU) { me = '(unknown)'; }

  // ONE SOURCE, ONE FORM — the same law the importer keeps.
  try {
    var found = DriveApp.getFilesByName(CANDIDATE_PENDING_TITLE);
    if (found.hasNext()) {
      Logger.log('ALREADY IN DRIVE as ' + me + ' — "' + CANDIDATE_PENDING_TITLE + '" ' +
                 found.next().getUrl() +
                 '\nNothing was created. Import that link, or rename the existing one.');
      return;
    }
  } catch (eD) { /* no Drive answer: carry on and let create speak */ }

  var form = FormApp.create(CANDIDATE_PENDING_TITLE);
  form.setDescription('The pending items on a candidate at the New stage.');
  try { form.setRequireLogin(false); } catch (eL) { /* personal account: no such switch */ }
  try { form.setCollectEmail(false); } catch (eC) { /* same */ }

  var drew = formSpecToGoogle_(form, candidatePendingSpec_());

  // DOES GOOGLE REALLY REFUSE A FILE QUESTION?
  var probe = [];
  var wanted = candidatePendingSpec_().filter(function (f) { return f.kind === 'file'; });
  for (var p = 0; p < wanted.length; p++) {
    var lbl = String(wanted[p].label);
    if (typeof form.addFileUploadItem !== 'function') {
      probe.push(lbl + ': FormApp has no addFileUploadItem()');
      continue;
    }
    try {
      var up = form.addFileUploadItem().setTitle(lbl);
      if (wanted[p].help) up.setHelpText(String(wanted[p].help));
      probe.push(lbl + ': CREATED — Google accepted a file question');
      drew.drawn++;
    } catch (eF) {
      probe.push(lbl + ': refused — ' + (eF && eF.message ? eF.message : String(eF)));
    }
  }

  // FormApp.create lands in the account's root, so the next move is to file it where it was declared to belong.
  var where = 'My Drive (the named folder did not answer)';
  try {
    var home = DriveApp.getFolderById(CANDIDATE_PENDING_FOLDER);
    DriveApp.getFileById(form.getId()).moveTo(home);
    where = home.getName() + ' (' + home.getId() + ')';
  } catch (eM) { /* the form exists either way; the log says where it is */ }

  var live = '';
  try { live = form.getPublishedUrl(); } catch (eP) { live = ''; }
  Logger.log('CANVAS CREATED as ' + me + ' — "' + CANDIDATE_PENDING_TITLE + '"' +
             '\n  filed:   ' + where +
             '\n  edit:    ' + form.getEditUrl() +
             '\n  send:    ' + live +
             '\n  drawn:   ' + drew.drawn + ' question(s)' +
             (probe.length ? '\n  FILE QUESTION PROBE:\n    ' + probe.join('\n    ') : '') +
             '\n  If a probe line says CREATED, FORM_KINDS.file is wrong about' +
             '\n  authoring and the drawer should draw uploads too. If it says' +
             '\n  refused or absent, add those two on the ASA side after the' +
             '\n  import — formKeepPlatformFields_ carries them through every' +
             '\n  Reimport after that.');
}
