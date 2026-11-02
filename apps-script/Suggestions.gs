var SUGGESTIONS_TAB = 'entity_suggestions';
var SUGGESTIONS_HEADER = ['suggestion_id', 'created_at', 'by_email', 'by_name', 'role', 'text'];

function suggestionsSheet_() {
  return hubTabEnsure_(SUGGESTIONS_TAB, SUGGESTIONS_HEADER);
}

// The mail copy is a Smart Comms letter (SmartGate.gs `suggestion_mailbox_note`) through the one door.
HUB_POLICY.suggestionCreate = {
  file: 'Suggestions.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  params: { text: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend']
};
HUB_ACTIONS.suggestionCreate = function (payload, user) {
  var text = str_(payload.text).slice(0, 4000);
  if (text.length < 3) return { status: 400, message: 'Write the suggestion first.' };
  var id = 'SUG_' + randomHex_(10).toUpperCase();
  var sheet = suggestionsSheet_();
  sheet.appendRow([
    id, new Date().toISOString(),
    str_(user && user.email), str_(user && user.display_name),
    str_(user && user.role), text
  ]);
  // THE BOOK THE ROW LANDED IN.
  var book = '';
  try { book = str_(sheet.getParent().getId()); } catch (eB) { book = ''; }
  // Mail only after the row is saved: a dead mailserver must never lose a suggestion.
  try {
    var letter = suggestionNoteLetter_(id, str_(user && user.display_name), str_(user && user.email),
                                       str_(user && user.role), text, book);
    if (letter && typeof hubLetterSend_ === 'function') {
      var said = hubLetterSend_(letter);
      if (said && !/^(told|deduplicated)$/.test(said.state)) {
        hubSysLog_(str_(user && user.email), 'suggestion_note_not_sent',
                   id + ' — ' + said.state + ': ' + String(said.why || '').slice(0, 160), { status: 200 });
      }
    }
  } catch (eM) { /* the suggestion is saved either way */ }
  return { status: 200, data: { sent: true } };
};

/** The suggestion's copy for the platform's own mailbox, or null when no mailbox is configured. */
function suggestionNoteLetter_(id, name, email, role, text, book) {
  var self = '';
  try { self = str_((platformMailCreds_() || {}).user); } catch (e) { self = ''; }
  if (!self) return null;
  var facts = { suggestion_id: str_(id) };
  if (str_(book)) facts.book = str_(book);
  return {
    situation: 'suggestion_mailbox_note', to: self,
    vars: { who: name || email || 'somebody', name: name, role: role, email: email, text: text },
    subject_floor: 'Suggestion — {who}',
    text_floor: '{text}\n\n— {name} ({role}, {email})',
    key: 'suggestion|' + str_(id),
    facts: facts
  };
}

// AT 08:00, THE SUGGESTION IS READ AGAIN (SmartGate.gs hubLetterQuietCarry_): said while its row is still in the…
function suggestionNoteRebuild_(facts) {
  var want = str_(facts && facts.suggestion_id);
  var book = str_(facts && facts.book);
  var hit = null;
  try {
    var wb = book ? ssOpen_(book) : hubTabWorkbook_(SUGGESTIONS_TAB);
    readTabNormalized_(wb, SUGGESTIONS_TAB).forEach(function (r) {
      if (str_(r.suggestionid) === want) hit = r;
    });
  } catch (e) {
    return { unreadable: 'the suggestions tab could not be read (' + String((e && e.message) || e).slice(0, 120) + ')' };
  }
  if (!hit) return { stale: 'the suggestion ' + want + ' is no longer in the tab' };
  var letter = suggestionNoteLetter_(want, str_(hit.byname), str_(hit.byemail), str_(hit.role), str_(hit.text), book);
  return letter ? { letter: letter } : { stale: 'no platform mailbox is configured' };
}

HUB_POLICY.suggestionsList = {
  file: 'Suggestions.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Every role may ask; non-masters get a 404 that does not reveal the box exists.
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: []
};
HUB_ACTIONS.suggestionsList = function (payload, user) {
  if (typeof hubIsMaster_ !== 'function' || !hubIsMaster_(user)) {
    return { status: 404, message: 'Unknown action.' };
  }
  var rows = [];
  try {
    readTabNormalized_(hubTabWorkbook_(SUGGESTIONS_TAB), SUGGESTIONS_TAB).forEach(function (r) {
      if (!str_(r.suggestionid)) return;
      rows.push({
        id: str_(r.suggestionid),
        at: str_(r.createdat),
        by: str_(r.byname) || str_(r.byemail),
        email: str_(r.byemail),
        role: str_(r.role),
        text: str_(r.text)
      });
    });
  } catch (e) { }
  rows.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return { status: 200, data: { rows: rows } };
};
