// ------------------------------------------------------------------ TALENT PIPELINE — the legacy recruiting…
// From that start the talent pipeline is separated out, and each part goes into production as it is worked out.


var TP_TABS = { candidates: 'tp_candidates', resume: 'tp_resume', screens: 'tp_screens' };
var TP_HEADERS = {
  tp_candidates: ['candidate_id', 'name', 'first_name', 'phone', 'email', 'city', 'state',
                  'languages', 'status', 'score', 'resume_link', 'created_at', 'src', 'migrated_at'],
  tp_resume: ['candidate_id', 'name', 'months_since_last', 'years_caregiving', 'avg_tenure',
              'highest_responsibility', 'availability', 'num_agencies', 'consistency',
              'leadership_ratio', 'setting_balance', 'care_experience', 'certifications',
              'skills_rating', 'certs_rating', 'experience_rating', 'job_history_rating',
              'composite_score', 'flag_short_tenure', 'flag_no_certs', 'flag_stale',
              'decision', 'summary', 'cjis_status', 'cjis_report', 'analyzed_at', 'src', 'migrated_at'],
  tp_screens: ['candidate_id', 'name', 'attempt', 'screen_date', 'screen_status', 'notes',
               'qualification', 'final_result', 'best_day_time', 'screened_by',
               'cert_dodd', 'cert_cpr', 'cert_meddel', 'has_dl', 'has_vehicle', 'has_insurance',
               'src', 'migrated_at']
};

function tpSheet_(tab) {
  var sheet = hubTabEnsure_(tab, TP_HEADERS[tab]);
  // A tab written before a column existed still gains it; on a fresh one the header the door has just stamped…
  if (!sheet.isRuntimeBacked) ensureHeader_(sheet, TP_HEADERS[tab]);
  return sheet;
}

function tpManager_(user) {
  return !!user && !user.is_service &&
         ['admin', 'manager'].indexOf(String(user.role)) !== -1;
}

// A possibly-not-yet-migrated tab reads as EMPTY, never as an error — readTabNormalized_ throws on a missing tab…
function tpReadSoft_(ss, tab) {
  try { return readTabNormalized_(ss, tab); }
  catch (e) { return []; }
}

/** Header map by exact legacy column name — the extraction pinned them. */
function tpCols_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) map[String(headers[i]).trim()] = i;
  return map;
}
function tpVal_(row, map, name) {
  var i = map[name];
  if (i === undefined) return '';
  var v = row[i];
  if (v instanceof Date) return Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

HUB_POLICY.talentPipelineMigrate = {
  file: 'TalentPipeline.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.talentPipelineMigrate = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  // Pressed by hand, so it LOOKS — see tpSourceStamp_.
  return tpMigrateRun_(str_(user.email), true);
};

// THE NEW ONES ARRIVE ON THEIR OWN — the sync has to fetch the NEW rows.
HUB_POLICY.talentPipelineSync = {
  file: 'TalentPipeline.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.talentPipelineSync = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && String(user.role) !== 'admin') return hubDenied_();
  // The clock is gated on the source's own timestamp (tpSourceStamp_); an admin asking for this action by hand is a…
  var out = tpMigrateRun_(user.is_service ? 'service:relay-clock' : str_(user.email),
                          !user.is_service);
  // the authorization reply sweep rides the same hourly clock; a sweep fault never breaks the sync
  if (out && out.status === 200 && out.data) {
    try { out.data.authorization_sweep = (tpAuthSweepRun_() || {}).data || null; }
    catch (eSw) {
      out.data.authorization_sweep = { error: String((eSw && eSw.message) || eSw).slice(0, 120) };
    }
  }
  return out;
};

// THE LEGACY WORKBOOK'S OWN CLOCK, ASKED BEFORE WE OPEN ANYTHING.
var TP_SOURCE_CURSOR_PROP = 'TP_SOURCE_CURSOR';
var TP_SOURCE_FLOOR_MS = 24 * 60 * 60 * 1000;   // a full pass a day, stamp or no stamp

// The legacy workbook's last edit as Drive reports it — '' when Drive will not answer, and '' means COPY, never…
function tpSourceStamp_() {
  try {
    return DriveApp.getFileById(hubId_('TP_SOURCE_ID')).getLastUpdated().toISOString();
  } catch (e) { return ''; }
}

function tpMigrateRun_(actor, force) {
  // THE CHEAP QUESTION FIRST. `force` is a hand on a button; the clock is not.
  var stamp = force ? '' : tpSourceStamp_();
  if (stamp) {
    var seen = null;
    try { seen = JSON.parse(hubProp_(TP_SOURCE_CURSOR_PROP) || 'null'); }
    catch (eC) { seen = null; }
    var seenAt = (seen && seen.at) ? Date.parse(str_(seen.at)) : 0;
    if (seen && seen.stamp === stamp && seenAt && (Date.now() - seenAt) < TP_SOURCE_FLOOR_MS) {
      tpSweepIdle_('talent-migrate',
                   'the legacy workbook has not been edited since ' + stamp +
                   ' — nothing to copy, and no workbook was opened to find out');
      var quiet = {};
      quiet[TP_TABS.candidates] = 0;
      quiet[TP_TABS.resume] = 0;
      quiet[TP_TABS.screens] = 0;
      return { status: 200, data: { added: quiet, skipped: 'source unchanged since ' + stamp } };
    }
  }
  var src;
  try { src = ssOpen_(hubId_('TP_SOURCE_ID')); }
  catch (eO) {
    return { status: 403, message: 'The Talent Pipeline workbook could not be opened — ' +
             'make sure this Google account still has access to it.' };
  }
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var counts = {};

  function copy(tabName, destTab, keyOf, mapRow) {
    var sh = src.getSheetByName(tabName);
    if (!sh || sh.getLastRow() < 2) { counts[destTab] = 0; return; }
    var values = sh.getDataRange().getValues();
    var map = tpCols_(values[0]);
    var dest = tpSheet_(destTab);
    var have = {};
    readTabNormalized_(db, destTab).forEach(function (r) {
      if (str_(r.src)) have[str_(r.src)] = true;
    });
    var out = [], keys = [], now = new Date().toISOString();
    for (var i = 1; i < values.length; i++) {
      var key = keyOf(values[i], map);
      if (!key || have[key]) continue;
      var mapped = mapRow(values[i], map, key, now);
      if (mapped) { out.push(mapped); keys.push(key); have[key] = true; }
    }
    // THE ROWS HAVE TO LAND, AND THE COUNT IS WHAT LANDED.
    var landed = 0;
    if (out.length && dest.isRuntimeBacked) {
      var hdr = TP_HEADERS[destTab];
      for (var k = 0; k < out.length; k++) {
        var fields = {};
        for (var c = 0; c < hdr.length; c++) fields[hdr[c]] = out[k][c];
        if (hiringLegacyWrite_(destTab, keys[k], fields, 'talent-pipeline:migrate')) landed++;
      }
    } else if (out.length) {
      dest.getRange(dest.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
      landed = out.length;
    }
    counts[destTab] = landed;
  }

  copy('Candidates', TP_TABS.candidates,
    function (row, map) { return tpVal_(row, map, 'CandidateId'); },
    function (row, map, key, now) {
      var name = tpVal_(row, map, 'CandidateName') ||
                 (tpVal_(row, map, 'FirstName') + ' (' + key + ')').trim();
      return [key, name, tpVal_(row, map, 'FirstName'), tpVal_(row, map, 'Phone'),
              tpVal_(row, map, 'Email'), tpVal_(row, map, 'City'), tpVal_(row, map, 'State'),
              tpVal_(row, map, 'Languages'), tpVal_(row, map, 'Status'), tpVal_(row, map, 'Score'),
              tpVal_(row, map, 'ResumeLink'), tpVal_(row, map, 'CreatedAt'), key, now];
    });

  copy('ResumeAnalysis', TP_TABS.resume,
    function (row, map) { return tpVal_(row, map, 'CandidateId'); },
    function (row, map, key, now) {
      return [key, tpVal_(row, map, 'CandidateName'),
              tpVal_(row, map, 'MonthsSinceLastExperience'), tpVal_(row, map, 'TotalYearsCaregiving'),
              tpVal_(row, map, 'AvgTenurePerJob'), tpVal_(row, map, 'HighestResponsibility'),
              tpVal_(row, map, 'ScheduleAvailability'), tpVal_(row, map, 'NumDSPAgencies'),
              tpVal_(row, map, 'ConsistencyInField'), tpVal_(row, map, 'LeadershipRatio'),
              tpVal_(row, map, 'SettingBalance'), tpVal_(row, map, 'CareExperience'),
              tpVal_(row, map, 'ListedCertifications'),
              tpVal_(row, map, 'SkillsRating'), tpVal_(row, map, 'CertsRating'),
              tpVal_(row, map, 'ExperienceRating'), tpVal_(row, map, 'JobHistoryRating'),
              tpVal_(row, map, 'CompositeScore'),
              tpVal_(row, map, 'RedFlagShortTenure'), tpVal_(row, map, 'RedFlagNoCerts'),
              tpVal_(row, map, 'RedFlagStaleExperience'),
              tpVal_(row, map, 'DecisionStatus'), tpVal_(row, map, 'Summary'),
              tpVal_(row, map, 'CJISStatus'), tpVal_(row, map, 'CJISReportUrl'),
              tpVal_(row, map, 'AnalyzedAt'), key, now];
    });

  copy('PhoneScreen', TP_TABS.screens,
    function (row, map) {
      var id = tpVal_(row, map, 'CandidateId');
      return id ? id + ':' + (tpVal_(row, map, 'AttemptNum') || '1') : '';
    },
    function (row, map, key, now) {
      return [tpVal_(row, map, 'CandidateId'), tpVal_(row, map, 'CandidateName'),
              tpVal_(row, map, 'AttemptNum'), tpVal_(row, map, 'ScreenDate'),
              tpVal_(row, map, 'ScreenStatus'), tpVal_(row, map, 'Notes'),
              tpVal_(row, map, 'Qualification'), tpVal_(row, map, 'FinalResult'),
              tpVal_(row, map, 'BestInPersonDayTime'), tpVal_(row, map, 'ScreenedBy'),
              tpVal_(row, map, 'CertDODD'), tpVal_(row, map, 'CertCPRFirstAid'),
              tpVal_(row, map, 'CertMedDel'), tpVal_(row, map, 'HasDL'),
              tpVal_(row, map, 'HasVehicle'), tpVal_(row, map, 'HasInsurance'), key, now];
    });

  // THE CURSOR MOVES ONLY WHEN THE THREE COPIES CAME BACK.
  if (stamp) {
    try {
      hubPropSet_(TP_SOURCE_CURSOR_PROP,
                  JSON.stringify({ stamp: stamp, at: new Date().toISOString() }));
    } catch (eS) { /* an unwritable cursor just means the next pass copies */ }
  }

  var imported = counts[TP_TABS.candidates] || counts[TP_TABS.resume] ||
                 counts[TP_TABS.screens];
  if (imported) {
    // THE BUST BELONGS AFTER THE WRITE.
    try { tpBustCrossingCache_(); } catch (eB) {}
    // THE LOG IS A TRAIL OF ACTS, AND AN IMPORT OF NOTHING IS NOT ONE.
    hubSysLog_(actor, 'talent_pipeline_migrate', JSON.stringify(counts).slice(0, 200),
               { status: 200 });
  } else {
    tpSweepIdle_('talent-migrate',
                 'the legacy workbook was edited but carried no row we had not already copied');
  }
  return { status: 200, data: { added: counts } };
}

// The join, shared by the list and the authorization ask.
function tpIsDuplicate_(c) {
  return str_(c && c.status).trim().toLowerCase() === 'duplicate';
}

// WHAT THE LEGACY'S CJIS COLUMN ACTUALLY SAYS — one reader, because it is not a verdict field and pretending it is…
function tpCjisVerdict_(v) {
  var s = str_(v).trim();
  if (!s) return 'unreadable';
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return 'unreadable';        // a timestamp
  var low = s.toLowerCase();
  if (low === 'done' || low === 'none') return 'unreadable';
  if (low.indexOf('error') === 0) return 'unreadable';
  if (/review/i.test(s)) return 'review';
  if (low.indexOf('disqualified') === 0) return 'disqualified';
  if (low.indexOf('clear') === 0 || low.indexOf('verified') === 0) return 'clear';
  return 'unreadable';                                            // never a guess
}

// MAY THIS LEGACY ROW COME INTO THE HIRING PROCESS?
var TP_CROSS_DECLINED = true;

// The ONE sentence for "their card is already on the hiring board".
var TP_WHY_ON_BOARD = 'already a candidate on the hiring board';

function tpCrossable_(cand, rz, staffIdx) {
  var status = str_(cand && cand.status).trim();
  if (tpIsDuplicate_(cand)) {
    return { ok: false, why: 'the legacy marked this row a duplicate of somebody else' };
  }
  if (!str_(cand && cand.name)) return { ok: false, why: 'the row carries no name' };
  if (!str_(cand && cand.phone) && !str_(cand && cand.email)) {
    return { ok: false, why: 'neither a phone nor an e-mail on the record' };
  }
  if (!TP_CROSS_DECLINED && /^not hiring$/i.test(status)) {
    return { ok: false, why: 'the legacy declined them (Not Hiring)' };
  }
  // ALREADY EMPLOYED IS NOT A CANDIDATE.
  var staff = tpStaffHit_(staffIdx, str_(cand && cand.phone), str_(cand && cand.email));
  if (staff) {
    return { ok: true, landing: 'ready', staff_name: str_(staff.name),
             why: 'already on the staff roster as ' + str_(staff.name) +
                  ' — they land at Ready to start and finish by themselves' };
  }
  if (/^hired$/i.test(status)) {
    return { ok: true, landing: 'ready',
             why: 'the legacy already hired them — they land at Ready to start and finish by themselves' };
  }
  var verdict = tpCjisVerdict_(rz && rz.cjisstatus);
  if (verdict === 'review') {
    return { ok: false, verdict: verdict,
             why: 'the background check came back for review — ' + str_(rz.cjisstatus) };
  }
  if (verdict === 'disqualified') {
    return { ok: false, verdict: verdict, why: 'the background check says Disqualified' };
  }
  // AN UNREADABLE CHECK IS MISSING DATA, NOT A VERDICT — so it stops being a refusal (with "pode colocar todos").
  if (verdict === 'unreadable') {
    return { ok: true, verdict: verdict,
             why: str_(rz && rz.cjisstatus)
               ? 'no readable verdict in the CJIS column ("' + str_(rz.cjisstatus).slice(0, 40) + '") — they come in with the check still owed'
               : 'no background check on the legacy record — they come in with it still owed' };
  }
  return { ok: true, verdict: verdict, why: '' };
}

// IS THIS PERSON ALREADY STAFF?
function tpStaffHit_(idx, phone, email) {
  if (!idx || !idx.ok) return null;
  var live = function (list) {
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].active) return list[i];
    }
    return null;                       // known here once, employed here no more
  };
  try {
    var pk = (typeof contactPhoneKey_ === 'function') ? contactPhoneKey_(phone) : '';
    if (pk) {
      var byPhone = live(idx.phones[pk]);
      if (byPhone) return byPhone;
    }
    var hit = null;
    ((typeof contactEmailKeys_ === 'function') ? contactEmailKeys_(email) : []).forEach(function (k) {
      if (!hit) hit = live(idx.emails[k]);
    });
    return hit;
  } catch (e) { return null; }
}

