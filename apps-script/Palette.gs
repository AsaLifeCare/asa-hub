/** Search-bar fallback: when the typed words match no label, the model picks up to three of the destinations the browser offered. */
HUB_POLICY.paletteResolve = {
  file: 'Palette.gs', lane: 'tool', store: 'external',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};

var PALETTE_MAX_CHOICES = 60;

HUB_ACTIONS.paletteResolve = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var phrase = str_(payload && payload.q).slice(0, 120);
  if (!phrase) return { status: 400, message: 'Nothing to look for.' };

  var raw = (payload && payload.choices) || [];
  if (!raw.length) return { status: 400, message: 'No destinations were offered.' };

  var choices = [], byId = {};
  for (var i = 0; i < raw.length && choices.length < PALETTE_MAX_CHOICES; i++) {
    var id = str_(raw[i] && raw[i].id);
    var label = str_(raw[i] && raw[i].label);
    if (!id || byId[id]) continue;
    byId[id] = true;
    choices.push({ id: id, label: label || id, note: str_(raw[i] && raw[i].note).slice(0, 120) });
  }
  if (!choices.length) return { status: 400, message: 'No destinations were offered.' };

  if (typeof screenAiChat_ !== 'function') {
    return { status: 200, data: { matches: [], via: '' } };
  }

  var lines = choices.map(function (c) {
    return '- ' + c.id + ': ' + c.label + (c.note ? ' — ' + c.note : '');
  }).join('\n');

  var ask =
    'A person typed this into the search bar of a care-provider work platform:\n' +
    '"' + phrase + '"\n\n' +
    'Here are the ONLY places they can be sent. Choose the ones that answer ' +
    'what they typed — in the language they used or any other.\n' +
    lines + '\n\n' +
    'Rules: choose ONLY from the ids above. Choose NOTHING rather than ' +
    'something loosely related. At most three, best first.\n' +
    'Reply with JSON only: {"ids":["<id>", ...]}';

  var res = null;
  try { res = screenAiChat_(ask, 0.1, 'ai_palette_search'); } catch (e) { res = null; }
  if (!res || !res.ok) return { status: 200, data: { matches: [], via: '' } };

  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (e) { parsed = null; }
  var ids = (parsed && parsed.ids) || [];

  // The model may only choose among the offered ids; anything else is dropped here.
  var out = [];
  for (var j = 0; j < ids.length && out.length < 3; j++) {
    var pick = str_(ids[j]);
    if (byId[pick] && out.indexOf(pick) === -1) out.push(pick);
  }

  return { status: 200, data: { matches: out, via: str_(res.via) } };
};
