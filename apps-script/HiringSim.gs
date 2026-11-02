// commsIsTestCandidate_ reads this prefix, and everything downstream depends on it.
var HIRING_SIM_FIRST = '[TEST]';
var HIRING_SIM_LAST = 'Rehearsal Candidate';

// Last-resort sample: the comms window rolls 7 days; the caller's number is masked.
var HIRING_SIM_SAMPLE_TRANSCRIPT =
  '[0:00] +13307544040: Hi there. This is Asa Life Care\'s phone screening assistant. I just need five minutes to go over your background and qualifications. If everything lines up, we\'ll schedule an in person meeting next. Does that sound good?\n' +
  '[0:12] +1XXXXXXXXXX: Yes.\n' +
  '[0:14] +13307544040: Great. Can you tell me your first and last name, please?\n' +
  '[0:17] +1XXXXXXXXXX: Tiana Brooks.\n' +
  '[0:20] +13307544040: Thanks, Anna. I\'ll begin with the phone screening. Have you worked as a DSP before?\n' +
  '[0:25] +1XXXXXXXXXX: No.\n' +
  '[0:27] +13307544040: Got it. Many clients need full personal care. Are you comfortable assisting with toileting and bathing? That\'s great, Sienna. Are you looking for full time, part time, or occasional shifts when available?\n' +
  '[0:42] +1XXXXXXXXXX: Yes. Part time.\n' +
  '[0:45] +13307544040: Which days and times would you be available?\n' +
  '[0:50] +1XXXXXXXXXX: Mornings and afternoons.\n' +
  '[0:53] +13307544040: We\'re currently hiring for afternoon shifts from 2PM to 10PM and midnight shifts from 09:30PM to 8AM. We don\'t have morning shifts available right now. Would afternoons, midnights, or both work for you?\n' +
  '[1:05] +1XXXXXXXXXX: Afternoons.\n' +
  '[1:08] +13307544040: Afternoons work. All staff are required to work every other weekend on twelve hour shifts from 8AM to 8PM or 8PM to 8AM. Does that work for you?\n' +
  '[1:18] +1XXXXXXXXXX: Yes.\n' +
  '[1:20] +13307544040: Wonderful. Do you have your eight hour DODD certification?\n' +
  '[1:25] +1XXXXXXXXXX: No.\n' +
  '[1:26] +13307544040: No problem. We\'ll send you a link to complete it online. Do you have CPR and first aid?\n' +
  '[1:31] +1XXXXXXXXXX: Yes.\n' +
  '[1:34] +13307544040: That\'s okay. We can help get you certified after the in person interview. Are you currently med administration certified?\n' +
  '[1:40] +1XXXXXXXXXX: No.\n' +
  '[1:42] +13307544040: That\'s fine. We can help you get certified once you start. Afternoon shifts start at sixteen dollars per hour and midnight shifts at $15 per hour. Meddell adds an extra 50 cents per hour.\n' +
  '[1:52] +1XXXXXXXXXX: Yes.\n' +
  '[1:53] +13307544040: Do these rates work for you? Awesome. We have a strict attendance policy. Do you have a valid driver\'s license?\n' +
  '[2:02] +1XXXXXXXXXX: Yes.\n' +
  '[2:04] +13307544040: Awesome. Do you also have a vehicle? And if so, do you have insurance on that vehicle?\n' +
  '[2:10] +1XXXXXXXXXX: I have a vehicle. I don\'t have insurance.\n' +
  '[2:14] +13307544040: That\'s no problem. We just like to know staff can make it to work on time. Some clients do have physical behaviors. Have you worked with or are you comfortable working with aggressive clients?\n' +
  '[2:24] +1XXXXXXXXXX: Not comfortable.\n' +
  '[2:27] +13307544040: That\'s okay. We can make a note of that. Are you comfortable working with male and female clients?\n' +
  '[2:32] +1XXXXXXXXXX: Yes.\n' +
  '[2:34] +13307544040: We are required to conduct a standard state background check. Is there anything you\'d like to disclose before we proceed?\n' +
  '[2:41] +1XXXXXXXXXX: No.\n' +
  '[2:42] +13307544040: If we decide to proceed with an in person interview, what day and time works best to meet one of our house managers?\n' +
  '[2:50] +1XXXXXXXXXX: I\'m flexible.\n' +
  '[2:54] +13307544040: Got it. Since you are flexible, how does this coming Tuesday at two in the afternoon sound for a meeting at 1305 49th Street Northwest in Canton?\n' +
  '[3:04] +1XXXXXXXXXX: What time?\n' +
  '[3:07] +13307544040: Two in the afternoon.\n' +
  '[3:10] +1XXXXXXXXXX: I\'ll need a later time.\n' +
  '[3:13] +13307544040: How about four in the afternoon on Tuesday?\n' +
  '[3:17] +1XXXXXXXXXX: That will work.\n' +
  '[3:19] +13307544040: Thanks for speaking with me today, Sayana. I\'ll share your information with our hiring team, and we\'ll follow-up on next steps soon. Have a great rest of your day.';