// The roster index, or null when it cannot be read — and a null must never read as "nobody is staff": the callers…
var TP_STAFF_MEMO;
function tpStaffIndex_() {
  if (TP_STAFF_MEMO !== undefined) return TP_STAFF_MEMO;
  TP_STAFF_MEMO = null;
  try {
    if (typeof staffContactIndex_ === 'function') {
      var idx = staffContactIndex_();
      if (idx && idx.ok) TP_STAFF_MEMO = idx;
    }
  } catch (e) { TP_STAFF_MEMO = null; }
  return TP_STAFF_MEMO;
}

// Who is already on our board — by name and by the last ten digits, the two keys the crossing door itself uses.
function tpOnBoardIndex_(db) {
  var byName = {}, byPhone = {};
  tpReadSoft_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    var n = str_(c.candidatename) || (str_(c.firstname) + ' ' + str_(c.lastname)).trim();
    var k = n.toLowerCase().replace(/[^a-z]/g, '');
    if (k) byName[k] = str_(c.candidateid);
    var d = str_(c.phone).replace(/\D/g, '');
    d = d.length > 10 ? d.slice(-10) : d;
    if (d.length === 10) byPhone[d] = str_(c.candidateid);
  });
  return { byName: byName, byPhone: byPhone };
}

function tpAlreadyHere_(idx, cand) {
  var k = str_(cand.name).toLowerCase().replace(/[^a-z]/g, '');
  if (k && idx.byName[k]) return idx.byName[k];
  var d = str_(cand.phone).replace(/\D/g, '');
  d = d.length > 10 ? d.slice(-10) : d;
  if (d.length === 10 && idx.byPhone[d]) return idx.byPhone[d];
  return '';
}

function tpJoinedRows_(db) {
  var all = tpReadSoft_(db, TP_TABS.candidates);
  if (!all.length) return { rows: [], migrated: false, duplicates: 0 };
  // ONE PLACE, so no reader can forget: this join feeds the scoreboard, the ranking, the collection of five that…
  var duplicates = 0, archived = 0;
  var cands = all.filter(function (c) {
    // A REMOVED STORE ROW LEAVES EVERY READER AT ONCE — removed means it goes to the archive.
    if (/^(true|yes|1)$/i.test(str_(c.archived))) { archived++; return false; }
    if (!tpIsDuplicate_(c)) return true;
    duplicates++;
    return false;
  });
  if (!cands.length) return { rows: [], migrated: true, duplicates: duplicates };
  var resume = {};
  tpReadSoft_(db, TP_TABS.resume).forEach(function (r) {
    var id = str_(r.candidateid);
    if (id) resume[id] = r;
  });
  var screens = {};
  tpReadSoft_(db, TP_TABS.screens).forEach(function (r) {
    var id = str_(r.candidateid);
    if (!id) return;
    var att = parseInt(str_(r.attempt), 10) || 1;
    if (!screens[id] || att >= (parseInt(str_(screens[id].attempt), 10) || 1)) screens[id] = r;
  });
  var yes = function (v) { return /^(yes|true|y|1)$/i.test(str_(v)); };
  var rows = cands.map(function (c) {
    var id = str_(c.candidateid);
    var rz = resume[id] || {};
    var sc = screens[id] || {};
    return {
      candidate_id: id,
      name: str_(c.name) || str_(rz.name) || str_(sc.name) || id,
      phone: str_(c.phone), email: str_(c.email), city: str_(c.city),
      collected_at: str_(c.collectedat),
      status: str_(c.status), resume_link: str_(c.resumelink),
      composite_score: str_(rz.compositescore),
      skills: str_(rz.skillsrating), certs: str_(rz.certsrating),
      experience: str_(rz.experiencerating), job_history: str_(rz.jobhistoryrating),
      years: str_(rz.yearscaregiving),
      flags: [str_(rz.flagshorttenure) === 'Yes' ? 'short tenure' : '',
              str_(rz.flagnocerts) === 'Yes' ? 'no certs' : '',
              str_(rz.flagstale) === 'Yes' ? 'stale experience' : ''].filter(String),
      decision: str_(rz.decision), summary: str_(rz.summary),
      cjis: str_(rz.cjisstatus), cjis_report: str_(rz.cjisreport),
      certifications: str_(rz.certifications),
      screen_result: str_(sc.finalresult) || str_(sc.screenstatus),
      screen_qualification: str_(sc.qualification),
      screen_date: str_(sc.screendate), screened_by: str_(sc.screenedby),
      // all six screen checks true — one of the ranking's transparent bonuses
      screen_checks_all: yes(sc.certdodd) && yes(sc.certcpr) && yes(sc.certmeddel) &&
                         yes(sc.hasdl) && yes(sc.hasvehicle) && yes(sc.hasinsurance),
      avg_tenure: str_(rz.avgtenure), months_since_last: str_(rz.monthssincelast)
    };
  });
  rows.sort(function (a, b) {
    var sa = parseFloat(a.composite_score), sb = parseFloat(b.composite_score);
    if (!isNaN(sb) && !isNaN(sa)) return sb - sa;
    if (!isNaN(sb)) return 1;
    if (!isNaN(sa)) return -1;
    return a.name.localeCompare(b.name);
  });
  // The count travels with the rows: a list that quietly got shorter reads as "that is everybody", and 128 people…
  return { rows: rows, migrated: true, duplicates: duplicates, resume: resume };
}

// The scoreboard: every legacy candidate joined to their scores in one read, the canonical rank folded on, and the…
HUB_POLICY.talentPipelineList = {
  file: 'TalentPipeline.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
// `talentPool` — THE ROSTER AS A RESOURCE, so it can be SLICED: why read from the sheet rather than from the JSON…
function talentPoolRoute_(action, payload, user) {
  if (!user || (!user.is_service && !tpManager_(user))) {
    return { status: 403, message: 'The talent pool is for the hiring team.' };
  }
  if (action !== 'list' && action !== 'get') {
    return { status: 405, message: 'The talent pool is read-only — it mirrors the legacy workbook.' };
  }
  var answer = HUB_ACTIONS.talentPipelineList({ crossing: true },
                                              { role: 'admin', email: str_(user.email) || 'service' });
  if (answer.status !== 200) return answer;
  var rows = (answer.data && answer.data.rows) || [];
  if (action === 'list') return { status: 200, data: rows };
  var id = str_(payload && payload.id);
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].candidate_id) === id) return { status: 200, data: rows[i] };
  }
  return { status: 404, message: 'No talent pool row "' + id + '".' };
}

