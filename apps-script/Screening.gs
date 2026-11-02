
var HUB_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

var SCREEN_DAY_WORDS = {
  monday: 'monday', mon: 'monday',
  tuesday: 'tuesday', tues: 'tuesday', tue: 'tuesday',
  wednesday: 'wednesday', wed: 'wednesday',
  thursday: 'thursday', thurs: 'thursday', thu: 'thursday',
  friday: 'friday', fri: 'friday',
  saturday: 'saturday', sat: 'saturday',
  sunday: 'sunday', sun: 'sunday'
};

/** No model: a wrong date is worse than none. */
function screenSlotFromText_(transcript) {
  var out = { interview_weekday: '', interview_period: '', interview_time: '', interview_date: '' };
  var t = String(transcript || '');
  if (!t) return out;
  // Strip the playback clock — "[3:16] +1330…:" reads as an interview at 03:16.
  var low = t.toLowerCase().replace(/\[\s*\d{1,2}\s*:\s*\d{2}\s*\]/g, ' ');

  // Last weekday spoken wins; longest-first so "tues" never beats "tuesday".
  var dayRe = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thu|fri|sat|sun)\b/g;
  var m, lastAt = -1, lastDay = '';
  while ((m = dayRe.exec(low)) !== null) {
    lastAt = m.index; lastDay = SCREEN_DAY_WORDS[m[1]] || '';
  }
  if (!lastDay) return out;
  out.interview_weekday = lastDay.charAt(0).toUpperCase() + lastDay.slice(1);

  var from = Math.max(0, lastAt - 120);
  var near = low.slice(from, lastAt + 120);
  var clock = near.match(/\b(\d{1,2})\s*[:h]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)/) ||
              near.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)/);
  if (clock) {
    var hh = parseInt(clock[1], 10);
    var mins = /^\d{2}$/.test(clock[2] || '') ? parseInt(clock[2], 10) : 0;
    var ampm = String(clock[3] || clock[2] || '').replace(/\./g, '').toLowerCase();
    if (ampm.indexOf('p') === 0 && hh < 12) hh += 12;
    if (ampm.indexOf('a') === 0 && hh === 12) hh = 0;
    if (hh >= 0 && hh <= 23 && (ampm || clock[2] !== undefined)) {
      out.interview_time = hubPad2_(hh) + ':' + hubPad2_(mins);
    }
  }

  if (/\bmorning\b/.test(near)) out.interview_period = 'morning';
  else if (/\bafternoon\b/.test(near)) out.interview_period = 'afternoon';
  else if (/\bevening\b|\bnight\b/.test(near)) out.interview_period = 'evening';

  return out;
}

/** Calendar maths lives here: a model asked to resolve the day kept answering the wrong one. */
function hubResolveInterviewDate_(analysis, screenRow) {
  var period = str_(analysis.interview_period).toLowerCase();
  var time = str_(analysis.interview_time);
  var hh = 14, mm = 0;
  if (/^\d{1,2}:\d{2}$/.test(time)) {
    hh = parseInt(time.split(':')[0], 10); mm = parseInt(time.split(':')[1], 10);
  } else if (period === 'morning' || period === 'afternoon' || period === 'evening') {
    var ph = parseInt(bookText_('Strings', 'hours.' + period, ''), 10);
    if (!isNaN(ph)) hh = ph;
  }

  var explicit = str_(analysis.interview_date) || str_(analysis.best_in_person_day_time);
  var weekday = str_(analysis.interview_weekday).toLowerCase();
  var target = HUB_WEEKDAYS.indexOf(weekday);

  var base = commsWhenSafe_(str_(screenRow && (screenRow.transcriptcreated || screenRow.screendate)));
  if (target === -1) {
    if (!explicit) return '';
    return hubBusinessDay_(explicit.indexOf(':') === -1 ? explicit + ' ' + hubPad2_(hh) + ':' + hubPad2_(mm) : explicit);
  }

  var d = new Date(base.getTime());
  // timezone trap: getDay() answers in the project's zone, where a late Ohio call is already tomorrow
  var today = (typeof hubTzWeekday_ === 'function') ? hubTzWeekday_(d) : d.getDay();
  var delta = (target - today + 7) % 7;
  if (delta === 0) delta = 7;                 // said ON that weekday = next week
  d.setDate(d.getDate() + delta);
  d.setHours(hh, mm, 0, 0);
  return hubBusinessDay_(d.getFullYear() + '-' + hubPad2_(d.getMonth() + 1) + '-' + hubPad2_(d.getDate()) +
                         ' ' + hubPad2_(d.getHours()) + ':' + hubPad2_(d.getMinutes()));
}

function hubPad2_(n) { return (n < 10 ? '0' : '') + n; }

