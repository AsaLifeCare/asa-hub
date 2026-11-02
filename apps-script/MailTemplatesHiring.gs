// A Smart Comms row's words (bodyText) win when present; the layout is ours either way.

var HIRING_MAIL_EYEBROW = 'ASA LifeCare · Hiring';

function hiringScoreTable_(rows) {
  var list = rows || [];
  if (!list.length) return '';
  var html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="border:1px solid ' + MAIL_LINE + ';border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;">' +
    '<tr style="background:' + MAIL_ACCENT_SOFT + ';">' +
    '<td style="padding:9px 14px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">Candidate</td>' +
    '<td align="center" style="padding:9px 10px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">Score</td>' +
    '<td style="padding:9px 14px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">Why</td>' +
    '</tr>';
  for (var i = 0; i < list.length; i++) {
    var r = list[i] || {};
    var contact = [];
    if (r.phone) contact.push(String(r.phone));
    if (r.email) contact.push(String(r.email));
    if (r.city) contact.push(String(r.city));
    // Unscored prints a dash, never a zero.
    var score = (r.score === '' || r.score === null || r.score === undefined) ? '–' : String(r.score);
    html += '<tr style="border-top:1px solid ' + MAIL_LINE + ';">' +
      '<td style="padding:11px 14px;border-top:1px solid ' + MAIL_LINE + ';font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:' + MAIL_INK + ';">' +
      '<strong>' + mailEsc_(r.name || '') + '</strong>' +
      (contact.length ? '<br><span style="font-size:12px;color:' + MAIL_INK_SOFT + ';">' + mailEsc_(contact.join(' · ')) + '</span>' : '') +
      '</td>' +
      '<td align="center" style="padding:11px 10px;border-top:1px solid ' + MAIL_LINE + ';font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:bold;color:' + (score === '–' ? MAIL_INK_SOFT : MAIL_ACCENT) + ';">' + mailEsc_(score) + '</td>' +
      '<td style="padding:11px 14px;border-top:1px solid ' + MAIL_LINE + ';font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:19px;color:' + MAIL_INK_SOFT + ';">' + mailEsc_(r.why || '') + '</td>' +
      '</tr>';
  }
  return html + '</table>';
}

function hiringScoreText_(rows) {
  var list = rows || [];
  if (!list.length) return '';
  return list.map(function (r, i) {
    var score = (r.score === '' || r.score === null || r.score === undefined) ? 'not scored' : String(r.score) + '/10';
    var contact = [r.phone, r.email, r.city].filter(String).join(' · ');
    return '  ' + (i + 1) + '. ' + String(r.name || '') + ' — ' + score +
      (r.why ? '\n     ' + String(r.why) : '') +
      (contact ? '\n     ' + contact : '');
  }).join('\n');
}

function mailBodyBlocks_(bodyText) {
  return String(bodyText || '').trim().split(/\n{2,}/).map(function (p) {
    return mailPara_(mailEsc_(p).replace(/\n/g, '<br>'));
  });
}