var TP_LIST_CACHE_SECONDS = 600;
HUB_ACTIONS.talentPipelineList = function (payload, user) {
  if (!tpManager_(user)) return hubDenied_();
  // Two shapes, two keys: the roster asks for the crossing column, the Analysis does not, and caching one under the…
  var ckey = 'hub_tp_list_v1' + ((payload && payload.crossing) ? ':x' : '');
  var cached = tpCacheGet_(ckey);
  if (cached) return { status: 200, data: cached };
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var joined = tpJoinedRows_(db);
  if (!joined.migrated) {
    return { status: 200, data: { rows: [], migrated: false, authorizations: [] } };
  }
  var ranked = tpRank_(joined.rows);
  var pos = {};
  for (var i = 0; i < ranked.length; i++) pos[ranked[i].candidate_id] = i + 1;
  // WHY THIS PERSON IS NOT A CANDIDATE — on their own row.
  var wantCross = !!(payload && payload.crossing);
  // ONE COMPUTATION, SHARED AND CACHED — this used to build the board index and read the whole staff roster a…
  var crossBy = wantCross ? (tpCrossingCompute_(db).byId || {}) : null;
  joined.rows.forEach(function (r) {
    r.rank = pos[r.candidate_id] || null;
    r.rank_score = pos[r.candidate_id] ? tpRankScore_(r) : null;
    if (!wantCross) return;
    var why = crossBy[r.candidate_id];
    // undefined = the crossing computation never saw them (a row added since the cache was written).
    r.cross_ok = why === '';
    r.cross_why = (why === undefined) ? '' : str_(why);
    // ALREADY IN THE PROCESS, AS A FLAG AND NOT AS A SENTENCE: anybody at ANY step of the hiring process leaves…
    r.on_board = why === TP_WHY_ON_BOARD;
    // AND THE OTHER HALF OF THE SAME QUESTION — Mandy Radtka stood FIRST in the ranking with the legacy status…
    var legacyStage = null;
    try { legacyStage = (typeof talentStage_ === 'function') ? talentStage_(str_(r.status)) : null; }
    catch (eS) { legacyStage = null; }
    r.in_process = !!legacyStage;
    r.in_process_stage = str_(legacyStage);
  });
  var asks = tpReadSoft_(db, TP_AUTH_TAB).map(function (a) {
    return { ask_id: str_(a.askid), candidate_id: str_(a.candidateid),
             candidate_name: str_(a.candidatename), rank: str_(a.rank),
             nota: str_(a.nota), requested_at: str_(a.requestedat),
             requested_by: str_(a.requestedby), state: str_(a.state),
             reply_from: str_(a.replyfrom), reply_verdict: str_(a.replyverdict),
             reply_analyzed_at: str_(a.replyanalyzedat),
             moved_candidate_id: str_(a.movedcandidateid), moved_at: str_(a.movedat) };
  });
  var answer = { rows: joined.rows, migrated: true, authorizations: asks,
                 duplicates_hidden: joined.duplicates };
  tpCachePut_(ckey, answer, TP_LIST_CACHE_SECONDS);
  return { status: 200, data: answer };
};

/** Every door that changes what the roster shows drops BOTH shapes. */
function tpBustListCache_() {
  tpCacheDrop_('hub_tp_list_v1');
  tpCacheDrop_('hub_tp_list_v1:x');
}

// THE MINUTES A FINISHED PERSON STANDS AT READY — one cell, the house's own convention (blank falls to the shipped…
var TP_AUTOCROSS_ARMED_PROP = 'HUB_TALENT_AUTOCROSS_ARMED_AT';

function tpAutoCrossPerPass_() {
  var n = 0;
  try { n = parseInt(str_(simCfgVal_('sim_talent_autocross_per_pass')), 10); } catch (e) { n = 0; }
  if (isNaN(n) || n < 0) return 10;
  return Math.min(n, 50);
}

function tpAutoCrossBacklog_() {
  var v = '';
  try { v = str_(simCfgVal_('sim_talent_autocross_backlog')).toLowerCase(); } catch (e) { v = ''; }
  return /^(yes|true|sim|1)$/.test(v);
}

// A MACHINE THAT ONLY SPEAKS WHEN IT ACTS CANNOT BE TOLD FROM A DEAD ONE .
function tpSweepIdle_(name, why) {
  try {
    var cache = CacheService.getScriptCache();
    var k = 'tp_idle_' + name;
    if (cache.get(k)) return;
    cache.put(k, '1', 21600);                       // six hours
    hubSysLog_('asa-hub:' + name, name + '_idle', why, { status: 200 });
  } catch (e) { /* the sweep itself must not fail over its own diary */ }
}

function tpAutoCrossSweepMaybe_() {
  // The machine lane only: a person's read must never pay for this.
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('talent_autocross_sweep')) return;
  cache.put('talent_autocross_sweep', '1', 300);

  var budget = tpAutoCrossPerPass_();
  if (budget <= 0) return;                      // the cell turns it off

  // ARMED FROM NOW.
  var armedAt = '';
  try { armedAt = str_(PropertiesService.getScriptProperties().getProperty(TP_AUTOCROSS_ARMED_PROP)); }
  catch (eP) { armedAt = ''; }
  if (!armedAt) {
    armedAt = new Date().toISOString();
    try { PropertiesService.getScriptProperties().setProperty(TP_AUTOCROSS_ARMED_PROP, armedAt); }
    catch (eS) { return; }                      // no stamp, no sweep: never unbounded
    hubSysLog_('asa-hub:talent-autocross', 'talent_autocross_armed',
               'the automatic crossing is armed from ' + armedAt +
               ' — applications signed before it stay a press in Actions', { status: 200 });
    return;                                     // the arming pass takes nobody
  }
  var backlog = tpAutoCrossBacklog_();
  var armedDay = armedAt.slice(0, 10);

  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var waiting = [];
  try {
    var cands = tpReadSoft_(db, TP_TABS.candidates);
    waiting = tpApplicationsWaiting_(db, tpOnBoardIndex_(db), cands, tpStaffIndex_());
  } catch (eW) {
    hubSysLog_('asa-hub:talent-autocross', 'talent_autocross_read_failed',
               String((eW && eW.message) || eW), { status: 500 });
    return;
  }

  var done = 0, skipped = 0;
  for (var i = 0; i < waiting.length && done < budget; i++) {
    var p = waiting[i];
    // The signature day is all the envelope carries — a day, not a stamp — so the comparison is by day and the…
    var signed = str_(p.signed_at);
    if (!backlog && (!signed || signed <= armedDay)) { skipped++; continue; }
    // A NUMBER SOMEBODY CAN RING. Stricter than the queue on purpose.
    var digits = str_(p.phone).replace(/\D/g, '');
    if (digits.length < 10) { skipped++; continue; }

    var env = { candidate: p.name, phone: p.phone, email: p.email,
                location: p.location || '', signaturerequestid: p.srid };
    var out;
    try { out = tpMoveFromApplication_(env, str_(p.landing) || 'new', 'asa-hub:talent-autocross'); }
    catch (eM) { out = { moved: false, reason: String((eM && eM.message) || eM) }; }
    if (!out || !out.moved) {
      hubSysLog_('asa-hub:talent-autocross', 'talent_autocross_refused',
                 str_(p.name) + ' — ' + str_(out && out.reason), { status: 200 });
      continue;
    }
    done++;
    if (out.matched_existing) continue;         // they were already here

    // Ready to start means somebody the company already employs: mark them for the finisher exactly as the press…
    if (str_(p.landing) === 'ready') {
      try {
        hubSetStatus_(out.candidate_id, HUB_STAGE_TO_STATUS['ready'],
                      { email: 'asa-hub:talent-autocross' });
        var due = new Date(Date.now() + tpFinishMinutes_() * 60000).toISOString();
        hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, out.candidate_id, {
          talent_finish_at: due, talent_finish_why: str_(p.landing_why)
        }, { email: 'asa-hub:talent-autocross' }, false);
      } catch (eR) { /* the card stands; the finisher simply will not touch it */ }
    }
    try {
      journeyLog_({ candidate_id: out.candidate_id, name: str_(p.name),
                    step: 'talent_autocross', channel: 'record', ok: true,
                    title: 'They came in on their own signed application',
                    detail: 'the platform brought them in without anybody pressing: they signed ' +
                            'the application form on ' + (signed || 'a day the envelope does not carry') +
                            ' and were in no other book — landing at ' +
                            (str_(p.landing) === 'ready' ? 'Ready to start' : 'New') });
    } catch (eJ) { /* the card is what matters */ }
  }
  if (done) {
    hubSysLog_('asa-hub:talent-autocross', 'talent_autocross_pass',
               done + ' brought in, ' + skipped + ' left for the queue' +
               (backlog ? ' (backlog included)' : ' (armed ' + armedDay + ', backlog excluded)'),
               { status: 200 });
  } else {
    // Dormant, and dormancy has a reason worth reading.
    tpSweepIdle_('talent-autocross',
                 'ran and took nobody — ' + waiting.length + ' waiting, ' + skipped +
                 ' skipped' + (backlog ? ' (backlog included)'
                   : ' (armed ' + armedDay + '; everything signed before that day is a press ' +
                     'in Actions, and sim_talent_autocross_backlog is off)'));
  }
  if (done) hubBustTalentCache_();
}

// THE BOARD DOES NOT STARVE WHILE NOBODY IS WATCHING — there is a rule for New Entities when nobody is monitoring…
function tpAutoFillCfg_(key, dflt, max) {
  var n = 0;
  try { n = parseInt(str_(simCfgVal_(key)), 10); } catch (e) { n = NaN; }
  if (isNaN(n) || n < 0) return dflt;
  return Math.min(n, max);
}

/** The last moment a PERSON moved a card, ISO, or '' when nobody ever has. */
function tpLastHumanTouch_(db) {
  var newest = '';
  try {
    if (!hubTabSheet_('log_status_history')) return '';
    readTabNormalized_(db, 'log_status_history').forEach(function (h) {
      var who = str_(h.actor);
      if (!who) return;
      // The machines all name themselves: the service identity, the sweeps' own prefixes and the auto- watchers.
      if (who.indexOf('@service.local') !== -1) return;
      if (who.indexOf('asa-hub:') === 0 || who.indexOf('asa-hub-') === 0) return;
      if (who.indexOf('auto-') === 0) return;
      var at = str_(h.timestamp);
      if (at > newest) newest = at;
    });
  } catch (e) { return ''; }
  return newest;
}

function tpAutoFillNewMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('talent_autofill_sweep')) return;
  cache.put('talent_autofill_sweep', '1', 900);          // at most four an hour

  var floor = tpAutoFillCfg_('sim_talent_autofill_new_floor', 2, 20);
  if (floor <= 0) {
    tpSweepIdle_('talent-autofill', 'off — sim_talent_autofill_new_floor is 0');
    return;
  }
  var take = tpAutoFillCfg_('sim_talent_autofill_take', 3, 20);
  if (take <= 0) return;
  var idleHours = tpAutoFillCfg_('sim_talent_autofill_idle_hours', 12, 720);

  var db = ssOpen_(hubId_('HUB_DB_ID'));

  // 1 — how many stand at New right now
  var atNew = 0;
  try {
    readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (str_(c.archived).toLowerCase() === 'true') return;
      if (talentStage_(str_(c.status)) === 'new') atNew++;
    });
  } catch (eR) {
    tpSweepIdle_('talent-autofill', 'the board could not be read — an unread board decides nothing');
    return;
  }
  if (atNew >= floor) {
    tpSweepIdle_('talent-autofill',
                 'nothing to do — ' + atNew + ' card(s) stand at New and the floor is ' + floor);
    return;
  }

  // 2 — has a person touched the board lately?
  var last = tpLastHumanTouch_(db);
  if (last) {
    var ageH = (Date.now() - Date.parse(last)) / 3600000;
    if (!isNaN(ageH) && ageH < idleHours) {
      tpSweepIdle_('talent-autofill',
                   'New is low (' + atNew + ' of ' + floor + ') but somebody IS watching — a ' +
                   'person moved a card ' + Math.round(ageH) + 'h ago and the idle threshold is ' +
                   idleHours + 'h');
      return;
    }
  }

  // 3 — the queue's own order, and the same door a press uses
  var queue;
  try { queue = tpCrossingCompute_(db); } catch (eQ) { return; }
  var ready = (queue && queue.ready) || [];
  if (!ready.length) {
    tpSweepIdle_('talent-autofill',
                 'New is low (' + atNew + ' of ' + floor + ') and nobody has been watching, but ' +
                 'the queue is empty — there is nobody to start');
    return;
  }

  var actor = { role: 'admin', email: 'asa-hub:talent-autofill' };
  var done = 0, refused = 0;
  for (var i = 0; i < ready.length && done < take; i++) {
    var p = ready[i];
    var payload = p.tp_candidate_id ? { tp_candidate_id: p.tp_candidate_id } : { srid: p.srid };
    var res;
    try { res = HUB_ACTIONS.talentCrossIn(payload, actor); }
    catch (eC) { res = { status: 500, message: String((eC && eC.message) || eC) }; }
    var d = (res && res.data) || {};
    if (res && res.status === 200 && (d.moved || d.matched_existing)) {
      done++;
      if (d.matched_existing) continue;
      try {
        journeyLog_({ candidate_id: str_(d.candidate_id), name: str_(p.name),
                      step: 'talent_autofill', channel: 'record', ok: true,
                      title: 'The platform started them because the board had run dry',
                      detail: 'only ' + atNew + ' card(s) stood at New and no person had moved ' +
                              'one for ' + idleHours + ' hours, so the queue\'s next name came in' });
      } catch (eJ) {}
    } else {
      refused++;
    }
  }
  if (!done && !refused) {
    tpSweepIdle_('talent-autofill', 'every condition held and yet nobody came in — worth looking at');
  }
  if (done || refused) {
    hubSysLog_('asa-hub:talent-autofill', 'talent_autofill_pass',
               done + ' started (New had ' + atNew + ' of ' + floor + ', idle ' +
               idleHours + 'h)' + (refused ? ', ' + refused + ' refused' : ''),
               { status: 200 });
  }
  if (done) { hubBustTalentCache_(); tpBustCrossingCache_(); }
}

function tpFinishMinutes_() {
  var n = 0;
  try { n = parseInt(str_(simCfgVal_('sim_talent_finish_minutes')), 10); } catch (e) { n = 0; }
  return (!isNaN(n) && n >= 1) ? Math.min(n, 1440) : 10;
}

// THE FINISHER — the card waits a few minutes and finishes, automatically.
function talentFinishSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('talent_finish_sweep')) return;
  cache.put('talent_finish_sweep', '1', 300);
  var rows;
  try { rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB); }
  catch (e) { return; }
  var now = new Date().toISOString();
  var done = 0;
  rows.forEach(function (c) {
    if (done >= 20) return;                                  // budget per pass
    var at = str_(c.talentfinishat);
    if (!at || at > now) return;                             // not due, or never marked
    if (str_(c.archived).toLowerCase() === 'true') return;    // already closed
    if (talentStage_(str_(c.status)) !== 'ready') return;     // somebody moved them
    var cid = str_(c.candidateid);
    try {
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
        archived: 'true', archived_at: now,
        archived_reason: str_(c.talentfinishwhy) ||
          'crossed from the Talent Pipeline already employed — the record was closed',
        talent_finish_at: ''
      }, { email: 'asa-hub:talent-finish' }, false);
      journeyLog_({ candidate_id: cid, name: str_(c.candidatename), step: 'talent_finish',
                    channel: 'record', ok: true, title: 'Their record closed by itself',
                    detail: 'they stood at Ready to start for the configured minutes and the ' +
                            'platform finished them — ' +
                            (str_(c.talentfinishwhy) || 'they already work here'),
                    by: 'asa-hub:talent-finish' });
      done++;
    } catch (eF) {
      try { hubSysLog_('asa-hub:talent-finish', 'talent_finish_failed',
                       cid + ' — ' + String((eF && eF.message) || eF), { status: 500 }); } catch (eL) {}
    }
  });
  if (done) { try { hubBustTalentCache_(); } catch (eB) {} }
}

// THE CROSSING QUEUE — with the name, the phone and the CJIS already in hand a person HAS to enter the hiring…
HUB_POLICY.talentCrossingList = {
  file: 'TalentPipeline.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
// A CACHE THAT HOLDS AN ANSWER BIGGER THAN 100KB (measured).
var TP_CHUNK = 90000;
function tpCachePut_(key, obj, seconds) {
  try {
    var json = JSON.stringify(obj);
    var n = Math.ceil(json.length / TP_CHUNK);
    if (n > 8) return false;                     // past this it is not worth it
    var parts = {};
    for (var i = 0; i < n; i++) parts[key + ':' + i] = json.substr(i * TP_CHUNK, TP_CHUNK);
    parts[key + ':n'] = String(n);
    CacheService.getScriptCache().putAll(parts, seconds);
    return true;
  } catch (e) { return false; }
}
function tpCacheGet_(key) {
  try {
    var c = CacheService.getScriptCache();
    var n = parseInt(str_(c.get(key + ':n')), 10);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    var got = c.getAll(keys) || {};
    var json = '';
    for (var j = 0; j < n; j++) {
      var piece = got[key + ':' + j];
      if (piece === null || piece === undefined) return null;
      json += piece;
    }
    return JSON.parse(json);
  } catch (e) { return null; }
}
function tpCacheDrop_(key) {
  try {
    var c = CacheService.getScriptCache();
    var n = parseInt(str_(c.get(key + ':n')), 10) || 0;
    var keys = [key + ':n'];
    for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    c.removeAll(keys);
  } catch (e) {}
}

// The queue's own cache key — the ANSWER is small (a dozen people and five counts) even though computing it walks…
var TP_CROSSING_CACHE_KEY = 'hub_talent_crossing_v1';
var TP_CROSSING_CACHE_SECONDS = 300;

// THE SECOND SOURCE OF CANDIDATES: A SIGNED APPLICATION — the 170 go up into the app, in actions.
function tpApplicationsWaiting_(db, boardIdx, tpRows, staffIdx) {
  var out = [];
  var envelopes = [];
  try { envelopes = (typeof packetMirrorRows_ === 'function') ? packetMirrorRows_() : []; }
  catch (e) { return out; }
  if (!envelopes.length) return out;

  // Everybody already IN the legacy roster, by the two keys the doors use.
  var tpMail = {}, tpPhone = {};
  (tpRows || []).forEach(function (c) {
    var e = str_(c.email).toLowerCase().trim();
    if (e) tpMail[e] = true;
    var d = str_(c.phone).replace(/\D/g, '');
    d = d.length > 10 ? d.slice(-10) : d;
    if (d.length === 10) tpPhone[d] = true;
  });

  envelopes.forEach(function (r) {
    if (str_(r.status).toLowerCase() !== 'signed') return;   // only a SIGNED form
    var name = str_(r.candidate).trim();
    if (!name) return;
    var email = str_(r.email).toLowerCase().trim();
    var digits = str_(r.phone).replace(/\D/g, '');
    digits = digits.length > 10 ? digits.slice(-10) : digits;
    if (!email && digits.length !== 10) return;              // nobody to reach
    // Already a card here, or already in the roster: the other source owns them.
    if (tpAlreadyHere_(boardIdx, { name: name, phone: r.phone })) return;
    if ((email && tpMail[email]) || (digits.length === 10 && tpPhone[digits])) return;

    // Already staff?
    var staff = tpStaffHit_(staffIdx, str_(r.phone), email);
    out.push({
      srid: str_(r.signaturerequestid),
      tp_candidate_id: '',
      source: 'application',
      name: name,
      phone: str_(r.phone),
      email: email,
      legacy_status: '',
      applied_at: str_(r.applied),
      signed_at: str_(r.signed),
      cjis: '',
      nota: '',
      decision: '',
      resume_link: '',
      landing: staff ? 'ready' : 'new',
      landing_why: staff
        ? 'already on the staff roster as ' + str_(staff.name) +
          ' — they land at Ready to start and finish by themselves'
        : 'they signed the application form on ' + (str_(r.signed) || 'a day the envelope does not carry')
    });
  });
  return out;
}

// The application forms that never came back signed — pending, or declined.
function tpApplicationsUnfinished_() {
  var out = [];
  var rows = [];
  try { rows = (typeof packetMirrorRows_ === 'function') ? packetMirrorRows_() : []; }
  catch (e) { return out; }
  rows.forEach(function (r) {
    var status = str_(r.status).toLowerCase();
    if (status === 'signed') return;
    var name = str_(r.candidate).trim();
    if (!name) return;
    out.push({
      srid: str_(r.signaturerequestid),
      name: name,
      email: str_(r.email).toLowerCase(),
      phone: str_(r.phone),
      location: str_(r.location),
      status: status === 'declined' ? 'declined' : 'pending',
      applied: str_(r.applied)
    });
  });
  // Pending before declined, then the ones who started longest ago — a form opened in November is a colder trail…
  out.sort(function (a, b) {
    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
    return str_(a.applied).localeCompare(str_(b.applied));
  });
  return out;
}

// THE CROSSING, COMPUTED ONCE (after it turned out agonisingly slow).
function tpCrossingCompute_(db) {
  // THE CHUNKED CACHE, NOT A SINGLE ENTRY.
  var hit = tpCacheGet_(TP_CROSSING_CACHE_KEY);
  if (hit) return hit;
  var cands = tpReadSoft_(db, TP_TABS.candidates);
  if (!cands.length) return { migrated: false, ready: [], held: {}, byId: {} };
  var resume = {};
  tpReadSoft_(db, TP_TABS.resume).forEach(function (r) {
    var id = str_(r.candidateid);
    if (id) resume[id] = r;                      // newest row wins
  });
  var idx = tpOnBoardIndex_(db);
  var staffIdx = tpStaffIndex_();
  var ready = [], held = {}, byId = {}, duplicates = 0, here = 0;
  cands.forEach(function (c) {
    var cid = str_(c.candidateid);
    if (tpIsDuplicate_(c)) {
      duplicates++;
      byId[cid] = 'the legacy marked this row a duplicate';
      return;
    }
    var already = tpAlreadyHere_(idx, c);
    if (already) { here++; byId[cid] = TP_WHY_ON_BOARD; return; }
    var rz = resume[cid] || {};
    var can = tpCrossable_(c, rz, staffIdx);
    if (can.ok) {
      byId[cid] = '';                            // '' = they can come in
      ready.push({
        tp_candidate_id: cid,
        name: str_(c.name),
        phone: str_(c.phone),
        email: str_(c.email),
        legacy_status: str_(c.status),
        cjis: str_(rz.cjisstatus),
        cjis_report: str_(rz.cjisreport),
        nota: str_(rz.compositescore),
        decision: str_(rz.decision),
        resume_link: str_(c.resumelink),
        // WHERE THEY LAND, said before the press — 'new' for a real hiring process, 'ready' for somebody the…
        landing: str_(can.landing) || 'new',
        landing_why: str_(can.why)
      });
      return;
    }
    byId[cid] = str_(can.why);
    var bucket = can.verdict || 'declined';
    held[bucket] = (held[bucket] || 0) + 1;
  });
  // THE SECOND SOURCE — signed applications nobody has picked up.
  var fromForms = [];
  try { fromForms = tpApplicationsWaiting_(db, idx, cands, staffIdx); } catch (eApp) { fromForms = []; }
  ready = ready.concat(fromForms);
  ready.sort(function (a, b) {
    // The roster's people carry a nota and sort by it; an application has none, so the newest signature leads among…
    var na = parseFloat(a.nota) || 0, nb = parseFloat(b.nota) || 0;
    if (nb !== na) return nb - na;
    var sa = str_(a.signed_at), sb = str_(b.signed_at);
    if (sa !== sb) return sb.localeCompare(sa);
    return a.name.localeCompare(b.name);
  });
  // THE NINE WHO STOPPED HALFWAY, and what the platform owes: the system obeys the rules and finishes on its own…
  var unfinished = [];
  try { unfinished = tpApplicationsUnfinished_(); } catch (eU) { unfinished = []; }

  var answer = {
    migrated: true, ready: ready, held: held, byId: byId,
    unfinished: unfinished,
    from_applications: fromForms.length,
    duplicates_hidden: duplicates, already_here: here, total: cands.length
  };
  // Chunked: an answer too big for one slot is split, not dropped.
  tpCachePut_(TP_CROSSING_CACHE_KEY, answer, TP_CROSSING_CACHE_SECONDS);
  return answer;
}

HUB_ACTIONS.talentCrossingList = function (payload, user) {
  if (!tpManager_(user)) return hubDenied_();
  var out = tpCrossingCompute_(ssOpen_(hubId_('HUB_DB_ID')));
  // byId is for the roster's column; the queue does not need to carry it.
  return { status: 200, data: {
    migrated: out.migrated, ready: out.ready, held: out.held,
    duplicates_hidden: out.duplicates_hidden, already_here: out.already_here, total: out.total
  } };
};

/** Drop the queue's cache — every door that changes who is in it calls this. */
function tpBustCrossingCache_() {
  // Chunked now, so the drop has to take every piece with it — a leftover ':n' with missing parts reads as a miss…
  try { tpCacheDrop_(TP_CROSSING_CACHE_KEY); } catch (e) {}
  try { tpBustListCache_(); } catch (e2) {}
}

// THE ENTRY DOOR MOVED HOUSES — the entry that lived in another app is in this one now, and it goes to the talent…
HUB_POLICY.talentPipelineAdd = {
  // 'tool' for the same reason as talentCrossIn: the ANSWER is the product — "they are in" or "somebody with that…
  file: 'TalentPipeline.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    first_name: { required: true, type: 'string' },
    last_name: { required: true, type: 'string' },
    phone: { required: true, type: 'string' },
    email: { required: false, type: 'string' },
    city: { required: false, type: 'string' },
    state: { required: false, type: 'string' },
    resume_link: { required: false, type: 'string' }
  },
  invalidates: [], emits: []
};
HUB_ACTIONS.talentPipelineAdd = function (payload, user) {
  if (!hubIsWriter_(user) || !tpManager_(user)) return hubDenied_();
  var first = str_(payload && payload.first_name).trim();
  var last = str_(payload && payload.last_name).trim();
  var phone = str_(payload && payload.phone).trim();
  var email = str_(payload && payload.email).trim().toLowerCase();
  var check = hubIntakeIdentityCheck_(first, last, phone, email);
  if (!check.ok) return { status: 400, message: check.message };

  var name = (first + ' ' + last).trim();
  var digits = phone.replace(/\D/g, '');
  digits = digits.length > 10 ? digits.slice(-10) : digits;
  var nameKey = name.toLowerCase().replace(/[^a-z]/g, '');
  var db = ssOpen_(hubId_('HUB_DB_ID'));

  // ALREADY IN THE STORE?
  var hit = null;
  tpReadSoft_(db, TP_TABS.candidates).forEach(function (c) {
    if (hit) return;
    var d = str_(c.phone).replace(/\D/g, '');
    d = d.length > 10 ? d.slice(-10) : d;
    var k = str_(c.name).toLowerCase().replace(/[^a-z]/g, '');
    if ((digits && d === digits) || (nameKey && k === nameKey)) hit = c;
  });
  if (hit) {
    return { status: 409, message: str_(hit.name) + ' is already in the Talent Pipeline' +
             (str_(hit.status) ? ' (' + str_(hit.status) + ')' : '') + '.' };
  }
  // ALREADY IN THE PROCESS? Then the store is the wrong book for them.
  var already = tpAlreadyHere_(tpOnBoardIndex_(db), { name: name, phone: phone });
  if (already) {
    return { status: 409, message: name + ' is already a candidate on the hiring board.' };
  }

  var id = 'TPC_' + randomHex_(10).toUpperCase();
  var now = new Date().toISOString();
  tpSheet_(TP_TABS.candidates);          // the tab and its header, guaranteed
  hubAppendRow_(TP_TABS.candidates, {
    candidate_id: id, name: name, first_name: first,
    phone: phone, email: email,
    city: str_(payload.city), state: str_(payload.state),
    // NO STATUS ON PURPOSE.
    status: '', resume_link: str_(payload.resume_link),
    created_at: now, src: 'asa-hub:' + str_(user && user.email), migrated_at: ''
  });
  tpBustCrossingCache_();
  try {
    hubSysLog_(str_(user && user.email), 'talent_pipeline_add',
               name + ' — ' + id + ' typed into the Talent Pipeline', { status: 200 });
  } catch (eL) {}
  return { status: 200, data: { tp_candidate_id: id, name: name } };
};

