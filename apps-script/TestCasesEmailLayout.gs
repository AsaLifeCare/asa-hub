var EMAIL_TEST_TO = 'asatech@asalifecare.com';

function emailLayoutSend_(label, letter) {
  var out = rpcCall_('emailSend', {
    to: EMAIL_TEST_TO,
    subject: '[EMAIL TEST ' + label + '] ' + letter.subject,
    body: letter.text,
    html: letter.html,
    reason: 'email layout test case: ' + label
  }, { quiet_exempt: 'asked_now' });   // run by hand from the editor
  var line = label + ' -> ' + EMAIL_TEST_TO +
    (out && out.sent ? (out.redirected ? ' (SENT, redirected by test mode)' : ' (SENT)')
                     : ' (NOT SENT: ' + String(out && (out.detail || out.error || out.reason)) + ')');
  Logger.log(line);
  return line;
}

function testInviteWithPassword() {
  return emailLayoutSend_('invite/password', inviteEmail_({
    name: 'Priya Raman', login: 'priya.raman@asalifecare.com',
    password: 'Welcome#2026', inviterName: 'Ty Bond'
  }));
}

function testInviteAlreadyArmed() {
  return emailLayoutSend_('invite/armed', inviteEmail_({
    name: 'Marcus Cole', login: 'marcus.cole@asalifecare.com',
    password: '', inviterName: 'Ty Bond'
  }));
}

function testInviteBareMinimum() {
  return emailLayoutSend_('invite/bare', inviteEmail_({
    name: '', login: 'front.desk@asalifecare.com', password: 'Welcome#2026'
  }));
}

function testChatUnreadShort() {
  return emailLayoutSend_('chat/short', chatUnreadEmail_({
    name: 'David', fromName: 'Emma Reyes',
    messages: ['Cover for the 7am at Maple? Tami called off.',
               'Never mind — Lucas took it. See you at the huddle.']
  }));
}

function testChatUnreadOverflow() {
  return emailLayoutSend_('chat/overflow', chatUnreadEmail_({
    name: 'David', fromName: 'Emma Reyes',
    messages: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
      .map(function (n) { return n + ' — a line of the conversation.'; })
  }));
}

function testLateShowAllFound() {
  var person = 'Jeremiah Inman', whenIso = '2026-08-15T04:00:00.000Z';
  var dayIso = staffAlertDay_(whenIso);
  return emailLayoutSend_('late-show/found', staffAlertEmail_({
    kind: 'late_show', person: person, whenText: staffAlertWhen_(whenIso),
    shiftText: staffShiftText_(person, dayIso),
    arrivedText: staffArrivalText_(person, dayIso),
    reportWords: 'Late Show — ' + person + ' (' + whenIso + ')'
  }));
}

function testLateShowNothingFound() {
  return emailLayoutSend_('late-show/missing', staffAlertEmail_({
    kind: 'late_show', person: 'A. Nonexistent Person',
    whenText: 'Sat, Aug 15, 2026', shiftText: '', arrivedText: '',
    reportWords: 'Late Show — A. Nonexistent Person (2026-08-15T04:00:00.000Z)'
  }));
}

function testNoCallWithShift() {
  var person = 'Nikyla Compton', whenIso = '2026-08-15T04:00:00.000Z';
  var dayIso = staffAlertDay_(whenIso);
  return emailLayoutSend_('no-call/found', staffAlertEmail_({
    kind: 'no_call', person: person, whenText: staffAlertWhen_(whenIso),
    shiftText: staffShiftText_(person, dayIso),
    reportWords: 'No Show No Call — ' + person + ' (' + whenIso + ')'
  }));
}

function testRedirectStripPreview() {
  var letter = inviteEmail_({
    name: 'Priya Raman', login: 'priya.raman@asalifecare.com',
    password: 'Welcome#2026', inviterName: 'Ty Bond'
  });
  return emailLayoutSend_('test-strip', {
    subject: letter.subject,
    text: '[strip preview] ' + letter.text,
    html: hubTestBannerHtml_('priya.raman@asalifecare.com') + letter.html
  });
}

function runAllEmailLayoutTests() {
  var lines = [
    testInviteWithPassword(),
    testInviteAlreadyArmed(),
    testInviteBareMinimum(),
    testChatUnreadShort(),
    testChatUnreadOverflow(),
    testLateShowAllFound(),
    testLateShowNothingFound(),
    testNoCallWithShift(),
    testRedirectStripPreview()
  ];
  Logger.log('---- ' + lines.length + ' layout test letters attempted -> ' + EMAIL_TEST_TO + ' ----');
  return lines;
}
