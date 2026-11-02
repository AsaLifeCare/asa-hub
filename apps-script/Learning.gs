var LEARN_STAGES = ['exposed', 'emerging', 'practising', 'stable', 'mastered', 'generalised'];

// A floor: Settings may make these stricter, never laxer.
var LEARN_FLOOR = {
  emergingCorrect: 1,
  practisingRun: 2,
  stableRun: 3,
  masteredRun: 4,          // consecutive and unassisted
  generalisedGapDays: 7
};

function learnMayUse_(user) {
  return !!(user && !user.is_service && str_(user.id));
}

function learnRules_() {
  var out = {};
  for (var k in LEARN_FLOOR) out[k] = LEARN_FLOOR[k];
  try {
    listRows_('financeConfig', {}).forEach(function (r) {
      if (str_(r.key) !== 'learnRules') return;
      var saved = null;
      try { saved = JSON.parse(str_(r.value) || '{}'); } catch (e) { saved = null; }
      if (!saved) return;
      for (var key in LEARN_FLOOR) {
        var n = finNum_(saved[key]);
        if (n > LEARN_FLOOR[key]) out[key] = n;
      }
    });
  } catch (e) {}
  return out;
}

// Never stored: the stage is always recomputed from the attempts.
function learnStage_(attempts, rules) {
  if (!attempts.length) return { stage: 'exposed', run: 0, unassistedRun: 0, why: 'not attempted yet' };

  var sorted = attempts.slice().sort(function (a, b) {
    return String(a.at).localeCompare(String(b.at));
  });

  var run = 0, unassisted = 0, anyCorrect = false, lastCorrectAt = '';
  sorted.forEach(function (a) {
    if (a.correct) {
      anyCorrect = true;
      run++;
      if (!a.helped) unassisted++; else unassisted = 0;
      lastCorrectAt = str_(a.at);
    } else {
      run = 0;
      unassisted = 0;
    }
  });

  if (!anyCorrect) return { stage: 'exposed', run: 0, unassistedRun: 0, why: 'attempted, not yet correct' };

  if (unassisted >= rules.masteredRun && lastCorrectAt) {
    var firstMastery = null;
    var streak = 0;
    for (var i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      if (a.correct && !a.helped) { streak++; if (streak >= rules.masteredRun && !firstMastery) firstMastery = str_(a.at); }
      else if (!a.correct) streak = 0;
    }
    if (firstMastery) {
      var gapMs = new Date(lastCorrectAt).getTime() - new Date(firstMastery).getTime();
      if (!isNaN(gapMs) && gapMs >= rules.generalisedGapDays * 86400000) {
        return { stage: 'generalised', run: run, unassistedRun: unassisted,
                 why: 'held after ' + Math.floor(gapMs / 86400000) + ' days' };
      }
    }
    return { stage: 'mastered', run: run, unassistedRun: unassisted,
             why: unassisted + ' in a row, unaided' };
  }
  if (run >= rules.stableRun) return { stage: 'stable', run: run, unassistedRun: unassisted, why: run + ' in a row' };
  if (run >= rules.practisingRun) return { stage: 'practising', run: run, unassistedRun: unassisted, why: run + ' in a row' };
  if (anyCorrect) return { stage: 'emerging', run: run, unassistedRun: unassisted, why: 'correct at least once' };
  return { stage: 'exposed', run: 0, unassistedRun: 0, why: '' };
}

function learnState_(user) {
  var me = str_(user.id);
  var rules = learnRules_();

  var skills = listRows_('learnSkills', {}).filter(function (r) {
    return str_(r.active).toLowerCase() !== 'false';
  });
  var mine = listRows_('learnAttempts', {}).filter(function (r) {
    return str_(r.ownerId) === me;
  });

  var bySkill = {};
  mine.forEach(function (a) {
    var k = str_(a.skillId);
    if (!bySkill[k]) bySkill[k] = [];
    bySkill[k].push({
      id: str_(a.id), at: str_(a.at),
      correct: str_(a.correct) === 'true' || a.correct === true,
      helped: str_(a.helped) === 'true' || a.helped === true,
      note: str_(a.note)
    });
  });

  return {
    rules: rules,
    stages: LEARN_STAGES,
    skills: skills.map(function (s) {
      var attempts = bySkill[str_(s.id)] || [];
      var st = learnStage_(attempts, rules);
      return {
        id: str_(s.id), name: str_(s.name), area: str_(s.area),
        description: str_(s.description),
        attempts: attempts.length,
        lastAt: attempts.length ? attempts[attempts.length - 1].at : '',
        stage: st.stage, why: st.why, run: st.run, unassistedRun: st.unassistedRun
      };
    }).sort(function (a, b) {
      return (a.area || '').localeCompare(b.area || '') || a.name.localeCompare(b.name);
    })
  };
}

