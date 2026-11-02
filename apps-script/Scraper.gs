// Never store the password (a Script Property), never overwrite rows, never copy raw_json (it carries Medicaid numbers).
var SCRAPER_CONFIG_TAB = 'scraper_config';
var SCRAPER_LEADS_TAB = 'potentialClients';
var SCRAPER_PASSWORD_PROP = 'BRITTCO_PASSWORD';

var SCRAPER_CONFIG_DEFAULT = [
  { key: 'login_url', value: 'https://starkdd.brittcosoftware.com/login', note: 'POST target for the sign-in form' },
  { key: 'referrals_url', value: 'https://starkdd.brittcosoftware.com/providers/referrals', note: 'Open referrals list' },
  { key: 'email', value: '', note: 'Portal account. The password is a Script Property, never a cell.' },
  { key: 'pages', value: '2', note: 'How many pages to walk per run' },
  { key: 'enabled', value: 'no', note: 'yes = the button and the schedule may run it' },
  { key: 'home_zip', value: '44709', note: 'Distance is scored against this ZIP' },
  { key: 'score_batch_size', value: '50', note: 'How many referrals to rate per pass' },
  { key: 'score_threshold', value: '7', note: 'Above this rating a referral is worth a text message' },
  { key: 'score_model', value: 'gpt-5.1', note: 'Model used for the rating' },
  { key: 'notify_enabled', value: 'no', note: 'yes = the Notify button may send text messages' },
  { key: 'notify_from', value: '+13309195558', note: 'Sending number (the Automations line, when it resolves)' },
  { key: 'notify_recipients', value: '', note: 'Comma-separated numbers in +1########## form' },
  { key: 'score_system', value: '', note: 'Instruction given to the model. Blank = the built-in default.' },
  { key: 'score_prompt', value: '', note: 'The rating criteria. {{placeholders}} are filled per referral. Blank = the built-in default.' }
];

var SCRAPER_LEAD_HEADER = [
  'id', 'referral_id', 'client_name', 'client_age', 'client_gender', 'diagnosis',
  'frequency', 'description', 'postal_code', 'phone', 'email', 'funding_source',
  'expiration_date', 'ai_rating', 'ai_notes', 'sms_sent', 'source', 'scraped_at',
  'stage', 'owner', 'next_step', 'notes'
];

var SCRAPER_OPENAI_PROP = 'OPENAI_API_KEY';
var SCRAPER_OPENPHONE_PROP = 'OPENPHONE_API_KEY';

// Kept verbatim so new ratings stay comparable with those already scored.
var SCRAPER_SYSTEM_DEFAULT =
  'You are an AI assistant specializing in client care analysis for a healthcare provider. ' +
  'Always return responses in JSON format only.';

var SCRAPER_PROMPT_DEFAULT = [
  'Analyze the following client data and assign a care rating (1-10) based on the following criteria:',
  '',
  '- Frequency of care (1-10 scale, 10 being 24/7 care) – Heavily weighted.',
  '- Distance to ZIP code {{home_zip}} (1-10 scale, 10 being closest) – Moderately weighted.',
  '- Gender (5 for male, 10 for female) – Less weighted.',
  '- Complexity of diagnosis and intellectual disability (1-10 scale, higher meaning more complex care required) – Moderately to heavily weighted.',
  '- Description of service needs.',
  '- Client age.',
  '- Client home phone (presence indicates contactability).',
  '- Client email (presence indicates contactability).',
  '',
  'Return ONLY a JSON object without explanations or additional text in this exact format:',
  '{"ai_rating": X, "ai_notes": "3-sentence summary of care needs."}',
  '',
  'Client details:',
  '- ID: {{referral_id}}',
  '- Name: {{client_name}}',
  '- Frequency: {{frequency}}',
  '- Service Description: {{description}}',
  '- Postal Code: {{postal_code}}',
  '- Gender: {{client_gender}}',
  '- Diagnosis: {{diagnosis}}',
  '- Age: {{client_age}}',
  '- Client home phone: {{phone}}',
  '- Client email: {{email}}'
].join('\n');

// An unknown placeholder is left as-is so a typo shows instead of blanking.
function scraperFillTemplate_(template, values) {
  return String(template || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, function (whole, key) {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] == null ? '' : values[key]) : whole;
  });
}