function hiringWelcomeEmail_(o) {
  var opts = o || {};
  var roles = opts.roles || [];
  var count = opts.candidateCount;
  var link = String(opts.link || mailPlatformUrl_() + '/#/app/hiring/pipeline');
  var bodyText = String(opts.bodyText || '').trim();
  var rolesLine = roles.length
    ? roles.join(', ')
    : 'the roles named in the access matrix';

  var blocks;
  if (bodyText) {
    blocks = mailBodyBlocks_(bodyText);
    blocks.push(mailFact_('Who can open it', rolesLine));
  } else {
    blocks = [
      mailPara_('The <strong>Hiring Pipeline</strong> is open on the platform. It carries every ' +
        'candidate from the first contact to their first day — the resume and its score, the ' +
        'background check, the phone screen and its transcript, the in-person interview, the ' +
        'onboarding paperwork, and the account the new hire signs in with.'),
      mailFact_('Who can open it', rolesLine),
    ];
  }
  if (count !== undefined && count !== null && count !== '') {
    blocks.push(mailFact_('Ready to work today', String(count) + ' DSPs already in our database'));
  }
  if (!bodyText) {
    blocks.push(mailPara_('Open the app, pick the people worth calling, and start them down the ' +
      'process — every step after that is prompted by the platform itself, and every message ' +
      'it sends is recorded on the card.'));
    blocks.push(mailSteps_([
      'Open <strong>Hiring Pipeline</strong> from the app hub.',
      'Choose a candidate from the board and open their card.',
      'Advance them when the card says every piece of evidence is on file — it names what is missing.',
    ]));
  }

  var text = (bodyText ||
    'The Hiring Pipeline is open on the platform.\n\n' +
    'It carries every candidate from first contact to first day: the resume and its score, ' +
    'the background check, the phone screen and its transcript, the in-person interview, the ' +
    'onboarding paperwork, and the account the new hire signs in with.') + '\n\n' +
    'Who can open it: ' + rolesLine + '\n' +
    (count !== undefined && count !== null && count !== ''
      ? 'Ready to work today: ' + count + ' DSPs already in our database\n' : '') +
    '\nOpen it here: ' + link + '\n';

  return {
    subject: String(opts.subject || '') || 'The Hiring Pipeline is open — start hiring from our own database',
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'The Hiring Pipeline is open',
      preheader: 'Pick candidates from our own database and start the hiring process.',
      blocks: blocks,
      cta: { label: 'Open the Hiring Pipeline', href: link },
      footnote: 'You are reading this because your role reaches the Hiring Pipeline. ' +
        'Everything the app sends from here on is recorded on the candidate’s own card.'
    })
  };
}

function hiringAskEmail_(o) {
  var opts = o || {};
  var count = opts.candidateCount;
  var bodyText = String(opts.bodyText || '').trim();

  var blocks = [];
  if (bodyText) {
    bodyText.split(/\n{2,}/).forEach(function (p) {
      blocks.push(mailPara_(mailEsc_(p).replace(/\n/g, '<br>')));
    });
  } else {
    blocks.push(mailPara_('Hello team — <strong>are we currently hiring?</strong>'));
    blocks.push(mailPara_('If we are, how many Direct Support Professionals from the pool I ' +
      'have already analyzed would you like to see? Reply with a number and I will send the ' +
      'ranked shortlist with my reading of it.'));
  }
  if (count !== undefined && count !== null && count !== '') {
    blocks.push(mailFact_('Analyzed and ready to be ranked', String(count) + ' DSPs'));
  }
  blocks.push(mailPara_('<strong>Reply to this message</strong> — a number, or simply OK, is ' +
    'all this needs. I read the answer and take the next step from it.'));

  var text = (bodyText ||
    'Hello team — are we currently hiring?\n\n' +
    'If we are, how many Direct Support Professionals from the pool I have already analyzed ' +
    'would you like to see? Reply with a number and I will send the ranked shortlist.') +
    (count !== undefined && count !== null && count !== ''
      ? '\n\nAnalyzed and ready to be ranked: ' + count + ' DSPs\n' : '\n');

  return {
    subject: String(opts.subject || '') || 'Are we hiring? — your word starts the process',
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'Are we hiring?',
      preheader: 'One reply starts the whole process.',
      blocks: blocks,
      footnote: 'The platform reads the reply on this thread. OK, a number, or the names you ' +
        'want are all answers it understands.'
    })
  };
}