// ONE PERSON COMES IN.
HUB_POLICY.talentCrossIn = {
  // 'tool' AND NOT 'write' IS THE TIER, DECLARED — the same reason hiringSimSeed carries it.
  file: 'TalentPipeline.gs', lane: 'tool', store: 'sheet',
  // Re-pressing is safe by construction: the door refuses a duplicate and reports the existing card instead of…
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { tp_candidate_id: { required: true, type: 'string' } },
  // IT CAN REACH A PERSON, AND IT SAYS SO (the emits gate caught this, which is exactly what that gate is for).
  invalidates: ['candidates'], emits: ['emailSend']
};
// MINT A CARD FROM A SIGNED APPLICATION.
function tpMoveFromApplication_(env, landing, approver) {
  var name = str_(env.candidate).trim();
  var words = name.split(/\s+/).filter(String);
  var first = words[0] || '';
  var last = words.length > 1 ? words.slice(1).join(' ') : '';
  var phone = str_(env.phone);
  var email = str_(env.email).toLowerCase().trim();
  if (email.indexOf('@') === -1) email = '';
  if (!phone && !email) return { moved: false, reason: 'the envelope carries no way to reach them' };

  var digits = phone.replace(/\D/g, '').replace(/^1/, '');
  var dup = hubFindDuplicate_(digits, email);
  if (dup) {
    return { moved: true, candidate_id: dup.id, matched_existing: true };
  }
  var guard = contactGuard_(phone, email, { name: name, trusted: true });
  if (guard && guard.severity !== 'warn' && cgEnforces_('auth')) {
    if (landing !== 'ready') return { moved: false, reason: contactGuardMessage_(guard) };
    try {
      hubSysLog_(str_(approver), 'staff_guard_override',
                 name + ' — application crossing, already on the staff roster', { status: 200 });
    } catch (eOv) {}
  }
  var id = 'CAN_' + randomHex_(20).toUpperCase();
  var now = new Date().toISOString();
  hubEnsureColumns_(TALENT_CANDIDATES_TAB, ['source', 'resume_link']);
  hubAppendRow_(TALENT_CANDIDATES_TAB, {
    candidate_id: id, candidate_name: name, first_name: first, last_name: last,
    phone: phone, email: email,
    city: str_(env.location),
    status: HUB_STAGE_TO_STATUS['new'],
    // WHERE THEY CAME FROM, in the word the card already understands.
    source: 'Application form',
    created_at: now, updated_at: now,
    // The prefix that keeps the Added Manually machine asleep.
    created_by: 'asa-hub-talent-auth:' + str_(approver)
  });
  hubBustTalentCache_();
  return { moved: true, candidate_id: id };
}

// REMOVE A STORE ROW — there is a REMOVE button, and what is removed goes to the archive.
HUB_POLICY.talentPoolArchive = {
  file: 'TalentPipeline.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    tp_candidate_id: { required: true, type: 'string' },
    archived: { required: false, type: 'boolean' },
    reason: { required: false, type: 'string' }
  },
  invalidates: ['talentPool'], emits: []
};
HUB_ACTIONS.talentPoolArchive = function (payload, user) {
  if (!hubIsWriter_(user) || !tpManager_(user)) return hubDenied_();
  var cid = str_(payload && payload.tp_candidate_id);
  if (!cid) return { status: 400, message: 'Which row? A tp_candidate_id is required.' };
  var hide = !(payload && payload.archived === false);

  var sheet = hubTabSheet_(TP_TABS.candidates);
  if (!sheet) return { status: 404, message: 'The Talent Pipeline store has no tab yet.' };
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('candidate_id');
  if (iId === -1) return { status: 500, message: 'candidate_id column missing' };
  // Additive, created the first time somebody removes anyone.
  ensureHeader_(sheet, ['archived', 'archived_at', 'archived_by', 'archived_reason']);
  hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  var name = '';
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() !== cid) continue;
    var row = r + 1;
    var now = new Date().toISOString();
    var put = function (col, v) {
      var i = hdr.indexOf(col);
      if (i !== -1) sheet.getRange(row, i + 1).setValue(v);
    };
    put('archived', hide ? 'TRUE' : 'FALSE');
    put('archived_at', hide ? now : '');
    put('archived_by', hide ? str_(user.email) : '');
    put('archived_reason', hide ? str_(payload && payload.reason).slice(0, 200) : '');
    var iName = hdr.indexOf('name');
    name = iName === -1 ? cid : String(values[r][iName] || cid);
    // Both shapes AND the queue: this row leaves (or rejoins) every one of them.
    tpBustCrossingCache_();
    hubSysLog_(str_(user.email), 'talentPoolArchive',
               cid + ' — ' + (hide ? 'removed from the store' : 'put back in the store'),
               { status: 200 });
    return { status: 200, data: { tp_candidate_id: cid, name: name, archived: hide } };
  }
  return { status: 404, message: 'No Talent Pipeline row "' + cid + '".' };
};

