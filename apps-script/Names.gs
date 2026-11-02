// Loose matching must refuse when two different people score nearly the same.

var NAME_SUFFIXES = {
  jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1,
  md: 1, rn: 1, lpn: 1, stna: 1, dsp: 1, phd: 1, esq: 1,
  mr: 1, mrs: 1, ms: 1, miss: 1, dr: 1
};

// Only short forms that are not names in their own right (no Lisa, no Pat).
var NAME_NICKNAMES = {
  mike: 'michael', mikey: 'michael', mick: 'michael',
  bob: 'robert', bobby: 'robert', robbie: 'robert', rob: 'robert',
  bill: 'william', billy: 'william', willie: 'william',
  jim: 'james', jimmy: 'james',
  joe: 'joseph', joey: 'joseph',
  tom: 'thomas', tommy: 'thomas',
  dave: 'david', davey: 'david',
  dan: 'daniel', danny: 'daniel',
  chris: 'christopher', kris: 'christopher',
  matt: 'matthew', nick: 'nicholas', tony: 'anthony',
  steve: 'steven', stevie: 'steven',
  eddie: 'edward', ed: 'edward',
  rick: 'richard', ricky: 'richard', rich: 'richard',
  jen: 'jennifer', jenny: 'jennifer', jess: 'jessica', jessie: 'jessica',
  liz: 'elizabeth', lizzie: 'elizabeth', beth: 'elizabeth',
  katie: 'katherine', kathy: 'katherine', kate: 'katherine',
  sue: 'susan', suzy: 'susan', susie: 'susan',
  patty: 'patricia', trish: 'patricia',
  maggie: 'margaret', peggy: 'margaret',
  becky: 'rebecca', debbie: 'deborah', deb: 'deborah',
  cindy: 'cynthia', vicky: 'victoria', angie: 'angela', barb: 'barbara',
  ken: 'kenneth', kenny: 'kenneth',
  larry: 'lawrence', jerry: 'gerald', gerry: 'gerald',
  ron: 'ronald', ronnie: 'ronald', don: 'donald', donnie: 'donald',
  charlie: 'charles', chuck: 'charles',
  hank: 'henry', johnny: 'john', jon: 'john', jack: 'john',
  greg: 'gregory', andy: 'andrew', drew: 'andrew',
  ben: 'benjamin', benny: 'benjamin',
  sam: 'samuel', sammy: 'samuel',
  alex: 'alexander', zach: 'zachary', josh: 'joshua',
  nate: 'nathaniel', gabe: 'gabriel', theo: 'theodore',
  tina: 'christina', chrissy: 'christina',
  shell: 'michelle', shelly: 'michelle',
  toni: 'antoinette', dee: 'deandra'
};

var NAME_MATCH_MIN = 0.86;
var NAME_MATCH_GAP = 0.05;

function nameDeburr_(s) {
  try {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    return String(s);
  }
}

function nameNorm_(v) {
  var s = nameDeburr_(v == null ? '' : v).toLowerCase();
  s = s.replace(/['’`]/g, '');        // o'brien → obrien, not "o brien"
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function nameTokens_(v) {
  var all = nameNorm_(v).split(' ').filter(function (t) { return t && !NAME_SUFFIXES[t]; });
  var core = all.filter(function (t) { return t.length > 1; });
  if (!core.length) core = all;
  if (core.length > 1 && NAME_NICKNAMES[core[0]]) core = [NAME_NICKNAMES[core[0]]].concat(core.slice(1));
  return { all: all, core: core };
}

function nameLev_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
      );
    }
    for (j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function nameSim_(a, b) {
  if (a === b) return 1;
  var m = Math.max(a.length, b.length);
  if (!m) return 0;
  var sim = 1 - nameLev_(a, b) / m;
  // A different first letter is rarely a typo and often a different person.
  if (a.charAt(0) !== b.charAt(0) && sim < 0.85) sim *= 0.75;
  return sim < 0 ? 0 : sim;
}

function nameScore_(a, b) {
  var A = nameTokens_(a), B = nameTokens_(b);
  if (!A.core.length || !B.core.length) return 0;
  var an = A.core.join(' '), bn = B.core.join(' ');
  if (an === bn) return 1;

  var aF = A.core[0], aL = A.core[A.core.length - 1];
  var bF = B.core[0], bL = B.core[B.core.length - 1];

  if (A.core.length === 1 || B.core.length === 1) return nameSim_(an, bn);

  var direct = (nameSim_(aF, bF) + nameSim_(aL, bL)) / 2;
  var swapped = (nameSim_(aF, bL) + nameSim_(aL, bF)) / 2 * 0.98;
  var score = Math.max(direct, swapped);

  // The whole string may only raise the score when first and last each hold up alone.
  var partsHold = Math.min(nameSim_(aF, bF), nameSim_(aL, bL)) >= 0.7 ||
                  Math.min(nameSim_(aF, bL), nameSim_(aL, bF)) >= 0.7;
  return partsHold ? Math.max(score, nameSim_(an, bn)) : score;
}

function nameBest_(typed, list, getName) {
  var scored = [];
  for (var i = 0; i < list.length; i++) {
    var nm = getName(list[i]);
    if (!nameNorm_(nm)) continue;
    scored.push({ item: list[i], name: nm, key: nameTokens_(nm).core.join(' '), score: nameScore_(typed, nm) });
  }
  scored.sort(function (x, y) { return y.score - x.score; });

  var best = scored[0];
  if (!best || best.score < NAME_MATCH_MIN) {
    return { ok: false, reason: 'no match', score: best ? best.score : 0 };
  }
  // A runner-up that matches the winner this strongly is the same person, not a rival.
  var runner = null;
  for (var r = 1; r < scored.length; r++) {
    if (scored[r].key === best.key) continue;
    if (nameScore_(best.name, scored[r].name) >= NAME_MATCH_MIN) continue;
    runner = scored[r];
    break;
  }
  if (runner && runner.score >= NAME_MATCH_MIN && best.score - runner.score < NAME_MATCH_GAP) {
    return { ok: false, reason: 'ambiguous', score: best.score,
             candidates: [best.name, runner.name] };
  }
  return { ok: true, item: best.item, matched_name: best.name, key: best.key, score: best.score };
}

function debugNameMatch(typed) {
  var sheet = runtimeSheetFor_('onboarding_packet') ||
              ssOpen_(hubId_('HUB_DB_ID')).getSheetByName('onboarding_packet');
  if (!sheet) return { error: 'onboarding_packet is neither a tab nor dissolved' };
  var rows = sheet.getDataRange().getValues();
  var hdr = rows[0].map(function (h) { return String(h).trim(); });
  var i = hdr.indexOf('CandidateName');
  var list = rows.slice(1).map(function (r) { return { name: String(r[i] || '') }; });
  var out = nameBest_(typed, list, function (x) { return x.name; });
  Logger.log(JSON.stringify(out));
  return out;
}