function commsWhenSafe_(raw) {
  var d = raw ? new Date(String(raw)) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

/** A model still answers Saturday, so weekends roll to Monday here. */
function hubBusinessDay_(when) {
  var raw = str_(when);
  if (!raw) return '';
  var d = new Date(raw.replace(' ', 'T'));
  if (isNaN(d.getTime())) return raw;
  var dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  else return raw;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function hubCallDateLabel_(s) {
  var raw = str_(s && (s.transcriptcreated || s.screendate));
  var d = raw ? new Date(raw) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var tz = hiringTimeZone_();
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd') + ' (' + Utilities.formatDate(d, tz, 'EEEE') + ')';
}

var SCREEN_FIELDS = [
  'screen_date', 'screen_status', 'notes', 'shift_day', 'shift_afternoon',
  'shift_night', 'hours_prn', 'hours_pt', 'hours_ft', 'current_rate',
  'cert_dodd', 'cert_cpr_first_aid', 'cert_med_del', 'has_dl', 'has_vehicle',
  'has_insurance', 'behavioral_care', 'every_other_weekend', 'male_care',
  'background_disclosure', 'best_in_person_day_time'
];

HUB_POLICY.screenGet = {
  file: 'Screening.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.screenGet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  var s = ev.screen || null;
  var out = {};
  if (s) {
    SCREEN_FIELDS.forEach(function (f) { out[f] = str_(s[normKey_(f)]); });
    out.final_result = str_(s.finalresult);
    out.qualification = str_(s.qualification);
    out.screen_score = str_(s.screenscore);
    out.phone_screen_report_url = str_(s.phonescreenreporturl);
    out.has_transcript = !!(str_(s.transcripttext) || str_(s.transcripturl));
  }
  return { status: 200, data: { exists: !!s, screen: out } };
};

HUB_POLICY.screenSave = {
  file: 'Screening.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.screenSave = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  var fields = {};
  SCREEN_FIELDS.forEach(function (f) {
    if (payload[f] !== undefined) fields[f] = str_(payload[f]);
  });
  if (!fields.screen_date) fields.screen_date = new Date().toISOString().slice(0, 10);
  fields.screened_by = 'asa-hub:' + user.email;
  if (ev.screen) {
    hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, fields, user, false);
  } else {
    var now = new Date().toISOString();
    fields.candidate_id = cid;
    fields.candidatename = str_(ev.cand.candidatename);
    fields.phone_screen_id = 'PS_' + randomHex_(16).toUpperCase();
    fields.attempt_num = '1';
    fields.created_at = now;
    fields.updated_at = now;
    fields.created_by = 'asa-hub:' + user.email;
    hubAppendRow_(TALENT_PHONE_TAB, fields);
  }
  hubBustTalentCache_();
  var gate = hubGate_(hubEvidence_(cid));
  return { status: 200, data: { saved: true, gate_passed: gate.ok, missing: gate.reasons } };
};

var SCREEN_AI_RELAY_PROP = 'HUB_ANALYZE_URL';

/** An UNSET property means "the usual place", not "give up". */
var SCREEN_AI_RELAY_DEFAULT = 'https://asamylife.asalifecare.com/analyze';

/** Must never repair malformed JSON; check-undefined-helpers.mjs guards that it exists. */
function screenJsonish_(raw) {
  var t = String(raw || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  return (a !== -1 && b > a) ? t.slice(a, b + 1) : t;
}


var SCREEN_BUILD = '2026-08-07d';

// not gpt-oss-20b: it runs NDJSON objects together on one line, and hotlineParseNdjson_ splits on newlines
var SCREEN_GROQ_MODEL = 'openai/gpt-oss-120b';

/** The Groq entries are the 429 rotation; GROK_API_KEY is spelled with a K on purpose, and renaming it unplugs the screen. */
var SCREEN_AI_PROVIDERS = [
  { name: 'groq', prop: 'GROK_API_KEY', modelProp: 'GROQ_MODEL',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: SCREEN_GROQ_MODEL },
  { name: 'groq2', prop: 'GROQ_KEY1', modelProp: 'GROQ_MODEL',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: SCREEN_GROQ_MODEL },
  { name: 'groq3', prop: 'GROQ_KEY2', modelProp: 'GROQ_MODEL',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: SCREEN_GROQ_MODEL },
  { name: 'groq4', prop: 'GROQ_KEY3', modelProp: 'GROQ_MODEL',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: SCREEN_GROQ_MODEL },
  { name: 'groq5', prop: 'GROQ_KEY4', modelProp: 'GROQ_MODEL',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: SCREEN_GROQ_MODEL },
  { name: 'groq6', prop: 'GROQ_KEY5', modelProp: 'GROQ_MODEL',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: SCREEN_GROQ_MODEL },
  // an open slot: skipped as groq7_nokey until GROQ_KEY6 is filled
  { name: 'groq7', prop: 'GROQ_KEY6', modelProp: 'GROQ_MODEL',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: SCREEN_GROQ_MODEL },
  { name: 'openai', prop: 'OPENAI_API_KEY', modelProp: 'OPENAI_MODEL',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini' }
];

/** Read once per call so a 300s cache cannot turn over mid-loop; null leaves the shipped ladder. */
function screenAiConfig_(requestId) {
  try {
    if (typeof smartAiRequest_ !== 'function') return null;
    var own = requestId ? smartAiRequest_(String(requestId)) : null;
    if (own && (str_(own.model) || (own.providers && own.providers.length))) return own;
    var def = smartAiRequest_(typeof SMART_AI_DEFAULT_ID === 'string' ? SMART_AI_DEFAULT_ID : 'ai_default');
    return def || own;
  } catch (e) { return null; }
}

function screenAiHostKey_(p) {
  try {
    var m = String((p && p.url) || '').match(/^https?:\/\/([^\/]+)/);
    var host = m ? m[1] : '';
    var parts = host.split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch (e) { return ''; }
}

/** A model belongs to a host: a Groq model name sent to OpenAI is refused. */
function screenAiModelFor_(cfg, p) {
  if (!cfg) return '';
  var raw = String(cfg.model || '');
  if (!raw) return '';
  var byName = {}, fallback = '';
  raw.split(/[,;\n]+/).forEach(function (piece) {
    var t = String(piece || '').trim();
    if (!t) return;
    var eq = t.indexOf('=');
    if (eq === -1) { if (!fallback) fallback = t; return; }
    var k = t.slice(0, eq).trim().toLowerCase();
    var v = t.slice(eq + 1).trim();
    if (k && v) byName[k] = v;
  });
  var name = String((p && p.name) || '').toLowerCase();
  var hostKey = screenAiHostKey_(p).toLowerCase();
  var fullHost = '';
  try {
    var mm = String((p && p.url) || '').match(/^https?:\/\/([^\/]+)/);
    fullHost = mm ? mm[1].toLowerCase() : '';
  } catch (eH) { fullHost = ''; }
  if (byName[name]) return byName[name];
  if (hostKey && byName[hostKey]) return byName[hostKey];
  if (fullHost && byName[fullHost]) return byName[fullHost];
  return fallback;
}

function screenAiModel_(p, cfg) {
  try {
    var picked = screenAiModelFor_(cfg, p);
    if (picked) return picked;
  } catch (eC) {}
  return screenAiModelProp_(p);
}

/** NAMED, never derived: a derivation returned GROQ_KEY1 itself as the model. */
function screenAiModelProp_(p) {
  try {
    var set = String(hubProp_(p.modelProp || '') || '');
    if (set) return set;
  } catch (e) {}
  return p.model;
}

/** json_object is a promise the provider enforces: an NDJSON ask sent under it answers 400 json_validate_failed. */
function screenAskWantsLines_(prompt) {
  var t = String(prompt || '');
  return /\bNDJSON\b/i.test(t) || /one\s+JSON\s+object\s+per\s+line/i.test(t);
}

/** Shared with the weekly key watch; `strict` defaults on so a missing argument never loosens a caller's guarantee. */
function screenAiPayload_(model, messages, temperature, strict) {
  var body = {
    model: model,
    temperature: temperature,
    messages: messages
  };
  if (strict !== false) body.response_format = { type: 'json_object' };
  return body;
}

function screenAiWhy_(body) {
  var m = String(body || '').match(/"code"\s*:\s*"([A-Za-z0-9_.-]{1,40})"/);
  if (m) return '(' + m[1] + ')';
  m = String(body || '').match(/"type"\s*:\s*"([A-Za-z0-9_.-]{1,40})"/);
  return m ? '(' + m[1] + ')' : '';
}

/** Never throws for an HTTP code: a refusal is a value. */
function screenAiFetch_(p, key, model, messages, temperature, strict) {
  var resp = UrlFetchApp.fetch(p.url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(screenAiPayload_(model, messages, temperature, strict)),
    muteHttpExceptions: true
  });
  return { code: resp.getResponseCode(), text: resp.getContentText() };
}

function screenAiChat_(prompt, temperature, requestId) {
  var out = { ok: false, content: '', via: '', error: '' };
  var errors = [];
  var messages = [{ role: 'user', content: prompt }];
  var wantsLines = screenAskWantsLines_(prompt);

  var aiCfg = screenAiConfig_(requestId);
  for (var i = 0; i < SCREEN_AI_PROVIDERS.length; i++) {
    var p = SCREEN_AI_PROVIDERS[i];
    if (aiCfg && aiCfg.providers && aiCfg.providers.length &&
        aiCfg.providers.indexOf(p.name) === -1) {
      errors.push(p.name + '_offbyconfig');
      continue;
    }
    var key = '';
    try { key = String(hubProp_(p.prop) || ''); }
    catch (eK) { key = ''; }
    if (!key) { errors.push(p.name + '_nokey'); continue; }
    // quarantine is honoured here: hubProp_ reads Props.gs first, so deleting a stored key would not stop this loop
    if (typeof aiKeyIsRetired_ === 'function' && aiKeyIsRetired_(p.prop)) {
      errors.push(p.name + '_retired');
      continue;
    }
    try {
      var strict = !wantsLines;
      var att = screenAiFetch_(p, key, screenAiModel_(p, aiCfg), messages, temperature, strict);
      // json_validate_failed is our own promise discarding the answer: retry the same prompt without it
      if (att.code === 400 && strict && String(att.text).indexOf('json_validate_failed') !== -1) {
        strict = false;
        att = screenAiFetch_(p, key, screenAiModel_(p, aiCfg), messages, temperature, false);
      }
      if (att.code >= 400) {
        errors.push(p.name + '_' + att.code + screenAiWhy_(att.text));
        continue;
      }
      var c = '', finish = '';
      try {
        var choice = JSON.parse(att.text).choices[0];
        c = choice.message.content;
        finish = String(choice.finish_reason || '');
      } catch (eP) { c = ''; finish = ''; }
      if (!c) {
        // an empty 200 is an answer only to a lines ask that ended in `stop`; keyed on wantsLines because strict is mutated above
        if (wantsLines && finish === 'stop') {
          out.ok = true; out.content = ''; out.via = p.name;
          out.error = errors.join('+');
          return out;
        }
        errors.push(p.name + '_empty' + (finish ? '(' + finish.slice(0, 20) + ')' : '(no finish_reason)'));
        continue;
      }
      out.ok = true; out.content = screenJsonish_(c); out.via = p.name;
      return out;
    } catch (e) {
      errors.push(p.name + '_threw(' + String((e && e.message) || e).slice(0, 90) + ')');
    }
  }

  var relay = SCREEN_AI_RELAY_DEFAULT;
  try {
    var set = String(hubProp_(SCREEN_AI_RELAY_PROP) || '');
    if (set) relay = set;
  } catch (eR) {}
  var secret = '';
  try { secret = String(hubProp_('HUB_SERVICE_SECRET') || ''); }
  catch (eS) { secret = ''; }
  out.error = errors.join('+') || 'no_provider_configured';
  if (!relay || !secret) return out;
  try {
    var relayBody = { service_secret: secret, temperature: temperature,
                      messages: messages };
    // the relay forwards whatever format it is handed, so it gets the shape the prompt demands
    if (!wantsLines) relayBody.response_format = { type: 'json_object' };
    var r2 = UrlFetchApp.fetch(relay, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(relayBody),
      muteHttpExceptions: true
    });
    if (r2.getResponseCode() >= 400) {
      out.error += '+relay_' + r2.getResponseCode();
    } else {
      var env = JSON.parse(r2.getContentText());
      // the relay answers 200 and refuses in the body, so its own reason is carried
      var envStatus = Number((env && env.status) || 0);
      if (envStatus >= 400) {
        out.error += '+relay_' + envStatus + '(' +
                     String((env && env.message) || '').slice(0, 90) + ')';
        hubSysLog_('asa-hub:screen', 'screen_ai_failed', '[' + SCREEN_BUILD + '] ' + out.error, { status: 502 });
        return out;
      }
      var c2 = ((((env.data || {}).choices || [{}])[0] || {}).message || {}).content || '';
      if (c2) {
        out.ok = true; out.content = screenJsonish_(c2); out.via = 'relay';
        return out;
      }
      out.error += '+relay_empty';
    }
  } catch (e2) {
    out.error += '+relay_threw(' + String((e2 && e2.message) || e2).slice(0, 90) + ')';
  }
  hubSysLog_('asa-hub:screen', 'screen_ai_failed', '[' + SCREEN_BUILD + '] ' + out.error, { status: 502 });
  return out;
}


/** Alerts the team when Date Accepted cannot be read; HUB_RPC_SEND does not hold this path. */
HUB_POLICY.screenAnalyze = {
  file: 'Screening.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: ['teamAlert']
};
HUB_ACTIONS.screenAnalyze = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  // no key check here: it would wall off the fallback that exists for a dead provider
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (!ev.screen) return { status: 409, message: bookText_('Strings', 'refuse.no_screening_saved', '') };

  var s = ev.screen;
  var facts = SCREEN_FIELDS.map(function (f) {
    return f + ': ' + str_(s[normKey_(f)]);
  }).join('\n');
  var transcript = str_(s.transcripttext);
  var tBlock = transcript
    ? bookText_('Prompts', 'ai_phone_screen_transcript_block', '')
        .split('{transcript}').join(transcript.slice(0, 11000))
    : '';
  var prompt = bookText_('Prompts', 'ai_phone_screen', '')
    .split('{evidence}').join(bookText_('Prompts',
      transcript ? 'ai_phone_screen_evidence_call' : 'ai_phone_screen_evidence_form', ''))
    .split('{call_date}').join(hubCallDateLabel_(s))
    .split('{name}').join(str_(ev.cand.candidatename))
    .split('{facts}').join(facts)
    .split('{transcript_block}').join(tBlock);

  var chat = prompt ? screenAiChat_(prompt, 0.2, 'ai_phone_screen')
                    : { ok: false, error: 'prompt_cell_empty' };
  if (!chat.ok) {
    // no model must not cost the date: only the slot, with no score and no invented summary
    var only = screenSlotFromText_(transcript);
    var slot = only.interview_weekday ? hubResolveInterviewDate_(only, s) : '';
    if (slot && !str_(s.bestinpersondaytime)) {
      ensureHeader_(hubSheet_(TALENT_PHONE_TAB), ['best_in_person_day_time']);
      hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, { best_in_person_day_time: slot }, user, false);
      hubBustTalentCache_();
      return { status: 200, data: { score: '', qualification: '', summary: '',
               concerns: [], report_url: '', analysis_missing: chat.error,
               best_in_person_day_time: slot,
               note: bookText_('Strings', 'screen.note.no_model', '') } };
    }
    return { status: 502, message: hiringRenderMail_(
      bookText_('Strings', 'refuse.model_silent', ''), { error: str_(chat.error) }) };
  }
  var analysis;
  try {
    analysis = JSON.parse(chat.content);
  } catch (err) {
    return { status: 502, message: bookText_('Strings', 'refuse.bad_shape', '') };
  }
  var score = Math.max(0, Math.min(10, parseInt(analysis.score, 10) || 0));
  var qual = ['Qualified', 'Borderline', 'Not Qualified'].indexOf(str_(analysis.qualification)) !== -1
    ? str_(analysis.qualification) : 'Borderline';

  var reportUrl = '';
  var reportShare = null;
  try {
    var token = ScriptApp.getOAuthToken();
    var evidenceLine = transcript
      ? '\n' + hiringRenderMail_(bookText_('Strings', 'report.doc.evidence', ''),
                                 { chars: String(transcript.length) })
      : '';
    var body = hiringRenderMail_(bookText_('Strings', 'report.doc.body', ''), {
      name: str_(ev.cand.candidatename),
      date: new Date().toISOString().slice(0, 10),
      score: String(score),
      qualification: qual,
      evidence: evidenceLine,
      summary: str_(analysis.summary),
      concerns: (analysis.concerns || []).map(str_).join('\n- '),
      facts: facts
    });
    var up = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'post',
        headers: { Authorization: 'Bearer ' + token },
        contentType: 'multipart/related; boundary=hubrep',
        payload: '--hubrep\r\nContent-Type: application/json\r\n\r\n' +
          JSON.stringify({ name: hiringRenderMail_(bookText_('Strings', 'report.doc.title', ''),
                                                   { name: str_(ev.cand.candidatename) }),
                           mimeType: 'application/vnd.google-apps.document' }) +
          '\r\n--hubrep\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + body + '\r\n--hubrep--',
        muteHttpExceptions: true });
    if (up.getResponseCode() < 400) {
      var fid = JSON.parse(up.getContentText()).id;
      // admins only, never anyone-with-link: the report carries background_disclosure and a new doc is minted each…
      var reportFile = { getId: function () { return fid; },
                         getName: function () { return 'the phone screen report'; } };
      var reportGate = (typeof hubGateHolds_ === 'function')
        ? hubGateHolds_('gate_screening_report_share', {
            subject: 'the phone screen report for ' + str_(ev.cand.candidatename),
            body: 'reader access on the phone screen report, document ' + fid,
            purpose: 'a Drive grant this platform gated', to_name: 'the administrators' })
        : { held: false };
      if (!reportGate.held) {
        var admins = (typeof hubAdminEmails_ === 'function' ? hubAdminEmails_() : []);
        var granted = 0, lastWhy = '';
        admins.forEach(function (who) {
          // no Google share mail: the report reaches the team through the governed screen_report letter
          var said = {};
          if (typeof hubGrantReader_ === 'function' && hubGrantReader_(reportFile, who, said)) granted++;
          else if (said.reason) lastWhy = String(said.reason);
        });
        reportShare = { shared: granted > 0 && granted === admins.length, granted: granted, of: admins.length,
                        why: granted === admins.length ? '' : lastWhy };
      } else {
        // A HELD SHARE IS SAID IN THE ANSWER: the report exists, and no administrator can open it yet.
        reportShare = { shared: false, granted: 0, of: 0, why: String(reportGate.why || '') };
      }
      reportUrl = 'https://docs.google.com/document/d/' + fid + '/edit';
    }
  } catch (err) {}

  // date_accepted_alert_at must be listed: hubSetFieldLastRow_ silently drops missing columns and the alert re-fires
  var sheet = hubSheet_(TALENT_PHONE_TAB);
  ensureHeader_(sheet, ['qualification', 'screen_score', 'phone_screen_report_url', 'date_accepted_alert_at']);
  var fields = { qualification: qual, screen_score: String(score) };
  if (reportUrl) fields.phone_screen_report_url = reportUrl;
  // fill-blank only: the analysis, a single-purpose second reading, then the words themselves
  var when = hubResolveInterviewDate_(analysis, s);
  if (!when && transcript && !str_(s.bestinpersondaytime)) {
    when = hubForceDateAccepted_(s, transcript);
  }
  if (!when && transcript && !str_(s.bestinpersondaytime)) {
    var guess = screenSlotFromText_(transcript);
    if (guess.interview_weekday) when = hubResolveInterviewDate_(guess, s);
  }
  if (when && !str_(s.bestinpersondaytime)) fields.best_in_person_day_time = when;
  // A date that could not be read is escalated by Python from these fields (app/team_alerts.py).
  var escalation = null;
  hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, fields, user, false);
  hubBustTalentCache_();
  try { screenReportAndAdvance_(cid, score, qual, reportUrl); }
  catch (eRp) {
    hubSysLog_('asa-hub:screen-report', 'screen_report_error',
               cid + ' — ' + String((eRp && eRp.message) || eRp), { status: 500 });
  }
  return { status: 200, data: { score: score, qualification: qual,
           summary: str_(analysis.summary), concerns: (analysis.concerns || []).map(str_),
           report_url: reportUrl,
           report_share: reportShare,
           date_accepted_alerted: !!(escalation && escalation.done),
           date_accepted_alert: escalation ? { state: escalation.state, why: escalation.why } : null } };
};

