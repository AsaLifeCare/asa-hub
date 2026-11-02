// Verdicts: ok, dead (401/403), throttled (capped, never garbage), sick, wrong_model (key fine, model refused).

// Two rounds is the floor that makes n_ok * 2 >= rounds a majority.
var KEY_STRESS_ROUNDS_DEFAULT = 2;
var KEY_STRESS_ROUNDS_MAX = 5;
var KEY_STRESS_GAP_MS = 1200;
// Must name JSON: OpenAI and Groq refuse json_object mode otherwise, grading every key sick.
var KEY_STRESS_PROMPT =
  'Reply as JSON: {"what": "one short sentence on what an API rate limit is"}';

var KEY_STRESS_DEAD_SIGNATURES = [
  'invalid api key', 'invalid_api_key', 'incorrect api key',
  'api key not valid', 'unauthorized', 'no auth credentials'
];
var KEY_STRESS_MODEL_SIGNATURES = [
  'model_not_found', 'model not found', 'does not exist',
  'decommissioned', 'unknown model', 'invalid model', 'no such model',
  // A retired model's 410 reaches us through the relay as 502, so only the words catch it.
  'end of life', 'no longer available', 'has been retired', 'sunset'
];
var KEY_STRESS_QUOTA_SIGNATURES = [
  'rate limit', 'rate_limit', 'quota', 'insufficient_quota',
  'too many requests', 'billing'
];

function keyStressHas_(text, list) {
  var t = String(text || '').toLowerCase();
  for (var i = 0; i < list.length; i++) if (t.indexOf(list[i]) !== -1) return true;
  return false;
}

function keyStressMask_(key) {
  var k = String(key || '');
  if (k.length <= 10) return k ? '••••' : '';
  return k.slice(0, 4) + '…' + k.slice(-4);
}

// Order is the rule: dead first, wrong_model before sick, throttled only when nothing else failed.
function keyStressVerdict_(t, rounds) {
  if (t.n_auth > 0) return 'dead';
  if (t.n_model > 0 && t.n_ok === 0) return 'wrong_model';
  if (t.n_ok * 2 >= rounds) return 'ok';
  if (t.n_429 > 0 && (t.n_5xx + t.n_timeout + t.n_empty + t.n_model) === 0) return 'throttled';
  return 'sick';
}

function keyStressRequest_(p, key, model) {
  // The relay takes the service secret in the body and answers an envelope.
  if (p.isRelay) {
    return {
      url: p.url,
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        service_secret: key,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: KEY_STRESS_PROMPT }]
      }),
      muteHttpExceptions: true
    };
  }
  return {
    url: p.url,
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    // The ladder's own body builder, never a copy.
    payload: JSON.stringify(
      screenAiPayload_(model, [{ role: 'user', content: KEY_STRESS_PROMPT }], 0.2)),
    muteHttpExceptions: true
  };
}

// The relay answers 200 carrying its own status; unwrapped before scoring so the reason survives.
function keyStressRelayUnwrap_(body) {
  var out = { code: 0, text: '', content: '', tokens: 0 };
  var env = null;
  try { env = JSON.parse(body); } catch (e) { env = null; }
  if (!env) { out.code = 502; out.text = String(body || '').slice(0, 140); return out; }
  var inner = Number(env.status || 0);
  if (inner >= 400) {
    out.code = inner;
    // Never truncated: the model signatures are matched against the whole message.
    out.text = String(env.message || '');
    return out;
  }
  out.code = 200;
  var data = env.data || env;
  try {
    out.content = ((((data.choices || [{}])[0] || {}).message || {}).content) || '';
    out.tokens = Number(((data.usage || {}).completion_tokens) || 0) || 0;
  } catch (eC) { out.content = ''; }
  // A fleet that refuses the model answers inside `error`, not `choices`.
  if (!out.content && data.error) {
    out.code = Number((data.error || {}).code || 502) || 502;
    out.text = String((data.error || {}).message || '');
  }
  return out;
}

