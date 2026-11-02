// Scored server-side from the weights in the sheet; a browser-computed score could be edited in a console.
var QUESTIONNAIRE_TAB = 'questionnaires';
var QUESTIONNAIRE_RESPONSES_TAB = 'questionnaireResponses';
var QUESTIONNAIRE_RESPONSE_COLUMNS = [
  'response_id', 'questionnaire_id', 'questionnaire_title', 'respondent',
  'respondent_email', 'role', 'submitted_at', 'answered', 'total',
  'score', 'score_max', 'status', 'answers_json'
];

function questionnaireResponsesSheet_() {
  var sheet = hubTabEnsure_(QUESTIONNAIRE_RESPONSES_TAB, QUESTIONNAIRE_RESPONSE_COLUMNS);
  ensureHeader_(sheet, QUESTIONNAIRE_RESPONSE_COLUMNS);
  return sheet;
}

function questionnaireAll_() {
  var rows = [];
  try {
    // Same workbook door the seeder writes through, or the screen reads an empty tab.
    rows = readTabNormalized_(hubTabWorkbook_(QUESTIONNAIRE_TAB), QUESTIONNAIRE_TAB);
  } catch (e) {
    return { error: 'The questionnaires tab could not be read: ' +
             String((e && e.message) || e), list: [] };
  }
  var by = {}, order = [];
  rows.forEach(function (r) {
    var qid = str_(r.questionnaireid);
    var prompt = str_(r.prompt);
    if (!qid || !prompt) return;
    if (!by[qid]) {
      by[qid] = { id: qid, title: str_(r.questionnairetitle) || qid,
                  audience: str_(r.audience) || 'all-staff',
                  source_sheet: str_(r.sourcesheet), questions: [] };
      order.push(qid);
    }
    var weight = parseFloat(String(r.weight || '').replace(',', '.'));
    by[qid].questions.push({
      id: str_(r.questionid) || (qid + '-q' + (by[qid].questions.length + 1)),
      number: parseInt(str_(r.qnumber), 10) || by[qid].questions.length + 1,
      kind: str_(r.kind) || 'text',
      prompt: prompt,
      metric: str_(r.metric),
      weight: isNaN(weight) ? 0 : weight,
      yes_is: str_(r.yesis),
      unit: str_(r.unit),
      purpose: str_(r.purpose)
    });
  });
  var list = order.map(function (id) {
    by[id].questions.sort(function (a, b) { return a.number - b.number; });
    return by[id];
  });
  return { error: '', list: list };
}

// `yes_is` flips Yes/No scoring per question; open text returns null so it never drags an average down.
function questionnaireScore_(q, raw) {
  var v = str_(raw);
  if (!v) return null;
  var k = String(q.kind || '').toLowerCase();
  if (k === 'text' || !q.metric || q.metric === 'Diagnostic Only') return null;
  if (k === 'scale') {
    var n = parseFloat(v);
    return isNaN(n) ? null : Math.max(1, Math.min(5, n));
  }
  if (k === 'yesno') {
    var said = v.trim().toLowerCase();
    if (said !== 'yes' && said !== 'no') return null;
    var good = String(q.yes_is || 'yes').toLowerCase();
    return said === good ? 5 : 1;
  }
  if (k === 'number') {
    var num = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    if (isNaN(num)) return null;
    // Banded, not scaled: a count has no ceiling of its own.
    if (String(q.unit) === '%') return num >= 90 ? 5 : num >= 80 ? 4 : num >= 70 ? 3 : num >= 60 ? 2 : 1;
    return num >= 4 ? 5 : num >= 3 ? 4 : num >= 2 ? 3 : num >= 1 ? 2 : 1;
  }
  if (k === 'date') {
    var t = new Date(v).getTime();
    if (isNaN(t)) return null;
    var months = (new Date().getTime() - t) / (30.44 * 86400000);
    return months <= 6 ? 5 : months <= 12 ? 4 : months <= 18 ? 3 : months <= 24 ? 2 : 1;
  }
  return null;
}

function questionnaireResult_(questions, answers) {
  var got = 0, max = 0, scored = 0, byMetric = {};
  questions.forEach(function (q) {
    var s = questionnaireScore_(q, answers[q.id]);
    if (s === null) return;
    var w = q.weight || 0;
    got += s * w;
    max += 5 * w;
    scored++;
    if (!byMetric[q.metric]) byMetric[q.metric] = { got: 0, max: 0 };
    byMetric[q.metric].got += s * w;
    byMetric[q.metric].max += 5 * w;
  });
  return {
    scored: scored,
    score: max > 0 ? Math.round((got / max) * 5 * 10) / 10 : null,
    byMetric: byMetric
  };
}