var HIRING_SIM_TABS = [
  { tab: 'entity_candidates', col: 'candidate_id' },
  { tab: 'entity_resume_analyses', col: 'candidate_id' },
  { tab: 'entity_phone_screens', col: 'candidate_id' },
  { tab: 'entity_in_person_interviews', col: 'candidate_id' },
  { tab: 'entity_inbound_messages', col: 'candidate_id' },
  { tab: 'interview_asks', col: 'candidate_id' },
  { tab: 'hiring_journey', col: 'candidate_id' },
  { tab: 'entity_hiring_events', col: 'candidate_id' },
  { tab: 'hiring_sim_asks', col: 'candidate_id' }
];

// Structure only (the words live in the config book); a step with no action is only observed.
var HIRING_SIM_STEPS = [
  { id: 'ask', n: 0, pretend: { channel: 'team', preset: 'sim_pretend_ask_reply' },
    action: 'hiringAskSend', to: 'team', channel: 'email' },
  { id: 'shortlist', n: 1,
    action: 'hiringShortlistSend', to: 'team', channel: 'email' },
  { id: 'interest', n: 2, pretend: { channel: 'team', preset: 'sim_pretend_interest_reply' },
    action: 'hiringInterestScan', to: 'team', channel: 'email' },
  { id: 'interest_thanks', n: 3,
    action: 'hiringInterestThanksSend', to: 'team', channel: 'email' },
  { id: 'outreach_sms', n: 4,
    action: 'hiringOutreachSend', to: 'candidate', channel: 'email+sms' },
  { id: 'outreach_reply', n: 4.5, pretend: { channel: 'candidate', preset: 'sim_pretend_outreach_reply' },
    action: 'hiringOutreachReplyCheck', to: 'team', channel: 'email' },
  { id: 'accepted', n: 5,
    action: 'hiringAcceptedNotify', to: 'team', channel: 'email+sms' },
  { id: 'screen_call', n: 5.2,
    action: 'hiringScreenCallSend', to: 'candidate', channel: 'email+sms' },
  { id: 'screen_watch', n: 5.4, loop: true,
    action: 'hiringSimScreenEvaluate', to: 'team', channel: 'email+sms' },
  { id: 'resume_request', n: 5.5,
    action: 'hiringResumeRequestSend', to: 'candidate', channel: 'email' },
  { id: 'cjis_request', n: 6,
    action: 'hiringCjisRequestSend', to: 'team', channel: 'email' },
  { id: 'cjis_scan', n: 6.5,
    action: 'cjisFolderSweepNow', to: 'card', channel: 'drive' },
  { id: 'resume_scan', n: 6.6,
    action: 'resumeInboxScan', to: 'card', channel: 'drive' },
  { id: 'phone_screen', n: 7,
    action: 'moveStage', to: 'card', channel: 'gate' },
  { id: 'screen_seed', n: 8,
    action: 'hiringSimTranscriptSeed', to: 'card', channel: 'record' },
  { id: 'screen_analyze', n: 8.3,
    action: 'screenAnalyze', to: 'card', channel: 'record' },
  { id: 'decision_ask', n: 8.7,
    action: 'hiringDecisionAskSend', to: 'team', channel: 'email+sms' },
  { id: 'cjis_recheck', n: 8.9,
    action: 'hiringCjisRequestSend', to: 'team', channel: 'email+sms' },
  { id: 'schedule_invite', n: 9, pretend: { channel: 'pick' },
    action: 'interviewInviteSend', to: 'candidate', channel: 'email+sms' },
  { id: 'interviewer_ask', n: 10, pretend: { channel: 'interviewer', preset: 'sim_pretend_interviewer_reply' },
    action: 'interviewAskSweepNow', to: 'interviewer', channel: 'email+sms' },
  { id: 'referral_arrives', n: 0.1,
    action: 'hiringSimReferralSeed', to: 'card', channel: 'record' },
  { id: 'manual_add', n: 0.2,
    action: 'hiringSimSeed', to: 'card', channel: 'record' },
  { id: 'manual_contact', n: 0.3,
    action: 'manualContactSend', to: 'candidate', channel: 'email+sms' },
  { id: 'director_add', n: 0.4,
    action: '', to: 'card', channel: 'record' },
  { id: 'director_docs', n: 0.5,
    action: '', to: 'team', channel: 'email+sms' },
  { id: 'sim_evidence', n: 6.8,
    action: 'hiringSimEvidenceFill', to: 'card', channel: 'record' },
  { id: 'discarded', n: 11,
    action: 'hiringDiscard', to: 'team', channel: 'email' },
  { id: 'journey', n: 13,
    action: '', to: 'card', channel: 'record' },
  { id: 'interview_scored', n: 14,
    action: '', to: 'card', channel: 'gate' },
  { id: 'onboarding', n: 15,
    action: '', to: 'candidate', channel: 'email' },
  { id: 'first_login', n: 15.1,
    action: '', to: 'candidate', channel: 'email+sms' },
  { id: 'portal_finale', n: 15.2,
    action: '', to: 'candidate', channel: 'web' },
  { id: 'ready_ask', n: 15.3,
    action: '', to: 'team', channel: 'email+sms' },
  { id: 'ready_move', n: 15.4,
    action: '', to: 'card', channel: 'record' },
  { id: 'ready_parked', n: 15.5,
    action: '', to: 'team', channel: 'email+sms' },
  { id: 'talent_cross', n: 15.6,
    action: '', to: 'card', channel: 'record' },
  { id: 'application', n: 15.7,
    action: '', to: 'card', channel: 'record' },
  { id: 'application_unfinished', n: 15.8,
    action: '', to: 'card', channel: 'record' },
  { id: 'talent_autocross', n: 15.9,
    action: '', to: 'card', channel: 'record' },
  { id: 'talent_autofill', n: '15.95',
    action: '', to: 'card', channel: 'record' },
  { id: 'talent_store_remove', n: '16',
    action: '', to: 'card', channel: 'record' }
];

