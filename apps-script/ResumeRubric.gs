var RUBRIC_PROMPT_ID = 'resume_analysis_v1';
var RUBRIC_CACHE_KEY = 'resume_rubric_doc_v1';
var RUBRIC_CACHE_SECONDS = 1800;

var RUBRIC_MAP = {
  MonthsSinceLastExperience: 'months_since_last_experience',
  TotalYearsCaregiving: 'total_years_caregiving',
  AvgTenurePerJob: 'avg_tenure_per_job',
  HighestResponsibility: 'highest_responsibility',
  ScheduleAvailability: 'schedule_availability',
  NumDSPAgencies: 'num_dsp_agencies',
  ConsistencyInField: 'consistency_in_field',
  LeadershipRatio: 'leadership_ratio',
  SettingBalance: 'setting_balance',
  CareExperience: 'care_experience',
  ListedCertifications: 'listed_certifications',
  SkillsRating: 'skills_rating',
  CertsRating: 'certs_rating',
  ExperienceRating: 'experience_rating',
  JobHistoryRating: 'job_history_rating',
  CompositeScore: 'composite_score',
  RedFlagShortTenure: 'red_flag_short_tenure',
  RedFlagNoCerts: 'red_flag_no_certs',
  RedFlagStaleExperience: 'red_flag_stale_experience',
  Summary: 'summary',
  Zip: 'zip',
  Gender: 'gender',
  Languages: 'languages',
  FirstName: 'first_name',
  Phone: 'phone',
  Email: 'email',
  City: 'city',
  State: 'state'
};

function rubricPrompt_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(RUBRIC_CACHE_KEY);
    if (hit) return hit;
  } catch (e) { }
  var text = '';
  try {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + hubId_('RUBRIC_DOC_ID') + '/export?mimeType=text%2Fplain',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() < 400) text = String(res.getContentText() || '');
  } catch (e2) { text = ''; }
  if (text) { try { cache.put(RUBRIC_CACHE_KEY, text, RUBRIC_CACHE_SECONDS); } catch (e3) {} }
  return text;
}