/** Once per candidate (the journey line is the memo), and only from Phone Screen. */
function screenReportAndAdvance_(cid, score, qual, reportUrl) {
  var ev = hubEvidence_(cid);
  if (!ev.cand) return;
  if (str_(ev.cand.archived).toLowerCase() === 'true') return;
  if (talentStage_(str_(ev.cand.status)) !== 'phone-screen') return;
  var name = str_(ev.cand.candidatename);
  var already = false;
  try {
    (journeyFor_(cid) || []).forEach(function (j) {
      if (str_(j.step) === 'screen_report') already = true;
    });
  } catch (eJ) { return; }
  if (!already) {
    var sit = (typeof smartSituationOn_ === 'function')
      ? smartSituationOn_(commSituationId_('hiring.screen.report_ready', 'hiring_screen_report')) : null;
    if (sit) {
      var fill = function (t) {
        return String(t || '').split('{name}').join(name || cid)
          .split('{score}').join(String(score))
          .split('{qualification}').join(str_(qual) || '-')
          .split('{report_url}').join(str_(reportUrl) ||
                                      bookText_('Strings', 'report.none', ''));
      };
      var sendReason = hiringRenderMail_(bookText_('Strings', 'report.reason', ''),
                                         { who: name || cid });
      var rehearsal = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(ev.cand);
      var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
      var team = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [], sms: [] };
      var to = (addr && addr.to) || (team.emails || []).join(', ');
      var sentAny = false;
      try {
        if (to) {
          var rm = rpcCall_('emailSend', {
            to: to, cc: (addr && addr.cc) || '',
            subject: (typeof simTagSubject_ === 'function')
              ? simTagSubject_(fill(str_(sit.email_subject))) : fill(str_(sit.email_subject)),
            body: fill(str_(sit.email_text)),
            reason: sendReason
          }, { idempotency_key: 'screen_report_mail_' + cid });
          sentAny = sentAny || !!(rm && rm.sent);
        }
        var smsBody = fill(str_(sit.sms_text));
        if (smsBody) {
          (team.sms || []).forEach(function (n) {
            var num = (typeof simSendablePhone_ === 'function') ? simSendablePhone_(n) : n;
            if (!num) return;
            var rs = rpcCall_('smsSend', { to: num, body: smsBody, reason: sendReason },
              { idempotency_key: 'screen_report_sms_' + cid + '_' + String(num).replace(/\D/g, '') });
            sentAny = sentAny || !!(rs && rs.sent);
          });
        }
      } catch (eS) {
        hubSysLog_('asa-hub:screen-report', 'screen_report_send_error',
                   cid + ' — ' + String((eS && eS.message) || eS), { status: 500 });
      }
      journeyLog_({ candidate_id: cid, name: name, step: 'screen_report', channel: 'email+sms',
                    ok: sentAny,
                    title: bookText_('Strings', 'journey.screen_report.title', ''),
                    detail: hiringRenderMail_(
                      bookText_('Strings', 'journey.screen_report.detail', ''),
                      { score: String(score), qualification: str_(qual),
                        link: reportUrl ? ' · ' + reportUrl : '',
                        unsent: sentAny ? ''
                          : ' ' + bookText_('Strings', 'journey.screen_report.unsent', '') }),
                    by: 'asa-hub:screen-report' });
    }
  }
  try { hubSetStatus_(cid, HUB_STAGE_TO_STATUS['interview'], { email: 'asa-hub:screen-report' }); }
  catch (eMv) { return; }
  journeyLog_({ candidate_id: cid, name: name, step: 'phone_screen', channel: 'record',
                ok: true,
                title: bookText_('Strings', 'journey.screen_done.title', ''),
                detail: bookText_('Strings', 'journey.screen_done.detail', ''),
                by: 'asa-hub:screen-report' });
}