function keyStressScore_(rec, resp, isRelay) {
  var code = 0, body = '';
  try { code = resp.getResponseCode(); } catch (e) { code = 0; }
  try { body = resp.getContentText(); } catch (e) { body = ''; }
  if (isRelay && code < 400) {
    var un = keyStressRelayUnwrap_(body);
    code = un.code;
    body = un.text || (un.content ? JSON.stringify({ choices: [{ message: { content: un.content } }],
                                                     usage: { completion_tokens: un.tokens } }) : '');
  }
  var short = String(body || '').slice(0, 140).replace(/\s+/g, ' ').trim();

  if (!code) {
    rec.n_5xx++;
    rec.sample = rec.sample || 'no response';
    return;
  }
  if (code < 400) {
    var text = '', toks = 0;
    try {
      var env = JSON.parse(body);
      text = ((((env.choices || [{}])[0] || {}).message || {}).content) || '';
      toks = Number(((env.usage || {}).completion_tokens) || 0) || 0;
    } catch (eP) { text = ''; }
    // A 200 carrying nothing is not an answer.
    if (text || toks > 0) { rec.n_ok++; rec.tokens += toks; }
    else { rec.n_empty++; rec.sample = rec.sample || '2xx but empty output'; }
    return;
  }
  if (code === 401 || code === 403 ||
      (code === 400 && keyStressHas_(body, KEY_STRESS_DEAD_SIGNATURES))) {
    rec.n_auth++;
    rec.sample = rec.sample || ('HTTP ' + code + ': ' + short);
    return;
  }
  // Code or body: a refused model arrives as 404, 400 or the relay's 502; only the words are constant.
  if (code === 404 || keyStressHas_(body, KEY_STRESS_MODEL_SIGNATURES)) {
    rec.n_model++;
    rec.sample = rec.sample || ('HTTP ' + code + ': ' + short);
    return;
  }
  if (code === 429 || code === 402 || keyStressHas_(body, KEY_STRESS_QUOTA_SIGNATURES)) {
    rec.n_429++;
    rec.sample = rec.sample || ('HTTP ' + code + ': ' + short);
    return;
  }
  rec.n_5xx++;
  rec.sample = rec.sample || ('HTTP ' + code + ': ' + short);
}

function keyStressModelsOffered_(p, key) {
  try {
    var url = String(p.url || '').replace(/\/chat\/completions\s*$/, '') + '/models';
    var r = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + key },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() >= 400) return [];
    var data = (JSON.parse(r.getContentText()) || {}).data || [];
    var out = [];
    for (var i = 0; i < data.length && out.length < 40; i++) {
      var id = String((data[i] || {}).id || '').trim();
      if (id) out.push(id);
    }
    return out.sort();
  } catch (e) {
    return [];
  }
}

