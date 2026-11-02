// Real handlers and real senders, in one execution: only the safety checked at pre-flight keeps it safe.

// Well inside the six-minute ceiling, leaving room for tear-down; overruns return truncated: true.
var HIRING_WALK_BUDGET_MS = 240000;

// role 'manager' is exactly what hubIsWriter_ admits, no more.
function hiringWalkActor_(user) {
  if (user && str_(user.email)) return user;
  return { role: 'manager', email: 'hiring-walk@service.local', id: 'SVC_HIRING_WALK' };
}

function walkCheck_(out, name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: str_(detail) });
  if (!ok) out.failed++;
  return !!ok;
}

function walkPress_(out, step, action, payload, user) {
  var started = new Date().getTime();
  var env = null, err = '';
  try {
    if (typeof HUB_ACTIONS[action] !== 'function') {
      err = 'no such action: ' + action;
    } else {
      env = HUB_ACTIONS[action](payload || {}, hiringWalkActor_(user));
    }
  } catch (e) {
    err = String((e && e.message) || e);
  }
  var data = (env && env.data) || {};
  var row = {
    step: step, action: action,
    status: Number((env && env.status) || (err ? 500 : 0)),
    ms: new Date().getTime() - started,
    sent: (data.sent === undefined ? null : !!data.sent),
    redirected: !!data.redirected,
    to: str_(data.to),
    delivered_to: str_(data.delivered_to),
    reason: str_(data.reason || data.error),
    message: str_(env && env.message),
    error: err
  };
  out.steps.push(row);
  return { env: env, data: data, row: row, error: err };
}

function walkOutOfTime_(out) {
  if (new Date().getTime() - out.started_ms < HIRING_WALK_BUDGET_MS) return false;
  out.truncated = true;
  return true;
}