function hubForceDateAccepted_(s, transcript) {
  var prompt = bookText_('Prompts', 'ai_date_accepted', '')
    .split('{call_date}').join(hubCallDateLabel_(s))
    .split('{transcript}').join(transcript.slice(0, 11000));
  try {
    var chat2 = prompt ? screenAiChat_(prompt, 0, 'ai_date_accepted') : { ok: false };
    if (!chat2.ok) return '';
    var second = JSON.parse(chat2.content);
    return hubResolveInterviewDate_(second, s);
  } catch (err) {
    return '';
  }
}

// The caller stamps the row so one screening run alerts once — and only on an answer that ends it…
function hubDateAcceptedEscalate_(ev, extra, tail) {
  var c = ev.cand, s = ev.screen || {};
  var name = str_(c.candidatename) || (str_(c.firstname) + ' ' + str_(c.lastname));
  var sit = (typeof smartSituationOn_ === 'function')
    ? smartSituationOn_(commSituationId_('hiring.date_accepted', 'hiring_date_accepted')) : null;
  if (!sit) {
    hubSysLog_('asa-hub:screening', 'date_accepted_alert_skipped',
               name + ': situation_off (hiring_date_accepted)', { status: 200 });
    return { done: false, state: 'off', why: 'situation off (hiring_date_accepted)' };
  }
  var screenLine = hiringRenderMail_(bookText_('Strings', 'date_accepted.screen_line', ''), {
    score: (extra && extra.score !== undefined) ? extra.score + '/10 · ' : '',
    qualification: str_((extra && extra.qualification) || s.qualification || '—'),
    call: str_(s.transcriptcreated) || str_(s.screendate) || '—'
  });
  var vars = {
    name: name,
    phone: hubPhoneE164_(str_(c.phone)) || '—',
    email: str_(c.email) || '—',
    screen: screenLine,
    report: (extra && extra.report_url)
      ? hiringRenderMail_(bookText_('Strings', 'date_accepted.report_line', ''),
                          { url: str_(extra.report_url) }) + '\n'
      : ''
  };
  var fallback = bookText_('Strings', 'date_accepted.body', '');
  var subject = hiringRenderMail_(str_(sit.email_subject) ||
    bookText_('Strings', 'date_accepted.subject', ''), vars);
  var smsText = hiringRenderMail_(str_(sit.sms_text) || str_(sit.email_text) || fallback, vars);
  var mailText = hiringRenderMail_(str_(sit.email_text) || str_(sit.sms_text) || fallback, vars);
  var letter = hiringNoticeEmail_({
    title: subject,
    preheader: bookText_('Strings', 'date_accepted.preheader', ''),
    bodyText: mailText
  });
  // Through rpcCall_ (Hired.gs hubTeamAlert_): the escalation now carries the quiet window, the platform's sending…
  var said = hubTeamAlert_({
    subject: subject, body: smsText, html: letter.html, mail_text: mailText,
    reason: 'smart comms: ' + commSituationId_('hiring.date_accepted', 'hiring_date_accepted') +
            (tail ? ' ' + tail : ''),
    key: 'date_accepted|' + str_(c.candidateid)
  });
  var out = { done: !!said.done, state: said.state, why: str_(said.why) || said.state };
  // A ONE-SHOT: nothing asks this again on its own, so a quiet-window hold is kept for 08:00 with the facts it…
  if (said.state === 'quiet' && typeof hubTeamAlertOwe_ === 'function') {
    out.owed = !!hubTeamAlertOwe_('date_accepted', 'date_accepted|' + str_(c.candidateid), {
      cid: str_(c.candidateid),
      score: (extra && extra.score !== undefined) ? extra.score : '',
      qualification: str_(extra && extra.qualification),
      report_url: str_(extra && extra.report_url),
      call: str_(s.transcriptcreated)
    });
    out.why = out.owed ? 'held by the quiet window and kept for 08:00'
                       : 'held by the quiet window, and the morning list could NOT keep it';
  }
  hubSysLog_('asa-hub:screening', out.done ? 'date_accepted_alert_sent' : 'date_accepted_alert_held',
             name + ': ' + out.state + (out.done ? '' : ' — ' + String(out.why).slice(0, 160)),
             { status: 200 });
  return out;
}

