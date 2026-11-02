// The description decides outage vs reset, never the type; only the relay's verdict may say `down`.

var PSI_RELAY_PATH = '/psi/health';

// UrlFetchApp has no timeout, so the relay door is asked at most once per execution.
var PSI_RELAY_BUDGET_MS = 2000;

var PSI_RELAY_ASKED = null;


// Padded so a token never matches inside a longer word.
function psiFold_(raw) {
  var s = String(raw == null ? '' : raw).toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .replace(/0/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ' ' + s + ' ';
}

function psiAny_(folded, tokens) {
  for (var i = 0; i < tokens.length; i++) {
    if (folded.indexOf(' ' + tokens[i] + ' ') !== -1) return tokens[i];
  }
  return '';
}

// A bare "anywhere" is deliberately absent: people say it about everything.
var PSI_MATTER_WORDS = ['psi', 'psy', 'psi anywhere', 'psy anywhere', 'psianywhere',
                        'psyanywhere', 'psi any where', 'time entry', 'time entries',
                        'time entry system'];

function psiIsPsiMatter_(text, type) {
  var key = '';
  if (typeof hotlineRequestTypeKey_ === 'function') {
    try { key = String(hotlineRequestTypeKey_(type) || ''); } catch (e) { key = ''; }
  }
  if (!key) key = String(type == null ? '' : type).toLowerCase();
  if (/^psi\b|^psi /.test(key)) return true;
  return !!psiAny_(psiFold_(text), PSI_MATTER_WORDS);
}

// "not work" is deliberately absent: "will not work today" is how a call-off sounds.
var PSI_OUTAGE_WORDS = [
  'not working', 'isnt working', 'is not working', 'stopped working', 'quit working',
  'is down', 'went down', 'down right now', 'system is down', 'site is down',
  'app is down', 'server is down', 'is offline', 'outage',
  'wont load', 'will not load', 'not loading', 'wont open', 'will not open',
  'wont come up', 'will not come up',
  'cant get in', 'cannot get in', 'cant log in', 'cannot log in', 'cant login',
  'cannot login', 'cant sign in', 'cannot sign in', 'unable to log in',
  'unable to login', 'unable to sign in',
  'wont let me log in', 'will not let me log in', 'not letting me log in',
  'wont let me in', 'will not let me in', 'not letting me in',
  'kicked out', 'kicks me out', 'kicking me out',
  'error message', 'getting an error', 'gives an error', 'throws an error',
  'crashed', 'froze', 'frozen', 'not responding', 'keeps spinning',
  // Plural forms: ' can log in ' is not matched by 'cannot log in'.
  'nobody can log in', 'no one can log in', 'nobody can get in', 'no one can get in',
  'nobody can sign in', 'none of us can log in',
  'wont accept my password', 'will not accept my password', 'not accepting my password'
];

// System-scope words settle a sentence that fires both the outage and the reset gate.
var PSI_SITE_WORDS = [
  'is down', 'went down', 'down right now', 'system is down', 'site is down',
  'app is down', 'server is down', 'is offline', 'outage',
  'wont load', 'will not load', 'not loading', 'wont open', 'will not open',
  'wont come up', 'will not come up',
  'crashed', 'froze', 'frozen', 'not responding', 'keeps spinning',
  'everyone', 'everybody', 'nobody can', 'no one can', 'for anyone', 'whole office'
];

// A bare "locked out" is absent: the queue uses it for both outages and single accounts.
var PSI_RESET_WORDS = [
  'reset', 'resets', 'resetting', 'forgot my password', 'forgot password',
  'forgot her password', 'forgot his password', 'new password', 'change my password',
  'change her password', 'temporary password', 'password expired', 'expired password',
  'never received', 'never got', 'dont have a login', 'do not have a login',
  'dont have an account', 'do not have an account', 'need access', 'needs access',
  'request access', 'requesting access', 'requests access', 'set up an account',
  'create an account', 'new account', 'unlock my account', 'unlock her account',
  'locked out after'
];

// verdict: '' | 'outage' | 'reset' | 'unknown'; an unknown is filed, never claimed.
function psiRead_(type, text) {
  var out = { psi: false, verdict: '', why: '', outage_word: '', reset_word: '', site_word: '' };
  if (!psiIsPsiMatter_(text, type)) {
    out.why = 'nothing in the type or the words names PSI Anywhere';
    return out;
  }
  out.psi = true;
  var folded = psiFold_(text);
  out.outage_word = psiAny_(folded, PSI_OUTAGE_WORDS);
  out.reset_word = psiAny_(folded, PSI_RESET_WORDS);
  out.site_word = psiAny_(folded, PSI_SITE_WORDS);

  if (!out.outage_word) {
    out.verdict = out.reset_word ? 'reset' : 'unknown';
    out.why = out.reset_word
      ? 'an account matter ("' + out.reset_word + '") and no words of a thing that is not working'
      : 'a PSI matter that reports neither an outage nor an account problem — nothing is claimed';
    return out;
  }
  if (out.reset_word && !out.site_word) {
    out.verdict = 'reset';
    out.why = '"' + out.outage_word + '" and "' + out.reset_word + '" arrived together with ' +
              'nothing said about the system itself — one person, one account';
    return out;
  }
  out.verdict = 'outage';
  out.why = '"' + out.outage_word + '"' +
            (out.site_word ? ' and "' + out.site_word + '", which is about the system' : '') +
            (out.reset_word ? ' (a reset was asked for too, and it still files)' : '');
  return out;
}


// Queue readers split cells on newlines, so none may reach the cell.
function psiOneLine_(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 240);
}