function hiringWalkRun_(opts, user) {
  var o = opts || {};
  var out = {
    started_ms: new Date().getTime(), started_at: new Date().toISOString(),
    checks: [], steps: [], failed: 0, truncated: false,
    candidate_id: '', card_created: false, torn_down: false
  };

  // ACTORS mode sends for real to configured actor mailboxes; REDIRECT mode requires test mode ON.
  var contacts = hiringSimContacts_();
  if (contacts.mode === 'actors') {
    if (!walkCheck_(out, 'the actor contacts are configured', contacts.on,
          'candidate → ' + (contacts.email || '(none)') + ' · ' + (contacts.phone || '(none)'))) {
      out.refused = 'actors mode with no candidate mailbox/phone configured — fill ' +
                    'sim_candidate_email and sim_candidate_phone in the simulation config';
      return out;
    }
    var actors = hiringSimActors_();
    walkCheck_(out, 'the copy list resolves', actors.cc_emails.length > 0,
               actors.cc_emails.join(', ') ||
               'sim_cc_emails is empty — nobody rides in copy, and the team rides in copy on every letter');
    walkCheck_(out, 'the interviewer actor is set', !!(actors.interviewer_email || actors.interviewer_phone),
               (actors.interviewer_email || actors.interviewer_phone || '(none)') +
               ' — a rehearsal ask with no actor would fall to nobody, never to the real badge holder');
    if (contacts.test_mode_on) {
      out.checks.push({ name: 'note: test mode is ALSO on', ok: true,
        detail: 'the redirect folds every actor into the listed testers — switch it off to see ' +
                'each mailbox receive its own half' });
    }
  } else {
    if (!walkCheck_(out, 'test mode is ON', contacts.on,
          'sms → ' + (contacts.phone || '(none)') + ' · email → ' + (contacts.email || '(none)'))) {
      out.refused = 'test mode is off — every step below sends a real message, and the ' +
                    'redirect is the only thing between this walk and a real candidate';
      return out;
    }
    walkCheck_(out, 'both rehearsal endpoints are set', !!(contacts.phone && contacts.email),
               'a channel with nobody on it refuses every send, so half the walk would look ' +
               'broken rather than tested');
  }

  var iv = hiringInterviewerPick_('');
  walkCheck_(out, 'somebody holds the INTERVIEWER badge', !!iv.name,
             (iv.name || '(nobody)') + ' · ' + (iv.email || 'no address') + ' — ' + iv.by);

  var team = hiringTeamRecipients_();
  walkCheck_(out, 'the hiring team resolves to at least one address', team.emails.length > 0,
             team.emails.join(', '));

  var secret = !!interviewLinkSecret_();
  walkCheck_(out, 'INTERVIEW_LINK_SECRET is set', secret,
             secret ? '' : 'without it the scheduling invite refuses with no_link_secret and ' +
                           'the scheduling half cannot be walked');

  if (out.failed) return out;

  var cid = str_(o.candidate_id);
  if (!cid) {
    var seeded = walkPress_(out, 'card', 'hiringSimSeed', { fresh: !!o.fresh }, user);
    cid = str_(seeded.data.candidate_id);
    out.card_created = !!seeded.data.created;
  }
  if (!walkCheck_(out, 'a rehearsal card exists', !!cid, cid)) return out;
  out.candidate_id = cid;

  var card = null;
  try { card = hubEvidence_(cid).cand; } catch (eC) { card = null; }
  walkCheck_(out, 'the card is a rehearsal by the platform’s own rule',
             !!(card && commsIsTestCandidate_(card)),
             'its name must begin with [TEST] — that is what stops the graduation minting a ' +
             'staff account from it');

  var gate = null;
  try { gate = hubGate_(hubEvidence_(cid)); } catch (eG) { gate = null; }
  if (gate) {
    walkCheck_(out, 'a fresh card cannot move', gate.ok === false,
               str_(gate.from) + ' → ' + str_(gate.to));
    var reasons = (gate.reasons || []).join(' · ');
    walkCheck_(out, 'the gate asks for the resume decision and nothing else',
               reasons.indexOf('resume decision Advance') !== -1 &&
               reasons.indexOf('resume on file') === -1 &&
               reasons.indexOf('CJIS') === -1, reasons);
    walkCheck_(out, 'no gate asks for a Date accepted any more',
               reasons.toLowerCase().indexOf('date accepted') === -1,
               'the candidate picks their own interview time now');
  }

  if (!walkOutOfTime_(out)) {
    var w = walkPress_(out, 'ask', 'hiringAskSend', {}, user);
    walkCheck_(out, 'step 0 · the ask went', w.data.sent === true,
               str_(w.data.to) + ' → ' + str_(w.data.delivered_to) +
               (w.data.cc ? ' · cc: ' + str_(w.data.cc) : ''));
    if (contacts.mode === 'actors') {
      walkCheck_(out, 'step 0 · the team rides in copy', !!str_(w.data.cc) || w.data.sent !== true,
                 'the copy list rides on every letter; empty means To ' +
                 'already covers everybody on it');
    } else {
      walkCheck_(out, 'step 0 · test mode redirected it', w.data.redirected === true,
                 'a rehearsal that reaches the real team is not a rehearsal');
    }
  }

  if (!walkOutOfTime_(out)) {
    var sl = walkPress_(out, 'shortlist', 'hiringShortlistSend', { limit: 5 }, user);
    if (str_(sl.data.reason) === 'nobody_to_rank') {
      walkCheck_(out, 'step 1 · the shortlist had somebody to rank', false,
                 'no candidate sits at `new` with a scored resume — the letter was not sent, ' +
                 'and an empty table says nothing');
    } else {
      walkCheck_(out, 'step 1 · the shortlist went', sl.data.sent === true,
                 (sl.data.ranked ? sl.data.ranked.length : 0) + ' named · ' +
                 sl.data.unscored + ' unscored of ' + sl.data.pool);
      walkCheck_(out, 'step 1 · unscored candidates are counted, not zeroed',
                 typeof sl.data.unscored === 'number',
                 'the letter prints a dash for them and the count says how many');
    }
  }

  if (!walkOutOfTime_(out)) {
    var sms = walkPress_(out, 'outreach_sms', 'hiringOutreachSend', { candidate_id: cid }, user);
    var one = (sms.data.candidates && sms.data.candidates[0]) || {};
    if (one.sms && str_(one.sms.reason) === 'opted_out') {
      walkCheck_(out, 'step 4 · the rehearsal number can be texted', false,
                 'it has opted out — send START from it to reverse');
    } else {
      walkCheck_(out, 'step 4 · the outreach text went', !!(one.sms && one.sms.sent),
                 (one.sms ? str_(one.sms.to) + ' → ' + str_(one.sms.delivered_to) : 'no sms leg'));
    }
    walkCheck_(out, 'step 4 · the outreach letter went too', !!(one.email && one.email.sent),
               (one.email ? str_(one.email.to) +
                 (one.email.cc ? ' · cc: ' + str_(one.email.cc) : '') : 'no email leg') +
               ' — both channels since 2026-08-23');
  }

  if (!walkOutOfTime_(out)) {
    var rq = walkPress_(out, 'resume_request', 'hiringResumeRequestSend',
                        { candidate_id: cid, referrer: 'the walk' }, user);
    walkCheck_(out, 'step 5 · the resume request went', rq.data.sent === true,
               str_(rq.data.to) + ' → ' + str_(rq.data.delivered_to));
  }

  if (!walkOutOfTime_(out)) {
    var cj = walkPress_(out, 'cjis_request', 'hiringCjisRequestSend', { candidate_id: cid }, user);
    if (str_(cj.data.reason) === 'already_cleared') {
      out.checks.push({ name: 'step 6 · nothing asked for — already cleared', ok: true,
                        detail: 'asking for a document that is on file is how a team learns to ' +
                                'ignore the platform' });
    } else {
      walkCheck_(out, 'step 6 · the CJIS request went', cj.data.sent === true,
                 str_(cj.data.to) + ' → ' + str_(cj.data.delivered_to));
    }
  }

  if (!walkOutOfTime_(out)) {
    var rep = walkPress_(out, 'outreach_reply', 'hiringOutreachReplyCheck',
                         { candidate_id: cid }, user);
    out.checks.push({
      name: 'step 4b · the inbound reply was read on demand',
      ok: rep.row.status === 200,
      detail: rep.data.matched
        ? 'a yes was found: ' + str_(rep.data.reply).slice(0, 80)
        : 'no reply on the card yet (' + Number(rep.data.checked || 0) + ' inbound row(s) read). ' +
          'Text YES from the rehearsal number and run the walk again — the sweep is NOT waited ' +
          'for, it is called.'
    });
  }

  // Scans only: attaching a document to a person is a human decision, never the walk's.
  if (!walkOutOfTime_(out)) {
    var cs = walkPress_(out, 'cjis_scan', 'cjisFolderSweepNow', {}, user);
    out.checks.push({
      name: 'step 6b · the CJIS folder was looked at',
      ok: cs.row.status === 200,
      detail: cs.row.status === 200
        ? Number((cs.data && cs.data.attached) || 0) + ' attached · ' +
          Number((cs.data && cs.data.orphans) || 0) + ' file(s) matching nobody — and NOTHING ' +
          'was marked Clear, which is the line this lane does not cross'
        : str_(cs.row.message) || str_(cs.error)
    });
  }
  if (!walkOutOfTime_(out)) {
    var rs2 = walkPress_(out, 'resume_scan', 'resumeInboxScan', {}, user);
    out.checks.push({
      name: 'step 6c · the resume folder was read',
      ok: rs2.row.status === 200,
      detail: rs2.row.status === 200 ? 'the folder answered'
                                     : str_(rs2.row.message) || str_(rs2.error)
    });
  }

  if (secret && !walkOutOfTime_(out)) {
    var inv = walkPress_(out, 'schedule_invite', 'interviewInviteSend',
                         { candidate_id: cid }, user);
    walkCheck_(out, 'step 9 · the scheduling invite went', inv.data.invited === true,
               str_(inv.data.reason) || ('ask ' + str_(inv.data.ask_id)));
    walkCheck_(out, 'step 9 · e-mail always, SMS only when a phone exists',
               inv.data.emailed === true,
               'an address is something everybody has and a phone is not');
    out.link = str_(inv.data.link);

    var ask = null;
    try {
      interviewAskRows_().forEach(function (r) { if (str_(r.candidateid) === cid) ask = r; });
    } catch (eA) { ask = null; }
    walkCheck_(out, 'step 9 · the ask row says invited',
               !!ask && str_(ask.state) === 'invited',
               ask ? ('state: ' + str_(ask.state)) : 'no ask row was written');
    out.ask_state = ask ? str_(ask.state) : '';
    out.next = 'Open the link above and pick a time. Then run the walk again — it reads the ' +
               'reply and asks the interviewer without waiting for any throttle.';
  }

  if (!walkOutOfTime_(out)) {
    var sw = walkPress_(out, 'interviewer_ask', 'interviewAskSweepNow', {}, user);
    out.checks.push({
      name: 'step 10 · the interviewer sweep ran on demand',
      ok: sw.row.status === 200,
      detail: sw.row.status === 200
        ? 'waiting: ' + Number((sw.data && sw.data.waiting) || 0) +
          ' · acted on: ' + Number((sw.data && sw.data.acted) || 0) +
          ' — the 900-second throttle was NOT waited for'
        : str_(sw.row.message) || str_(sw.error)
    });
  }

  if (o.include_discard && !walkOutOfTime_(out)) {
    var dis = walkPress_(out, 'discarded', 'hiringDiscard',
                         { candidate_id: cid, reason: 'The walk exercised the discard path' }, user);
    walkCheck_(out, 'step 11 · the discard told the team', dis.data.sent === true,
               str_(dis.data.reason));
    walkCheck_(out, 'step 11 · the card was marked archived', dis.data.archived === true,
               'archived / archived_at / archived_reason — the Archive’s own column names');
  }

  var journey = journeyFor_(cid);
  if (journey === null) {
    walkCheck_(out, 'the record is readable', false,
               'the hiring_journey tab could not be read — that is NOT an empty journey');
  } else {
    walkCheck_(out, 'every step wrote a line', journey.length > 0, journey.length + ' line(s)');
    var rehearsals = 0;
    journey.forEach(function (l) { if (l.rehearsal) rehearsals++; });
    walkCheck_(out, 'the record says which sends were rehearsals', rehearsals > 0,
               rehearsals + ' of ' + journey.length + ' marked as a rehearsal');
    out.journey = journey.length;
  }

  if (o.tear_down) {
    var td = walkPress_(out, 'tear_down', 'hiringSimReset', { candidate_id: cid }, user);
    out.torn_down = td.row.status === 200;
    walkCheck_(out, 'the rehearsal was removed', out.torn_down,
               'a card left at hired is picked up by the graduation sweep on the next service read');
  }

  out.ms = new Date().getTime() - out.started_ms;
  out.ok = out.failed === 0 && !out.truncated;

  // check-emits cannot follow HUB_ACTIONS[action]; this direct report is what makes the reach visible to it.
  if (o.notify !== false) out.reported_to = hiringWalkTell_(out, user);
  return out;
}