/** Told, already told, or switched off: an answer after which nobody should ask again. */
function hubDateAcceptedSettled_(r) {
  return !!(r && (r.done || r.state === 'off'));
}

// THE MORNING, FOR A DATE ACCEPTED ESCALATION THE QUIET WINDOW HELD.
function hubDateAcceptedQuietCarry_(data) {
  var d = data || {};
  var cid = str_(d.cid);
  if (!cid) return { state: 'stale', why: 'the entry names no candidate' };
  var ev = hubEvidence_(cid);
  if (!ev || !ev.cand) return { state: 'stale', why: cid + ' is no longer a candidate' };
  if (str_(ev.cand.archived).toLowerCase() === 'true') return { state: 'stale', why: cid + ' was archived overnight' };
  var s = ev.screen || {};
  if (str_(s.bestinpersondaytime)) return { state: 'stale', why: 'a date was accepted overnight' };
  if (str_(s.dateacceptedalertat)) return { state: 'stale', why: 'the escalation was already raised' };
  var said = hubDateAcceptedEscalate_({ cand: ev.cand, screen: s },
    { score: (d.score === '' || d.score === undefined) ? undefined : d.score,
      qualification: d.qualification, report_url: d.report_url },
    '(held overnight by the quiet window)');
  if (hubDateAcceptedSettled_(said)) {
    try {
      hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, { date_accepted_alert_at: new Date().toISOString() },
                          { email: 'auto-quiet-carry' }, false);
    } catch (eS) { /* the receipt stops a second telling for six hours */ }
  }
  return { state: 'carried', why: said.done ? 'the team was told' : ('not told: ' + said.why) };
}