function rubricHash_(text) {
  if (!text) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < 8; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function rubricNum_(v) {
  var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

// The composite is computed here, never taken from the model.
function rubricComposite_(obj) {
  var s = rubricNum_(obj.SkillsRating), e = rubricNum_(obj.ExperienceRating),
      j = rubricNum_(obj.JobHistoryRating), c = rubricNum_(obj.CertsRating);
  if (s === null || e === null || j === null || c === null) return null;
  return Math.round((s * 1.5 + e * 1.5 + j * 1.0 + c * 0.5) * 10) / 10;
}

function rubricAnalyze_(text) {
  var out = {
    fields: {}, raw: '', status: '', error: '',
    promptId: RUBRIC_PROMPT_ID, hash: '', recommendation: ''
  };
  if (!str_(text)) { out.status = 'no résumé text'; return out; }

  var prompt = rubricPrompt_();
  if (!prompt) { out.status = 'rubric doc unreadable'; return out; }
  out.hash = rubricHash_(prompt);

  if (typeof screenAiChat_ !== 'function') { out.status = 'no AI door in this build'; return out; }
  var chat = null;
  try {
    var wrapped = bookText_('Prompts', 'ai_resume_rubric_wrap', '')
      .split('{resume}').join(String(text).slice(0, 18000))
      .split('{rubric}').join(prompt);
    chat = wrapped ? screenAiChat_(wrapped, 0.1, 'ai_resume_rubric')
                   : { ok: false, error: 'prompt_cell_empty' };
  }
  catch (e) { chat = null; out.error = String((e && e.message) || e); }
  if (!chat || !chat.ok) {
    out.status = 'no provider';
    out.error = out.error || str_(chat && chat.error);
    return out;
  }
  out.raw = String(chat.content || '').slice(0, 45000);

  var obj = null;
  try { obj = JSON.parse(chat.content); } catch (e2) { obj = null; }
  if (!obj || typeof obj !== 'object') {
    out.status = 'reply was not JSON';
    return out;
  }

  for (var key in RUBRIC_MAP) {
    if (!Object.prototype.hasOwnProperty.call(RUBRIC_MAP, key)) continue;
    var v = obj[key];
    if (v === undefined || v === null || String(v) === '') continue;
    out.fields[RUBRIC_MAP[key]] = String(v);
  }

  var mine = rubricComposite_(obj);
  if (mine !== null) {
    var theirs = rubricNum_(obj.CompositeScore);
    out.fields.composite_score = String(mine);
    if (theirs !== null && Math.abs(theirs - mine) > 0.05) {
      out.error = 'composite recomputed: the reply said ' + theirs + ', the weights give ' + mine;
    }
  }

  // Kept but never written to decision_status: only a person moves a candidate out of New.
  out.recommendation = str_(obj.DecisionStatus);
  out.status = 'ok';
  return out;
}

function rubricFileId_(url) {
  var s = String(url || '');
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(s);
  return m ? m[1] : '';
}

// Never a gate: a failure reports its reason and hiring walks on.
function rubricEnsureForCandidate_(candidateId, user, fileId) {
  var cid = str_(candidateId);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { scored: false, reason: 'invalid candidate_id' };
  var ss = ssOpen_(TALENT_SHEET_ID);
  var cand = null;
  readTabNormalized_(ss, TALENT_CANDIDATES_TAB).some(function (c) {
    if (str_(c.candidateid) === cid) { cand = c; return true; }
    return false;
  });
  if (!cand) return { scored: false, reason: 'no such candidate' };
  var link = str_(cand.resumelink);
  var fid = str_(fileId) || rubricFileId_(link);
  if (!fid) {
    return { scored: false, reason: link ? 'the resume link carries no Drive file id' : 'no resume on file' };
  }
  var last = null;
  readTabNormalized_(ss, TALENT_RESUME_TAB).forEach(function (a) {
    if (str_(a.candidateid) === cid) last = a;
  });
  if (last && str_(last.compositescore)) {
    var have = parseFloat(str_(last.compositescore));
    return { scored: true, reason: 'already scored', composite: isNaN(have) ? null : have };
  }
  var why = {};
  var text = '';
  try { text = hubExtractResumeText_(fid, why); }
  catch (eX) { return { scored: false, reason: 'extract threw: ' + String((eX && eX.message) || eX) }; }
  if (!text) return { scored: false, reason: str_(why.reason) || 'the resume held no readable text' };
  var analysis = rubricAnalyze_(text);
  if (analysis.status !== 'ok') {
    return { scored: false, reason: analysis.status + (analysis.error ? ' — ' + analysis.error : '') };
  }
  rubricWrite_(cid, analysis, user, fid);
  if (typeof hubBustTalentCache_ === 'function') { try { hubBustTalentCache_(); } catch (eB) {} }
  var comp = parseFloat(str_(analysis.fields.composite_score));
  return { scored: true, reason: 'ok', composite: isNaN(comp) ? null : comp };
}

HUB_POLICY.resumeAnalysisGet = {
  file: 'ResumeRubric.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.resumeAnalysisGet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var last = null;
  readTabNormalized_(ssOpen_(TALENT_SHEET_ID), TALENT_RESUME_TAB).forEach(function (a) {
    // Only a scored row counts: the upload stub must not shadow a real analysis.
    if (str_(a.candidateid) === cid && str_(a.compositescore)) last = a;
  });
  if (!last) return { status: 200, data: { found: false } };
  var num = function (v) { var n = parseFloat(str_(v)); return isNaN(n) ? null : n; };
  var flag = function (v) {
    var s = str_(v).toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  };
  return { status: 200, data: { found: true, analysis: {
    composite: num(last.compositescore),
    ratings: {
      skills: num(last.skillsrating), certs: num(last.certsrating),
      experience: num(last.experiencerating), job_history: num(last.jobhistoryrating)
    },
    red_flags: {
      short_tenure: flag(last.redflagshorttenure),
      no_certs: flag(last.redflagnocerts),
      stale_experience: flag(last.redflagstaleexperience)
    },
    total_years_caregiving: str_(last.totalyearscaregiving),
    avg_tenure_per_job: str_(last.avgtenureperjob),
    months_since_last_experience: str_(last.monthssincelastexperience),
    highest_responsibility: str_(last.highestresponsibility),
    schedule_availability: str_(last.scheduleavailability),
    num_dsp_agencies: str_(last.numdspagencies),
    consistency_in_field: str_(last.consistencyinfield),
    setting_balance: str_(last.settingbalance),
    care_experience: str_(last.careexperience),
    listed_certifications: str_(last.listedcertifications),
    languages: str_(last.languages),
    summary: str_(last.summary),
    analyzed_at: str_(last.analyzedat)
  } } };
};

HUB_POLICY.resumeScorecardRun = {
  file: 'ResumeRubric.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: []
};
HUB_ACTIONS.resumeScorecardRun = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var out = rubricEnsureForCandidate_(str_(payload.candidate_id), user, str_(payload.file_id));
  if (!out.scored && out.reason === 'no such candidate') {
    return { status: 404, message: 'No candidate "' + str_(payload.candidate_id) + '".' };
  }
  if (!out.scored && out.reason === 'no resume on file') {
    return { status: 409, message: 'No resume on file — the scorecard needs one.' };
  }
  return { status: 200, data: out };
};

function rubricWrite_(candidateId, analysis, user, sourceFileId) {
  var now = new Date().toISOString();
  var row = { candidate_id: candidateId };
  for (var k in analysis.fields) {
    if (Object.prototype.hasOwnProperty.call(analysis.fields, k)) row[k] = analysis.fields[k];
  }
  row.analyzed_at = now;
  row.created_at = now;
  row.updated_at = now;
  row.created_by = 'asa-hub-rubric:' + str_(user && user.email);
  row.prompt_id = RUBRIC_PROMPT_ID;
  row.prompt_doc_id = hubId_('RUBRIC_DOC_ID');
  row.prompt_doc_url = 'https://docs.google.com/document/d/' + hubId_('RUBRIC_DOC_ID') + '/edit';
  row.prompt_content_hash = analysis.hash;
  row.prompt_last_fetched_at = now;
  row.prompt_parse_status = analysis.status;
  row.prompt_error = analysis.error;
  row.raw_prompt_output_json = analysis.raw;
  if (sourceFileId) row.source_asset_id = sourceFileId;
  hubAppendRow_(TALENT_RESUME_TAB, row);
  return row;
}