HUB_POLICY.aiKeyStress = {
  file: 'KeyStress.gs', lane: 'tool', store: 'external',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: []
};
/** Run the stress test over the phone screen's own provider ladder. */
HUB_ACTIONS.aiKeyStress = function (payload, user) {
  if (!user || String(user.role) !== 'admin' || user.is_service) return hubDenied_();

  var rounds = Number((payload && payload.rounds) || KEY_STRESS_ROUNDS_DEFAULT);
  if (!(rounds >= 1)) rounds = KEY_STRESS_ROUNDS_DEFAULT;
  rounds = Math.min(Math.round(rounds), KEY_STRESS_ROUNDS_MAX);

  var t0 = new Date().getTime();

  // The same configured model the ladder sends, read once.
  var aiCfg = (typeof screenAiConfig_ === 'function') ? screenAiConfig_() : null;
  var cast = [];
  var skipped = [];
  for (var i = 0; i < SCREEN_AI_PROVIDERS.length; i++) {
    var p = SCREEN_AI_PROVIDERS[i];
    var key = '';
    try { key = String(hubProp_(p.prop) || ''); } catch (eK) { key = ''; }
    if (!key) { skipped.push({ provider: p.name, why: 'no key in ' + p.prop }); continue; }
    // A retired key stays out of the ladder but in the measurement, so it can prove it came back.
    var retiredNow = aiKeyIsRetired_(p.prop);
    cast.push({
      p: p, key: key, model: screenAiModel_(p, aiCfg), retired: retiredNow,
      rec: { n_ok: 0, n_auth: 0, n_429: 0, n_5xx: 0, n_timeout: 0,
             n_empty: 0, n_model: 0, tokens: 0, sample: '', lat: [] }
    });
  }

  // The relay leg reaches the platform's own model fleet, which Apps Script cannot address.
  var relayUrl = SCREEN_AI_RELAY_DEFAULT;
  try { var setUrl = String(hubProp_(SCREEN_AI_RELAY_PROP) || ''); if (setUrl) relayUrl = setUrl; }
  catch (eRU) { }
  var relaySecret = '';
  try { relaySecret = String(hubProp_('HUB_SERVICE_SECRET') || ''); } catch (eRS) { relaySecret = ''; }
  if (relayUrl && relaySecret) {
    cast.push({
      p: { name: 'relay', prop: 'HUB_SERVICE_SECRET', url: relayUrl, isRelay: true },
      key: relaySecret, model: '(the relay decides — HUB_ANALYZE_MODEL)',
      rec: { n_ok: 0, n_auth: 0, n_429: 0, n_5xx: 0, n_timeout: 0,
             n_empty: 0, n_model: 0, tokens: 0, sample: '', lat: [] }
    });
  } else {
    skipped.push({ provider: 'relay', why: relayUrl ? 'no HUB_SERVICE_SECRET' : 'no relay url' });
  }

  if (!cast.length) {
    return { status: 200, data: {
      ok: false, rounds: rounds, tested: 0, skipped: skipped,
      verdict_line: 'No provider has a key — nothing to test.',
      providers: [], totals: { ok: 0, dead: 0, throttled: 0, sick: 0, wrong_model: 0, tokens: 0 }
    } };
  }

  for (var r = 0; r < rounds; r++) {
    // The relay is fetched alone: one unreachable host makes fetchAll throw for the whole batch.
    var batch = [], batchIdx = [], relayItem = null;
    for (var c = 0; c < cast.length; c++) {
      if (cast[c].p.isRelay) { relayItem = cast[c]; continue; }
      batch.push(keyStressRequest_(cast[c].p, cast[c].key, cast[c].model));
      batchIdx.push(c);
    }
    var started = new Date().getTime();
    var resps = [];
    try {
      resps = batch.length ? UrlFetchApp.fetchAll(batch) : [];
    } catch (eF) {
      for (var t = 0; t < batchIdx.length; t++) {
        var vt = cast[batchIdx[t]];
        vt.rec.n_timeout++;
        vt.rec.sample = vt.rec.sample ||
          ('batch failed: ' + String((eF && eF.message) || eF).slice(0, 90));
      }
      resps = [];
    }
    var spent = new Date().getTime() - started;
    for (var k = 0; k < resps.length; k++) {
      var target = cast[batchIdx[k]];
      target.rec.lat.push(spent);
      keyStressScore_(target.rec, resps[k], false);
    }
    if (relayItem) {
      var rt0 = new Date().getTime();
      try {
        var rResp = UrlFetchApp.fetch(relayItem.p.url,
                                      keyStressRequest_(relayItem.p, relayItem.key, relayItem.model));
        relayItem.rec.lat.push(new Date().getTime() - rt0);
        keyStressScore_(relayItem.rec, rResp, true);
      } catch (eRelay) {
        relayItem.rec.lat.push(new Date().getTime() - rt0);
        relayItem.rec.n_timeout++;
        relayItem.rec.sample = relayItem.rec.sample ||
          ('unreachable: ' + String((eRelay && eRelay.message) || eRelay).slice(0, 90));
      }
    }
    if (r < rounds - 1) Utilities.sleep(KEY_STRESS_GAP_MS);
  }

  var totals = { ok: 0, dead: 0, throttled: 0, sick: 0, wrong_model: 0, tokens: 0 };
  var rows = [];
  var offeredBy = {};
  for (var j = 0; j < cast.length; j++) {
    var it = cast[j];
    var v = keyStressVerdict_(it.rec, rounds);
    totals[v] = (totals[v] || 0) + 1;
    totals.tokens += it.rec.tokens;

    var avg = 0;
    if (it.rec.lat.length) {
      var s = 0;
      for (var l = 0; l < it.rec.lat.length; l++) s += it.rec.lat[l];
      avg = Math.round(s / it.rec.lat.length);
    }
    if (v === 'wrong_model' && !offeredBy[it.p.url]) {
      offeredBy[it.p.url] = keyStressModelsOffered_(it.p, it.key);
    }
    // A verdict that survived failures says how many, or ok beside a failed sample reads as a lie.
    var bad = it.rec.n_model + it.rec.n_5xx + it.rec.n_timeout +
              it.rec.n_empty + it.rec.n_429;
    var sampleOut = it.rec.sample;
    if (it.rec.n_ok > 0 && bad > 0) {
      sampleOut = 'answered ' + it.rec.n_ok + ' of ' + rounds +
                  ' — the other round(s) failed: ' + (it.rec.sample || 'no detail');
    }
    rows.push({
      provider: it.p.name,
      // The host, not the name: the never-empty-a-provider lock counts keys per host.
      host: String(it.p.url || ''),
      retired: !!it.retired,
      key_prop: it.p.prop,
      key_masked: keyStressMask_(it.key),
      model: it.model,
      verdict: v,
      n_ok: it.rec.n_ok, n_auth: it.rec.n_auth, n_429: it.rec.n_429,
      n_5xx: it.rec.n_5xx, n_timeout: it.rec.n_timeout,
      n_empty: it.rec.n_empty, n_model: it.rec.n_model,
      tokens: it.rec.tokens, avg_ms: avg,
      sample: sampleOut
    });
  }

  var line = '';
  var working = totals.ok + totals.throttled;
  if (totals.wrong_model > 0 && totals.ok === 0) {
    var names = [];
    for (var u in offeredBy) {
      if (offeredBy[u] && offeredBy[u].length) names = names.concat(offeredBy[u].slice(0, 8));
    }
    line = totals.wrong_model + ' key(s) authenticate but the MODEL is refused — the keys are ' +
           'valid, the model name is not. Set GROQ_MODEL / OPENAI_MODEL in Script Properties' +
           (names.length ? '. The provider currently serves: ' + names.join(', ') : '.');
  } else if (working === 0) {
    line = 'No provider can answer: ' + totals.dead + ' dead, ' + totals.sick +
           ' sick, ' + totals.throttled + ' throttled. The phone screen has no AI.';
  } else if (totals.ok === 0) {
    line = 'Nothing generated, but ' + totals.throttled + ' key(s) are merely capped — ' +
           'valid keys waiting on quota, not garbage. Do not remove them.';
  } else {
    line = totals.ok + ' key(s) answering' +
           (totals.throttled ? ', ' + totals.throttled + ' capped' : '') +
           (totals.dead ? ', ' + totals.dead + ' dead' : '') +
           (totals.wrong_model ? ', ' + totals.wrong_model + ' on a refused model' : '') +
           (totals.sick ? ', ' + totals.sick + ' sick' : '') + '.';
  }

  var ms = new Date().getTime() - t0;
  hubSysLog_(String(user.email || ''), 'ai_key_stress',
             line + ' (' + rounds + ' rounds, ' + cast.length + ' keys, ' + ms + 'ms)',
             { status: totals.ok ? 200 : 502 });

  return { status: 200, data: {
    ok: totals.ok > 0,
    rounds: rounds,
    tested: cast.length,
    skipped: skipped,
    ms: ms,
    totals: totals,
    rows: rows,
    models_offered: offeredBy,
    verdict_line: line
  } };
};