// A changed mechanic must update its step's words in the book's Steps tab.
function hiringSimStepsWithWords_() {
  var words = bookKv_('Steps');
  return HIRING_SIM_STEPS.map(function (s) {
    var o = {};
    for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k]; }
    o.title = str_(words[s.id + '.title']);
    o.about = str_(words[s.id + '.about']);
    var more = str_(words[s.id + '.more']);
    if (more) o.more = more.split('\n');
    if (s.loop) o.loop = str_(words[s.id + '.loop']);
    if (s.pretend) {
      o.pretend = {};
      for (var pk in s.pretend) {
        if (Object.prototype.hasOwnProperty.call(s.pretend, pk)) o.pretend[pk] = s.pretend[pk];
      }
      o.pretend.label = str_(words[s.id + '.pretend.label']);
      o.pretend.hint = str_(words[s.id + '.pretend.hint']);
    }
    return o;
  });
}

function hiringSimFlowsWithWords_() {
  var words = bookKv_('Steps');
  return HIRING_SIM_FLOWS.map(function (f) {
    return { id: f.id, steps: f.steps,
             title: str_(words['flow.' + f.id + '.title']),
             about: str_(words['flow.' + f.id + '.about']) };
  });
}

// Each flow is an ordered reading of this one shared spine, so a fix lands on every tab.
var HIRING_SIM_MAIN_STEPS =
  ['ask', 'shortlist', 'cjis_request', 'cjis_scan', 'interest', 'interest_thanks',
   'outreach_sms', 'outreach_reply', 'accepted', 'resume_scan', 'phone_screen',
   'screen_call', 'screen_watch', 'screen_analyze', 'decision_ask',
   'cjis_recheck',
   'schedule_invite', 'interviewer_ask', 'discarded', 'journey', 'interview_scored',
   'onboarding', 'first_login', 'portal_finale', 'ready_ask', 'ready_move',
   // Appended, never inserted: step numbering is positional.
   'ready_parked', 'talent_cross', 'application', 'application_unfinished',
   'talent_autocross', 'talent_autofill', 'talent_store_remove'];

