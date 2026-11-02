// For mail clients: tables and inline styles only, no <style>, fonts or images; text says all the html says.

// Literals: a mail client cannot read a CSS variable.
var MAIL_INK = '#1c2024';
var MAIL_INK_SOFT = '#5b6470';
var MAIL_LINE = '#e3e6ea';
var MAIL_PAPER = '#f5f6f8';
var MAIL_ACCENT = '#2f6f5f';
var MAIL_ACCENT_SOFT = '#eaf3f0';
var MAIL_DANGER = '#b3261e';
var MAIL_DANGER_SOFT = '#fdecea';

function mailEsc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Without a preheader, inboxes preview the body's first words: the greeting.
function mailShell_(opts) {
  var o = opts || {};
  var blocks = o.blocks || [];
  var bar = o.barColor || MAIL_ACCENT;
  var html = '' +
'<!DOCTYPE html><html><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>' + mailEsc_(o.title || '') + '</title></head>' +
'<body style="margin:0;padding:0;background:' + MAIL_PAPER + ';">' +
'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + mailEsc_(o.preheader || '') + '</div>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MAIL_PAPER + ';padding:32px 12px;">' +
'<tr><td align="center">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ' + MAIL_LINE + ';border-radius:14px;">' +
'<tr><td style="height:4px;background:' + bar + ';border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>' +
'<tr><td style="padding:28px 32px 8px 32px;">' +
'<p style="margin:0 0 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">' +
mailEsc_(o.eyebrow || 'ASA LifeCare') + '</p>' +
'<h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;font-weight:bold;letter-spacing:-0.2px;color:' + MAIL_INK + ';">' +
mailEsc_(o.title || '') + '</h1>' +
'</td></tr>';

  if (o.intro) {
    html += '<tr><td style="padding:12px 32px 0 32px;">' +
      '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:' + MAIL_INK + ';">' +
      o.intro + '</p></td></tr>';
  }
  for (var i = 0; i < blocks.length; i++) {
    html += '<tr><td style="padding:16px 32px 0 32px;">' + blocks[i] + '</td></tr>';
  }
  if (o.cta && o.cta.href) {
    html += '<tr><td style="padding:24px 32px 4px 32px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td style="background:' + bar + ';border-radius:8px;">' +
      '<a href="' + mailEsc_(o.cta.href) + '" style="display:inline-block;padding:12px 22px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">' +
      mailEsc_(o.cta.label || 'Open') + '</a></td></tr></table>' +
      // The bare address: a button is not clickable in every client.
      '<p style="margin:10px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:' + MAIL_INK_SOFT + ';">' +
      'Or paste this into your browser:<br><span style="color:' + MAIL_INK + ';">' + mailEsc_(o.cta.href) + '</span></p>' +
      '</td></tr>';
  }
  if (o.footnote) {
    html += '<tr><td style="padding:22px 32px 0 32px;">' +
      '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:20px;color:' + MAIL_INK_SOFT + ';">' +
      o.footnote + '</p></td></tr>';
  }
  html += '<tr><td style="padding:24px 32px 28px 32px;">' +
    '<div style="border-top:1px solid ' + MAIL_LINE + ';padding-top:14px;">' +
    '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;line-height:18px;color:' + MAIL_INK_SOFT + ';">' +
    'This message was sent by the ASA LifeCare platform. If it reached you by mistake, please ignore it — nothing was created for you.' +
    '</p></div></td></tr>' +
    '</table></td></tr></table></body></html>';
  return html;
}

// mono only where the glyphs are the content (a password or login: O vs 0).
function mailFact_(label, value, mono) {
  var face = mono ? "'Courier New',Courier,monospace"
                  : 'Helvetica,Arial,sans-serif';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MAIL_ACCENT_SOFT + ';border-radius:10px;">' +
    '<tr><td style="padding:12px 16px;">' +
    '<p style="margin:0 0 2px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">' + mailEsc_(label) + '</p>' +
    '<p style="margin:0;font-family:' + face + ';font-size:16px;line-height:22px;font-weight:' + (mono ? 'normal' : 'bold') + ';color:' + MAIL_INK + ';">' + mailEsc_(value) + '</p>' +
    '</td></tr></table>';
}

function mailPara_(html) {
  return '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:' + MAIL_INK + ';">' + html + '</p>';
}

function mailSteps_(steps) {
  var out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">';
  for (var i = 0; i < steps.length; i++) {
    out += '<tr>' +
      '<td valign="top" width="26" style="padding:0 0 10px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;color:' + MAIL_ACCENT + ';">' + (i + 1) + '.</td>' +
      '<td style="padding:0 0 10px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:' + MAIL_INK + ';">' + steps[i] + '</td>' +
      '</tr>';
  }
  return out + '</table>';
}

function mailPlatformUrl_() {
  return 'https://asamylife.asalifecare.com';
}