// Removal is a quarantine: these keys live in the Props.gs file, so deleting the store property removes nothing the…
var AI_KEYS_RETIRED_PROP = 'AI_KEYS_RETIRED';
var AI_KEY_SWEEP_STAMP = 'AI_KEY_SWEEP_AT';
var AI_KEY_SWEEP_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
var AI_KEY_CONFIRM_ROUNDS = 2;

function aiKeysRetired_() {
  try {
    var raw = String(hubProp_(AI_KEYS_RETIRED_PROP) || '');
    if (!raw) return {};
    var m = JSON.parse(raw);
    return (m && typeof m === 'object') ? m : {};
  } catch (e) { return {}; }
}

function aiKeyIsRetired_(prop) {
  if (!prop) return false;
  var m = aiKeysRetired_();
  return Object.prototype.hasOwnProperty.call(m, String(prop));
}

function aiKeyUnretire_(prop) {
  var m = aiKeysRetired_();
  if (!Object.prototype.hasOwnProperty.call(m, String(prop))) return false;
  delete m[String(prop)];
  if (typeof hubPropSet_ === 'function') hubPropSet_(AI_KEYS_RETIRED_PROP, JSON.stringify(m));
  return true;
}

function aiKeyRetire_(prop, provider, why, masked) {
  var m = aiKeysRetired_();
  m[String(prop)] = {
    at: new Date().toISOString(),
    provider: String(provider || ''),
    why: String(why || '').slice(0, 200),
    key_masked: String(masked || '')
  };
  if (typeof hubPropSet_ === 'function') hubPropSet_(AI_KEYS_RETIRED_PROP, JSON.stringify(m));
  else PropertiesService.getScriptProperties().setProperty(AI_KEYS_RETIRED_PROP, JSON.stringify(m));
  // Through hubPropDelete_, which clears HUB_ID_CACHE; a no-op when the value lives in Props.gs.
  try {
    if (typeof hubPropDelete_ === 'function') hubPropDelete_(String(prop));
    else PropertiesService.getScriptProperties().deleteProperty(String(prop));
  } catch (eD) { }
}