HUB_ACTIONS.talentCrossIn = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.tp_candidate_id);
  var srid = str_(payload && payload.srid);
  if (!cid && !srid) return { status: 400, message: 'Send tp_candidate_id or srid.' };

  // TWO SOURCES, ONE DOOR.
  if (!cid && srid) {
    var env = null;
    try {
      (packetMirrorRows_() || []).forEach(function (r) {
        if (str_(r.signaturerequestid) === srid) env = r;      // last wins
      });
    } catch (eEnv) { env = null; }
    if (!env) return { status: 404, message: 'No application envelope "' + srid + '".' };
    if (str_(env.status).toLowerCase() !== 'signed') {
      return { status: 409, message: 'That application is not signed — it reads ' +
               (str_(env.status) || 'nothing') + '.' };
    }
    var eName = str_(env.candidate).trim();
    var eStaff = tpStaffHit_(tpStaffIndex_(), str_(env.phone), str_(env.email));
    var eLanding = eStaff ? 'ready' : 'new';
    var eMoved = tpMoveFromApplication_(env, eLanding, str_(user && user.email));
    if (!eMoved.moved) {
      try {
        journeyLog_({ candidate_id: '', name: eName, step: 'talent_cross', channel: 'record',
                      ok: false, title: 'The crossing was refused',
                      detail: 'from a signed application — ' + str_(eMoved.reason),
                      by: str_(user && user.email) });
      } catch (eJ) {}
      return { status: 409, message: eMoved.reason || 'The move was refused.' };
    }
    if (eLanding === 'ready' && !eMoved.matched_existing) {
      try {
        hubSetStatus_(str_(eMoved.candidate_id), HUB_STAGE_TO_STATUS['ready'],
                      { email: 'asa-hub-talent-auth:' + str_(user && user.email) });
        hubEnsureColumns_(TALENT_CANDIDATES_TAB, ['talent_finish_at', 'talent_finish_why']);
        hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, str_(eMoved.candidate_id), {
          talent_finish_at: new Date(Date.now() + tpFinishMinutes_() * 60000).toISOString(),
          talent_finish_why: 'already on the staff roster as ' + str_(eStaff && eStaff.name)
        }, { email: 'asa-hub-talent-auth:' + str_(user && user.email) }, false);
        hubBustTalentCache_();
      } catch (eL2) { /* the card stands at New; the journey says what happened */ }
    }
    tpBustCrossingCache_();
    try {
      hubSysLog_(str_(user && user.email), 'talent_cross_in',
                 eName + ' (application ' + srid + ') — ' + str_(eMoved.candidate_id), { status: 200 });
    } catch (eL3) {}
    try {
      journeyLog_({ candidate_id: str_(eMoved.candidate_id), name: eName, step: 'talent_cross',
                    channel: 'record', ok: true,
                    title: 'They came in from a signed application',
                    detail: 'they signed the application form on ' + (str_(env.signed) || 'a day the envelope does not carry') +
                            ' and were in no book here; they start at ' +
                            (eLanding === 'ready' ? 'Ready to start' : 'New'),
                    by: str_(user && user.email) });
    } catch (eJ2) {}
    return { status: 200, data: { moved: true, candidate_id: eMoved.candidate_id,
                                  matched_existing: !!eMoved.matched_existing } };
  }
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var cand = null;
  tpReadSoft_(db, TP_TABS.candidates).forEach(function (c) {
    if (str_(c.candidateid) === cid) cand = c;                    // last wins
  });
  if (!cand) return { status: 404, message: 'No Talent Pipeline row "' + cid + '".' };
  var rz = null;
  tpReadSoft_(db, TP_TABS.resume).forEach(function (r) {
    if (str_(r.candidateid) === cid) rz = r;
  });
  // EVERY OUTCOME LEAVES A TRACE — pressed on a real person, it was as if nothing had been pressed at all: the…
  var trace = function (ok, what) {
    try {
      hubSysLog_(str_(user && user.email), 'talent_cross_in',
                 str_(cand.name) + ' (' + cid + ') — ' + what, { status: ok ? 200 : 409 });
    } catch (eT) {}
    try {
      journeyLog_({ candidate_id: cid, name: str_(cand.name), step: 'talent_cross',
                    channel: 'record', ok: ok,
                    title: ok ? 'They came in from the Talent Pipeline'
                              : 'The crossing was refused',
                    detail: what, by: str_(user && user.email) });
    } catch (eJ) {}
  };

  var can = tpCrossable_(cand, rz || {}, tpStaffIndex_());
  if (!can.ok) {
    trace(false, 'refused — ' + can.why);
    return { status: 409, message: 'They cannot come in: ' + can.why };
  }
  var already = tpAlreadyHere_(tpOnBoardIndex_(db), cand);
  if (already) {
    trace(false, 'already on the board as ' + already);
    return { status: 200, data: { moved: false, matched_existing: true, candidate_id: already,
                                  message: str_(cand.name) + ' is already on the board.' } };
  }
  var landing = str_(can.landing) || 'new';
  var moved = tpAuthMove_({
    candidateid: cid, candidatename: str_(cand.name), askid: '',
    // Only the already-employed lane forces the contact guard, and only with the guard's own reason written down.
    force_contact: landing === 'ready' ? can.why : '',
    why: 'Brought in from the Talent Pipeline by ' + str_(user && user.email) +
         ' — the legacy record said ' + (str_(cand.status) || 'nothing') +
         ' and its background check read ' + (str_(rz && rz.cjisstatus) || 'nothing') + '.'
  }, db, str_(user && user.email));
  if (!moved.moved) {
    trace(false, 'the move door refused — ' + (moved.reason || 'no reason given'));
    return { status: 409, message: moved.reason || 'The move was refused.' };
  }
  // THEY LAND AT THE END, AND THEY FINISH BY THEMSELVES.
  if (landing === 'ready' && !moved.matched_existing) {
    try {
      hubSetStatus_(str_(moved.candidate_id), HUB_STAGE_TO_STATUS['ready'],
                    { email: 'asa-hub-talent-auth:' + str_(user && user.email) });
      hubEnsureColumns_(TALENT_CANDIDATES_TAB, ['talent_finish_at', 'talent_finish_why']);
      var mins = tpFinishMinutes_();
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, str_(moved.candidate_id), {
        talent_finish_at: new Date(Date.now() + mins * 60000).toISOString(),
        talent_finish_why: can.why
      }, { email: 'asa-hub-talent-auth:' + str_(user && user.email) }, false);
      hubBustTalentCache_();
    } catch (eLand) {
      trace(false, 'they crossed but could not be placed at Ready to start — ' +
            String((eLand && eLand.message) || eLand));
    }
  }
  tpBustCrossingCache_();
  trace(true, (moved.matched_existing
    ? 'matched the existing card ' + str_(moved.candidate_id) + ' — the notas crossed, no second row'
    : 'became ' + str_(moved.candidate_id) + ' at ' + (landing === 'ready' ? 'Ready to start' : 'New') +
      '; ' + (landing === 'ready' ? can.why + '. ' : '') + 'the legacy said ' + (str_(cand.status) || 'nothing') +
      ' and its background check read ' + (str_(rz && rz.cjisstatus) || 'nothing') +
      '; the notas crossed with them and they start at New'));
  return { status: 200, data: { moved: true, candidate_id: moved.candidate_id,
                                matched_existing: !!moved.matched_existing } };
};

// One candidate's scored tp row — the nota profile every candidate page builds on.
function candidateTpRow_(cid, name, tpId) {
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var joined = tpJoinedRows_(db);
  if (!joined.migrated || !joined.rows.length) return null;
  var rows = joined.rows;
  // The hourly sync mirrors hub cards into tp_candidates SCORELESS, so the same person can answer twice — a…
  var movedId = '';
  tpReadSoft_(db, TP_AUTH_TAB).forEach(function (a) {
    if (str_(a.movedcandidateid) === cid) movedId = str_(a.candidateid);
  });
  var want = String(name || '').trim().toLowerCase();
  var keyed = [null, null, null, null];   // stamp · direct id · moved id · name
  // NUMERIC composite only — the legacy column holds the occasional "No".
  var scoredRow_ = function (r) { return r && isFinite(parseFloat(str_(r.composite_score))); };
  rows.forEach(function (r) {
    var scored = scoredRow_(r);
    var place = function (idx, match) {
      if (!match) return;
      if (!keyed[idx] || (scored && !str_(keyed[idx].composite_score))) keyed[idx] = r;
    };
    place(0, tpId && r.candidate_id === tpId);
    place(1, r.candidate_id === cid);
    place(2, movedId && r.candidate_id === movedId);
    place(3, want && String(r.name || '').trim().toLowerCase() === want);
  });
  var hit = null;
  for (var k = 0; k < keyed.length && !hit; k++) {
    if (scoredRow_(keyed[k])) hit = keyed[k];
  }
  for (var f = 0; f < keyed.length && !hit; f++) hit = keyed[f];
  if (!hit) return null;
  var ranked = tpRank_(rows);
  for (var m = 0; m < ranked.length; m++) {
    if (ranked[m].candidate_id === hit.candidate_id) { hit.rank = m + 1; break; }
  }
  return hit;
}

// ------------------------------------------------------------------ THE AUTHORIZATION LOOP…

var TP_AUTH_TAB = 'tp_authorizations';
var TP_AUTH_HEADERS = ['ask_id', 'candidate_id', 'candidate_name', 'rank', 'nota',
  'requested_at', 'requested_by', 'recipients', 'state', 'reply_message_id',
  'reply_from', 'reply_verdict', 'reply_analyzed_at', 'moved_candidate_id', 'moved_at'];
/** One model verdict per message, ever — this tab is the memory (STAFF_AI_TAB's shape). */
var TP_AUTH_AI_TAB = 'tp_auth_ai';
var TP_AUTH_AI_HEADER = ['message_id', 'verdict', 'approves', 'denies', 'via', 'seen_at'];
/** The exact dictated SMS. */
var TP_AUTH_SMS = 'asamylife need help in one decision. thanks and check your email';

function tpAuthSheet_(tab, headers) {
  var sheet = hubTabEnsure_(tab, headers);
  // The ask tab predates its reply columns; an older one still gains them.
  if (!sheet.isRuntimeBacked) ensureHeader_(sheet, headers);
  return sheet;
}

/** Nota: the legacy composite is /12; nota is the same number on 0-10. Pure. */
function tpNota_(composite) {
  var n = parseFloat(composite);
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(10, Math.round((n / 12) * 100) / 10));
}

// Eligible: Advance (or Review with zero red flags), CJIS not failed, screen not Reject.
function tpRankEligible_(r) {
  // SOMEBODY ALREADY IN THE PROCESS IS NOT A DECISION TO TAKE — in the live ranking Mandy Radtka stood FIRST with…
  try {
    if (typeof talentStage_ === 'function' && talentStage_(str_(r.status))) return false;
  } catch (eS) { /* an unreadable status is not a reason to hide somebody */ }
  var d = str_(r.decision);
  if (d !== 'Advance' && !(d === 'Review' && !(r.flags || []).length)) return false;
  if (/fail/i.test(str_(r.cjis))) return false;
  if (/reject/i.test(str_(r.screen_result))) return false;
  return true;
}

// score = nota + 0.5 qualification pass + 0.25 all six screen checks − 0.75 per red flag.
function tpRankScore_(r) {
  var nota = tpNota_(r.composite_score);
  if (nota === null) return null;
  var s = nota;
  if (/pass/i.test(str_(r.screen_qualification))) s += 0.5;
  if (r.screen_checks_all === true) s += 0.25;
  s -= 0.75 * ((r.flags || []).length);
  return Math.round(s * 100) / 100;
}

/** Eligible rows, best first; ties by years_caregiving. Pure. */
function tpRank_(rows) {
  var ranked = (rows || []).filter(function (r) {
    // A collected row LEFT the pool: every collection consumes its five, the ranking re-runs by itself on the next…
    if (str_(r.collected_at)) return false;
    return tpRankEligible_(r) && tpRankScore_(r) !== null;
  });
  ranked.sort(function (a, b) {
    var d = (tpRankScore_(b) || 0) - (tpRankScore_(a) || 0);
    if (d) return d;
    return (parseFloat(b.years) || 0) - (parseFloat(a.years) || 0);
  });
  return ranked;
}