var HIRING_SIM_FLOWS = [
  { id: 'main',
    steps: HIRING_SIM_MAIN_STEPS },
  { id: 'referral',
    steps: ['referral_arrives', 'resume_request'].concat(HIRING_SIM_MAIN_STEPS.slice(2)) },
  { id: 'manual',
    steps: ['manual_add', 'manual_contact'].concat(HIRING_SIM_MAIN_STEPS.slice(2)) },
  { id: 'director',
    // The onboarding index is found, never counted, so earlier steps cannot shift it.
    steps: ['director_add', 'director_docs']
      .concat(HIRING_SIM_MAIN_STEPS.slice(HIRING_SIM_MAIN_STEPS.indexOf('onboarding'))) }
];

// ---- the rehearsal card ----

// Actor mode sends for real (test mode would fold every actor into one tester); redirect mode needs test mode on.
function hiringSimContacts_() {
  var mode = 'redirect';
  try {
    if (typeof hiringSimActors_ === 'function') mode = hiringSimActors_().mode;
  } catch (eM) { mode = 'redirect'; }
  var st = null;
  try { st = (typeof hubTestModeState_ === 'function') ? hubTestModeState_() : null; }
  catch (e) { st = null; }
  if (mode === 'actors') {
    var a = hiringSimActors_();
    return { phone: a.candidate_phone, email: a.candidate_email,
             on: !!(a.candidate_phone && a.candidate_email),
             mode: 'actors', test_mode_on: !!(st && st.on) };
  }
  var phone = (st && st.sms && st.sms[0]) || '';
  var email = (st && st.emails && st.emails[0]) || '';
  return { phone: phone, email: email, on: !!(st && st.on),
           mode: 'redirect', test_mode_on: !!(st && st.on) };
}

function hiringSimCard_() {
  var hit = null;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (str_(c.candidatename).toLowerCase().indexOf('[test]') === 0) hit = c;
    });
  } catch (e) { return null; }
  return hit;
}

/** Make (or find) the card the rehearsal walks. */
HUB_POLICY.hiringSimSeed = {
  file: 'HiringSim.gs', lane: 'tool', store: 'sheet',
  // 'tool', not 'write': on the write tier the ledger replaces this answer with {accepted:true}.
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { fresh: { required: false, type: 'boolean' } },
  invalidates: ['candidates'], emits: []
};
// Redirect mode refuses with test mode off: every later step sends something.
HUB_ACTIONS.hiringSimSeed = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var c = hiringSimContacts_();
  if (c.mode === 'actors') {
    if (!c.email || !c.phone) {
      return { status: 409, message:
        'Actors mode needs both rehearsal contacts configured (' +
        (c.email ? '' : 'sim_candidate_email is empty') +
        (c.email || c.phone ? '' : ' and ') +
        (c.phone ? '' : 'sim_candidate_phone is empty') +
        '). Fill them in the simulation config — the card IS those mailboxes, and they are ' +
        'the only thing keeping a rehearsal letter out of a stranger’s inbox.' };
    }
  } else if (!c.on) {
    return { status: 409, message:
      'Test mode is OFF. Turn it on in Settings before running a rehearsal — every step ' +
      'below sends a real message, and test mode is the only thing standing between this ' +
      'card and a real candidate. (Or switch the simulation to actors mode in its config.)' };
  } else if (!c.phone || !c.email) {
    return { status: 409, message:
      'Test mode is on but one of the two rehearsal endpoints is empty (' +
      (c.phone ? '' : 'no SMS number') + (c.phone || c.email ? '' : ' and ') +
      (c.email ? '' : 'no e-mail address') + '). A channel with nobody on it refuses every ' +
      'send, so half the rehearsal would look broken rather than tested.' };
  }

  var existing = hiringSimCard_();
  if (existing && !(payload && payload.fresh)) {
    return { status: 200, data: { candidate_id: str_(existing.candidateid),
             name: str_(existing.candidatename), created: false,
             phone: str_(existing.phone), email: str_(existing.email) } };
  }

  var env = HUB_ACTIONS.hubIntake({
    first_name: HIRING_SIM_FIRST,
    last_name: str_(payload && payload.name) ||
      (HIRING_SIM_LAST + ' ' + new Date().toISOString().slice(11, 19).replace(/:/g, '')),
    phone: c.phone, email: c.email,
    source: 'Simulator'
  }, user);
  if (!env || Number(env.status) !== 200) {
    return { status: Number((env && env.status) || 500),
             message: str_(env && env.message) || 'the intake refused the rehearsal card' };
  }
  var cid = str_(env.data && (env.data.candidate_id || env.data.id));
  journeyLog_({ candidate_id: cid, name: HIRING_SIM_FIRST + ' ' + HIRING_SIM_LAST,
                step: 'welcome', title: 'Rehearsal card created', channel: 'sim',
                to: c.email, ok: true, rehearsal: true,
                detail: 'the simulator created a rehearsal card on the test contacts',
                by: str_(user && user.email) });
  return { status: 200, data: { candidate_id: cid, created: true,
           phone: c.phone, email: c.email, name: HIRING_SIM_FIRST + ' ' + HIRING_SIM_LAST } };
};