function aiKeyConfirmDead_(p, key, model) {
  var rec = { n_ok: 0, n_auth: 0, n_429: 0, n_5xx: 0, n_timeout: 0,
              n_empty: 0, n_model: 0, tokens: 0, sample: '', lat: [] };
  for (var i = 0; i < AI_KEY_CONFIRM_ROUNDS; i++) {
    var resp = null;
    try { resp = UrlFetchApp.fetch(p.url, keyStressRequest_(p, key, model)); }
    catch (e) { rec.n_timeout++; continue; }
    keyStressScore_(rec, resp, !!p.isRelay);
    if (i < AI_KEY_CONFIRM_ROUNDS - 1) Utilities.sleep(600);
  }
  return rec.n_auth === AI_KEY_CONFIRM_ROUNDS;
}

// Weekly, ridden by the sweep chain: hubHiredSweepMaybe_ is the clock.
function aiKeySweepMaybe_() {
  var now = new Date().getTime();
  var last = 0;
  try { last = Number(hubProp_(AI_KEY_SWEEP_STAMP) || 0) || 0; } catch (e) { last = 0; }
  if (last && (now - last) < AI_KEY_SWEEP_EVERY_MS) return;
  // NOT INSIDE THE QUIET WINDOW.
  try { if (typeof hubQuietAt_ === 'function' && hubQuietAt_()) return; } catch (eQ) { /* the clock is the day */ }
  // Stamp first: a run that throws halfway must not re-enter and spend quota again.
  if (typeof hubPropSet_ === 'function') hubPropSet_(AI_KEY_SWEEP_STAMP, String(now));

  var res = null;
  try {
    res = HUB_ACTIONS.aiKeyStress({ rounds: KEY_STRESS_ROUNDS_DEFAULT },
                                  { role: 'admin', email: 'asa-hub:weekly', is_service: false });
  } catch (e) {
    hubSysLog_('auto-ai-keys', 'ai_key_sweep_error',
               String((e && e.message) || e), { status: 500 });
    return;
  }
  var data = (res && res.data) || {};
  var rows = data.rows || [];

  var aliveByHost = {};
  for (var a = 0; a < rows.length; a++) {
    var hostA = String(rows[a].host || rows[a].provider || '');
    if (rows[a].verdict !== 'dead') aliveByHost[hostA] = (aliveByHost[hostA] || 0) + 1;
  }

  var aiCfg = (typeof screenAiConfig_ === 'function') ? screenAiConfig_() : null;
  var retired = [];
  var restored = [];
  var kept = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.retired) {
      if (row.verdict === 'ok' || row.verdict === 'throttled') {
        var backProp = row.key_prop;
        if (backProp && aiKeyUnretire_(backProp)) {
          restored.push({ provider: row.provider, prop: backProp, verdict: row.verdict });
        }
      }
      continue;
    }
    if (row.verdict !== 'dead') continue;
    if (row.provider === 'relay') { kept.push(row.provider + ' (the relay secret is not ours to retire)'); continue; }
    if (row.n_auth !== data.rounds) {
      kept.push(row.provider + ' (rejected ' + row.n_auth + ' of ' + data.rounds + ' rounds, not all)');
      continue;
    }
    var hostR = String(row.host || row.provider || '');
    if ((aliveByHost[hostR] || 0) === 0) {
      kept.push(row.provider + ' (it is the last key ' + hostR + ' has — a provider is never emptied)');
      continue;
    }
    var prov = null;
    for (var q = 0; q < SCREEN_AI_PROVIDERS.length; q++) {
      if (SCREEN_AI_PROVIDERS[q].name === row.provider) { prov = SCREEN_AI_PROVIDERS[q]; break; }
    }
    if (!prov) continue;
    var live = '';
    try { live = String(hubProp_(prov.prop) || ''); } catch (eL) { live = ''; }
    if (!live) continue;
    if (!aiKeyConfirmDead_(prov, live, screenAiModel_(prov, aiCfg))) {
      kept.push(row.provider + ' (the fresh re-check did not reject it — a blip, not a dead key)');
      continue;
    }
    aiKeyRetire_(prov.prop, row.provider, row.sample, row.key_masked);
    retired.push({ provider: row.provider, prop: prov.prop,
                   masked: row.key_masked, why: row.sample });
  }

  var lines = [];
  lines.push('Weekly AI key check — ' + data.verdict_line);
  lines.push('');
  lines.push('Tested ' + (data.tested || 0) + ' key(s) over ' + (data.rounds || 0) + ' rounds: ' +
             (data.totals.ok || 0) + ' ok, ' + (data.totals.throttled || 0) + ' capped, ' +
             (data.totals.wrong_model || 0) + ' on a refused model, ' +
             (data.totals.sick || 0) + ' sick, ' + (data.totals.dead || 0) + ' dead.');
  var sk = data.skipped || [];
  if (sk.length) {
    lines.push('');
    lines.push('NOT TESTED (' + sk.length + '):');
    for (var s2 = 0; s2 < sk.length; s2++) {
      lines.push('  · ' + sk[s2].provider + ' — ' + sk[s2].why);
    }
  }
  if (restored.length) {
    lines.push('');
    lines.push('BACK IN SERVICE (a retired key answered again):');
    for (var r3 = 0; r3 < restored.length; r3++) {
      lines.push('  · ' + restored[r3].prop + '  (' + restored[r3].provider +
                 ', now ' + restored[r3].verdict + ')');
    }
  }
  if (retired.length) {
    lines.push('');
    lines.push('RETIRED (the key was rejected outright, twice, and re-checked fresh):');
    for (var r2 = 0; r2 < retired.length; r2++) {
      lines.push('  · ' + retired[r2].prop + '  (' + retired[r2].provider + ', ' +
                 retired[r2].masked + ') — ' + retired[r2].why);
    }
    lines.push('');
    lines.push('They are already OUT of the ladder — nothing dials them again. To erase the');
    lines.push('value itself, blank that line in Props.gs; it is the one place a person must act.');
  }
  if (kept.length) {
    lines.push('');
    lines.push('Looked dead and was KEPT: ' + kept.join('; '));
  }
  if ((data.totals.wrong_model || 0) > 0) {
    lines.push('');
    lines.push('A refused MODEL is not a bad key and nothing was removed for it. Point');
    lines.push('GROQ_MODEL / OPENAI_MODEL at a model the provider still serves.');
  }
  var text = lines.join('\n');

  hubSysLog_('asa-hub:ai-keys', 'ai_key_sweep',
             (retired.length ? retired.length + ' retired · ' : '') +
             (restored.length ? restored.length + ' restored · ' : '') + (data.verdict_line || ''),
             { status: retired.length ? 502 : 200 });

  // Told every week: a watch that only speaks on bad news looks like a broken one.
  try {
    aiKeyNotice_(data.verdict_line || '', retired.length, text);
  } catch (eN) {
    hubSysLog_('auto-ai-keys', 'ai_key_sweep_notify_failed',
               String((eN && eN.message) || eN), { status: 500 });
  }
}