// THE COLLECTION CONSUMES: the shortlist's five are stamped collected_at/by on tp_candidates and tpRank_ skips them…
function tpMarkCollected_(ids, by) {
  if (!ids || !ids.length) return 0;
  var sheet = tpSheet_(TP_TABS.candidates);
  ensureHeader_(sheet, ['collected_at', 'collected_by']);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('candidate_id'), iAt = hdr.indexOf('collected_at'),
      iBy = hdr.indexOf('collected_by');
  if (iId === -1 || iAt === -1) return 0;
  var want = {};
  ids.forEach(function (id) { want[str_(id)] = true; });
  var n = 0, now = new Date().toISOString();
  for (var r = 1; r < values.length; r++) {
    if (!want[String(values[r][iId]).trim()]) continue;
    if (String(values[r][iAt]).trim()) continue;
    sheet.getRange(r + 1, iAt + 1).setValue(now);
    if (iBy !== -1) sheet.getRange(r + 1, iBy + 1).setValue(String(by || ''));
    n++;
  }
  return n;
}

// The ask: top-5 by the pure rank, ONE letter + ONE SMS per configured leader, every send through rpcCall_.
HUB_POLICY.talentAuthorizationSend = {
  file: 'TalentPipeline.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: ['emailSend', 'smsSend']
};
HUB_ACTIONS.talentAuthorizationSend = function (payload, user) {
  if (!tpManager_(user)) return hubDenied_();
  // A Smart Comms situation (talent_authorization_ask): off, no ask is written and nobody is written to.
  var sit = hubLaneSituation_('talent_authorization_ask');
  if (!sit.on) return { status: 409, message: 'Nobody was asked: ' + sit.why + '.' };
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var joined = tpJoinedRows_(db);
  var top5 = tpRank_(joined.rows).slice(0, 5);
  if (!top5.length) return { status: 409, message: 'No eligible candidate to ask about yet.' };
  var open = {};
  tpReadSoft_(db, TP_AUTH_TAB).forEach(function (a) {
    var st = str_(a.state);
    if (st === 'requested' || st === 'approved') open[str_(a.candidateid)] = st;
  });
  var fresh = top5.filter(function (r) { return !open[r.candidate_id]; });
  if (!fresh.length) {
    return { status: 409, message: 'Every candidate in the top 5 already has an open or ' +
             'approved ask — the platform is waiting on the leaders\' reply.' };
  }
  // recipients come from Settings (AlertsConfig) — never typed here
  var to = hubAlertRecipients_();
  var sheet = tpAuthSheet_(TP_AUTH_TAB, TP_AUTH_HEADERS);
  var now = new Date().toISOString();
  var items = top5.map(function (r, i) {
    return { rank: i + 1, name: r.name, nota: tpNota_(r.composite_score),
             score: tpRankScore_(r), decision: r.decision, stage: r.status,
             flags: r.flags, cjis: r.cjis, screen: r.screen_result };
  });
  fresh.forEach(function (r) {
    var rank = 0;
    for (var i = 0; i < top5.length; i++) if (top5[i].candidate_id === r.candidate_id) rank = i + 1;
    sheet.appendRow(['ASK_' + randomHex_(12).toUpperCase(), r.candidate_id, r.name, rank,
                     tpNota_(r.composite_score), now, str_(user.email), to.emails.join(', '),
                     'requested', '', '', '', '', '', '']);
  });
  var letter = talentAuthorizationEmail_({ items: items });
  var authVars = { count: String(items.length),
                   list: items.map(function (it) { return it.rank + '. ' + it.name; }).join('\n') };
  var subjectOut = sit.word('email_subject', letter.subject, authVars);
  var textOut = sit.word('email_text', letter.text, authVars);
  var batch = randomHex_(8);
  var emailed = 0, texted = 0;
  for (var e = 0; sit.leg('email') && e < to.emails.length; e++) {
    var rE = rpcCall_('emailSend', {
      to: to.emails[e], subject: subjectOut, body: textOut, html: letter.html,
      reason: 'smart comms: talent_authorization_ask'
    }, { idempotency_key: 'tpauth_' + batch + '_e' + e });
    if (rE && rE.sent) emailed++;
  }
  var smsOut = sit.word('sms_text', TP_AUTH_SMS, authVars);
  for (var s = 0; sit.leg('sms') && s < to.sms.length; s++) {
    var rS = rpcCall_('smsSend', {
      to: to.sms[s], body: smsOut,
      reason: 'smart comms: talent_authorization_ask'
    }, { idempotency_key: 'tpauth_' + batch + '_s' + s });
    if (rS && rS.sent) texted++;
  }
  hubSysLog_(str_(user.email), 'talent_auth_send',
             fresh.length + ' ask(s), ' + emailed + ' email(s), ' + texted + ' sms', { status: 200 });
  return { status: 200, data: { asked: fresh.length, already_open: top5.length - fresh.length,
           emails_sent: emailed, sms_sent: texted,
           top5: items.map(function (it) { return it.name; }) } };
};

/** The reply reader — service clock or an admin by hand (talentPipelineSync's shape). */
HUB_POLICY.talentAuthorizationSweep = {
  file: 'TalentPipeline.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.talentAuthorizationSweep = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && String(user.role) !== 'admin') return hubDenied_();
  return tpAuthSweepRun_();
};

// ONE model read per message.
function tpAuthReadReply_(t, openNames) {
  if (typeof screenAiChat_ !== 'function') return null;
  var text = ('FROM: ' + str_(t.from_addr) + '\nSUBJECT: ' + str_(t.subject) +
              '\n' + str_(t.snippet)).slice(0, 1500);
  var ask =
    'A company leader is replying to a hiring-authorization request. The ONLY candidates ' +
    'with an open ask are: ' + openNames.join('; ') + '.\n\nMESSAGE:\n' + text + '\n\n' +
    'Which of those candidates does the message say to PROCEED with, and which does it say ' +
    'NOT to proceed with? Use only names from the list, spelled exactly as listed. ' +
    'If the message decides nothing, both arrays are empty.\n' +
    'Reply with JSON only: {"approves":["<name>"],"denies":["<name>"]}';
  var res = null;
  try { res = screenAiChat_(ask, 0.1, 'ai_crossing_reply'); } catch (e) { res = null; }
  if (!res || !res.ok) return null;
  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (e2) { parsed = null; }
  if (!parsed) return null;
  var arr = function (v) {
    return Array.isArray(v) ? v.map(function (x) { return String(x); }) : [];
  };
  var approves = arr(parsed.approves), denies = arr(parsed.denies);
  var both = {};
  approves.forEach(function (n) { if (denies.indexOf(n) !== -1) both[n] = true; });
  return { approves: approves.filter(function (n) { return !both[n]; }),
           denies: denies.filter(function (n) { return !both[n]; }),
           via: str_(res.via) };
}

/** Patch one ask row by ask_id, header-addressed. */
function tpAuthUpdate_(askId, patch) {
  var sheet = tpAuthSheet_(TP_AUTH_TAB, TP_AUTH_HEADERS);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('ask_id');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() !== String(askId)) continue;
    for (var k in patch) {
      if (!patch.hasOwnProperty(k)) continue;
      var c = hdr.indexOf(k);
      if (c !== -1) sheet.getRange(r + 1, c + 1).setValue(patch[k]);
    }
    return true;
  }
  return false;
}

// The sweep body.
function tpAuthSweepRun_() {
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  // BEFORE the early return — moved candidates get their notas even when no ask is open (blank-only carry, one pass…
  try { tpAuthHealMoved_(db); } catch (eHeal) {}
  var openAsks = tpReadSoft_(db, TP_AUTH_TAB).filter(function (a) {
    return str_(a.state) === 'requested';
  });
  if (!openAsks.length) return { status: 200, data: { checked: 0, note: 'no open asks' } };

  // the deterministic gate, BEFORE any AI: only the configured leaders
  var allowed = hubAlertRecipients_().emails.map(function (e) {
    return String(e).toLowerCase();
  });

  var inbox = platformMailPost_('/mail/inbox', { limit: 50 });
  if (!inbox || inbox.status !== 200) {
    return { status: 502, message: 'The mailbox did not answer: ' +
             String(inbox && inbox.message).slice(0, 120) };
  }
  var threads = (inbox.data && inbox.data.threads) || [];

  var aiSheet = tpAuthSheet_(TP_AUTH_AI_TAB, TP_AUTH_AI_HEADER);
  var aiSeen = {};
  tpReadSoft_(db, TP_AUTH_AI_TAB).forEach(function (r) {
    if (str_(r.messageid)) aiSeen[str_(r.messageid)] = str_(r.verdict);
  });

  var openByName = {};
  openAsks.forEach(function (a) { openByName[str_(a.candidatename).toLowerCase()] = a; });

  var checked = 0, approved = 0, denied = 0, moved = 0, skipped = [];
  for (var i = 0; i < threads.length; i++) {
    var t = threads[i];
    var mid = str_(t.id);
    if (!mid || aiSeen[mid] !== undefined) continue;   // judged once, ever (incl. 'none')
    var from = str_(t.from_addr).toLowerCase();
    var authorized = false;
    for (var a2 = 0; a2 < allowed.length; a2++) {
      if (allowed[a2] && from.indexOf(allowed[a2]) !== -1) { authorized = true; break; }
    }
    if (!authorized) continue;                          // never reaches the model
    checked++;
    var verdict = tpAuthReadReply_(t, openAsks.map(function (a) {
      return str_(a.candidatename);
    }));
    if (!verdict) continue;                             // no provider — next sweep retries
    // the anti-invention gate: a name matching no open ask is refused
    var okApprove = (verdict.approves || []).filter(function (n) {
      return !!openByName[String(n).toLowerCase()];
    });
    var okDeny = (verdict.denies || []).filter(function (n) {
      return !!openByName[String(n).toLowerCase()];
    });
    var kind = (okApprove.length || okDeny.length) ? 'decided' : 'none';
    aiSheet.appendRow([mid, kind, okApprove.join('; '), okDeny.join('; '),
                       str_(verdict.via), new Date().toISOString()]);
    aiSeen[mid] = kind;
    if (kind === 'none') continue;
    var now = new Date().toISOString();
    okDeny.forEach(function (n) {
      var ask = openByName[String(n).toLowerCase()];
      if (!ask) return;
      tpAuthUpdate_(str_(ask.askid), { state: 'denied', reply_message_id: mid,
        reply_from: str_(t.from_addr), reply_verdict: 'deny', reply_analyzed_at: now });
      delete openByName[String(n).toLowerCase()];
      denied++;
    });
    okApprove.forEach(function (n) {
      var ask = openByName[String(n).toLowerCase()];
      if (!ask) return;
      tpAuthUpdate_(str_(ask.askid), { state: 'approved', reply_message_id: mid,
        reply_from: str_(t.from_addr), reply_verdict: 'approve', reply_analyzed_at: now });
      approved++;
      var mv = tpAuthMove_(ask, db, str_(t.from_addr));
      if (mv.moved) {
        tpAuthUpdate_(str_(ask.askid), { state: 'moved',
          moved_candidate_id: mv.candidate_id, moved_at: new Date().toISOString() });
        moved++;
      } else if (mv.reason) {
        skipped.push(str_(ask.candidatename) + ': ' + mv.reason);
      }
      delete openByName[String(n).toLowerCase()];
    });
  }
  if (checked || approved || denied || moved || skipped.length) {
    hubSysLog_('asa-hub:talent-auth', 'talent_auth_sweep',
               checked + ' read, ' + approved + ' approved, ' + denied + ' denied, ' +
               moved + ' moved' + (skipped.length ? ', skipped: ' + skipped.join(' | ').slice(0, 120) : ''),
               { status: 200 });
  }
  return { status: 200, data: { checked: checked, approved: approved, denied: denied,
           moved: moved, skipped: skipped } };
}