// The proof's own time, never now: a verdict may be held.
function psiStampAt_(v) {
  var at = String((v && (v.at || v.checked_at)) || '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at) ? at.slice(11, 16) + 'Z' : '';
}

// Only up, down and unknown are verdicts; any other state reads as null (no verdict).
function psiVerdictFrom_(raw, from) {
  if (!raw || typeof raw !== 'object') return null;
  var state = String(raw.state || '').trim().toLowerCase();
  if (state !== 'up' && state !== 'down' && state !== 'unknown') return null;
  return {
    state: state,
    at: String(raw.checked_at || raw.at || ''),
    ms: Number(raw.ms || 0) || 0,
    note: psiOneLine_(raw.note || ''),
    why: psiOneLine_(raw.why || raw.sentence || ''),
    decided_by: String(raw.decided_by || ''),
    held: !!raw.held,
    from: String(from || '')
  };
}

// A refusal is remembered for the pass and answers null, which is never an outage.
function psiRelayVerdict_() {
  if (PSI_RELAY_ASKED) return PSI_RELAY_ASKED.verdict;
  var asked = { verdict: null, ms: 0, why: '' };
  PSI_RELAY_ASKED = asked;
  if (typeof staffRelayPost_ !== 'function') {
    asked.why = 'the relay door is absent from this build';
    return null;
  }
  var startedMs = Date.now();
  var r = null;
  try { r = staffRelayPost_(PSI_RELAY_PATH, {}); }
  catch (e) { r = { status: 502, message: String((e && e.message) || e) }; }
  asked.ms = Date.now() - startedMs;
  if (!r || Number(r.status) !== 200 || !r.data) {
    asked.why = 'the relay answered ' + String((r && r.status) || 'nothing') +
                ' — no verdict, and no verdict is not an outage';
    return null;
  }
  var v = psiVerdictFrom_(r.data, 'the relay door');
  if (!v) {
    asked.why = 'the door answered without a state this lane knows';
    return null;
  }
  v.ask_ms = asked.ms;
  asked.verdict = v;
  asked.why = 'the relay answered in ' + asked.ms + ' ms';
  if (asked.ms > PSI_RELAY_BUDGET_MS) {
    try {
      if (typeof hubSysLog_ === 'function') {
        hubSysLog_('asa-hub:comm', 'psi_door_slow',
                   'the PSI verdict took ' + asked.ms + ' ms to arrive, past the ' +
                   PSI_RELAY_BUDGET_MS + ' ms budget — this pass asks no second time',
                   { status: 200 });
      }
    } catch (eL) {}
  }
  return v;
}

function psiRelayForget_() {
  PSI_RELAY_ASKED = null;
}


// The proof rides in the existing `notes` cell: the queue is not ours to widen.
function psiProofNote_(v) {
  if (!v || !v.state) return '';
  if (v.note) {
    return psiOneLine_(v.state === 'unknown'
      ? v.note + ' Nothing was claimed to the caller.'
      : v.note);
  }
  var at = String(v.at || '');
  var when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at) ? at.slice(11, 16) + 'Z' : 'just now';
  var why = v.why ? ' (' + v.why + ')' : '';
  if (v.state === 'up') {
    return psiOneLine_('PSI Anywhere checked ' + when + ': working normally' + why + '.');
  }
  if (v.state === 'down') {
    return psiOneLine_('PSI Anywhere checked ' + when + ': NOT answering' + why + '.');
  }
  return psiOneLine_('PSI Anywhere could not be checked ' + when + why +
                     ' — the check did not decide, and nothing was claimed to the caller.');
}

// States only what really reached the caller; a caller with no number gets nothing.
function psiCallerLine_(said) {
  if (!said) return 'The message below is the one this platform would send the caller.';
  var why = String((said && said.why) || '').trim();
  var ch = String((said && said.channel) || '').trim();
  if (said.state === 'told') {
    return 'The caller was told the message below' + (ch ? ', on ' + ch : '') + '.';
  }
  if (said.state === 'rehearsed') {
    return 'TEST MODE: the caller was NOT written to — the message below went to the testers.';
  }
  if (said.state === 'already') {
    return 'The caller had already been answered for this call; the message below is what ' +
           'she was sent.';
  }
  if (said.state === 'doubt') {
    return 'The message below may or may not have reached the caller — the transport never ' +
           'confirmed it' + (why ? ' (' + why + ')' : '') + '.';
  }
  return 'THE CALLER WAS TOLD NOTHING' + (why ? ': ' + why : '') +
         '. The message below is what she would have been sent.';
}

function psiTeamLead_(v, reported, said) {
  var who = String(reported || '').trim();
  return 'PSI ANYWHERE IS NOT ANSWERING. ' + psiProofNote_(v) +
         (who ? ' Reported on the hotline by ' + who + '.' : '') +
         ' ' + psiCallerLine_(said);
}