// THE WEEKLY NOTICE, AS A SITUATION (SmartGate.gs `ai_keys_weekly_check`).
function aiKeyNotice_(verdictLine, retiredCount, report) {
  // A reader missing from a partial push is a switch nobody can read: it holds.
  var got = (typeof hubSituationRead_ === 'function')
    ? hubSituationRead_('ai_keys_weekly_check')
    : { row: null, on: false, unreadable: 'the situations reader is not in this build' };
  if (got.unreadable) {
    hubSysLog_('auto-ai-keys', 'ai_key_notice_held',
               got.unreadable + ' — the weekly notice is held, not sent: an unreadable switch is never a yes',
               { status: 502 });
    return { done: false, state: 'unreadable', why: got.unreadable };
  }
  if (got.row && !got.on) {
    hubSysLog_('auto-ai-keys', 'ai_key_notice_skipped',
               'situation_off (ai_keys_weekly_check) — the sweep ran, nobody was told', { status: 200 });
    return { done: false, state: 'off', why: 'situation off (ai_keys_weekly_check)' };
  }
  var day = new Date().toISOString().slice(0, 10);
  var measured = { verdict: String(verdictLine || ''), retired_count: Number(retiredCount) || 0,
                   report: String(report || ''), day: day };
  var said = aiKeyNoticeSay_(got.row || {}, measured, '');
  // A sweep that started at 21:25 can finish inside the window: what it MEASURED is kept for 08:00 — the verdict…
  if (said.state === 'quiet' && typeof hubTeamAlertOwe_ === 'function') {
    var fit = aiKeyReportToKeep_(measured.report);
    said.owed = !!hubTeamAlertOwe_('ai_keys', 'ai_keys|' + day, {
      verdict: measured.verdict, retired_count: measured.retired_count,
      report: fit.text, report_cut: fit.cut, day: day
    });
  }
  return said;
}