// The move — resumeIntakeCommit's shape, degraded gracefully: the tp row may lack first/last (split the name) and a…
var TP_CARRY_MAP = {
  months_since_last: 'months_since_last_experience',
  years_caregiving: 'total_years_caregiving',
  avg_tenure: 'avg_tenure_per_job',
  highest_responsibility: 'highest_responsibility',
  availability: 'schedule_availability',
  num_agencies: 'num_dsp_agencies',
  consistency: 'consistency_in_field',
  leadership_ratio: 'leadership_ratio',
  setting_balance: 'setting_balance',
  care_experience: 'care_experience',
  certifications: 'listed_certifications',
  skills_rating: 'skills_rating',
  certs_rating: 'certs_rating',
  experience_rating: 'experience_rating',
  job_history_rating: 'job_history_rating',
  composite_score: 'composite_score',
  flag_short_tenure: 'red_flag_short_tenure',
  flag_no_certs: 'red_flag_no_certs',
  flag_stale: 'red_flag_stale_experience',
  summary: 'summary',
  cjis_status: 'cjis_status',
  // THE NAME ON OUR SIDE IS cjis_report_URL, and this wrote `cjis_report` (found, before anybody crossed).
  cjis_report: 'cjis_report_url'
};

// The newest scored tp_resume row for one tp candidate, mapped onto the hiring analyses columns.
function tpCarriedFields_(db, tpCid) {
  var rz = null;
  tpReadSoft_(db, TP_TABS.resume).forEach(function (r) {
    if (str_(r.candidateid) === tpCid) rz = r;   // newest row wins
  });
  if (!rz) return { found: false, fields: {} };
  var fields = {};
  for (var src in TP_CARRY_MAP) {
    var v = str_(rz[src.replace(/[^a-z0-9]/g, '')]);
    if (v) fields[TP_CARRY_MAP[src]] = v;
  }
  return { found: true, fields: fields };
}

// Stamps tp_candidate_id on the hiring card and fills the BLANK score columns on its newest analysis row — a value…
function tpCarryScores_(db, tpCid, hiringCid) {
  ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB), ['tp_candidate_id']);
  var card = null;
  readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (str_(c.candidateid) === hiringCid) card = c;
  });
  if (card && !str_(card.tpcandidateid)) {
    hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, hiringCid,
      { tp_candidate_id: tpCid }, { email: 'talent-auth' }, false);
  }
  var carried = tpCarriedFields_(db, tpCid);
  if (!carried.found) return { filled: 0 };
  var last = null;
  readTabNormalized_(db, TALENT_RESUME_TAB).forEach(function (a) {
    if (str_(a.candidateid) === hiringCid) last = a;   // the row hubSetFieldLastRow_ writes
  });
  var fill = {};
  var n = 0;
  for (var col in carried.fields) {
    var cur = last ? str_(last[col.replace(/[^a-z0-9]/g, '')]) : '';
    if (!cur) { fill[col] = carried.fields[col]; n++; }
  }
  if (n) {
    ensureHeader_(hubSheet_(TALENT_RESUME_TAB), Object.keys(fill));
    hubSetFieldLastRow_(TALENT_RESUME_TAB, hiringCid, fill, { email: 'talent-auth' }, true);
  }
  return { filled: n };
}

// Candidates already on the hiring board get their notas too — first the authorization tab's two ids, then the…
function tpAuthHealMoved_(db) {
  var cache = CacheService.getScriptCache();
  if (cache.get('tp_heal_moved_v2')) return;
  cache.put('tp_heal_moved_v2', '1', 21600);
  tpReadSoft_(db, TP_AUTH_TAB).forEach(function (a) {
    if (str_(a.state) !== 'moved') return;
    var hid = str_(a.movedcandidateid), tid = str_(a.candidateid);
    if (hid && tid) { try { tpCarryScores_(db, tid, hid); } catch (eHeal) {} }
  });
  // The name pass — how every candidate who never crossed through the authorization loop still gets stamped and…
  try {
    var joined = tpJoinedRows_(db);
    if (!joined.migrated || !joined.rows.length) return;
    var scoredByName = {};
    joined.rows.forEach(function (r) {
      var n = String(r.name || '').trim().toLowerCase();
      // NUMERIC composite only — the legacy column holds the occasional "No".
      if (n && isFinite(parseFloat(str_(r.composite_score)))) scoredByName[n] = r.candidate_id;
    });
    readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (str_(c.archived).toLowerCase() === 'true') return;
      if (str_(c.tpcandidateid)) return;                 // already stamped
      var tid = scoredByName[str_(c.candidatename).toLowerCase()];
      if (tid) { try { tpCarryScores_(db, tid, str_(c.candidateid)); } catch (eN) {} }
    });
  } catch (eHealName) { /* the sweep never pays for the healer */ }
}

function tpAuthMove_(ask, db, approver) {
  var cid = str_(ask.candidateid);
  var cand = null;
  tpReadSoft_(db, TP_TABS.candidates).forEach(function (c) {
    if (str_(c.candidateid) === cid) cand = c;
  });
  if (!cand) return { moved: false, reason: 'no tp_candidates row for ' + cid };
  var name = str_(cand.name) || str_(ask.candidatename);
  var words = name.split(/\s+/).filter(String);
  var first = str_(cand.firstname) || words[0] || '';
  var last = words.length > 1 ? words.slice(1).join(' ') : '';
  var phone = str_(cand.phone);
  var email = str_(cand.email).toLowerCase();
  if (email.indexOf('@') === -1) email = '';
  if (!phone && !email) {
    return { moved: false, reason: 'neither a phone nor an e-mail on the record' };
  }
  var digits = phone.replace(/\D/g, '').replace(/^1/, '');
  var dup = hubFindDuplicate_(digits, email);
  if (dup) {
    // report the match, never absorb — the person already has a hiring card; the notas still cross (blank-only…
    hubSysLog_('asa-hub:talent-auth', 'talent_auth_match_existing',
               name + ' matched ' + dup.id + ' (' + dup.name + ')', { status: 200 });
    try { tpCarryScores_(db, cid, dup.id); } catch (eCarry) {}
    return { moved: true, candidate_id: dup.id, matched_existing: true };
  }
  var guard = contactGuard_(phone, email, { name: name, trusted: true });
  if (guard && guard.severity !== 'warn' && cgEnforces_('auth')) {
    // THE GUARD IS RIGHT AND THE ANSWER IS STILL YES.
    if (!str_(ask.force_contact)) {
      return { moved: false, reason: contactGuardMessage_(guard) };
    }
    try {
      hubSysLog_(str_(approver), 'staff_guard_override',
                 name + ' — ' + (guard ? guard.severity : '?') + ': ' +
                 str_(ask.force_contact).slice(0, 300), { status: 200 });
    } catch (eOv) {}
  }
  var id = 'CAN_' + randomHex_(20).toUpperCase();
  var now = new Date().toISOString();
  ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB), ['tp_candidate_id']);
  hubAppendRow_(TALENT_CANDIDATES_TAB, {
    candidate_id: id, candidate_name: name, first_name: first, last_name: last,
    phone: phone, email: email, city: str_(cand.city), state: str_(cand.state),
    status: 'New', resume_link: str_(cand.resumelink),
    tp_candidate_id: cid,
    created_at: now, updated_at: now,
    created_by: 'asa-hub-talent-auth:' + str_(approver)
  });
  // The notas cross WITH the person — the analysis row is born scored, the tp summary wins over the provenance stub…
  var carried = tpCarriedFields_(db, cid);
  var aRow = {
    candidate_id: id,
    // WHY THEY CROSSED, in the words of whoever crossed them.
    summary: str_(ask.why) ||
             ('Moved from the Talent Pipeline after leader authorization (ask ' +
              str_(ask.askid) + ').'),
    created_at: now, updated_at: now, created_by: 'asa-hub:talent-auth'
  };
  for (var ck in carried.fields) aRow[ck] = carried.fields[ck];
  if (carried.found) ensureHeader_(hubSheet_(TALENT_RESUME_TAB), Object.keys(carried.fields));
  hubAppendRow_(TALENT_RESUME_TAB, aRow);
  hubBustTalentCache_();
  return { moved: true, candidate_id: id };
}

// NOBODY WITHOUT A CONTACT WAITS IN THE STORE — a candidate with no phone and no e-mail goes straight to the…
var TP_NOCONTACT_PER_PASS = 25;

function tpArchiveNoContactMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('talent_nocontact_sweep')) return;
  cache.put('talent_nocontact_sweep', '1', 900);

  var db, rows;
  try {
    db = ssOpen_(hubId_('HUB_DB_ID'));
    rows = tpReadSoft_(db, TP_TABS.candidates);
  } catch (eR) {
    tpSweepIdle_('talent-nocontact', 'the store could not be read');
    return;
  }
  var sheet;
  try { sheet = tpSheet_(TP_TABS.candidates); } catch (eS) { return; }
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('candidateid');
  var iArch = hdr.indexOf('archived');
  var iAt = hdr.indexOf('archivedat');
  var iBy = hdr.indexOf('archivedby');
  var iWhy = hdr.indexOf('archivedreason');
  if (iId === -1 || iArch === -1) {
    tpSweepIdle_('talent-nocontact', 'the store has no archived column to write');
    return;
  }

  var now = new Date().toISOString();
  var done = 0, names = [];
  for (var r = 1; r < values.length && done < TP_NOCONTACT_PER_PASS; r++) {
    if (str_(values[r][iArch]).toLowerCase() === 'true') continue;
    var id = str_(values[r][iId]);
    var row = null;
    for (var k = 0; k < rows.length; k++) {
      if (str_(rows[k].candidateid) === id) { row = rows[k]; break; }
    }
    if (!row) continue;
    // THE SAME TEST THE DOOR USES, so the store and the queue cannot disagree about who is reachable.
    if (str_(row.phone) || str_(row.email)) continue;
    sheet.getRange(r + 1, iArch + 1).setValue('true');
    if (iAt !== -1) sheet.getRange(r + 1, iAt + 1).setValue(now);
    if (iBy !== -1) sheet.getRange(r + 1, iBy + 1).setValue('asa-hub:talent-nocontact');
    if (iWhy !== -1) {
      sheet.getRange(r + 1, iWhy + 1)
        .setValue('no phone and no e-mail on the record — nobody can reach them');
    }
    done++;
    names.push(str_(row.name) || id);
  }
  if (done) {
    try { tpBustCrossingCache_(); } catch (eB) {}
    hubSysLog_('asa-hub:talent-nocontact', 'talent_nocontact_archived',
               done + ' store row(s) archived for having no contact at all: ' +
               names.join(', ').slice(0, 400), { status: 200 });
  } else {
    tpSweepIdle_('talent-nocontact', 'every live store row carries a phone or an e-mail');
  }
}