HUB_POLICY.learnState = {
  file: 'Learning.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.learnState = function (payload, user) {
  if (!learnMayUse_(user)) return hubDenied_();
  return { status: 200, data: learnState_(user) };
};

// Attempts are append-only; a helped attempt never counts toward mastered.
HUB_POLICY.learnAttempt = {
  file: 'Learning.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.learnAttempt = function (payload, user) {
  if (!learnMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var skillId = str_(p.skillId);
  if (!skillId) return { status: 400, message: 'Which competency?' };
  var skill = requireRow_('learnSkills', skillId);
  if (skill.error) return skill.error;

  var attempt = createRow_('learnAttempts', {
    skillId: skillId,
    at: new Date().toISOString(),
    correct: p.correct === true || str_(p.correct) === 'true' ? 'true' : 'false',
    helped: p.helped === true || str_(p.helped) === 'true' ? 'true' : 'false',
    note: str_(p.note)
  });
  if (sheetDbRefused_(attempt)) return sheetDbRefused_(attempt);
  return { status: 200, data: learnState_(user) };
};

/** The competencies themselves — shared, and admin-owned. */
HUB_POLICY.learnSkillSave = {
  file: 'Learning.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.learnSkillSave = function (payload, user) {
  if (!user || user.is_service || user.role !== 'admin') return hubDenied_();
  var p = payload || {};
  var name = str_(p.name).trim();
  if (!name) return { status: 400, message: 'A competency needs a name.' };
  var fields = { name: name, area: str_(p.area).trim(), description: str_(p.description).trim(),
                 active: p.active === false ? 'false' : 'true' };
  if (str_(p.id)) {
    var row = updateRowById_('learnSkills', Object.assign({ id: str_(p.id) }, fields));
    if (row.error) return row.error;
    return { status: 200, data: { id: str_(p.id) } };
  }
  // Retire, never delete: attempts point at it.
  var made = createRow_('learnSkills', fields);
  if (sheetDbRefused_(made)) return sheetDbRefused_(made);
  return { status: 200, data: { id: str_(made.id) } };
};

// Only never-attempted competencies; slow progress is deliberately not chased.
function learnSmartSubjects_() {
  var rules = learnRules_();
  var skills = listRows_('learnSkills', {}).filter(function (r) {
    return str_(r.active).toLowerCase() !== 'false';
  });
  if (!skills.length) return [];

  var byOwner = {};
  listRows_('learnAttempts', {}).forEach(function (a) {
    var o = str_(a.ownerId);
    if (!byOwner[o]) byOwner[o] = {};
    if (!byOwner[o][str_(a.skillId)]) byOwner[o][str_(a.skillId)] = [];
    byOwner[o][str_(a.skillId)].push({
      at: str_(a.at),
      correct: str_(a.correct) === 'true',
      helped: str_(a.helped) === 'true'
    });
  });

  var out = [];
  for (var owner in byOwner) {
    var untouched = skills.filter(function (s) { return !byOwner[owner][str_(s.id)]; });
    if (!untouched.length) continue;
    var u = shopUserById_(owner);
    out.push({
      ownerId: owner,
      name: u ? (str_(u.displayname) || str_(u.email)) : owner,
      email: u ? str_(u.email) : '',
      phone: u ? str_(u.phone) : '',
      count: untouched.length,
      first: str_(untouched[0].name),
      rules: rules
    });
  }
  return out;
}