/** An admin rehearsal of the failure path on a test card: a real second reading that honestly fails, then error_hold until Use The Last; the escalation is Python's (app/team_alerts.py). */
HUB_POLICY.screenForceError = {
  file: 'Screening.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.screenForceError = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (talentStage_(ev.cand.status) !== 'phone-screen') {
    return { status: 409, message: bookText_('Strings', 'refuse.force_error.stage', '') };
  }
  if (typeof commsIsTestCandidate_ === 'function' && !commsIsTestCandidate_(ev.cand)) {
    return { status: 409, message: bookText_('Strings', 'refuse.force_error.test_only', '') };
  }
  var now = new Date().toISOString();
  var name = str_(ev.cand.candidatename);
  var mockTranscript = bookText_('Strings', 'force_error.transcript', '')
    .split('{name}').join(name);
  ensureHeader_(hubSheet_(TALENT_PHONE_TAB), [
    'transcript_text', 'transcript_call_id', 'transcript_created', 'transcript_pulled_at',
    'qualification', 'screen_score', 'phone_screen_report_url', 'date_accepted_alert_at', 'error_hold'
  ]);
  // Do NOT gate this on a key being present: that rehearses the wrong failure.
  var when = hubForceDateAccepted_({ transcriptcreated: now }, mockTranscript);
  var fields = {
    screen_status: 'Completed', screen_date: now,
    transcript_text: mockTranscript,
    transcript_call_id: 'FORCE_ERR_' + randomHex_(10).toUpperCase(),
    transcript_created: now, transcript_pulled_at: now,
    screen_score: '7', qualification: 'Qualified',
    notes: bookText_('Strings', 'force_error.notes', ''),
    phone_screen_report_url: '', final_result: '',
    best_in_person_day_time: '',
    error_hold: 'true',
    screened_by: 'asa-hub:force-error:' + str_(user.email)
  };
  // The escalation is raised by Python from these fields (app/team_alerts.py).
  var alerted = false, escalation = null;
  hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, fields, user, true);
  hubBustTalentCache_();
  hubSysLog_(user && user.email, 'screen_force_error',
    cid + ' — populated, hold on; alerted=' + alerted +
    (escalation && !alerted ? ' (' + escalation.state + ': ' + String(escalation.why).slice(0, 120) + ')' : ''),
    { status: 200 });
  return { status: 200, data: { forced: true, alerted: alerted,
    alert: escalation ? { state: escalation.state, why: escalation.why } : null,
    message: bookText_('Strings',
      alerted ? 'force_error.said.alerted' : 'force_error.said.silent', '') } };
};