// No read action on purpose: both tabs are declared resources, read through the ordinary resource path.
HUB_POLICY.questionnaireSubmit = {
  file: 'Questionnaire.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [], invalidates: [], emits: [],
  params: {
    questionnaire_id: { type: 'string', required: true },
    answers: { type: 'string', required: true }
  }
};
HUB_ACTIONS.questionnaireSubmit = function (payload, user) {
  if (!user) return hubDenied_();
  var qid = str_(payload && payload.questionnaire_id);
  var all = questionnaireAll_();
  if (all.error) return { status: 503, message: all.error };
  var mine = null;
  all.list.forEach(function (q) { if (q.id === qid) mine = q; });
  if (!mine) return { status: 404, message: 'No questionnaire "' + qid + '".' };

  var answers = {};
  try { answers = JSON.parse(str_(payload.answers) || '{}') || {}; }
  catch (e) { return { status: 400, message: 'The answers were not readable.' }; }

  var answered = 0;
  mine.questions.forEach(function (q) { if (str_(answers[q.id])) answered++; });
  var result = questionnaireResult_(mine.questions, answers);

  questionnaireResponsesSheet_();
  var id = 'QR_' + randomHex_(16).toUpperCase();
  hubAppendRow_(QUESTIONNAIRE_RESPONSES_TAB, {
    response_id: id, questionnaire_id: qid, questionnaire_title: mine.title,
    respondent: str_(user.display_name) || str_(user.name) || str_(user.email),
    respondent_email: str_(user.email), role: str_(user.role) || 'staff',
    submitted_at: new Date().toISOString(),
    answered: answered, total: mine.questions.length,
    score: result.score === null ? '' : result.score, score_max: 5,
    status: 'submitted',
    answers_json: JSON.stringify(answers).slice(0, 45000)
  });
  hubSysLog_(user.email, 'questionnaire_submitted',
             mine.title + ' — ' + answered + '/' + mine.questions.length, { status: 200 });
  return { status: 200, data: {
    response_id: id, answered: answered, total: mine.questions.length,
    score: result.score, scored: result.scored,
    message: answered + ' of ' + mine.questions.length + ' answered' +
             (result.score === null ? '.' : ', scored ' + result.score + '/5.')
  } };
};

// Editor-run and idempotent; seeds through createRow_ because a direct Sheets write never bumps the caches.
function runSeedQuestionnaires() {
  // Never creates the tab: a seeder that makes its own is how a killed tab comes back.
  var sheet = hubTabSheet_(QUESTIONNAIRE_TAB);
  if (!sheet) throw new Error('Hub tab missing: ' + QUESTIONNAIRE_TAB);
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
  ensureHeader_(sheet, QUESTIONNAIRE_COLUMNS);

  var rows = QUESTIONNAIRE_SEED;
  var hdr = headerOf_(sheet);
  var matrix = rows.map(function (r) {
    return hdr.map(function (h) { return r[h] === undefined ? '' : hubCellSafe_(r[h]); });
  });
  if (matrix.length) {
    sheet.getRange(2, 1, matrix.length, hdr.length).setValues(matrix);
  }
  cacheBump_(QUESTIONNAIRE_TAB);
  Logger.log(matrix.length + ' question row(s) written and the cache bumped.');
  return { rows: matrix.length };
}

var QUESTIONNAIRE_COLUMNS = [
  'questionnaire_id', 'questionnaire_title', 'audience', 'description',
  'estimated_min', 'privacy_note', 'header_layout', 'q_number', 'question_id',
  'kind', 'scenario', 'prompt', 'options', 'placeholder', 'scale_low',
  'scale_high', 'metric', 'weight', 'yes_is', 'unit', 'purpose', 'source_sheet'
];

// A provenance label, not hubId_: resolving it at load would read the property store on every execution.
var QUESTIONNAIRE_SEED_SOURCE = '1ieIkjKLLmlSW6Gy12q6GphKE3zl4GiK9MuxiN8FNIW8';