// No link and no credential: the reply is the whole mechanism.
function memberAuthEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var owner = String(opts.ownerName || '').trim() || 'The platform owner';
  var greeting = name ? 'Hi ' + name + ',' : 'Hello,';
  var blocks = [
    mailPara_(mailEsc_(greeting) + ' ' + mailEsc_(owner) + ' is asking to bring your account into their ' +
      'workspace on the ASA platform, temporarily.'),
    mailPara_('Nothing happens until you answer. <strong>Reply to this e-mail with one word:</strong>'),
    mailFact_('WORK', 'they see the work registered under your name — your cards, notes and activity', false),
    mailFact_('BOTH', 'your work AND your My world workbook', false),
    mailFact_('NO', 'nothing is shared, and the request is closed', false),
    mailPara_('Whatever you choose, it is <strong>read-only</strong>: nobody writes anything in your name, ' +
      'your password is never shared, and you can end it at any time by replying STOP.'),
    mailPara_('If you do not answer, nothing is shared.')
  ];
  return {
    subject: owner + ' is asking to bring your account into their workspace',
    html: mailShell_({
      title: 'A request to join your account',
      preheader: 'Reply WORK, BOTH or NO — nothing happens until you answer.',
      blocks: blocks
    }),
    text: greeting + ' ' + owner + ' is asking to bring your account into their workspace on the ASA ' +
      'platform, temporarily.\n\nReply to this e-mail with one word:\n' +
      '  WORK — they see the work registered under your name (cards, notes, activity)\n' +
      '  BOTH — your work AND your My world workbook\n' +
      '  NO   — nothing is shared\n\n' +
      'Whatever you choose it is READ-ONLY: nobody writes in your name, your password is never shared, ' +
      'and you can end it any time by replying STOP.\n\nIf you do not answer, nothing is shared.'
  };
}

function inviteRegisterEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var link = String(opts.link || '');
  var days = Number(opts.days) || 14;
  var inviter = String(opts.inviterName || '').trim();
  var greeting = name ? 'Hi ' + name + ',' : 'Hello,';
  var blocks = [
    mailPara_(mailEsc_(greeting) + ' you have been invited to the ASA LifeCare platform' +
      (inviter ? ' by ' + mailEsc_(inviter) : '') + '.'),
    mailPara_('Open the link below to create your account. You choose your own password — ' +
      'nobody here sets one for you, and there is nothing to change afterwards.'),
    mailFact_('Your invitation link', link, true),
    mailSteps_([
      'Open the link (it is personal to you).',
      'Pick a password of at least 8 characters.',
      'You are in — the platform opens on your own workspace.'
    ]),
    mailPara_('The link stands for ' + days + ' days. If it expires, ask for a new one.')
  ];
  var html = mailShell_({
    title: 'Your invitation to ASA LifeCare',
    preheader: 'Create your account — you choose the password.',
    blocks: blocks
  });
  var text = greeting + ' you have been invited to the ASA LifeCare platform' +
    (inviter ? ' by ' + inviter : '') + '.\n\n' +
    'Create your account here (you choose your own password):\n' + link + '\n\n' +
    'The link is personal to you and stands for ' + days + ' days.';
  return { subject: 'Your invitation to ASA LifeCare', html: html, text: text };
}

// Must say the password is shared by every new account and gets replaced at first sign-in.
function inviteEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var login = String(opts.login || '').trim();
  var password = String(opts.password || '').trim();
  var url = String(opts.url || mailPlatformUrl_());
  var greeting = name ? 'Hi ' + name + ',' : 'Hello,';
  var inviter = String(opts.inviterName || '').trim();

  var blocks = [
    mailPara_(mailEsc_(greeting) + ' you have an account on the ASA LifeCare platform' +
      (inviter ? ' — ' + mailEsc_(inviter) + ' set it up for you' : '') + '.'),
    mailFact_('Your sign-in', login, true),
  ];
  if (password) {
    blocks.push(mailFact_('First-time password', password, true));
    blocks.push(mailPara_('<strong>This password is not yours and is not private.</strong> It is the one every new ' +
      'account starts on, so the platform will ask you to choose your own the moment you sign in — you cannot reach ' +
      'any screen until you do.'));
    blocks.push(mailSteps_([
      'Open the platform and sign in with the two lines above.',
      'Choose a password of your own (at least 8 characters). This one takes its place immediately.',
      'You will land on your own workspace — only what your role opens, nothing else.',
    ]));
  } else {
    blocks.push(mailPara_('Sign in with the password you already chose. If you do not remember it, ask an ' +
      'administrator to reset it — nobody here can read it, so a new one is the only way back in.'));
  }

  var text = greeting + '\n\n' +
    'You have an account on the ASA LifeCare platform' + (inviter ? ' — ' + inviter + ' set it up for you' : '') + '.\n\n' +
    'Sign-in: ' + login + '\n' +
    (password
      ? 'First-time password: ' + password + '\n\n' +
        'This password is not yours and is not private: it is the one every new account starts on, so the platform ' +
        'will ask you to choose your own the moment you sign in. You cannot reach any screen until you do.\n\n' +
        '1. Open ' + url + ' and sign in with the two lines above.\n' +
        '2. Choose a password of your own (at least 8 characters).\n' +
        '3. You will land on your own workspace.\n\n'
      : '\nSign in with the password you already chose. If you do not remember it, ask an administrator to reset ' +
        'it — nobody here can read it, so a new one is the only way back in.\n\n' +
        'Open ' + url + ' to sign in.\n\n') +
    'If you did not expect this message, please ignore it — nothing was created for you.\n';

  return {
    subject: 'Your access to the ASA LifeCare platform',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare',
      title: 'Your access is ready',
      preheader: password ? 'Sign in with the first-time password and choose your own.'
                          : 'Your account is ready — sign in with your own password.',
      blocks: blocks,
      cta: { label: 'Sign in', href: url },
      footnote: password
        ? 'Keep this message until you have set your own password. After that it is of no use to anybody, including you.'
        : 'Nothing in this message is a secret — it names no password.',
    }),
  };
}

function chatUnreadEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var from = String(opts.fromName || 'A colleague').trim();
  var messages = opts.messages || [];
  var url = String(opts.url || mailPlatformUrl_()) ;
  var shown = messages.slice(0, 5);
  var rest = messages.length - shown.length;

  var quoted = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">';
  for (var i = 0; i < shown.length; i++) {
    quoted += '<tr><td style="padding:0 0 8px 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MAIL_PAPER + ';border-left:3px solid ' + MAIL_ACCENT + ';border-radius:0 8px 8px 0;">' +
      '<tr><td style="padding:10px 14px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:' + MAIL_INK + ';">' +
      mailEsc_(shown[i]) + '</td></tr></table></td></tr>';
  }
  quoted += '</table>';

  var blocks = [
    mailPara_((name ? 'Hi ' + mailEsc_(name) + ',' : 'Hello,') + ' <strong>' + mailEsc_(from) +
      '</strong> wrote to you on the platform while you were away.'),
    quoted,
  ];
  if (rest > 0) {
    blocks.push(mailPara_('…and ' + rest + ' more message' + (rest === 1 ? '' : 's') + ' waiting inside.'));
  }

  var text = (name ? 'Hi ' + name + ',' : 'Hello,') + '\n\n' +
    from + ' wrote to you on the platform while you were away.\n\n' +
    shown.map(function (m) { return '  "' + m + '"'; }).join('\n') + '\n' +
    (rest > 0 ? '\n…and ' + rest + ' more message' + (rest === 1 ? '' : 's') + ' waiting inside.\n' : '') +
    '\nReply from the platform: ' + url + '\n';

  return {
    subject: from + ' sent you a message',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare',
      title: 'You have messages waiting',
      preheader: from + ' wrote to you on the platform.',
      blocks: blocks,
      cta: { label: 'Open the conversation', href: url },
      footnote: 'You are getting this because you were signed out when the message arrived. ' +
        'While you are on the platform, messages reach you there instead.',
    }),
  };
}