// ---- the flow entrances ----

HUB_POLICY.hiringSimReferralSeed = {
  file: 'HiringSim.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};
/** The referral flow's first press: the real public door files a rehearsal referral with a name and the test actor's e-mail, nothing else. */
HUB_ACTIONS.hiringSimReferralSeed = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var c = hiringSimContacts_();
  if (!c.email) {
    return { status: 409, message: 'sim_candidate_email is empty — the referral needs a mailbox to land on.' };
  }
  var existing = hiringSimCard_();
  if (existing) {
    return { status: 200, data: { candidate_id: str_(existing.candidateid), created: false,
             name: str_(existing.candidatename),
             note: 'a rehearsal card already exists — tear it down first to rehearse the arrival' } };
  }
  var env = referralSubmit_({
    name: HIRING_SIM_FIRST + ' Referral ' + new Date().toISOString().slice(11, 19).replace(/:/g, ''),
    email: c.email, phone: '',
    referrer: 'the simulator',
    resume_text: ''
  });
  var ok = !!(env && Number(env.status) === 200);
  var card = ok ? hiringSimCard_() : null;
  if (ok && typeof journeyLog_ === 'function') {
    journeyLog_({ candidate_id: str_(card && card.candidateid), name: str_(card && card.candidatename),
                  step: 'welcome', title: 'A rehearsal referral arrived',
                  channel: 'record', ok: true, rehearsal: true,
                  detail: 'through the REAL public door (referralSubmit) — an e-mail only, ' +
                          'no phone, no resume: the exception lane begins',
                  by: str_(user && user.email) });
  }
  hubBustTalentCache_();
  return { status: 200, data: {
    created: ok, door: Number(env && env.status),
    message: str_(env && env.message),
    candidate_id: str_(card && card.candidateid) || '',
    name: str_(card && card.candidatename) || '',
    note: ok ? 'the referral card exists on the actor mailbox — the REFERRAL ask is the next press'
             : 'the public door refused: ' + str_(env && env.message)
  } };
};

HUB_POLICY.hiringSimEvidenceFill = {
  file: 'HiringSim.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: []
};
/** SIM-only: the phone, a resume mark, the resume decision and CJIS Clear land on the rehearsal card, every line signed by the SIM. */
HUB_ACTIONS.hiringSimEvidenceFill = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  if (!(typeof commsIsTestCandidate_ === 'function' && commsIsTestCandidate_(ev.cand))) {
    return { status: 409, message: 'Sim evidence lands on REHEARSAL cards only — a real ' +
             'candidate\'s resume, decision and CJIS are earned, never typed.' };
  }
  var c = hiringSimContacts_();
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
    phone: c.phone || str_(ev.cand.phone),
    resume_link: str_(ev.cand.resumelink) || '(SIM) resume received by e-mail — sample on file'
  }, user, false);
  hubSetFieldLastRow_(TALENT_RESUME_TAB, cid, {
    decision_status: 'Advance',
    cjis_status: 'Clear'
  }, user, true);
  hubBustTalentCache_();
  if (typeof journeyLog_ === 'function') {
    journeyLog_({ candidate_id: cid, name: str_(ev.cand.candidatename), step: 'welcome',
                  title: 'The missing pieces landed (sim)',
                  channel: 'record', ok: true, rehearsal: true,
                  detail: 'SIM filled: the actor phone, a sample resume mark, resume decision ' +
                          'Advance, CJIS Clear — stand-ins for the inbox scan, the folder ' +
                          'sweep and the recruiter\'s own presses',
                  by: str_(user && user.email) });
  }
  return { status: 200, data: { filled: true,
           note: 'phone + resume mark + decision Advance + CJIS Clear are on the card — the DECISION is the one the gate reads; the other two light their squares' } };
};