// one definition for both manual doors; only blanks are filled, so captured evidence stays
var SCREEN_MANUAL_COLUMNS = ['manual_screen', 'transcript_text', 'qualification',
                             'screen_score', 'phone_screen_report_url'];

function screenManualAttestFields_(s, user, now) {
  s = s || {};
  var fields = {
    manual_screen: 'true',
    screen_status: 'Completed',
    screened_by: 'asa-hub:manual-screen:' + str_(user && user.email)
  };
  if (!str_(s.screendate)) fields.screen_date = now;
  if (!str_(s.transcripttext) && !str_(s.transcripturl)) {
    fields.transcript_text = hiringRenderMail_(
      bookText_('Strings', 'manual_screen.attestation', ''),
      { who: str_(user && user.email), when: now });
  }
  return fields;
}

/** A recruiter screens by voice and one press attests it. */
HUB_POLICY.screenManualComplete = {
  file: 'Screening.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.screenManualComplete = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (talentStage_(ev.cand.status) !== 'phone-screen') {
    return { status: 409, message: bookText_('Strings', 'refuse.manual_screen.stage', '') };
  }
  var s = ev.screen || {};
  var now = new Date().toISOString();
  ensureHeader_(hubSheet_(TALENT_PHONE_TAB), SCREEN_MANUAL_COLUMNS);
  // attests the call, never decides it: advance or decline stays with the caller at hubGate_
  var fields = screenManualAttestFields_(s, user, now);
  var manualNotes = str_(payload.notes).slice(0, 2000);
  if (manualNotes) {
    var existingNotes = str_(s.notes);
    // The seam supplies the space: a sheet trims a trailing one off a cell.
    var notesPrefix = bookText_('Strings', 'manual_screen.notes_prefix', '');
    fields.notes = (existingNotes ? existingNotes + '\n' : '') +
      (notesPrefix ? notesPrefix + ' ' : '') + manualNotes;
  }
  hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, fields, user, true);
  hubBustTalentCache_();
  hubSysLog_(user && user.email, 'screen_manual_complete',
    cid + ' — ' + bookText_('Strings', 'manual_screen.logged', ''), { status: 200 });
  return { status: 200, data: { completed: true, moved: false, stage: 'phone-screen',
                                awaiting: 'advance-decision' } };
};