// The subject's instant is UTC; the letter prints the company's clock (midnight Ohio = a bare date).
function staffAlertEmail_(o) {
  var opts = o || {};
  var kind = String(opts.kind || '');
  var person = String(opts.person || '').trim() || 'A staff member';
  var whenText = String(opts.whenText || '').trim();
  // Shift and arrival print only when actually found, never guessed.
  var shiftText = String(opts.shiftText || '').trim();
  var arrivedText = String(opts.arrivedText || '').trim();
  var reportWords = String(opts.reportWords || '').trim();
  var noCall = kind === 'no_call';
  var lateShow = kind === 'late_show';
  var callOff = kind === 'call_off';
  var earlyOut = kind === 'early_out';
  var kindLabel = String(opts.kindLabel || '').trim() ||
    (noCall ? 'No Show, No Call' : lateShow ? 'Late Show'
      : callOff ? 'Call Off' : earlyOut ? 'Early Out' : 'Staff report');
  var folderName = String(opts.folderName || '').trim() ||
    (noCall ? 'Staff No Call' : lateShow ? 'Staff Late Show'
      : callOff ? 'Staff Call Off' : earlyOut ? 'Staff Early Out' : 'Staff Reports');
  var source = String(opts.source || 'mailbox');
  var clock = source === 'time_clock';
  var form = source === 'form';
  // The situation row's words, when it has them: they replace the sentence about the kind.
  var leadText = String(opts.leadText || '').trim();

  var blocks = [
    mailFact_('Staff member', person),
    mailFact_(clock ? 'Seen' : 'Shift date', whenText || 'not stated'),
  ];
  blocks.push(mailFact_('Scheduled shift',
    shiftText || 'Not found on the roster for this date'));
  if (lateShow) {
    blocks.push(mailFact_('Arrived',
      arrivedText || 'The time clock has no punch for this day yet'));
  }
  blocks.push(leadText ? mailPara_(mailEsc_(leadText).replace(/\n/g, '<br>')) : mailPara_(noCall
    ? (clock
        ? 'The time clock has no punch for this shift and no call-off is on record. ' +
          'The house may be short right now — coverage comes first, the conversation second.'
        : 'Nobody heard from them before the shift. The house may be short right now — ' +
          'coverage comes first, the conversation second.')
    : lateShow
      ? (clock
          ? 'They clocked in late for this shift. One late show is a conversation; a pattern ' +
            'belongs in their record.'
          : 'They arrived late for this shift. One late show is a conversation; a pattern ' +
            'belongs in their record.')
      : callOff
        ? 'They called off this shift. The house needs the gap covered — the Call Offs ' +
          'app carries the running history.'
        : earlyOut
          ? 'They left before the end of this shift. The remaining hours may need covering.'
          : 'A ' + mailEsc_(kindLabel) + ' report just arrived for this person. The message ' +
            'itself is filed in the mailbox for the record.'));
  if (reportWords) {
    blocks.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MAIL_PAPER + ';border-left:3px solid ' + MAIL_ACCENT + ';border-radius:0 8px 8px 0;">' +
      '<tr><td style="padding:10px 14px;">' +
      '<p style="margin:0 0 2px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">' +
        (clock ? 'What the time clock shows' : form ? 'What the office typed' : 'The report\'s own words') + '</p>' +
      '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:' + MAIL_INK + ';">' + mailEsc_(reportWords) + '</p>' +
      '</td></tr></table>');
  }

  var html = mailShell_({
    eyebrow: 'Staff attendance',
    title: kindLabel + ' — ' + person,
    preheader: kindLabel + ': ' + person + (whenText ? ' · ' + whenText : ''),
    intro: clock
      ? 'The time clock was read and this shift is a <strong>' + mailEsc_(kindLabel) +
        '</strong>. Nobody typed this report — the platform noticed it.'
      : form
        ? 'A <strong>' + mailEsc_(kindLabel) + '</strong> was typed on the Call Off form. ' +
          'The row is in the Call Off Tracker.'
        : 'The platform mailbox just received a <strong>' + mailEsc_(kindLabel) +
          '</strong> report. The message itself is filed under ' +
          '<strong>' + mailEsc_(folderName) + '</strong> in the mailbox.',
    blocks: blocks,
    cta: { href: mailPlatformUrl_(), label: 'Open the platform' },
    footnote: 'Sent automatically by asa-hub@asaop.org ' +
              (clock ? 'when the time clock was read. '
                : form ? 'when the form row was read. '
                  : 'the moment the report arrived. ') +
              'The Call Offs and Time Reconciliation apps carry the running history.'
  });

  var text = kindLabel + ' — ' + person + '\n' +
    (whenText ? (clock ? 'Seen: ' : 'Shift date: ') + whenText + '\n' : '') +
    'Scheduled shift: ' + (shiftText || 'not found on the roster for this date') + '\n' +
    (!noCall ? 'Arrived: ' + (arrivedText || 'no punch on the time clock yet') + '\n' : '') + '\n' +
    (leadText ? leadText + '\n' : (noCall
      ? (clock ? 'The time clock has no punch for this shift and no call-off is on record. Coverage first.\n'
               : 'Nobody heard from them before the shift. Coverage first.\n')
      : (clock ? 'They clocked in late for this shift.\n' : 'They arrived late for this shift.\n'))) +
    (reportWords ? '\n' + (clock ? 'What the time clock shows: ' : form ? 'What the office typed: '
                                 : 'The report\'s own words: ') + reportWords + '\n' : '') +
    (clock ? '\nNobody typed this report — the platform read the time clock.\n'
      : form ? '\nThe row is in the Call Off Tracker.\n'
        : '\nThe original message is filed under "' + folderName + '" in the platform mailbox.\n') +
    mailPlatformUrl_();

  return { subject: String(opts.subject || '').trim() ||
                    ('[' + kindLabel + '] ' + person + (whenText ? ' — ' + whenText : '')),
           html: html, text: text };
}

function mailFactRed_(label, value) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MAIL_DANGER_SOFT + ';border-left:3px solid ' + MAIL_DANGER + ';border-radius:0 10px 10px 0;">' +
    '<tr><td style="padding:12px 16px;">' +
    '<p style="margin:0 0 2px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + MAIL_DANGER + ';">' + mailEsc_(label) + '</p>' +
    '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:22px;font-weight:bold;color:' + MAIL_INK + ';">' + mailEsc_(value) + '</p>' +
    '</td></tr></table>';
}

function referralPhoneEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var greeting = name ? 'Hi ' + name + ',' : 'Hello,';

  var blocks = [
    mailPara_(mailEsc_(greeting) + ' thank you for your interest in working with ASA LifeCare — ' +
      'your information reached our hiring team and we would love to talk.'),
    mailPara_('One thing is missing before we can move forward: <strong>a phone number</strong>. ' +
      'Interviews and scheduling happen over the phone, and the message we received only carried your name and e-mail.'),
    mailFact_('What we need', 'The best phone number to reach you'),
    mailPara_('Just <strong>reply to this e-mail</strong> with your number and the best time to call. ' +
      'That is all — we will take it from there.'),
  ];

  var text = greeting + '\n\n' +
    'Thank you for your interest in working with ASA LifeCare — your information reached our hiring team ' +
    'and we would love to talk.\n\n' +
    'One thing is missing before we can move forward: a phone number. Interviews and scheduling happen ' +
    'over the phone, and the message we received only carried your name and e-mail.\n\n' +
    'Just reply to this e-mail with the best number to reach you, and the best time to call. ' +
    'That is all — we will take it from there.\n\n' +
    'If you did not apply or were not referred to us, please ignore this message.\n';

  return {
    subject: 'One more thing for your application — a phone number',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare · Hiring',
      title: 'We would love to call you',
      preheader: 'Your application arrived without a phone number — reply with yours.',
      blocks: blocks,
      footnote: 'You are receiving this because your name and e-mail reached the ASA LifeCare hiring team. ' +
        'If you did not apply or were not referred to us, please ignore this message.',
    }),
  };
}

function birthdayEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim() || 'friend';
  var audience = String(opts.audience || 'staff');
  var isClient = audience === 'client';

  var celebration =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MAIL_ACCENT_SOFT + ';border-radius:12px;">' +
    '<tr><td align="center" style="padding:22px 16px;">' +
    '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:34px;line-height:38px;">&#127874;</p>' +
    '<p style="margin:8px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:20px;line-height:26px;font-weight:bold;color:' + MAIL_ACCENT + ';">Happy birthday, ' + mailEsc_(name) + '!</p>' +
    '</td></tr></table>';

  var blocks = [
    celebration,
    isClient
      ? mailPara_('Today is all about you, and everyone at ASA LifeCare is glad to be part of your story. ' +
          'We hope your day is full of the people and the things you love most.')
      : mailPara_('Everyone at ASA LifeCare wishes you a wonderful day. The care you give the people we ' +
          'serve is what this company is made of — today the appreciation points at you.'),
    isClient
      ? mailPara_('From all of us — the caregivers, the office, the whole ASA family: ' +
          '<strong>may this new year of yours be the best one yet.</strong>')
      : mailPara_('<strong>Enjoy your day.</strong> The schedule can wait a moment for the cake.'),
  ];

  var text = 'Happy birthday, ' + name + '!\n\n' +
    (isClient
      ? 'Today is all about you, and everyone at ASA LifeCare is glad to be part of your story. ' +
        'We hope your day is full of the people and the things you love most.\n\n' +
        'From all of us - the caregivers, the office, the whole ASA family: may this new year of yours be the best one yet.\n'
      : 'Everyone at ASA LifeCare wishes you a wonderful day. The care you give the people we serve is what ' +
        'this company is made of - today the appreciation points at you.\n\n' +
        'Enjoy your day. The schedule can wait a moment for the cake.\n');

  return {
    subject: 'Happy birthday, ' + name + '! From all of us at ASA LifeCare',
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare',
      title: 'It’s your day',
      preheader: 'Happy birthday from the whole ASA family.',
      blocks: blocks,
      footnote: 'Sent with love by the ASA LifeCare platform on your birthday.',
    }),
  };
}

function certsExpiredEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var items = opts.items || [];
  var greeting = name ? 'Hi ' + name + ',' : 'Hello,';

  var blocks = [
    mailPara_(mailEsc_(greeting) + ' the platform checked your certifications today and ' +
      '<strong style="color:' + MAIL_DANGER + ';">' + (items.length === 1 ? 'one of them has expired' : items.length + ' of them have expired') + '</strong>. ' +
      'An expired certification means you cannot be scheduled until it is renewed.'),
  ];
  for (var i = 0; i < items.length; i++) {
    blocks.push(mailFactRed_(String(items[i].cert || 'Certification') + ' — EXPIRED',
      'Expired on ' + String(items[i].expiredOn || 'an earlier date')));
  }
  blocks.push(mailSteps_([
    'Book the renewal class or exam for each certification above as soon as you can.',
    'Send the new certificate (a photo or PDF is fine) to <strong>onboarding@asalifecare.com</strong>.',
    'The platform updates your record the moment the new document is verified.',
  ]));
  blocks.push(mailPara_('If any of these is already renewed and this letter is out of date, reply with the new ' +
    'certificate attached and we will fix your record — the reminder stops the moment the record is right.'));

  var text = greeting + '\n\n' +
    'The platform checked your certifications today and ' +
    (items.length === 1 ? 'one of them has EXPIRED' : items.length + ' of them have EXPIRED') + '. ' +
    'An expired certification means you cannot be scheduled until it is renewed.\n\n' +
    items.map(function (it) {
      return '  ' + String(it.cert || 'Certification') + ' - EXPIRED on ' + String(it.expiredOn || 'an earlier date');
    }).join('\n') + '\n\n' +
    '1. Book the renewal class or exam for each certification above.\n' +
    '2. Send the new certificate to onboarding@asalifecare.com.\n' +
    '3. The platform updates your record the moment the new document is verified.\n\n' +
    'If any of these is already renewed, reply with the new certificate attached and we will fix your record.\n';

  return {
    subject: '[Action required] Your certification' + (items.length === 1 ? ' has' : 's have') + ' expired',
    text: text,
    html: mailShell_({
      eyebrow: 'Certifications',
      title: 'Action required: renew your certifications',
      preheader: (items.length === 1 ? 'One certification has expired' : items.length + ' certifications have expired') + ' — you cannot be scheduled until renewed.',
      barColor: MAIL_DANGER,
      blocks: blocks,
      cta: { label: 'See my certifications', href: mailPlatformUrl_() },
      footnote: 'Raised automatically by the certification watcher. It checks every record daily and only writes ' +
        'when something needs a person.',
    }),
  };
}