// ---- the one read that draws the screen ----

/** Everything the simulator draws, in one execution. */
HUB_POLICY.hiringSimState = {
  file: 'HiringSim.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
// One execution for the whole screen: the account runs one execution at a time.
HUB_ACTIONS.hiringSimState = function (payload, user) {
  var cid = str_(payload && payload.candidate_id);
  var card = null;
  if (cid) {
    try {
      var ev = hubEvidence_(cid);
      card = ev.cand;
    } catch (e) { card = null; }
  } else {
    card = hiringSimCard_();
    cid = str_(card && card.candidateid);
  }

  var contacts = hiringSimContacts_();
  var team = hiringTeamRecipients_();
  var interviewer = hiringInterviewerPick_('');
  var interviewers = hiringInterviewersByBadge_();

  var gate = null, gates = null, stage = '', evidence = null;
  if (card) {
    try {
      evidence = hubEvidence_(str_(card.candidateid));
      stage = talentStage_(card.status) || str_(card.status);
      gate = hubGate_(evidence);
      try {
        if (typeof hubGateFor_ === 'function') {
          gates = ['new', 'phone-screen', 'interview', 'onboarding', 'hired', 'ready']
            .map(function (st) {
              var g = hubGateFor_(evidence, st) || {};
              return { from: str_(g.from) || st, to: str_(g.to) || '',
                       ok: !!g.ok, reasons: g.reasons || [] };
            });
        }
      } catch (eGL) { gates = null; }
    } catch (e2) { gate = null; }
  }

  var ask = null;
  if (cid) {
    try {
      interviewAskRows_().forEach(function (r) {
        if (str_(r.candidateid) === cid) ask = r;
      });
    } catch (e3) { ask = null; }
  }

  var journey = cid ? journeyFor_(cid) : [];
  // Team lines carry a blank candidate_id and must still ride along with the journey.
  if (journey) {
    try {
      var allLines = journeyFor_('');
      if (allLines) {
        var teamLines = allLines.filter(function (l) { return !str_(l.candidate_id); });
        if (teamLines.length) {
          journey = journey.concat(teamLines);
          journey.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
        }
      }
    } catch (eTeam) {}
  }

  var sim = null;
  try {
    if (typeof hiringSimActors_ === 'function') {
      sim = {
        actors: hiringSimActors_(),
        attempts: {
          ask: simAttemptsFor_('ask'), shortlist: simAttemptsFor_('shortlist'),
          outreach: simAttemptsFor_('outreach'), invite: simAttemptsFor_('invite')
        },
        asks: simAskRows_().map(function (r) {
          return { id: str_(r.simaskid), step: str_(r.step),
                   candidate_id: str_(r.candidateid),
                   sent: str_(r.sentcount), max: str_(r.maxattempts),
                   interval_minutes: str_(r.intervalminutes),
                   last_sent_at: str_(r.lastsentat), state: str_(r.state),
                   answered_by: str_(r.answeredby) };
        }),
        cfg: (function () {
          var cfg = hiringSimCfg_();
          var rows = {};
          HIRING_SIM_CFG_DEFAULTS.forEach(function (d) {
            // A blank cell shows the shipped words, as a send would use them.
            var v = cfg[d.key] !== undefined ? String(cfg[d.key]) : '';
            rows[d.key] = v !== '' ? v : (str_(d.value) || simTextDefault_(d.key));
          });
          return rows;
        })()
      };
    }
  } catch (eSim) { sim = null; }

  return { status: 200, data: {
    steps: hiringSimStepsWithWords_(),
    flows: hiringSimFlowsWithWords_(),
    test_mode: { on: contacts.on, sms: contacts.phone, email: contacts.email,
                 mode: contacts.mode || 'redirect',
                 test_redirect_on: !!contacts.test_mode_on },
    sim: sim,
    team: { emails: team.emails, names: team.names },
    interviewer: interviewer,
    interviewers: interviewers,
    candidate: card ? {
      id: str_(card.candidateid), name: str_(card.candidatename),
      phone: str_(card.phone), email: str_(card.email),
      status: str_(card.status), stage: stage,
      resume_link: str_(card.resumelink),
      cjis: str_(evidence && evidence.analysis && evidence.analysis.cjisstatus),
      decision: str_(evidence && evidence.analysis && evidence.analysis.decisionstatus),
      screen_status: str_(evidence && evidence.screen && evidence.screen.screenstatus),
      screen_result: str_(evidence && evidence.screen && evidence.screen.finalresult)
    } : null,
    gate: gate ? { from: gate.from, to: gate.to, ok: !!gate.ok, reasons: gate.reasons || [] } : null,
    gates: gates,
    ask: ask ? {
      ask_id: str_(ask.askid), state: str_(ask.state),
      picked_date: str_(ask.pickeddate), picked_time: str_(ask.pickedtime),
      supervisor_reply: str_(ask.supervisorreply),
      confirmed_date: str_(ask.confirmeddate), confirmed_time: str_(ask.confirmedtime)
    } : null,
    // An unreadable journey is null, never [] (which means nothing happened).
    journey: journey,
    journey_unreadable: journey === null,
    link_secret: !!interviewLinkSecret_()
  } };
};

// ---- tear-down ----

/** Remove a rehearsal and everything filed against it; a card that is not provably a rehearsal is refused. */
HUB_POLICY.hiringSimReset = {
  file: 'HiringSim.gs', lane: 'tool', store: 'sheet',
  // 'tool', not 'write': on the write tier the ledger replaces this answer with {accepted:true}.
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates', 'phoneScreens', 'onboarding'], emits: []
};
// Deletes only provable rehearsals, bottom-up so row numbers do not shift under other writers.
HUB_ACTIONS.hiringSimReset = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };

  var card = null;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (str_(c.candidateid) === cid) card = c;
    });
  } catch (e) { return { status: 500, message: 'could not read the candidates tab' }; }
  if (!card) return { status: 404, message: 'No candidate "' + cid + '".' };
  if (str_(card.candidatename).toLowerCase().indexOf('[test]') !== 0) {
    return { status: 409, message:
      'That card is not a rehearsal: "' + str_(card.candidatename) + '" does not begin with ' +
      '[TEST]. This door only removes rehearsals — a real candidate is archived with a ' +
      'reason (hiringDiscard), never deleted.' };
  }

  var removed = {}, failed = [];
  for (var t = 0; t < HIRING_SIM_TABS.length; t++) {
    var spec = HIRING_SIM_TABS[t];
    try {
      // Through hubTabSheet_, never HUB_DB directly: tabs move between books.
      var sheet = hubTabSheet_(spec.tab);
      if (!sheet) {
        failed.push(spec.tab + ': no sheet answered at its declared address');
        continue;
      }
      var values = sheet.getDataRange().getValues();
      if (values.length < 2) continue;
      var hdr = values[0].map(normKey_);
      var col = hdr.indexOf(normKey_(spec.col));
      if (col === -1) continue;
      var kill = [];
      for (var r = 1; r < values.length; r++) {
        if (str_(values[r][col]) === cid) kill.push(r + 1);
      }
      for (var k = kill.length - 1; k >= 0; k--) sheet.deleteRow(kill[k]);
      if (kill.length) removed[spec.tab] = kill.length;
    } catch (eT) {
      failed.push(spec.tab + ': ' + String((eT && eT.message) || eT));
    }
  }
  hubBustTalentCache_();
  try {
    if (typeof simAskAnswer_ === 'function') simAskAnswer_(['ask', 'shortlist'], 'torn down', '');
  } catch (eA) {}
  var simFiles = 0;
  try {
    if (typeof simCjisCleanup_ === 'function') simFiles = simCjisCleanup_();
  } catch (eF) {}
  try {
    hubSysLog_(str_(user && user.email), 'hiring_sim_reset',
               cid + ' — ' + JSON.stringify(removed) +
               (simFiles ? ' + ' + simFiles + ' (SIM) file(s) trashed from the docs folder' : ''),
               { status: 200 });
  } catch (eL) {}
  return { status: 200, data: { removed: removed, failed: failed, sim_files_trashed: simFiles,
           note: failed.length
             ? 'the rehearsal was torn down, but ' + failed.length + ' tab(s) did not answer — ' +
               'rows may still be filed against it; see failed'
             : 'the rehearsal and everything filed against it are gone' } };
};