/** The notice in the row's words with the measurement filled in, through the one door. */
function aiKeyNoticeSay_(row, measured, tail) {
  var r = row || {};
  var m = measured || {};
  var n = Number(m.retired_count) || 0;
  var vars = {
    verdict: String(m.verdict || ''),
    retired_line: n ? ' ' + n + ' retired.' : '',
    retired_count: n ? ' (' + n + ' retired)' : '',
    report: String(m.report || '')
  };
  var render = (typeof hubLetterRender_ === 'function') ? hubLetterRender_ : function (t) { return String(t || ''); };
  // THE LEGS ARE THE ROW'S: `channels` names which of the text and the letter go; a blank cell (or a row not…
  var named = str_(r.channels) ? smartList_(r.channels) : null;
  var legs = named ? named.filter(function (c) { return c === 'sms' || c === 'email'; }) : null;
  if (legs && !legs.length) {
    return { sms: 0, email: 0, ok: true, told: false, deduplicated: false, quiet: false, held: true,
             done: false, state: 'off', why: 'the situation ai_keys_weekly_check names no channel this door sends' };
  }
  // The SMS leg sends the body verbatim, so it gets one line; the report goes by e-mail.
  return hubTeamAlert_({
    subject: render(str_(r.email_subject) || 'AI keys — weekly check{retired_count}', vars),
    body: render(str_(r.sms_text) || 'AI keys — {verdict}{retired_line}', vars),
    mail_text: render(str_(r.email_text) || '{report}', vars),
    legs: legs ? legs.join(', ') : '',
    reason: 'smart comms: ai_keys_weekly_check' + (tail ? ' ' + tail : ''),
    key: 'ai_keys_weekly|' + String(m.day || new Date().toISOString().slice(0, 10))
  });
}