function hiringShortlistEmail_(o) {
  var opts = o || {};
  var rows = opts.rows || [];
  var reading = String(opts.reading || '');
  var criteria = opts.criteria || [];
  var bodyText = String(opts.bodyText || '').trim();
  var link = String(opts.link || mailPlatformUrl_() + '/#/app/hiring/pipeline');

  // An override replaces only the intro; the table, criteria and reply line always ride along.
  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_('We reviewed the Direct Support Professionals currently in our database and ' +
      'ranked them against the work we actually need covered.' +
      (rows.length ? ' These are the strongest, in order:' : '')),
  ];
  if (rows.length) blocks.push(hiringScoreTable_(rows));
  if (criteria.length) {
    blocks.push(mailPara_('<strong>The criteria behind the score:</strong><br>' +
      criteria.map(function (c, i) {
        return String.fromCharCode(65 + i) + ' · ' + mailEsc_(String(c));
      }).join('<br>')));
  }
  if (reading) {
    reading.split(/\n{2,}/).forEach(function (p) {
      blocks.push(mailPara_(mailEsc_(p).replace(/\n/g, '<br>')));
    });
  }
  blocks.push(mailPara_('<strong>If any of them is worth a call, reply to this message and say ' +
    'which one.</strong> We open the conversation from there and keep every step on their card.'));

  var text = (bodyText ||
    'We reviewed the Direct Support Professionals currently in our database and ranked ' +
    'them against the work we need covered.') + '\n\n' +
    (rows.length ? hiringScoreText_(rows) + '\n\n' : '') +
    (criteria.length
      ? 'The criteria behind the score:\n' + criteria.map(function (c, i) {
          return '  ' + String.fromCharCode(65 + i) + ' - ' + String(c);
        }).join('\n') + '\n\n'
      : '') +
    (reading ? reading + '\n\n' : '') +
    'If any of them is worth a call, reply and say which one — we open the conversation from ' +
    'there.\n\nThe board: ' + link + '\n';

  return {
    subject: String(opts.subject || '') ||
      ('Our strongest DSPs right now' + (rows.length ? ' — top ' + rows.length : '')),
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'The candidates worth calling',
      preheader: 'Our analysis of the DSPs already in our database, ranked.',
      blocks: blocks,
      cta: { label: 'See them on the board', href: link },
      footnote: 'Scores come from our own resume analysis. A dash means the resume was never ' +
        'scored — it is not a zero, and it is not a verdict.'
    })
  };
}

function hiringInterestThanksEmail_(o) {
  var opts = o || {};
  var who = String(opts.who || '').trim();
  var about = String(opts.about || '').trim();
  var bodyText = String(opts.bodyText || '').trim();
  var first = who.split(/\s+/)[0] || '';
  // The subject never names a DSP.
  var many = about.indexOf(',') !== -1;

  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_((first ? 'Hi ' + mailEsc_(first) + ',' : 'Hello,') + ' thank you — that is ' +
      'exactly what we needed.'),
    mailPara_('We are reaching out to ' + (about ? '<strong>' + mailEsc_(about) + '</strong>' : 'them') +
      ' now — the conversation lands on ' + (many ? 'each card' : 'their card') +
      ' from the first message. You will see the outcome there without having to ask.'),
  ];

  var text = bodyText ? bodyText + '\n' :
    (first ? 'Hi ' + first + ',' : 'Hello,') + '\n\nThank you — that is exactly what we ' +
    'needed.\n\nWe are reaching out to ' + (about || 'them') + ' now — the conversation lands ' +
    'on ' + (many ? 'each card' : 'their card') + ' from the first message.\n';

  return {
    subject: String(opts.subject || '') || 'Thank you — we will take it from here',
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'Thank you — we will take it from here',
      preheader: 'We are opening the conversation now.',
      blocks: blocks,
      footnote: 'No reply needed. Everything from here is recorded on the candidate’s card.'
    })
  };
}

function hiringResumeRequestEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var first = name.split(/\s+/)[0] || name;
  var referrer = String(opts.referrer || '').trim();
  var bodyText = String(opts.bodyText || '').trim();
  var link = String(opts.link || '');

  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_((first ? 'Hi ' + mailEsc_(first) + ',' : 'Hello,') + ' ' +
      (referrer
        ? mailEsc_(referrer) + ' passed your name to us at <strong>ASA LifeCare</strong>'
        : 'your name reached us at <strong>ASA LifeCare</strong>') +
      ' — we support people with developmental disabilities across Ohio, and we are hiring ' +
      'Direct Support Professionals.'),
    mailPara_('To look at you for a selection process, we would like <strong>either or ' +
      'both</strong> of:'),
    mailSteps_([
      '<strong>A phone number</strong> we can reach you on.',
      '<strong>Your resume</strong> — attached to a reply is perfect.',
    ]),
    mailPara_('<strong>And the question that decides it: are you interested in a selection ' +
      'process at ASA LifeCare?</strong> Reply to this message with your number, your resume, ' +
      'or simply "yes, I am interested" — our recruiting team reads it and calls you.'),
  ];
  var text = (bodyText ? bodyText + '\n' :
    (first ? 'Hi ' + first + ',' : 'Hello,') + '\n\n' +
    (referrer ? referrer + ' passed your name to us at ASA LifeCare' : 'Your name reached us at ASA LifeCare') +
    ' — we support people with developmental disabilities across Ohio, and we are hiring Direct ' +
    'Support Professionals.\n\nTo look at you for a selection process, we would like either or ' +
    'both of:\n\n  1. A phone number we can reach you on.\n  2. Your resume — attached to a ' +
    'reply is perfect.\n\nAnd the question that decides it: are you interested in a selection ' +
    'process at ASA LifeCare? Reply with your number, your resume, or simply "yes, I am ' +
    'interested" — our recruiting team reads it and calls you.\n') + (link ? '\n' + link + '\n' : '');

  return {
    subject: String(opts.subject || '') || 'REFERRAL - Your phone or resume — a selection process at ASA LifeCare',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare',
      title: 'A phone, a resume — and your interest',
      preheader: 'A phone number or your resume, and whether a selection process interests you.',
      blocks: blocks,
      cta: link ? { label: 'Send them here', href: link } : null,
      footnote: 'If this reached you by mistake, you can ignore it — nothing was created for you.'
    })
  };
}

function hiringCjisRequestEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var folder = String(opts.folderUrl || '');
  var status = String(opts.status || '').trim();
  var bodyText = String(opts.bodyText || '').trim();

  var blocks;
  if (bodyText) {
    blocks = mailBodyBlocks_(bodyText);
    blocks.push(mailFact_('Candidate', name));
  } else {
    blocks = [
      mailPara_('The hiring pipeline is holding <strong>' + mailEsc_(name) + '</strong> at the ' +
        'first gate: the background check is not on file, and nothing moves without it.'),
      mailFact_('Candidate', name),
    ];
  }
  if (status) blocks.push(mailFact_('What the record says today', status));
  // Only the folder: nothing on this platform reads an attachment out of a mailbox.
  if (!bodyText) {
    blocks.push(mailPara_('Download the CJIS result and drop it in the folder. The platform reads ' +
      'that folder on its own and matches the file to the candidate by name; putting it on their ' +
      'record stays a deliberate press by one of us, because finding a document and deciding it ' +
      'is theirs are two different things.'));
  }

  var text = bodyText
    ? bodyText + '\n\nCandidate: ' + name + '\n' +
      (status ? 'What the record says today: ' + status + '\n' : '') +
      (folder ? 'The folder: ' + folder + '\n' : '')
    : 'The hiring pipeline is holding ' + name + ' at the first gate: the background ' +
      'check is not on file.\n\n' + (status ? 'What the record says today: ' + status + '\n\n' : '') +
      'Download the CJIS result and drop it in the folder' + (folder ? ': ' + folder : '') +
      '\n\nThe platform reads that folder, matches the file to the candidate by name and puts it ' +
      'on their card. Attaching it to their record stays a deliberate press by one of us.\n';

  return {
    subject: String(opts.subject || '') || ('CJIS needed to move ' + name + ' forward'),
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'A background check is holding a candidate',
      preheader: name + ' cannot move until the CJIS result is on file.',
      blocks: blocks,
      cta: folder ? { label: 'Open Original Documents', href: folder } : null,
      footnote: 'The folder is the whole ask. The platform reads it on its own, and the card ' +
        'shows the report the moment one of us attaches it.'
    })
  };
}

function hiringDecisionAskEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var score = opts.score;
  var summary = String(opts.summary || '').trim();
  var reportUrl = String(opts.reportUrl || '');
  var bodyText = String(opts.bodyText || '').trim();
  var link = String(opts.link || mailPlatformUrl_() + '/#/app/hiring/pipeline');

  // An override replaces only the intro: the sweep reads the reply for ADVANCE/DECLINE.
  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_('<strong>' + mailEsc_(name) + '</strong> finished the phone screen. We read the ' +
      'transcript and scored it — the next move is yours.'),
  ];
  if (score !== undefined && score !== null && score !== '') {
    blocks.push(mailFact_('Screen score', String(score) + ' / 10'));
  }
  if (summary) {
    summary.split(/\n{2,}/).forEach(function (p) {
      blocks.push(mailPara_(mailEsc_(p).replace(/\n/g, '<br>')));
    });
  }
  blocks.push(mailPara_('<strong>Reply ADVANCE to release them to the interview and ' +
    'scheduling step, or DECLINE to close the file.</strong> Either answer is recorded on the ' +
    'card with your name and the time.'));

  var text = (bodyText ||
    name + ' finished the phone screen. We read the transcript and scored it — the next ' +
    'move is yours.') + '\n\n' +
    (score !== undefined && score !== null && score !== '' ? 'Screen score: ' + score + '/10\n\n' : '') +
    (summary ? summary + '\n\n' : '') +
    (reportUrl ? 'The full report: ' + reportUrl + '\n\n' : '') +
    'Reply ADVANCE to release them to the interview and scheduling step, or DECLINE to ' +
    'close the file.\n\n' +
    'The card: ' + link + '\n';

  return {
    subject: String(opts.subject || '') || ('Your decision: ' + name + ' after the phone screen'),
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'One decision left on ' + (name || 'this candidate'),
      preheader: 'The phone screen is done — advance them or close the file.',
      blocks: blocks,
      cta: { label: reportUrl ? 'Read the full report' : 'Open the card', href: reportUrl || link },
      footnote: 'The platform is watching this thread and the recruiting line for your answer. ' +
        'Whichever way you reply, the card records who said it and when.'
    })
  };
}

function interviewerAvailabilityEmail_(o) {
  var opts = o || {};
  var interviewer = String(opts.interviewer || '').trim();
  var first = interviewer.split(/\s+/)[0] || '';
  var name = String(opts.name || '').trim();
  var slot = String(opts.slot || '').trim();
  var facts = opts.facts || [];
  var bodyText = String(opts.bodyText || '').trim();
  var link = String(opts.link || '');

  // An override replaces only the intro: the sweep reads the reply for YES/NO.
  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_((first ? 'Hi ' + mailEsc_(first) + ',' : 'Hello,') + ' <strong>' + mailEsc_(name) +
      '</strong> chose a time for their in-person interview and we need your word before it is booked.'),
  ];
  blocks.push(mailFact_('They chose', slot || 'a time on their calendar'));
  for (var i = 0; i < facts.length; i++) {
    blocks.push(mailFact_(String(facts[i].label || ''), String(facts[i].value || '')));
  }
  blocks.push(mailPara_('<strong>Reply YES if that works and we book it, or NO and we will ask ' +
    'you for three times that suit you better.</strong>'));

  var text = (bodyText ||
    (first ? 'Hi ' + first + ',' : 'Hello,') + '\n\n' + name + ' chose a time for their ' +
    'in-person interview and we need your word before it is booked.') + '\n\n' +
    'They chose: ' + (slot || 'a time on their calendar') + '\n' +
    facts.map(function (f) { return String(f.label || '') + ': ' + String(f.value || ''); }).join('\n') +
    '\n\nReply YES if that works and we book it, or NO and we will ask you for three times that ' +
    'suit you better.\n' + (link ? '\n' + link + '\n' : '');

  return {
    subject: String(opts.subject || '') || ('Can you interview ' + name + (slot ? ' — ' + slot : '') + '?'),
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'Does this interview time work?',
      preheader: name + ' chose ' + (slot || 'a time') + ' — yes or no is all we need.',
      blocks: blocks,
      cta: link ? { label: 'Open the candidate', href: link } : null,
      footnote: 'You are being asked because you hold the INTERVIEWER badge on the platform. ' +
        'A reply of YES books the meeting on the hiring calendar and tells the candidate.'
    })
  };
}