/* ---- Config ---- */

function scraperConfigSheet_() {
  var existed = !!hubTabSheet_(SCRAPER_CONFIG_TAB);
  var sheet = hubTabEnsure_(SCRAPER_CONFIG_TAB, ['key', 'value', 'note']);
  // Emptiness is asked of the sheet too: one transient probe failure must not reseed a configured tab.
  if (!existed && sheet.getLastRow() < 2) {
    var rows = SCRAPER_CONFIG_DEFAULT.map(function (r) { return [r.key, r.value, r.note]; });
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  return sheet;
}

function scraperConfig_() {
  var sheet = scraperConfigSheet_();
  var values = sheet.getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) cfg[key] = String(values[i][1] == null ? '' : values[i][1]).trim();
  }
  return cfg;
}

/** Config, counts and which secrets are set — never a secret's value. */
HUB_POLICY.scraperConfig = {
  file: 'Scraper.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.scraperConfig = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cfg = scraperConfig_();
  return {
    status: 200,
    data: {
      config: cfg,
      password_set: Boolean(hubProp_(SCRAPER_PASSWORD_PROP)),
      scoring_key_set: Boolean(hubProp_(SCRAPER_OPENAI_PROP)),
      notify_key_set: Boolean(hubProp_(SCRAPER_OPENPHONE_PROP)),
      leads_tab: SCRAPER_LEADS_TAB,
      counts: scraperCounts_(),
      effective_system: String(cfg.score_system || '').trim() || SCRAPER_SYSTEM_DEFAULT,
      effective_prompt: String(cfg.score_prompt || '').trim() || SCRAPER_PROMPT_DEFAULT
    }
  };
};

function scraperCounts_() {
  var sheet = hubSheet_(SCRAPER_LEADS_TAB);
  if (sheet.getLastRow() < 2) return { total: 0, unrated: 0, high: 0, open: 0 };
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iRating = hdr.indexOf('ai_rating');
  var iExp = hdr.indexOf('expiration_date');
  var threshold = parseInt(scraperConfig_().score_threshold, 10) || 7;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var total = 0, unrated = 0, high = 0, open = 0;
  for (var r = 1; r < values.length; r++) {
    if (!String(values[r][0] || '').trim()) continue;
    total++;
    var live = true;
    if (iExp !== -1) {
      var d = scraperDate_(values[r][iExp]);
      live = Boolean(d) && d >= today;
    }
    if (live) open++;
    var rating = iRating === -1 ? '' : String(values[r][iRating] || '').trim();
    if (live && !rating) unrated++;
    if (live && rating && Number(rating) >= threshold) high++;
  }
  return { total: total, unrated: unrated, high: high, open: open };
}

function scraperTruthy_(value) {
  if (value === true) return true;
  var s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'sim';
}

function scraperDate_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  var s = String(value || '').trim();
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Write back only keys that already exist in the tab; unknown keys are ignored. */
HUB_POLICY.scraperConfigSet = {
  file: 'Scraper.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.scraperConfigSet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var updates = payload && payload.config ? payload.config : {};
  var sheet = scraperConfigSheet_();
  var values = sheet.getDataRange().getValues();
  var written = 0;
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key && Object.prototype.hasOwnProperty.call(updates, key)) {
      sheet.getRange(i + 1, 2).setValue(String(updates[key]));
      written++;
    }
  }
  hubSysLog_(user && user.email, 'scraper_config', String(written) + ' setting(s)', { status: 200 });
  return { status: 200, data: { config: scraperConfig_(), written: written } };
};

/* ---- Parsing ---- */