function platformDigestEmail_(o) {
  var opts = o || {};
  var items = opts.items || [];

  var rows = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var isNew = String(it.status || '').toLowerCase() === 'new';
    rows += '<tr>' +
      '<td valign="top" style="padding:0 10px 10px 0;white-space:nowrap;">' +
      '<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:' + (isNew ? MAIL_ACCENT : MAIL_ACCENT_SOFT) + ';font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;color:' + (isNew ? '#ffffff' : MAIL_ACCENT) + ';">' +
      mailEsc_(it.status || 'live') + '</span></td>' +
      '<td style="padding:0 0 10px 0;">' +
      '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:' + MAIL_INK + ';"><strong>' + mailEsc_(it.app) + '</strong>' +
      (it.note ? ' — ' + mailEsc_(it.note) : '') + '</p></td></tr>';
  }
  rows += '</table>';

  var text = 'Platform status - what is live and what is new\n\n' +
    items.map(function (it) {
      return '  [' + String(it.status || 'live').toUpperCase() + '] ' + it.app + (it.note ? ' - ' + it.note : '');
    }).join('\n') + '\n\n' +
    'Everything above is on ' + mailPlatformUrl_() + ' - your badge decides which doors open.\n';

  return {
    subject: 'ASA platform — what is live and what is new',
    text: text,
    html: mailShell_({
      eyebrow: 'Platform news',
      title: 'What is live, what is new',
      preheader: items.length + ' apps on the board today.',
      intro: 'The state of every app on the platform, in one look. Your badge decides which doors open for you.',
      blocks: [rows],
      cta: { label: 'Open the platform', href: mailPlatformUrl_() },
      footnote: 'Sent by the platform when the board changes enough to be worth a letter — never on a timer.',
    }),
  };
}

function howItWorksEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var greeting = name ? 'Hi ' + name + ',' : 'Hello,';
  var url = mailPlatformUrl_();

  var section = function (title) {
    return '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;font-weight:bold;color:' + MAIL_ACCENT + ';">' + mailEsc_(title) + '</p>';
  };

  var blocks = [
    mailPara_(mailEsc_(greeting) + ' this letter explains how the ASA LifeCare platform works — ' +
      'what you will see, why you see it, and where everything lives. Keep it around for your first week.'),
    section('Signing in'),
    mailPara_('You sign in at <strong>' + mailEsc_(url) + '</strong> with your e-mail (or login) and your own password. ' +
      'The first time, the platform gives you a shared starter password and immediately demands you choose your own — ' +
      'you cannot reach any screen until you do. Nobody, including administrators, can read your password afterwards.'),
    section('Your workspace'),
    mailPara_('The home screen is <strong>My asa.</strong> — your week, your reminders, your indicators. ' +
      'The grid button opens every app your badge allows: what you see depends on your role (staff, manager, client, guardian), ' +
      'so two people’s platforms can look different and both are right.'),
    section('The apps, in one breath'),
    mailSteps_([
      '<strong>Chat</strong> — talk to anyone on the platform. If someone is away, the message waits; after a few minutes it also goes to their e-mail.',
      '<strong>Calendar</strong> — the whole company’s month: shifts, birthdays, trainings, appointments, the weather on every coming day.',
      '<strong>Kanban</strong> — the team’s work on one wall, and the company’s projects behind the Projects button.',
      '<strong>Users &amp; Clients</strong> — every person, one profile each: documents, certifications, activity, support requests.',
      '<strong>Suggestions</strong> — the box the leadership actually reads. Anything, anytime.',
    ]),
    section('How your data moves'),
    mailPara_('Everything you save lands in the company’s own records the moment you press the button — ' +
      'there is no "sync later". Reading is instant because every screen keeps its own fresh copy. ' +
      'If your internet drops mid-save, the platform says so plainly instead of pretending.'),
    section('When the platform writes to you'),
    mailPara_('E-mail from the platform always comes from <strong>asa-hub@asaop.org</strong> and always looks like this letter. ' +
      'It writes when something needs you — a message you missed, a certification about to expire — and never just to exist.'),
    section('If something looks wrong'),
    mailPara_('Say it in <strong>Suggestions</strong> or tell your manager. The platform is built by people who read those.'),
  ];

  var text = greeting + '\n\n' +
    'This letter explains how the ASA LifeCare platform works.\n\n' +
    'SIGNING IN\nYou sign in at ' + url + ' with your e-mail (or login) and your own password. The first time, ' +
    'the platform gives you a shared starter password and immediately demands you choose your own. Nobody can read your password afterwards.\n\n' +
    'YOUR WORKSPACE\nThe home screen is My asa. - your week, your reminders, your indicators. The grid button opens every app ' +
    'your badge allows: what you see depends on your role.\n\n' +
    'THE APPS\n' +
    '1. Chat - talk to anyone; missed messages follow you to e-mail.\n' +
    '2. Calendar - the company\'s month: shifts, birthdays, trainings, appointments, the weather.\n' +
    '3. Kanban - the team\'s work on one wall, projects behind the Projects button.\n' +
    '4. Users & Clients - every person, one profile each.\n' +
    '5. Suggestions - the box the leadership actually reads.\n\n' +
    'HOW YOUR DATA MOVES\nEverything you save lands in the company\'s records the moment you press the button. ' +
    'Reading is instant because every screen keeps its own fresh copy.\n\n' +
    'WHEN THE PLATFORM WRITES TO YOU\nAlways from asa-hub@asaop.org, always looking like this letter, only when something needs you.\n\n' +
    'IF SOMETHING LOOKS WRONG\nSay it in Suggestions or tell your manager.\n';

  return {
    subject: 'How the ASA LifeCare platform works',
    text: text,
    html: mailShell_({
      eyebrow: 'Welcome aboard',
      title: 'How the platform works',
      preheader: 'What you will see, why you see it, and where everything lives.',
      blocks: blocks,
      cta: { label: 'Open the platform', href: url },
      footnote: 'Keep this letter for your first week — after that you will not need it.',
    }),
  };
}