function interviewerThanksEmail_(o) {
  var opts = o || {};
  var interviewer = String(opts.interviewer || '').trim();
  var first = interviewer.split(/\s+/)[0] || '';
  var name = String(opts.name || '').trim();
  var slot = String(opts.slot || '').trim();
  var where = String(opts.location || '').trim();
  var bodyText = String(opts.bodyText || '').trim();

  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_((first ? 'Thank you, ' + mailEsc_(first) + '.' : 'Thank you.') + ' It is booked ' +
      'and <strong>' + mailEsc_(name) + '</strong> has been told.'),
  ];
  blocks.push(mailFact_('Interview', name + (slot ? ' — ' + slot : '')));
  if (where) blocks.push(mailFact_('Where', where));
  if (!bodyText) {
    blocks.push(mailPara_('It is on the hiring calendar and on your own. The scorecard opens on ' +
      'the platform the day before and stays open for two days afterwards.'));
  }

  var text = (bodyText ||
    'Thank you' + (first ? ', ' + first : '') + '. It is booked and ' + name +
    ' has been told.') + '\n\nInterview: ' + name + (slot ? ' — ' + slot : '') + '\n' +
    (where ? 'Where: ' + where + '\n' : '') +
    (bodyText ? '' :
    '\nIt is on the hiring calendar. The scorecard opens the day before and stays open for two ' +
    'days afterwards.\n');

  return {
    subject: String(opts.subject || '') || ('Booked — ' + name + (slot ? ', ' + slot : '')),
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'The interview is booked',
      preheader: name + (slot ? ' — ' + slot : '') + ' is on the calendar.',
      blocks: blocks,
      footnote: 'Nothing else is needed from you until the interview itself.'
    })
  };
}

function hiringDiscardEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var reason = String(opts.reason || '').trim();
  var stage = String(opts.stage || '').trim();
  var when = String(opts.when || '').trim();
  var by = String(opts.by || '').trim();
  var bodyText = String(opts.bodyText || '').trim();
  var link = String(opts.link || mailPlatformUrl_() + '/#/app/hiring/archive');

  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_('<strong>' + mailEsc_(name) + '</strong> has just been taken out of our selection ' +
      'process. Their card and everything on it moved to the Archive — nothing was deleted.'),
  ];
  blocks.push(mailFact_('Candidate', name));
  if (stage) blocks.push(mailFact_('Stage when it happened', stage));
  if (reason) blocks.push(mailFact_('Reason', reason));
  if (when) blocks.push(mailFact_('When', when));
  if (by) blocks.push(mailFact_('Decided by', by));

  var text = (bodyText ||
    name + ' has just been taken out of our selection process. Their card and everything ' +
    'on it moved to the Archive — nothing was deleted.') + '\n\n' +
    'Candidate: ' + name + '\n' + (stage ? 'Stage: ' + stage + '\n' : '') +
    (reason ? 'Reason: ' + reason + '\n' : '') + (when ? 'When: ' + when + '\n' : '') +
    (by ? 'Decided by: ' + by + '\n' : '') + '\nThe Archive: ' + link + '\n';

  return {
    subject: String(opts.subject || '') || (name + ' was removed from the hiring process'),
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: 'A candidate left the process',
      preheader: name + ' moved to the Archive with their whole record.',
      blocks: blocks,
      cta: { label: 'Open the Archive', href: link },
      footnote: 'The Archive keeps the whole record — the resume, the screen, the messages and ' +
        'the reason. Nothing about them was thrown away.'
    })
  };
}