function scraperUnescape_(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// The attribute holds either a paginated object (`.data`) or the bare array; both occur.
function scraperParseReferrals_(html) {
  var m = String(html || '').match(/:?initial-open-referrals="([^"]+)"/);
  if (!m) return [];
  var parsed;
  try {
    parsed = JSON.parse(scraperUnescape_(m[1]));
  } catch (e) {
    return [];
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Array.isArray(parsed.data) ? parsed.data : [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

function scraperFlatten_(obj, prefix) {
  var out = {};
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var key = prefix ? prefix + '.' + k : k;
    var v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      var nested = scraperFlatten_(v, key);
      for (var n in nested) if (Object.prototype.hasOwnProperty.call(nested, n)) out[n] = nested[n];
    } else if (Array.isArray(v)) {
      out[key] = JSON.stringify(v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function scraperClean_(value) {
  var s = String(value == null ? '' : value);
  if (!s) return '';
  s = s.replace(/<\s*\/?\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr)\s*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = scraperUnescape_(s).replace(/&nbsp;/gi, ' ');
  return s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function scraperLeadRow_(ref) {
  var f = scraperFlatten_(ref, '');
  var first = String(f['client.first_name'] || '').trim();
  var last = String(f['client.last_name'] || '').trim();
  return {
    referral_id: String(ref.id == null ? '' : ref.id).trim(),
    client_name: (first + ' ' + last).trim(),
    client_age: String(f['client_age'] || ''),
    client_gender: String(f['client.gender'] || ''),
    frequency: scraperClean_(f['frequency']),
    description: scraperClean_(f['description_of_service']),
    diagnosis: scraperClean_(f['client.diagnosis']),
    postal_code: String(f['client_residence_postal_code'] || ''),
    phone: String(f['client.home_phone'] || ''),
    email: String(f['client.email'] || ''),
    funding_source: String(f['funding_source_id'] || ''),
    expiration_date: String(f['expiration_date_friendly'] || '')
  };
}

/* ---- Run ---- */

/** Sign in, walk the configured pages, append only unseen referral ids. */
HUB_POLICY.scraperRun = {
  file: 'Scraper.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['potentialClients'], emits: []
};
HUB_ACTIONS.scraperRun = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();

  var cfg = scraperConfig_();
  if (String(cfg.enabled || '').toLowerCase() !== 'yes') {
    return { status: 400, message: 'The scraper is switched off. Set `enabled` to yes in the scraper_config tab.' };
  }
  var password = hubProp_(SCRAPER_PASSWORD_PROP);
  if (!cfg.email || !password) {
    return { status: 400, message: 'Missing credentials: set `email` in scraper_config and ' + SCRAPER_PASSWORD_PROP + ' in Script Properties.' };
  }

  var login = UrlFetchApp.fetch(cfg.login_url, {
    method: 'post',
    payload: { email: cfg.email, password: password },
    followRedirects: false,
    muteHttpExceptions: true
  });
  var code = login.getResponseCode();
  if (code !== 200 && code !== 302) {
    return { status: 502, message: 'Sign-in failed (HTTP ' + code + ').' };
  }

  // Carry the session by hand: UrlFetchApp has no cookie jar.
  var setCookie = login.getAllHeaders()['Set-Cookie'] || login.getAllHeaders()['set-cookie'] || '';
  var cookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .map(function (c) { return String(c).split(';')[0]; })
    .filter(String)
    .join('; ');
  if (!cookies) return { status: 502, message: 'Sign-in returned no session cookie.' };

  var pages = Math.max(1, parseInt(cfg.pages, 10) || 1);
  var seen = {};
  var fetched = 0;
  for (var p = 1; p <= pages; p++) {
    var url = cfg.referrals_url + '?open=1&client=&service=&status=' + (p > 1 ? '&page=' + p : '');
    var res = UrlFetchApp.fetch(url, { headers: { Cookie: cookies }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) continue;
    var refs = scraperParseReferrals_(res.getContentText());
    for (var i = 0; i < refs.length; i++) {
      var ref = refs[i];
      if (!ref || typeof ref !== 'object') continue;
      var rid = String(ref.id == null ? '' : ref.id).trim();
      if (!rid) continue;
      fetched++;
      seen[rid] = ref;
    }
  }

  // Append-only: what is already in the sheet may have been worked on.
  var sheet = hubSheet_(SCRAPER_LEADS_TAB);
  var last = sheet.getLastRow();
  var hdr = last > 0
    ? sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  if (hdr.length === 0) {
    sheet.getRange(1, 1, 1, SCRAPER_LEAD_HEADER.length).setValues([SCRAPER_LEAD_HEADER]);
    hdr = SCRAPER_LEAD_HEADER.slice();
  }
  var iRef = hdr.indexOf('referral_id');
  var known = {};
  if (iRef !== -1 && sheet.getLastRow() > 1) {
    var col = sheet.getRange(2, iRef + 1, sheet.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < col.length; r++) {
      var v = String(col[r][0] || '').trim();
      if (v) known[v] = true;
    }
  }

  var now = new Date().toISOString();
  var appended = 0;
  for (var id in seen) {
    if (!Object.prototype.hasOwnProperty.call(seen, id) || known[id]) continue;
    var lead = scraperLeadRow_(seen[id]);
    lead.id = 'LEAD_' + id;
    lead.source = 'brittco';
    lead.scraped_at = now;
    lead.stage = 'new';
    var row = hdr.map(function (h) { return Object.prototype.hasOwnProperty.call(lead, h) ? lead[h] : ''; });
    sheet.appendRow(row);
    appended++;
  }

  hubSysLog_(user && user.email, 'scraper_run', appended + ' new of ' + fetched, { status: 200 });
  return {
    status: 200,
    data: {
      pages: pages,
      seen: fetched,
      unique: Object.keys(seen).length,
      added: appended,
      ran_at: now
    }
  };
};

/* ---- Rating ---- */

function scraperScorePrompt_(lead, cfg) {
  var template = String(cfg.score_prompt || '').trim() || SCRAPER_PROMPT_DEFAULT;
  return scraperFillTemplate_(template, {
    home_zip: cfg.home_zip || '44709',
    referral_id: lead.referral_id, client_name: lead.client_name,
    frequency: lead.frequency, description: lead.description,
    postal_code: lead.postal_code, client_gender: lead.client_gender,
    diagnosis: lead.diagnosis, client_age: lead.client_age,
    phone: lead.phone, email: lead.email
  });
}

function scraperParseJson_(content) {
  var s = String(content || '').trim();
  var fenced = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) s = fenced[1];
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

// Only open rows are rated, and a rated row is never re-rated.
HUB_POLICY.scraperScore = {
  file: 'Scraper.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['potentialClients'], emits: []
};
HUB_ACTIONS.scraperScore = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();

  var apiKey = hubProp_(SCRAPER_OPENAI_PROP);
  if (!apiKey) {
    return { status: 400, message: 'Rating needs ' + SCRAPER_OPENAI_PROP + ' in Script Properties.' };
  }
  var cfg = scraperConfig_();
  var batch = Math.max(1, parseInt(cfg.score_batch_size, 10) || 50);
  var model = cfg.score_model || 'gpt-5.1';

  var sheet = hubSheet_(SCRAPER_LEADS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  for (var c = 0; c < hdr.length; c++) col[hdr[c]] = c;
  if (col.ai_rating === undefined || col.ai_notes === undefined) {
    return { status: 400, message: 'The sheet has no ai_rating / ai_notes columns.' };
  }

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var candidates = [];
  for (var r = 1; r < values.length && candidates.length < batch; r++) {
    var row = values[r];
    if (!String(row[0] || '').trim()) continue;
    if (String(row[col.ai_rating] || '').trim()) continue;
    var exp = col.expiration_date === undefined ? null : scraperDate_(row[col.expiration_date]);
    if (!exp || exp < today) continue;
    candidates.push({ rowIndex: r + 1, row: row });
  }

  var scored = 0, failed = 0;
  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i].row;
    var lead = {
      referral_id: v[col.referral_id] || '', client_name: v[col.client_name] || '',
      client_age: v[col.client_age] || '', client_gender: v[col.client_gender] || '',
      frequency: v[col.frequency] || '', description: v[col.description] || '',
      diagnosis: v[col.diagnosis] || '', postal_code: v[col.postal_code] || '',
      phone: col.phone === undefined ? '' : (v[col.phone] || ''),
      email: col.email === undefined ? '' : (v[col.email] || '')
    };
    var res;
    try {
      res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        muteHttpExceptions: true,
        payload: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: String(cfg.score_system || '').trim() || SCRAPER_SYSTEM_DEFAULT },
            { role: 'user', content: scraperScorePrompt_(lead, cfg) }
          ],
          // gpt-5.x rejects max_tokens and spends tokens reasoning: leave headroom or the reply is empty.
          max_completion_tokens: 600
        })
      });
    } catch (e) {
      failed++;
      continue;
    }
    if (res.getResponseCode() !== 200) { failed++; continue; }
    var body;
    try { body = JSON.parse(res.getContentText()); } catch (e2) { failed++; continue; }
    var content = body && body.choices && body.choices[0] && body.choices[0].message
      ? body.choices[0].message.content : '';
    var parsed = scraperParseJson_(content);
    if (!parsed) { failed++; continue; }

    var rating = parseInt(parsed.ai_rating, 10);
    if (isNaN(rating)) { failed++; continue; }
    var summary = lead.client_name + ' (' + lead.client_age + ', ' + lead.client_gender + '); ' +
      String(parsed.ai_notes || '');

    sheet.getRange(candidates[i].rowIndex, col.ai_rating + 1).setValue(rating);
    sheet.getRange(candidates[i].rowIndex, col.ai_notes + 1).setValue(summary);
    scored++;
  }

  hubSysLog_(user && user.email, 'scraper_score', scored + ' rated, ' + failed + ' failed', { status: 200 });
  return { status: 200, data: { considered: candidates.length, scored: scored, failed: failed, counts: scraperCounts_() } };
};