// ---- the borrowed transcript ----

/** A transcript is taken from the bank so the system can be validated without having to place a real call every time. */
HUB_POLICY.hiringSimTranscriptSeed = {
  file: 'HiringSim.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
// Rehearsal cards only: a real candidate must never carry someone else's transcript.
HUB_ACTIONS.hiringSimTranscriptSeed = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  if (!(typeof commsIsTestCandidate_ === 'function' && commsIsTestCandidate_(ev.cand))) {
    return { status: 409, message:
      'That card is not a rehearsal. A borrowed transcript belongs on a [TEST] card only — ' +
      'a real candidate must never carry a conversation that was somebody else’s.' };
  }

  var wantFrom = (typeof simCfgVal_ === 'function') ? simCfgVal_('sim_transcript_from') : '';
  var testNames = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (str_(c.candidatename).toLowerCase().indexOf('[test]') === 0) {
        testNames[str_(c.candidateid)] = true;
      }
    });
  } catch (eT) { testNames = {}; }
  var source = null;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_PHONE_TAB).forEach(function (s) {
      var scid = str_(s.candidateid);
      if (!scid || scid === cid || testNames[scid]) return;
      var text = str_(s.transcripttext);
      if (text.length < 400) return;
      if (wantFrom && scid !== wantFrom) return;
      source = s;
    });
  } catch (eR) {
    return { status: 500, message: 'The phone screens tab could not be read.' };
  }
  if (!source && !wantFrom) {
    try {
      var screenDigits = '3307544040';
      try {
        var cfgLine = (typeof simCfgVal_ === 'function') ? simCfgVal_('sim_screen_line') : '';
        var cd = String(cfgLine || '').replace(/\D/g, '').replace(/^1/, '');
        if (cd.length === 10) screenDigits = cd;
      } catch (eD) {}
      var sawCut = 0;
      readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts').forEach(function (t) {
        var line = str_(t.quonumber).replace(/\D/g, '').replace(/^1/, '');
        if (line !== screenDigits) return;
        var text = str_(t.speakertranscript) || str_(t.fulltranscript);
        if (text.length < 400) return;
        // Only a complete call: a cut transcript scores as a bad candidate, not a bad sample.
        if (!hubCallComplete_(text)) {
          sawCut++;
          return;
        }
        if (!source || text.length > source.transcripttext.length) {
          source = { candidateid: 'the 4040 line (call ' + (str_(t.callid) || 'unknown') + ')',
                     transcripttext: text };
        }
      });
      if (!source) {
        source = { candidateid: 'the built-in sample call (a complete Sona screening)',
                   transcripttext: HIRING_SIM_SAMPLE_TRANSCRIPT };
      }
    } catch (eC) {}
  }
  if (!source) {
    return { status: 404, message: wantFrom
      ? 'No completed transcript on file for ' + wantFrom + ' — clear sim_transcript_from ' +
        'to take the newest one instead.'
      : 'Nothing to borrow anywhere: no phone screen carries a transcript, and the comms ' +
        'window has no call on the evaluation line. Run Comms → Sync (or make one call to ' +
        'the 4040) and press again.' };
  }

  var now = new Date().toISOString();
  var borrowed =
    'BORROWED TRANSCRIPT — copied by the simulator on ' + now + ' from ' +
    str_(source.candidateid) + ' so the reading machinery can be validated without a live ' +
    'call. Every fact below belongs to the ORIGINAL conversation.\n\n' +
    str_(source.transcripttext);
  ensureHeader_(hubSheet_(TALENT_PHONE_TAB), [
    'transcript_text', 'transcript_call_id', 'transcript_created', 'transcript_pulled_at',
    'qualification', 'screen_score', 'phone_screen_report_url'
  ]);
  hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, {
    screen_status: 'Completed',
    screen_date: now,
    transcript_text: borrowed,
    transcript_call_id: 'SIM_BORROWED_' + randomHex_(8).toUpperCase(),
    transcript_created: now,
    transcript_pulled_at: now,
    screened_by: 'asa-hub:sim-transcript:' + str_(user && user.email)
  }, user, true);
  hubBustTalentCache_();
  if (typeof journeyLog_ === 'function') {
    journeyLog_({ candidate_id: cid, name: str_(ev.cand.candidatename), step: 'screen_done',
                  title: 'A borrowed transcript is on the card',
                  channel: 'record', ok: true, rehearsal: true,
                  detail: 'copied from ' + str_(source.candidateid) + ' (' +
                          str_(source.transcripttext).length + ' chars) — press Analyze next',
                  by: str_(user && user.email) });
  }
  return { status: 200, data: { seeded: true, source_candidate: str_(source.candidateid),
           chars: str_(source.transcripttext).length,
           note: 'the card reads Completed with the borrowed words — run the analysis next' } };
};