function hubCanManualDate_(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  var ov = user.overrides || {};
  return ov['hiring.dateManual'] === true;
}

/** Written as typed: an explicit human choice outranks the automatic lane's guards. */
HUB_POLICY.screenSetDateAccepted = {
  file: 'Screening.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], perm: 'hiring.dateManual',
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.screenSetDateAccepted = function (payload, user) {
  if (!hubCanManualDate_(user)) {
    return { status: 403, message: bookText_('Strings', 'refuse.date_manual.access', '') };
  }
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var dayTime = str_(payload.day_time);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dayTime)) {
    return { status: 400, message: bookText_('Strings', 'refuse.date_manual.format', '') };
  }
  // shape is not truth: round-trip the components and refuse anything a Date normalized away
  var mdt = dayTime.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  var dt = new Date(Number(mdt[1]), Number(mdt[2]) - 1, Number(mdt[3]), Number(mdt[4]), Number(mdt[5]));
  if (isNaN(dt.getTime()) || dt.getFullYear() !== Number(mdt[1]) || dt.getMonth() !== Number(mdt[2]) - 1 ||
      dt.getDate() !== Number(mdt[3]) || dt.getHours() !== Number(mdt[4]) || dt.getMinutes() !== Number(mdt[5])) {
    return { status: 400, message: bookText_('Strings', 'refuse.date_manual.not_real', '') };
  }
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (!ev.screen) return { status: 409, message: bookText_('Strings', 'refuse.no_screening_card', '') };
  ensureHeader_(hubSheet_(TALENT_PHONE_TAB), ['date_accepted_manual_by']);
  hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, {
    best_in_person_day_time: dayTime,
    date_accepted_manual_by: 'asa-hub:manual:' + str_(user.email)
  }, user, false);
  hubBustTalentCache_();
  hubSysLog_(user && user.email, 'screen_manual_date', cid + ' — ' + dayTime, { status: 200 });
  return { status: 200, data: { set: true, day_time: dayTime } };
};

/** Run once from the editor: a trigger cannot show the AI hosts' consent screen. */
function runAiPing() {
  var out = { groq: '', openai: '', relay: '' };
  var pingCfg = screenAiConfig_();

  for (var i = 0; i < SCREEN_AI_PROVIDERS.length; i++) {
    var p = SCREEN_AI_PROVIDERS[i];
    var key = String(hubProp_(p.prop) || '');
    if (!key) { out[p.name] = 'no key in ' + p.prop; continue; }
    try {
      var r = UrlFetchApp.fetch(p.url, {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({ model: screenAiModel_(p, pingCfg), temperature: 0,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }),
        muteHttpExceptions: true
      });
      var body = r.getContentText();
      out[p.name] = r.getResponseCode() === 200
        ? 'OK — ' + str_(JSON.parse(body).choices[0].message.content).slice(0, 20)
        : r.getResponseCode() + ': ' + body.slice(0, 120);
    } catch (e) { out[p.name] = 'THREW: ' + String((e && e.message) || e).slice(0, 140); }
  }

  var relay = SCREEN_AI_RELAY_DEFAULT;
  var set = String(hubProp_(SCREEN_AI_RELAY_PROP) || '');
  if (set) relay = set;
  try {
    var rr = UrlFetchApp.fetch(relay, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ service_secret: String(hubProp_('HUB_SERVICE_SECRET') || ''),
        temperature: 0, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }),
      muteHttpExceptions: true
    });
    out.relay = rr.getResponseCode() + ': ' + rr.getContentText().slice(0, 120);
  } catch (e2) { out.relay = 'THREW: ' + String((e2 && e2.message) || e2).slice(0, 140); }

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