/* ---- Alerts ---- */

// Referral plus number, never the text: a re-rated lead must not text the same person again.
function scraperAlertKey_(leadId, to) {
  return 'scraper_lead:' +
    String(leadId || '').trim().replace(/[^A-Za-z0-9_.:-]/g, '') + ':' +
    String(to || '').replace(/\D/g, '').slice(-10);
}

// Unlike teamAlert, the opt-out brake applies: a lead alert is a nudge, not an escalation.
HUB_POLICY.scraperNotify = {
  file: 'Scraper.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['potentialClients'], emits: ['smsSend']
};
HUB_ACTIONS.scraperNotify = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();

  var cfg = scraperConfig_();
  if (String(cfg.notify_enabled || '').toLowerCase() !== 'yes') {
    return { status: 400, message: 'Text messages are switched off. Set `notify_enabled` to yes first.' };
  }
  // A Smart Comms situation (lead_alert): off, nothing is sent and no lead is stamped.
  var sit = hubLaneSituation_('lead_alert');
  if (!sit.on || !sit.leg('sms')) {
    return { status: 409, message: 'Nothing was sent: ' + (sit.why || 'the situation lead_alert writes no text') + '.' };
  }
  var apiKey = hubProp_(SCRAPER_OPENPHONE_PROP);
  if (!apiKey) return { status: 400, message: 'Missing ' + SCRAPER_OPENPHONE_PROP + ' in Script Properties.' };

  var recipients = String(cfg.notify_recipients || '').split(',')
    .map(function (s) { return s.trim(); }).filter(String);
  if (!recipients.length) return { status: 400, message: 'No recipients set in scraper_config.' };

  var threshold = parseInt(cfg.score_threshold, 10) || 7;

  // The send door picks the line; this is only the label the screen shows.
  var from = String(cfg.notify_from || '').trim() || 'the Automations line';

  var sheet = hubSheet_(SCRAPER_LEADS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {};
  for (var c = 0; c < hdr.length; c++) col[hdr[c]] = c;
  if (col.sms_sent === undefined) return { status: 400, message: 'The sheet has no sms_sent column.' };

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var sent = 0, eligible = 0, failed = 0, blocked = 0, optedOut = 0, rehearsals = 0, paused = false;
  var limit = Math.max(1, parseInt(payload && payload.limit, 10) || 25);

  // The limit bounds attempts, not successes.
  for (var r = 1; r < values.length && eligible < limit; r++) {
    var row = values[r];
    var leadId = String(row[0] || '').trim();
    if (!leadId) continue;
    var rating = parseInt(row[col.ai_rating], 10);
    if (isNaN(rating) || rating < threshold) continue;
    if (scraperTruthy_(row[col.sms_sent])) continue;
    var exp = col.expiration_date === undefined ? null : scraperDate_(row[col.expiration_date]);
    if (!exp || exp < today) continue;
    eligible++;

    var notes = String(row[col.ai_notes] || '').trim() ||
      ('High-value lead: ' + String(row[col.client_name] || '').trim());
    var text = sit.word('sms_text', notes, { notes: notes, client: String(row[col.client_name] || '').trim(),
                                             rating: String(rating), lead_id: leadId });

    // One number per call: the opt-out brake keys on a single number.
    var reached = 0, stopped = 0, hardFail = 0, held = 0, rehearsed = 0;
    for (var t = 0; t < recipients.length; t++) {
      var res;
      try {
        res = rpcCall_('smsSend', {
          to: recipients[t],
          body: text,
          reason: 'lead alert: referral ' + leadId + ' rated ' + rating
        }, { idempotency_key: scraperAlertKey_(leadId, recipients[t]) });
      } catch (e3) {
        res = { ok: false, error: 'threw', detail: String((e3 && e3.message) || e3) };
      }
      // Redirected is asked first: it reached a tester but comes back with sent:true.
      if (res.ok && res.redirected) rehearsed++;
      else if (res.ok && (res.sent || res.deduplicated)) reached++;
      else if (res.ok && res.gated && res.reason === 'opted_out') stopped++;
      else if (res.ok && res.gated) held++;
      else hardFail++;
    }
    optedOut += stopped;

    // Sending is off platform-wide: stop and stamp nothing.
    if (held) { paused = true; break; }

    // Only a fully delivered alert is stamped, so a half-sent one stays retryable.
    if (hardFail) { failed++; continue; }
    // A rehearsal never stamps the lead, or the real alert would be disarmed.
    if (rehearsed) { rehearsals++; continue; }
    // Left unstamped on purpose: the recipient list is what needs fixing.
    if (!reached) { blocked++; continue; }

    // 'true' is the imported rows' vocabulary: do not change it.
    sheet.getRange(r + 1, col.sms_sent + 1).setValue('true');
    sent++;
  }

  hubSysLog_(user && user.email, 'scraper_notify',
    sent + ' alert(s) to ' + recipients.length + ' number(s)' +
    (rehearsals ? ', ' + rehearsals + ' rehearsed to the testers' : '') +
    (blocked ? ', ' + blocked + ' reached nobody (opted out)' : '') +
    (paused ? ', stopped: platform sending is switched off' : ''),
    { status: 200 });
  return { status: 200, data: {
    eligible: eligible, sent: sent, failed: failed,
    blocked: blocked, opted_out: optedOut, rehearsed: rehearsals, paused: paused,
    from: from, recipients: recipients.length,
    note: paused
      ? 'Nothing was sent: sending is switched off for the whole platform. The leads stay unstamped and go out when it is switched back on.'
      : rehearsals
        ? rehearsals + ' alert(s) went to the testers because test mode is on. The leads stay unstamped so the real alert still goes out.'
        : (blocked ? blocked + ' alert(s) reached nobody: every recipient on the list has asked us to stop.' : '')
  } };
};