// The share of a morning-list entry the report may take (Rpc.gs HUB_QUIET_OWED_BYTES): the rest carries the…
var AI_KEY_REPORT_KEEP_ROOM = 1200;

// THE REPORT, SIZED FOR THE MORNING LIST — { text, cut }.
function aiKeyReportToKeep_(report) {
  var text = String(report || '');
  var cap = ((typeof HUB_QUIET_OWED_BYTES !== 'undefined') ? HUB_QUIET_OWED_BYTES : 6000) - AI_KEY_REPORT_KEEP_ROOM;
  if (JSON.stringify(text).length <= cap) return { text: text, cut: false };
  var tail = '\n\n[The rest of this report did not fit the list the quiet window keeps, and was cut. ' +
             'The next weekly check measures every key again.]';
  var keep = text;
  while (keep.length && JSON.stringify(keep + tail).length > cap) {
    var over = JSON.stringify(keep + tail).length - cap;
    keep = keep.slice(0, Math.max(0, keep.length - Math.max(over, 40)));
    var nl = keep.lastIndexOf('\n');
    if (nl > keep.length - 200 && nl > 0) keep = keep.slice(0, nl);
  }
  return { text: keep + tail, cut: true };
}

// The morning, for a weekly notice the quiet window held: said in the row's words while its switch is still on.
function aiKeyNoticeQuietCarry_(data, entry) {
  var d = data || {};
  var got = (typeof hubSituationRead_ === 'function')
    ? hubSituationRead_('ai_keys_weekly_check') : { row: null, on: false, unreadable: 'the situations reader is not in this build' };
  if (got.unreadable) {
    var kept = (typeof hubTeamAlertOwe_ === 'function') &&
               hubTeamAlertOwe_('ai_keys', 'ai_keys|' + String(d.day || ''), d, str_(entry && entry.at));
    return kept ? { state: 'kept', why: got.unreadable + ' — kept for the next pass' }
                : { state: 'stale', why: got.unreadable + ' — and it could not be kept' };
  }
  if (got.row && !got.on) return { state: 'stale', why: 'the weekly notice was switched off overnight' };
  var said = aiKeyNoticeSay_(got.row || {}, d, '(held overnight by the quiet window)');
  return { state: 'carried', why: said.done ? 'the team was told' : ('not told: ' + said.why) };
}