function talentAuthorizationEmail_(o) {
  var opts = o || {};
  var items = opts.items || [];

  var line = function (it) {
    var bits = [];
    if (it.nota !== null && it.nota !== undefined && it.nota !== '') bits.push('Nota ' + it.nota + '/10');
    if (it.decision) bits.push(it.decision);
    if (it.stage) bits.push('stage: ' + it.stage);
    if (it.screen) bits.push('screen: ' + it.screen);
    if (it.cjis) bits.push('CJIS ' + it.cjis);
    bits.push((it.flags && it.flags.length) ? 'red flags: ' + it.flags.join(', ') : 'no red flags');
    return bits.join(' · ');
  };

  var blocks = [
    mailPara_('The platform re-ranked every analyzed candidate in the Talent Pipeline and these ' +
      (items.length === 1 ? 'is the one standing' : items.length + ' stand') + ' at the top. ' +
      '<strong>It needs your authorization before anyone moves into the hiring process.</strong>'),
  ];
  for (var i = 0; i < items.length; i++) {
    blocks.push(mailFact_('#' + items[i].rank + ' — ' + String(items[i].name || ''), line(items[i])));
  }
  blocks.push(mailSteps_([
    '<strong>Reply to this e-mail</strong> naming who to proceed with — e.g. "Proceed with ' +
      mailEsc_(items.length ? String(items[0].name || 'the first candidate') : 'the first candidate') + '".',
    'To hold somebody back, say that the same way — "Do not proceed with …".',
    'The platform reads the reply and moves each approved candidate into the hiring process on its own.',
  ]));

  var text = 'Hiring authorization needed - the top ' + items.length + ' candidates\n\n' +
    'The platform re-ranked every analyzed candidate in the Talent Pipeline and these stand at ' +
    'the top. It needs your authorization before anyone moves into the hiring process.\n\n' +
    items.map(function (it) {
      return '  #' + it.rank + ' ' + String(it.name || '') + ' - ' +
             line(it).replace(/·/g, '-');
    }).join('\n') + '\n\n' +
    '1. Reply to this e-mail naming who to proceed with (e.g. "Proceed with ' +
    String(items.length ? items[0].name : 'the first candidate') + '").\n' +
    '2. To hold somebody back, say that the same way ("Do not proceed with ...").\n' +
    '3. The platform reads the reply and moves each approved candidate into the hiring ' +
    'process on its own.\n\n' +
    'The platform is now waiting on this thread and reads the replies automatically.\n';

  return {
    subject: '[Action required] Hiring authorization — the top ' + items.length +
             ' candidate' + (items.length === 1 ? '' : 's'),
    text: text,
    html: mailShell_({
      eyebrow: 'Talent Pipeline',
      title: 'Authorization to proceed with hiring',
      preheader: 'The top ' + items.length + ' ranked candidates await your word — reply to decide.',
      blocks: blocks,
      footnote: 'The platform is now waiting on this thread and reads the replies automatically. ' +
        'Nothing moves until one of you answers; every decision the reply names is recorded.',
    }),
  };
}

function hiringNoticeEmail_(o) {
  var opts = o || {};
  var title = String(opts.title || 'Hiring pipeline notice').trim();
  var bodyText = String(opts.bodyText || '');
  var facts = opts.facts || [];
  var steps = opts.steps || [];

  var blocks = [];
  for (var f = 0; f < facts.length; f++) {
    blocks.push(mailFact_(String(facts[f].label || ''), String(facts[f].value || '')));
  }
  if (bodyText) {
    bodyText.split(/\n{2,}/).forEach(function (p) {
      blocks.push(mailPara_(mailEsc_(p).replace(/\n/g, '<br>')));
    });
  }
  if (steps.length) blocks.push(mailSteps_(steps));

  var text = bodyText +
    (facts.length ? '\n\n' + facts.map(function (x) {
      return '  ' + String(x.label || '') + ': ' + String(x.value || '');
    }).join('\n') : '') + '\n';

  return {
    subject: title,
    text: text,
    html: mailShell_({
      eyebrow: 'Hiring pipeline',
      title: title,
      preheader: String(opts.preheader || title),
      blocks: blocks,
      cta: { label: 'Open the Hiring Pipeline', href: mailPlatformUrl_() },
      footnote: 'Raised automatically by the hiring pipeline. The card itself carries ' +
        'the whole record — this letter only points at it.'
    })
  };
}