function hiringWalkTell_(out, user) {
  var to = str_(user && user.email);
  if (!to) {
    try { to = (hiringTeamRecipients_().emails || [])[0] || ''; } catch (e) { to = ''; }
  }
  if (!to) return '';
  var passed = out.checks.length - out.failed;
  var lines = out.checks.map(function (c) {
    return (c.ok ? '  ok   ' : '  FAIL ') + c.name + (c.detail ? '\n         ' + c.detail : '');
  }).join('\n');
  var title = out.failed
    ? out.failed + ' of ' + out.checks.length + ' checks failed'
    : 'the walk passed — ' + passed + ' checks';

  var blocks = [
    mailPara_('The hiring walk ran against the rehearsal card <strong>' +
      mailEsc_(str_(out.candidate_id)) + '</strong> and asserted every step.'),
    mailFact_('Result', title),
    mailFact_('Time spent', Math.round(Number(out.ms || 0) / 1000) + ' seconds, one execution')
  ];
  if (out.truncated) {
    blocks.push(mailPara_('<strong>It stopped early</strong> against its own four-minute budget. ' +
      'What is below is what finished, and it says so rather than looking complete.'));
  }
  if (out.link) blocks.push(mailFact_('The candidate’s page', str_(out.link)));
  if (out.next) blocks.push(mailPara_(mailEsc_(str_(out.next))));
  blocks.push('<pre style="margin:0;padding:12px 14px;background:' + MAIL_PAPER +
    ';border:1px solid ' + MAIL_LINE + ';border-radius:10px;font-family:' +
    "'Courier New',Courier,monospace" + ';font-size:12px;line-height:18px;color:' +
    MAIL_INK + ';white-space:pre-wrap;">' + mailEsc_(lines) + '</pre>');

  var letter = {
    subject: '[walk] ' + title,
    text: 'The hiring walk ran against ' + str_(out.candidate_id) + '.\n\n' + title + '\n\n' +
          lines + '\n' + (out.next ? '\n' + out.next + '\n' : ''),
    html: mailShell_({
      eyebrow: 'ASA LifeCare · Hiring',
      title: 'The hiring walk',
      preheader: title,
      blocks: blocks,
      barColor: out.failed ? MAIL_DANGER : MAIL_ACCENT,
      footnote: 'Every step above pressed the real action against a rehearsal card. Test mode ' +
        'redirected every message it sent.'
    })
  };
  var r = rpcCall_('emailSend', {
    to: to, subject: letter.subject, body: letter.text, html: letter.html,
    reason: 'hiring walk: the report of a rehearsal'
  }, { quiet_exempt: 'asked_now' });
  return (r && r.sent) ? to : '';
}

/** One execution, the whole walk: the screen presses this once instead of pressing twelve actions in a row. */
HUB_POLICY.hiringWalkRun = {
  file: 'HiringWalk.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  params: {
    candidate_id: { required: false, type: 'string' },
    include_discard: { required: false, type: 'boolean' },
    tear_down: { required: false, type: 'boolean' },
    dry_docs: { required: false, type: 'boolean' },
    fresh: { required: false, type: 'boolean' }
  },
  invalidates: ['candidates', 'phoneScreens', 'onboarding'],
  emits: ['emailSend', 'smsSend']
};
HUB_ACTIONS.hiringWalkRun = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var out;
  try { out = hiringWalkRun_(payload || {}, user); }
  catch (e) { return { status: 500, message: String((e && e.message) || e) }; }
  return { status: 200, data: out };
};

function runHiringWalk() {
  var out = hiringWalkRun_({ tear_down: false }, null);
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runHiringWalkAndTearDown() {
  var out = hiringWalkRun_({ tear_down: true }, null);
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