// new → read only after the alert is out; a hand-set stage is never overwritten.
HUB_POLICY.leadOpened = {
  file: 'Scraper.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: ['potentialClients'], emits: []
};
HUB_ACTIONS.leadOpened = function (payload, user) {
  // A single `id` still works for older bundles.
  var ids = [];
  if (payload && payload.ids && payload.ids.length) {
    for (var n = 0; n < payload.ids.length && n < 100; n++) ids.push(String(payload.ids[n]));
  } else if (payload && payload.id) {
    ids = [String(payload.id)];
  }
  if (!ids.length) return { status: 400, message: 'id (or ids) is required.' };
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var row = requireRow_('potentialClients', id);
    if (row.error) { out.push({ id: id, error: true }); continue; }
    if (!scraperTruthy_(row.sms_sent) ||
        String(row.stage || '').trim().toLowerCase() !== 'new') {
      out.push({ id: id, stage: row.stage, unchanged: true });
      continue;
    }
    var updated = updateRowById_('potentialClients', { id: id, stage: 'read' });
    if (updated.error) { out.push({ id: id, error: true }); continue; }
    hubSysLog_(user && user.email, 'lead_read',
      String(row.client_name || id) + ' new → read', { status: 200 });
    out.push({ id: id, stage: 'read' });
  }
  if (out.length === 1 && !(payload && payload.ids)) return { status: 200, data: out[0] };
  return { status: 200, data: { results: out } };
};
