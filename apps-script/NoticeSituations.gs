// THE COMPANY NOTICES, AS SITUATIONS.
// The relay's notices (server/web_notices.py) reach people's bells and, through Web Push, their devices: a call-off…

/** The situation id for one notice kind. */
var HUB_NOTICE_PREFIX = 'web_notice_';

/** Every kind the relay's catalogue declares (web_notices.CATALOGUE), with who hears it. */
var HUB_NOTICE_KINDS = [
  ['call_off', 'a call-off opened a shift to applications', 'the deciders, the staff it is open to, and the rest of the staff as news'],
  ['open_shift', 'an OPEN row\'s window opened on a published day', 'the deciders and the staff it is open to'],
  ['application', 'somebody applied for a shift', 'the deciders'],
  ['training_needed', 'a first-shift training approval is waiting', 'the deciders and the person it is about'],
  ['window_closed', 'applications closed with people on the shift', 'the deciders'],
  ['decided', 'the house manager approved or assigned somebody', 'the deciders and the person given the shift'],
  ['not_chosen', 'the shift went to somebody else', 'the applicant who was not chosen'],
  ['withdrawn', 'an application was taken back', 'the deciders'],
  ['training_decided', 'the house manager took the training on, or did not', 'the deciders and the person it is about'],
  ['filled', 'a shift got its person', 'the deciders and the person who took it'],
  ['swap_offered', 'a shift was offered to somebody', 'the deciders and the people in the swap'],
  ['swap_answered', 'the receiver, the house manager or a director answered a swap', 'the deciders and the people in the swap'],
  ['swap_done', 'a swap was approved by all three and the shift moved', 'the deciders and the people in the swap'],
  ['swap_ended', 'a swap ended for a reason that was not a no', 'the deciders and the people in the swap'],
  ['no_call_no_show', 'the punch board found no punch and no call', 'the deciders'],
  ['late_call', 'somebody called to say they would be late', 'the deciders'],
  ['time_off_asked', 'a time off request waits for its approvers', 'the approvers'],
  ['time_off_decided', 'one half of a time off request was answered', 'the person and the approvers'],
  ['time_off_scheduled', 'both halves approved: the person is off', 'the person, the approvers and the deciders'],
  ['time_off_ended', 'a time off request was denied, withdrawn, cancelled or expired', 'the person and the approvers']
];

/** The seed rows: one per notice kind, every one OFF, wordless because the relay words each reader's notice. */
function hubNoticeSeeds_() {
  return HUB_NOTICE_KINDS.map(function (k) {
    return {
      id: HUB_NOTICE_PREFIX + k[0], enabled: 'no', kind: HUB_LETTER_KIND, direction: 'out',
      channels: 'web', label: 'company notice — ' + k[1], to: '',
      sms_text: '', email_subject: '', email_text: '',
      note: 'OFF until switched on here — a new message arrives disabled, and while it is off this notice ' +
            'reaches no bell and no device. Goes to ' + k[2] + ', on the platform\'s bell and through Web ' +
            'Push. The relay words it for each reader from the event\'s facts, so the word cells stay blank. ' +
            'Switched on, the test switch still holds it and the quiet window still holds its push.'
    };
  });
}

/** The switch map for this execution: { map: {situation id: bool}, unreadable: '' }, or null. */
var HUB_NOTICE_MEMO = null;

// { map, unreadable } — every notice situation's switch, read once per execution.
function hubNoticeSituationsRead_() {
  if (HUB_NOTICE_MEMO) return HUB_NOTICE_MEMO;
  var got = { map: {}, unreadable: '' };
  try {
    if (typeof smartSituations_ !== 'function') throw new Error('the situations reader is not in this build');
    var rows = {};
    smartSituations_().forEach(function (s) { rows[String((s && s.id) || '')] = s; });
    HUB_NOTICE_KINDS.forEach(function (k) {
      var id = HUB_NOTICE_PREFIX + k[0];
      got.map[id] = !!(rows[id] && typeof smartOn_ === 'function' && smartOn_(rows[id].enabled));
    });
  } catch (e) {
    got = { map: {}, unreadable: 'the situations tab could not be read (' +
                                 String((e && e.message) || e).slice(0, 160) + ')' };
  }
  HUB_NOTICE_MEMO = got;
  return got;
}