function packetRequestEmail_(o) {
  var opts = o || {};
  var bodyText = String(opts.bodyText || '');

  var blocks = bodyText.split(/\n{2,}/).map(function (p) {
    return mailPara_(mailEsc_(p).replace(/\n/g, '<br>'));
  });
  blocks.push(mailFact_('What we are waiting on', 'Your signed New Hire packet'));

  return {
    subject: String(opts.subject || 'Your signed New Hire packet — ASA Lifecare'),
    text: bodyText + '\n',
    html: mailShell_({
      eyebrow: 'ASA LifeCare · New hire',
      title: 'One signature left',
      preheader: 'Your onboarding is waiting on the signed New Hire packet.',
      blocks: blocks,
      footnote: 'You are receiving this because your onboarding with ASA LifeCare is ' +
        'almost done. If the packet is already signed and sent, you can ignore this ' +
        'message — the record catches up on its own.'
    })
  };
}

function interviewInviteEmail_(o) {
  var opts = o || {};
  var name = String(opts.name || '').trim();
  var first = name.split(/\s+/)[0] || name;
  var link = String(opts.link || '');
  var slots = opts.slots || [];
  var bodyText = String(opts.bodyText || '');
  var greeting = first ? 'Hi ' + first + ',' : 'Hello,';

  var blocks, text;
  if (bodyText) {
    blocks = bodyText.split(/\n{2,}/).map(function (p) {
      return mailPara_(mailEsc_(p).replace(/\n/g, '<br>'));
    });
    text = bodyText + '\n';
  } else {
    blocks = [
      mailPara_(mailEsc_(greeting) + ' thank you for talking with ASA LifeCare — the next ' +
        'step in our conversation about the role is your in-person interview.'),
    ];
    if (slots.length) {
      blocks.push(mailPara_('Our supervisor offered these times. Open your calendar and ' +
        'choose the one that works for you:'));
      blocks.push(mailSteps_(slots.map(mailEsc_)));
    } else {
      blocks.push(mailPara_('Pick the day and the hour that suit you best — it takes under ' +
        'a minute, and our team confirms it right away.'));
    }
    text = greeting + '\n\n' +
      'Thank you for talking with ASA LifeCare — the next step in our conversation about ' +
      'the role is your in-person interview.\n\n' +
      (slots.length
        ? 'Our supervisor offered these times:\n' +
          slots.map(function (s, i) { return '  ' + (i + 1) + '. ' + s; }).join('\n') +
          '\n\nChoose yours here: ' + link + '\n\n'
        : 'Pick the day and the hour that suit you best here: ' + link + '\n\n') +
      'This link is personal to you — please do not forward it.\n';
  }

  return {
    subject: String(opts.subject || '') || (slots.length
      ? 'Three times for your interview — pick one'
      : 'Pick your interview time — ASA LifeCare'),
    text: text,
    html: mailShell_({
      eyebrow: 'ASA LifeCare',
      title: slots.length ? 'Choose your interview time' : 'Pick your interview time',
      preheader: 'Choose the day and hour of your in-person interview.',
      blocks: blocks,
      cta: { label: slots.length ? 'Choose a time' : 'Pick my time', href: link },
      footnote: 'This link is personal to you — it opens your own appointment and nobody ' +
        'else\'s. If you did not expect it, you can ignore it.',
    }),
  };
}

function guardianAlertEmail_(o) {
  var opts = o || {};
  var issues = opts.issues || [];
  var when = String(opts.when || new Date().toISOString().slice(0, 16).replace('T', ' ')) + ' UTC';

  var blocks = [
    mailPara_('The platform checked itself and found ' +
      '<strong style="color:' + MAIL_DANGER + ';">' +
      (issues.length === 1 ? 'one thing that needs a person' : issues.length + ' things that need a person') +
      '</strong>. Nothing is on fire — but none of these fix themselves.'),
  ];
  for (var i = 0; i < issues.length; i++) {
    blocks.push(mailFactRed_('Needs attention', mailEsc_(String(issues[i]))));
  }
  blocks.push(mailSteps_([
    'Open the Guardian app — the full picture is there, live.',
    'Fix what you can; the alert goes quiet the moment the platform is healthy again.',
    'If one of these keeps coming back, that is the conversation to have — the alert means it.',
  ]));
  blocks.push(mailPara_('This alert fires at most once a day while something is red — ' +
    'a red week is one letter a day, never one per sweep.'));

  var text = 'GUARDIAN ALERT — the environment needs a person\n\n' +
    'The platform checked itself (' + when + ') and found:\n\n' +
    issues.map(function (s) { return '  - ' + String(s); }).join('\n') + '\n\n' +
    'Open the Guardian app for the full picture: ' + mailPlatformUrl_() + '#/app/guardian/health\n';

  return {
    subject: '[Guardian] The environment needs a person — ' +
      (issues.length === 1 ? '1 issue' : issues.length + ' issues'),
    text: text,
    html: mailShell_({
      eyebrow: 'Guardian',
      title: 'The environment needs a person',
      preheader: issues.length + ' issue(s) found on the platform check — the full picture is in the Guardian app.',
      barColor: MAIL_DANGER,
      blocks: blocks,
      cta: { label: 'Open the Guardian app', href: mailPlatformUrl_() + '/#/app/guardian/health' },
      footnote: 'Raised automatically by the Guardian, the platform\'s own watcher. It only writes when ' +
        'something needs a person — red for a week is one letter a day, never one per sweep.',
    }),
  };
}