// The password prints monospace so O and 0 can be told apart.
function onboardingWelcomeLoginEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var first = name.split(/\s+/)[0] || name;
  var email = String(opts.email || '').trim();
  var password = String(opts.password || '').trim();
  var bodyText = String(opts.bodyText || '').trim();
  var link = String(opts.link || mailPlatformUrl_());

  var blocks = bodyText ? mailBodyBlocks_(bodyText) : [
    mailPara_((first ? 'Congratulations, ' + mailEsc_(first) + '.' : 'Congratulations.') +
      ' You are through the interview and starting your onboarding with <strong>ASA ' +
      'LifeCare</strong> — and you now have your own account on our platform.'),
  ];
  blocks.push(mailFact_('Sign in with', email, true));
  if (password) blocks.push(mailFact_('First-time password', password, true));
  if (password) {
    blocks.push(mailPara_('<strong>This password is not yours and is not private.</strong> It is the ' +
      'one every new account starts on, so the platform asks you to choose your own the moment you ' +
      'sign in — you cannot reach a single screen until you do.'));
  }
  if (!bodyText) {
    blocks.push(mailPara_('Your account opens <strong>your onboarding</strong> — the New Hire ' +
      'Questionnaire, your tutorials and your documents. That is deliberate: the rest of the ' +
      'platform opens by itself the day your onboarding is complete.'));
  }
  blocks.push(mailSteps_([
    'Sign in and change the temporary password.',
    'Finish the <strong>New Hire Questionnaire</strong>.',
    'Watch the <strong>New Hire Tutorials</strong> and upload the documents we ask for.',
  ]));

  var text = (bodyText ||
    (first ? 'Congratulations, ' + first + '.' : 'Congratulations.') + '\n\nYou are ' +
    'through the interview and starting your onboarding with ASA LifeCare — and you now have ' +
    'your own account on our platform.') + '\n\nSign in with: ' + email + '\n' +
    (password ? 'First-time password: ' + password + '\n\nThis password is not yours and is not ' +
      'private: it is the one every new account starts on, so the platform will ask you to choose ' +
      'your own the moment you sign in.\n' : '') +
    (bodyText ? '\n' :
    '\nYour account opens your onboarding — the New Hire Questionnaire, your tutorials and your ' +
    'documents. The rest of the platform opens by itself the day your onboarding is complete.\n\n') +
    link + '\n';

  return {
    subject: String(opts.subject || '') || 'Welcome to ASA LifeCare — your onboarding starts here',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare · Onboarding',
      title: 'Welcome — your onboarding starts here',
      preheader: 'Your account is ready. It opens your onboarding.',
      blocks: blocks,
      cta: { label: 'Sign in and begin', href: link },
      footnote: 'Change the temporary password the first time you sign in. If anything does not ' +
        'open yet, it is not broken — the rest of the platform unlocks when your onboarding is done.'
    })
  };
}

function hiringOutreachEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var first = name.split(/\s+/)[0] || name;
  var recruiter = String(opts.recruiter || 'our recruiter').trim();
  var bodyText = String(opts.bodyText || '').trim();

  var blocks = [];
  if (bodyText) {
    bodyText.split(/\n{2,}/).forEach(function (p) {
      blocks.push(mailPara_(mailEsc_(p).replace(/\n/g, '<br>')));
    });
  } else {
    blocks.push(mailPara_((first ? 'Hi ' + mailEsc_(first) + ',' : 'Hello,') + ' this is ' +
      '<strong>ASA LifeCare</strong> — we support people with developmental disabilities ' +
      'across Ohio, and we are hiring Direct Support Professionals.'));
    // The only person named is the candidate; the company speaks as the company.
    blocks.push(mailPara_('We would like to talk with you about the role. ' +
      '<strong>Are you interested? Reply YES</strong> — or answer the text we sent to your ' +
      'phone — and we will call you.'));
  }

  var text = bodyText ||
    ((first ? 'Hi ' + first + ',' : 'Hello,') + '\n\nThis is ASA LifeCare — we support people ' +
     'with developmental disabilities across Ohio, and we are hiring Direct Support ' +
     'Professionals.\n\nWe would like to talk with you about the role. Are you ' +
     'interested? Reply YES and we will call you.\n');

  return {
    subject: String(opts.subject || '') || 'A Direct Support Professional opportunity — ASA LifeCare',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare',
      title: 'We would like to talk with you',
      preheader: 'We would like to talk with you about a DSP opportunity.',
      blocks: blocks,
      footnote: 'Reply YES to this message, or to the text on your phone — either answer ' +
        'reaches the same team.'
    })
  };
}

function hiringScreenCallEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var first = name.split(/\s+/)[0] || name;
  var line = String(opts.line || '').trim();
  var lineLabel = line.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') || line;
  var bodyText = String(opts.bodyText || '').trim();

  var blocks = [];
  if (bodyText) {
    bodyText.split(/\n{2,}/).forEach(function (p2) {
      blocks.push(mailPara_(mailEsc_(p2).replace(/\n/g, '<br>')));
    });
  } else {
    blocks.push(mailPara_((first ? 'Hi ' + mailEsc_(first) + ',' : 'Hello,') + ' great — we ' +
      'are glad you want to move forward.'));
    blocks.push(mailPara_('The next step is a short <strong>phone evaluation</strong>. ' +
      'Call our interview line whenever you are ready:'));
    blocks.push(mailFact_('Interview line', lineLabel, true));
    blocks.push(mailPara_('The call takes a few minutes and is answered by our screening ' +
      'line. <strong>As soon as you finish, one of our employees will contact you</strong> ' +
      'with the next step.'));
  }

  var text = bodyText ||
    ((first ? 'Hi ' + first + ',' : 'Hello,') + '\n\nGreat — we are glad you want to move ' +
     'forward.\n\nThe next step is a short phone evaluation. Call our interview line ' +
     'whenever you are ready: ' + lineLabel + '\n\nAs soon as you finish, one of our ' +
     'employees will contact you with the next step.\n');

  return {
    subject: String(opts.subject || '') || 'Your phone evaluation — call us when you are ready',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare',
      title: 'Call us for your phone evaluation',
      preheader: 'Call ' + lineLabel + ' — a few minutes, then we contact you.',
      blocks: blocks,
      footnote: 'The call is the evaluation itself. Nothing else is needed from you until we ' +
        'reach out.'
    })
  };
}

function hiringAcceptedEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var reply = String(opts.reply || '').trim();
  var phone = String(opts.phone || '').trim();
  var email = String(opts.email || '').trim();
  var bodyText = String(opts.bodyText || '').trim();

  var blocks = [];
  if (bodyText) {
    bodyText.split(/\n{2,}/).forEach(function (p) {
      blocks.push(mailPara_(mailEsc_(p).replace(/\n/g, '<br>')));
    });
  } else {
    blocks.push(mailPara_('<strong>' + mailEsc_(name) + '</strong> answered our outreach and ' +
      'agreed to talk about the Direct Support Professional role.'));
    if (reply) blocks.push(mailFact_('Their words', reply.slice(0, 300)));
    if (phone) blocks.push(mailFact_('Their number', phone));
    if (email) blocks.push(mailFact_('Their e-mail', email));
    blocks.push(mailPara_('<strong>Arthur — the next two things are yours:</strong> talk with ' +
      'them, and ask for the CJIS background check and the document signatures. The card holds ' +
      'everything as it arrives.'));
  }

  var text = bodyText ||
    (name + ' answered our outreach and agreed to talk about the DSP role.\n\n' +
     (reply ? 'Their words: "' + reply.slice(0, 300) + '"\n' : '') +
     (phone ? 'Their number: ' + phone + '\n' : '') +
     (email ? 'Their e-mail: ' + email + '\n' : '') +
     '\nArthur — the next two things are yours: talk with them, and ask for the CJIS ' +
     'background check and the document signatures.\n');

  return {
    subject: String(opts.subject || '') || (name + ' said yes — CJIS and signatures are next'),
    text: text,
    html: mailShell_({
      eyebrow: HIRING_MAIL_EYEBROW,
      title: name + ' wants to talk',
      preheader: name + ' accepted — the CJIS and the signatures are the next two asks.',
      blocks: blocks,
      footnote: 'Recorded on their card. The folder sweep files the CJIS the moment it lands ' +
        'in Original Documents.'
    })
  };
}
