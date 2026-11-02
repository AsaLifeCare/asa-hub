// A reply claims only what it names; a bare yes counts only for a one-item message. Claims, never resolutions.

var COMM_AFFIRMATIVE = ['yes', 'y', 'yep', 'yeah', 'done', 'sent', 'ok', 'okay',
                        'sim', 'feito', 'enviei', 'ja enviei', 'já enviei'];
var COMM_NEGATIVE = ['no', 'n', 'not yet', 'nope', 'nao', 'não', 'ainda nao', 'ainda não'];

// Whole-message match only: "no problem" is not a refusal.
function commPhraseIs_(text, list) {
  var t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  return list.indexOf(t) !== -1;
}

// Whole-word match: a substring hit would file a claim against the wrong obligation.
function commNamed_(text, bindings, labelFor) {
  var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  var hit = [];
  (bindings || []).forEach(function (b) {
    var id = String(b.req_id || '');
    var words = [id];
    var label = labelFor ? String(labelFor(id) || '') : '';
    if (label) words.push(label);
    var found = words.some(function (w) {
      var clean = String(w).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!clean || clean.length < 3) return false;
      return t.indexOf(' ' + clean + ' ') !== -1;
    });
    if (found) hit.push(b);
  });
  return hit;
}

function commContribution_(text, intent, labelFor) {
  var bindings = ((intent && intent.bindings) || []).filter(function (b) {
    return String(b.binding_state || 'open') === 'open';
  });
  var body = String(text || '').trim();
  if (!body) {
    return { kind: 'unclear', claims: [], why: 'an empty reply claims nothing' };
  }
  if (!bindings.length) {
    return { kind: 'unclear', claims: [],
             why: 'this intent has nothing open to claim against' };
  }

  var named = commNamed_(body, bindings, labelFor);
  var affirmative = commPhraseIs_(body, COMM_AFFIRMATIVE);
  var negative = commPhraseIs_(body, COMM_NEGATIVE);

  if (named.length) {
    if (named.length === bindings.length && bindings.length > 1 && !affirmative) {
      return { kind: 'named', claims: named,
               why: 'the reply names every open item' };
    }
    return { kind: 'named', claims: named,
             why: 'the reply names ' + named.length + ' of ' + bindings.length + ' open item(s)' };
  }

  if (negative) {
    return { kind: 'declined', claims: bindings.length === 1 ? bindings : [],
             why: bindings.length === 1
               ? 'a plain no, to a message that asked about one thing'
               : 'a plain no, to a message that asked about ' + bindings.length +
                 ' — which one they mean is not knowable' };
  }

  if (affirmative) {
    if (bindings.length === 1) {
      return { kind: 'whole', claims: bindings,
               why: 'a bare yes, to a message that asked about exactly one thing' };
    }
    return { kind: 'unclear', claims: [],
             why: 'a bare "' + body.toLowerCase() + '" to a message carrying ' +
                  bindings.length + ' items — the commonest one-word answer there is, ' +
                  'and it names none of them' };
  }

  return { kind: 'unclear', claims: [],
           why: 'the reply says something this platform should not try to read' };
}