var QUESTIONNAIRE_SEED = [
 {
  "questionnaire_id": "q-caregiving-instincts",
  "questionnaire_title": "Caregiving Instincts — New Hire Questionnaire",
  "audience": "new-hire",
  "description": "Read each scenario and respond honestly. The first three are multiple choice; the last two ask for your own words. There are no wrong answers — we want to understand your caregiving instincts.",
  "estimated_min": 5,
  "privacy_note": "Visible to your team only",
  "header_layout": "hero",
  "q_number": 1,
  "question_id": "q1-transition",
  "kind": "choice",
  "scenario": "A client with autism becomes very agitated during a routine transition between activities. They begin pacing rapidly and raising their voice.",
  "prompt": "What is your first response?",
  "options": "A: Calmly acknowledge their feelings and offer a quiet space to decompress before continuing. | B: Redirect them to a preferred activity they enjoy to help them self-regulate. | C: Give clear, simple instructions to guide them through the transition step by step. | D: Step back and give them physical space while staying nearby for safety.",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-caregiving-instincts",
  "questionnaire_title": "Caregiving Instincts — New Hire Questionnaire",
  "audience": "new-hire",
  "description": "Read each scenario and respond honestly. The first three are multiple choice; the last two ask for your own words. There are no wrong answers — we want to understand your caregiving instincts.",
  "estimated_min": 5,
  "privacy_note": "Visible to your team only",
  "header_layout": "hero",
  "q_number": 2,
  "question_id": "q2-meals",
  "kind": "choice",
  "scenario": "You arrive for your shift and the outgoing caregiver tells you the client has been refusing meals all day and seems withdrawn.",
  "prompt": "How do you approach the situation?",
  "options": "A: Sit with the client and gently ask open-ended questions about how they’re feeling. | B: Offer a small, favorite snack in a low-pressure way and observe their mood. | C: Document the behavior and immediately contact the supervisor for guidance. | D: Engage them in a familiar activity first, then try introducing food later.",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-caregiving-instincts",
  "questionnaire_title": "Caregiving Instincts — New Hire Questionnaire",
  "audience": "new-hire",
  "description": "Read each scenario and respond honestly. The first three are multiple choice; the last two ask for your own words. There are no wrong answers — we want to understand your caregiving instincts.",
  "estimated_min": 5,
  "privacy_note": "Visible to your team only",
  "header_layout": "hero",
  "q_number": 3,
  "question_id": "q3-family",
  "kind": "choice",
  "scenario": "A client’s family member arrives during your shift and begins criticizing the care plan, saying \"this isn’t what we agreed to.\"",
  "prompt": "What do you do?",
  "options": "A: Listen respectfully, acknowledge their concerns, and explain you’ll pass the feedback to your supervisor. | B: Show them the documented care plan and walk through what you’ve been doing. | C: Politely let them know you follow the plan as written and suggest they contact the office. | D: Ask them what specific changes they’d like to see and take notes to share with the team.",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-caregiving-instincts",
  "questionnaire_title": "Caregiving Instincts — New Hire Questionnaire",
  "audience": "new-hire",
  "description": "Read each scenario and respond honestly. The first three are multiple choice; the last two ask for your own words. There are no wrong answers — we want to understand your caregiving instincts.",
  "estimated_min": 5,
  "privacy_note": "Visible to your team only",
  "header_layout": "hero",
  "q_number": 4,
  "question_id": "q4-medication-documentation",
  "kind": "text",
  "scenario": "You notice a coworker on the previous shift has been consistently skipping a client’s evening medication documentation.",
  "prompt": "How do you handle this? Describe what you would do and why.",
  "options": "",
  "placeholder": "Explain your approach…",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-caregiving-instincts",
  "questionnaire_title": "Caregiving Instincts — New Hire Questionnaire",
  "audience": "new-hire",
  "description": "Read each scenario and respond honestly. The first three are multiple choice; the last two ask for your own words. There are no wrong answers — we want to understand your caregiving instincts.",
  "estimated_min": 5,
  "privacy_note": "Visible to your team only",
  "header_layout": "hero",
  "q_number": 5,
  "question_id": "q5-nonverbal-discomfort",
  "kind": "text",
  "scenario": "A non-verbal client is showing signs of discomfort — grimacing, pulling at their clothing, and refusing to sit down — but you can’t identify the cause.",
  "prompt": "Walk us through your thought process and the steps you would take.",
  "options": "",
  "placeholder": "Describe how you would assess and respond to this situation…",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-dodd-knowledge",
  "questionnaire_title": "DODD Knowledge Check",
  "audience": "all-staff",
  "description": "Four quick questions on the Ohio DODD rules that shape daily care — MUI reporting, ISPs, medication administration and client rights. Choose the best answer for each.",
  "estimated_min": 6,
  "privacy_note": "Visible to your team only",
  "header_layout": "split",
  "q_number": 1,
  "question_id": "q2-mui",
  "kind": "choice",
  "scenario": "During your shift, a client falls and is taken to the emergency room. Your supervisor mentions this may need to be reported to the county board as a Major Unusual Incident (MUI).",
  "prompt": "Under DODD rules, when must an MUI be reported?",
  "options": "A: Immediately, and no later than the next business day | B: Within one week of the incident | C: Only at the client's annual review | D: Only if the family requests a report",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-dodd-knowledge",
  "questionnaire_title": "DODD Knowledge Check",
  "audience": "all-staff",
  "description": "Four quick questions on the Ohio DODD rules that shape daily care — MUI reporting, ISPs, medication administration and client rights. Choose the best answer for each.",
  "estimated_min": 6,
  "privacy_note": "Visible to your team only",
  "header_layout": "split",
  "q_number": 2,
  "question_id": "q2-isp",
  "kind": "choice",
  "scenario": "Every client served under a DODD waiver has an Individual Service Plan (ISP) that guides their goals, supports and daily care.",
  "prompt": "How often is the ISP formally reviewed and updated?",
  "options": "A: Only when a client moves to a new house | B: At least once every 12 months — and whenever the client's needs change | C: Every week at team meetings | D: Once, at intake — it never changes after that",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-dodd-knowledge",
  "questionnaire_title": "DODD Knowledge Check",
  "audience": "all-staff",
  "description": "Four quick questions on the Ohio DODD rules that shape daily care — MUI reporting, ISPs, medication administration and client rights. Choose the best answer for each.",
  "estimated_min": 6,
  "privacy_note": "Visible to your team only",
  "header_layout": "split",
  "q_number": 3,
  "question_id": "q2-meds",
  "kind": "choice",
  "scenario": "A coworker asks you to give a client their morning medications, but you have not completed DODD medication administration certification.",
  "prompt": "What is the correct action?",
  "options": "A: Give the medications anyway — a coworker vouched for you | B: Politely decline and explain that only certified staff may administer medications | C: Give half the dose to be safe | D: Crush the medication into the client's food so it's easier",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-dodd-knowledge",
  "questionnaire_title": "DODD Knowledge Check",
  "audience": "all-staff",
  "description": "Four quick questions on the Ohio DODD rules that shape daily care — MUI reporting, ISPs, medication administration and client rights. Choose the best answer for each.",
  "estimated_min": 6,
  "privacy_note": "Visible to your team only",
  "header_layout": "split",
  "q_number": 4,
  "question_id": "q2-rights",
  "kind": "choice",
  "scenario": "DODD rules guarantee the rights of individuals with developmental disabilities — including dignity, privacy, and freedom of choice in daily life.",
  "prompt": "Which of these best honors client rights during daily care?",
  "options": "A: Making all decisions for clients to keep the house running efficiently | B: Offering real choices (clothing, meals, activities) and respecting refusals whenever safely possible | C: Discussing a client's diagnosis with neighbors so they understand the situation | D: Restricting visitors to reduce disruptions to the routine",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-manager-scenarios",
  "questionnaire_title": "Manager Scenario Review",
  "audience": "manager",
  "description": "Three open-ended leadership scenarios from real house operations. Answer in your own words — we are looking at judgment, prioritization and how you communicate under pressure.",
  "estimated_min": 10,
  "privacy_note": "Visible to the leadership team only",
  "header_layout": "banner",
  "q_number": 1,
  "question_id": "q3-calloff",
  "kind": "text",
  "scenario": "Two caregivers call off for the same weekend shift at a house with four clients who require 2:1 staffing at all times. Your on-call list is thin and one client has a community outing planned.",
  "prompt": "How do you cover the shift, and in what order do you make your calls?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-manager-scenarios",
  "questionnaire_title": "Manager Scenario Review",
  "audience": "manager",
  "description": "Three open-ended leadership scenarios from real house operations. Answer in your own words — we are looking at judgment, prioritization and how you communicate under pressure.",
  "estimated_min": 10,
  "privacy_note": "Visible to the leadership team only",
  "header_layout": "banner",
  "q_number": 2,
  "question_id": "q3-performance",
  "kind": "text",
  "scenario": "A caregiver is consistently 20 minutes late and her documentation has started slipping — but clients adore her and she is one of your strongest hands-on workers.",
  "prompt": "How do you handle the conversation? What do you say first, and what do you put in writing?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-manager-scenarios",
  "questionnaire_title": "Manager Scenario Review",
  "audience": "manager",
  "description": "Three open-ended leadership scenarios from real house operations. Answer in your own words — we are looking at judgment, prioritization and how you communicate under pressure.",
  "estimated_min": 10,
  "privacy_note": "Visible to the leadership team only",
  "header_layout": "banner",
  "q_number": 3,
  "question_id": "q3-family",
  "kind": "text",
  "scenario": "A client's mother calls upset that her son's ISP goals \"aren't being worked on\" and threatens to escalate to the county board if she doesn't see change this month.",
  "prompt": "Describe your response — both to the mother in the moment, and internally with your team afterwards.",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": "seed (scenario questionnaires)"
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 1,
  "question_id": "q-skills-enhancement-q1",
  "kind": "number",
  "scenario": "Measures initiative for self-directed learning.",
  "prompt": "How many elective or optional trainings have you completed this quarter?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "VoluntaryTraining%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "count",
  "purpose": "Measures initiative for self-directed learning.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 2,
  "question_id": "q-skills-enhancement-q2",
  "kind": "scale",
  "scenario": "Employee self-perceived growth (cross-validated with supervisor skill assessment).",
  "prompt": "Do you feel that your skills have improved since your last evaluation?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "A great deal",
  "metric": "SkillImprovement%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "",
  "purpose": "Employee self-perceived growth (cross-validated with supervisor skill assessment).",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 3,
  "question_id": "q-skills-enhancement-q3",
  "kind": "scale",
  "scenario": "Tracks skill transfer and retention.",
  "prompt": "How confident are you in applying the new skills you learned to your daily work?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "Completely",
  "metric": "SkillImprovement%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "",
  "purpose": "Tracks skill transfer and retention.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 4,
  "question_id": "q-skills-enhancement-q4",
  "kind": "yesno",
  "scenario": "Captures flexibility and inter-team learning.",
  "prompt": "Have you participated in any cross-training with other sites or client types?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "CrossTraining%",
  "weight": 0.2,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Captures flexibility and inter-team learning.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 5,
  "question_id": "q-skills-enhancement-q5",
  "kind": "scale",
  "scenario": "Measures practical impact and engagement.",
  "prompt": "How would you rate the usefulness of your most recent training?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "A great deal",
  "metric": "EvaluationScore",
  "weight": 0.15,
  "yes_is": "",
  "unit": "",
  "purpose": "Measures practical impact and engagement.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 6,
  "question_id": "q-skills-enhancement-q6",
  "kind": "scale",
  "scenario": "Gauges peer knowledge sharing.",
  "prompt": "How often do you discuss new techniques or lessons learned with peers?",
  "options": "",
  "placeholder": "",
  "scale_low": "Never",
  "scale_high": "Always",
  "metric": "VoluntaryTraining%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "",
  "purpose": "Gauges peer knowledge sharing.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 7,
  "question_id": "q-skills-enhancement-q7",
  "kind": "number",
  "scenario": "Tracks learning engagement and time investment.",
  "prompt": "Total estimated training hours completed this quarter (approximate).",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "TrainingHoursPerFTE",
  "weight": 0.15,
  "yes_is": "",
  "unit": "hours",
  "purpose": "Tracks learning engagement and time investment.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 8,
  "question_id": "q-skills-enhancement-q8",
  "kind": "scale",
  "scenario": "Cross-verifies objective growth.",
  "prompt": "Has your supervisor observed noticeable improvement in your work since recent training?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "A great deal",
  "metric": "SkillImprovement%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "",
  "purpose": "Cross-verifies objective growth.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 9,
  "question_id": "q-skills-enhancement-q9",
  "kind": "scale",
  "scenario": "Indicates continuous improvement behavior.",
  "prompt": "How often do you seek feedback or coaching after training sessions?",
  "options": "",
  "placeholder": "",
  "scale_low": "Never",
  "scale_high": "Always",
  "metric": "VoluntaryTraining%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "",
  "purpose": "Indicates continuous improvement behavior.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-skills-enhancement",
  "questionnaire_title": "Skills Enhancement — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 10,
  "question_id": "q-skills-enhancement-q10",
  "kind": "text",
  "scenario": "AI uses this for skill gap prediction.",
  "prompt": "What training areas do you feel least confident in?",
  "options": "",
  "placeholder": "In your own words — this one is read by a person, not scored.",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 1,
  "question_id": "q-compliance-training-q1",
  "kind": "yesno",
  "scenario": "Tracks timeliness.",
  "prompt": "Did you complete all mandatory trainings before their due dates this quarter?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "OnTimeCompletion%",
  "weight": 0.25,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Tracks timeliness.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 2,
  "question_id": "q-compliance-training-q2",
  "kind": "yesno",
  "scenario": "Evaluates compliance independence.",
  "prompt": "Were you reminded or contacted by HR about overdue training?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "RetrainingOverdueInverse",
  "weight": 0.15,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Evaluates compliance independence.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 3,
  "question_id": "q-compliance-training-q3",
  "kind": "date",
  "scenario": "Feeds into compliance tracking.",
  "prompt": "When was the last time you renewed your certification (CPR, Med Del, etc.)?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "CertRenewal%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "",
  "purpose": "Feeds into compliance tracking.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 4,
  "question_id": "q-compliance-training-q4",
  "kind": "number",
  "scenario": "Measures comprehension.",
  "prompt": "Average quiz score from most recent compliance modules.",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "QuizAccuracy%",
  "weight": 0.2,
  "yes_is": "",
  "unit": "%",
  "purpose": "Measures comprehension.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 5,
  "question_id": "q-compliance-training-q5",
  "kind": "scale",
  "scenario": "Qualitative understanding check.",
  "prompt": "Do you understand how each compliance course applies to your role?",
  "options": "",
  "placeholder": "",
  "scale_low": "Never",
  "scale_high": "Always",
  "metric": "QuizAccuracy%",
  "weight": 0.2,
  "yes_is": "",
  "unit": "",
  "purpose": "Qualitative understanding check.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 6,
  "question_id": "q-compliance-training-q6",
  "kind": "yesno",
  "scenario": "Tracks efficiency and engagement.",
  "prompt": "Did you complete onboarding or recertification within required timeframe?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "OnboardingCompletion%",
  "weight": 0.15,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Tracks efficiency and engagement.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 7,
  "question_id": "q-compliance-training-q7",
  "kind": "yesno",
  "scenario": "Risk flag for compliance.",
  "prompt": "Have you ever had an expired certification while working?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "CertRenewal%",
  "weight": 0.25,
  "yes_is": "no",
  "unit": "",
  "purpose": "Risk flag for compliance.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 8,
  "question_id": "q-compliance-training-q8",
  "kind": "scale",
  "scenario": "Predictive confidence measure.",
  "prompt": "How confident do you feel about meeting upcoming compliance deadlines?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "Completely",
  "metric": "OnTimeCompletion%",
  "weight": 0.25,
  "yes_is": "",
  "unit": "",
  "purpose": "Predictive confidence measure.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 9,
  "question_id": "q-compliance-training-q9",
  "kind": "yesno",
  "scenario": "Indicates self-sufficiency.",
  "prompt": "Have you requested clarification or help understanding compliance content?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "QuizAccuracy%",
  "weight": 0.2,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Indicates self-sufficiency.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-compliance-training",
  "questionnaire_title": "Compliance Training — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
  "estimated_min": 8,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 10,
  "question_id": "q-compliance-training-q10",
  "kind": "text",
  "scenario": "Improves future course design.",
  "prompt": "Which compliance course do you find least relevant or engaging?",
  "options": "",
  "placeholder": "In your own words — this one is read by a person, not scored.",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 1,
  "question_id": "q-mentorship-life-planning-q1",
  "kind": "yesno",
  "scenario": "Tracks mentorship coverage.",
  "prompt": "Are you currently paired with a mentor or coach?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "MentorshipReach%",
  "weight": 0.2,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Tracks mentorship coverage.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 2,
  "question_id": "q-mentorship-life-planning-q2",
  "kind": "scale",
  "scenario": "Frequency = engagement indicator.",
  "prompt": "How often do you meet or communicate with your mentor?",
  "options": "",
  "placeholder": "",
  "scale_low": "Never",
  "scale_high": "Always",
  "metric": "MentorshipReach%",
  "weight": 0.2,
  "yes_is": "",
  "unit": "",
  "purpose": "Frequency = engagement indicator.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 3,
  "question_id": "q-mentorship-life-planning-q3",
  "kind": "scale",
  "scenario": "Evaluates mentor effectiveness.",
  "prompt": "How satisfied are you with your mentorship relationship overall?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "Completely",
  "metric": "MenteeSatisfaction",
  "weight": 0.2,
  "yes_is": "",
  "unit": "",
  "purpose": "Evaluates mentor effectiveness.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 4,
  "question_id": "q-mentorship-life-planning-q4",
  "kind": "scale",
  "scenario": "Links mentorship to growth planning.",
  "prompt": "Has mentorship helped you set clearer career or life goals?",
  "options": "",
  "placeholder": "",
  "scale_low": "Never",
  "scale_high": "Always",
  "metric": "CareerPlanCompletion%",
  "weight": 0.2,
  "yes_is": "",
  "unit": "",
  "purpose": "Links mentorship to growth planning.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 5,
  "question_id": "q-mentorship-life-planning-q5",
  "kind": "yesno",
  "scenario": "Tracks career planning discipline.",
  "prompt": "Have you updated your career development plan in the last 6 months?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "CareerPlanCompletion%",
  "weight": 0.2,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Tracks career planning discipline.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 6,
  "question_id": "q-mentorship-life-planning-q6",
  "kind": "scale",
  "scenario": "Monitors well-being outcomes.",
  "prompt": "Do you feel your mentor supports your work-life balance?",
  "options": "",
  "placeholder": "",
  "scale_low": "Never",
  "scale_high": "Always",
  "metric": "LifeBalanceImprovement%",
  "weight": 0.2,
  "yes_is": "",
  "unit": "",
  "purpose": "Monitors well-being outcomes.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 7,
  "question_id": "q-mentorship-life-planning-q7",
  "kind": "scale",
  "scenario": "Measures developmental retention predictor.",
  "prompt": "How confident do you feel about your long-term growth in this company?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "Completely",
  "metric": "RetentionMentored%",
  "weight": 0.2,
  "yes_is": "",
  "unit": "",
  "purpose": "Measures developmental retention predictor.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 8,
  "question_id": "q-mentorship-life-planning-q8",
  "kind": "yesno",
  "scenario": "Tracks cultural diffusion of mentorship.",
  "prompt": "Have you mentored or coached others recently?",
  "options": "",
  "placeholder": "",
  "scale_low": "",
  "scale_high": "",
  "metric": "MentorshipReach%",
  "weight": 0.2,
  "yes_is": "yes",
  "unit": "",
  "purpose": "Tracks cultural diffusion of mentorship.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 9,
  "question_id": "q-mentorship-life-planning-q9",
  "kind": "scale",
  "scenario": "Monitors holistic growth outcomes.",
  "prompt": "Have you noticed any improvements in your mood, motivation, or focus since mentorship began?",
  "options": "",
  "placeholder": "",
  "scale_low": "Not at all",
  "scale_high": "A great deal",
  "metric": "LifeBalanceImprovement%",
  "weight": 0.2,
  "yes_is": "",
  "unit": "",
  "purpose": "Monitors holistic growth outcomes.",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 },
 {
  "questionnaire_id": "q-mentorship-life-planning",
  "questionnaire_title": "Mentorship & Life Planning — Individual Evaluation",
  "audience": "all-staff",
  "description": "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
  "estimated_min": 10,
  "privacy_note": "Visible to your team only",
  "header_layout": "minimal",
  "q_number": 10,
  "question_id": "q-mentorship-life-planning-q10",
  "kind": "text",
  "scenario": "Feeds AI suggestion layer.",
  "prompt": "What support would help you progress toward your career goals?",
  "options": "",
  "placeholder": "In your own words — this one is read by a person, not scored.",
  "scale_low": "",
  "scale_high": "",
  "metric": "",
  "weight": "",
  "yes_is": "",
  "unit": "",
  "purpose": "",
  "source_sheet": QUESTIONNAIRE_SEED_SOURCE
 }
];
