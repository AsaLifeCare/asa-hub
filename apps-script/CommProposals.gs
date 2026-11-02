// ------------------------------------------------------------------ COMM PROPOSALS — the door where a word waits…
// OptOut.gs ships a fixed list of stop words, a fixed list of opt-in words and a fixed list of wrong-number phrases.

// The counter's house.
var COMM_PROPOSALS_TAB = 'comm_proposals';

// The header the mint declared, in its order.
var COMM_PROPOSALS_COLUMNS = [
  'id', 'created_at', 'status', 'vocabularies_allowed', 'phrase', 'tokens',
  'family', 'shape', 'evidence_n', 'people_n', 'coverage',
  'leak_control', 'leak_contains', 'would_catch', 'would_catch_wrongly',
  'verdict', 'why', 'merged_list', 'shipped_intact',
  'example', 'example_ref', 'example_withheld',
  'corpus_n', 'control_n', 'decided_at', 'decided_by', 'notes'
];

// THE LIVE VOCABULARY — a person's half of what this file writes, and append-only.
var COMM_VOCAB_TAB = 'comm_vocabulary';
var COMM_VOCAB_COLUMNS = [
  'id', 'created_at', 'decision', 'vocabulary', 'phrase', 'phrase_norm',
  'proposal_id', 'family', 'evidence_n', 'people_n', 'coverage',
  'would_catch', 'would_catch_wrongly', 'example_ref',
  'decided_by', 'decided_at', 'reason', 'source'
];

/** Brakes may grow. Releases may not. The argument is in the header. */
var COMM_VOCAB_PROPOSABLE = ['opt_out_phrases', 'wrong_number_phrases', 'availability_phrases'];
var COMM_VOCAB_FORBIDDEN = ['opt_in_phrases'];

// A vocabulary entry is a WHOLE short message (optOutIntent_ compares the entire normalised body), so a long phrase…
var COMM_VOCAB_MAX_TOKENS = 4;
var COMM_VOCAB_MAX_CHARS = 60;

// How many learned words one vocabulary may carry.
var COMM_VOCAB_MAX_LEARNED = 40;

var COMM_VOCAB_CACHE_KEY = 'hub_comm_vocab_v1';
var COMM_VOCAB_CACHE_SECONDS = 45;

/* ── what the machine's door accepts ───────────────────────────────────── */

// Rows accepted per call.
var COMM_PROPOSALS_INGEST_CAP = 60;

// THE TWO WORDS A MACHINE MAY FILE.
var COMM_PROPOSALS_FEED_STATUS = ['proposed', 'blocked'];

// A status that means somebody already answered.
var COMM_PROPOSALS_DECIDED_STATUS = ['approved', 'rejected'];

// THE CELLS THIS DOOR NEVER WRITES, on insert or on update.
var COMM_PROPOSALS_PERSON_COLUMNS = ['decided_at', 'decided_by'];

// THE LINE THE DOOR WILL NOT CROSS.
var COMM_PROPOSALS_REFUSED = ['text', 'body', 'message', 'messages', 'member', 'members',
                              'texts', 'raw', 'payload', 'person_key', 'person_name',
                              'name', 'from', 'to', 'from_key', 'phone', 'email',
                              'number', 'masked', 'masked_number', 'sid', 'thread_id'];

// EXACTLY WHAT `optOutIntent_` DOES TO A BODY BEFORE IT COMPARES.
function commVocabularyNorm_(body) {
  return String(body || '').toLowerCase()
    .replace(/[^a-zà-ú0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A shipped list → normalised words.
function commVocabularyShipped_(key) {
  var raw = '';
  try {
    if (key === 'opt_out_phrases' && typeof OPT_OUT_PHRASES_SHIPPED !== 'undefined') raw = OPT_OUT_PHRASES_SHIPPED;
    if (key === 'opt_in_phrases' && typeof OPT_IN_PHRASES_SHIPPED !== 'undefined') raw = OPT_IN_PHRASES_SHIPPED;
    if (key === 'wrong_number_phrases' && typeof WRONG_NUMBER_PHRASES_SHIPPED !== 'undefined') raw = WRONG_NUMBER_PHRASES_SHIPPED;
  } catch (e) { raw = ''; }
  // availability_phrases ships nothing — the lane parses hour ranges instead.
  var out = [];
  String(raw).split(/[,;\n]+/).forEach(function (w) {
    var n = commVocabularyNorm_(w);
    if (n && out.indexOf(n) === -1) out.push(n);
  });
  return out;
}

/** The house id for one of this lane's two tabs, or '' when nobody declared it. */
function commProposalsHouseId_(tab) {
  try {
    if (typeof houseMoved_ === 'function' && !houseMoved_(tab)) return '';
    return (typeof houseIdFor_ === 'function') ? String(houseIdFor_(tab) || '') : '';
  } catch (e) { return ''; }
}

// The proposals, as the counter left them.
function commProposalsRows_() {
  if (!commProposalsHouseId_(COMM_PROPOSALS_TAB)) {
    return { rows: [], declared: false,
             why: 'The proposals house is not declared yet — run ' +
                  'tools/mint_comm_proposals_house.py, then let the counter write into it.' };
  }
  try {
    var rows = readTabNormalized_(hubTabWorkbook_(COMM_PROPOSALS_TAB), COMM_PROPOSALS_TAB);
    var out = [];
    rows.forEach(function (r) {
      var id = str_(r.id);
      if (!id) return;
      out.push({
        id: id,
        created_at: str_(r.createdat),
        status: str_(r.status) || 'proposed',
        vocabularies_allowed: str_(r.vocabulariesallowed),
        phrase: str_(r.phrase),
        tokens: str_(r.tokens),
        family: str_(r.family),
        shape: str_(r.shape),
        evidence_n: str_(r.evidencen),
        people_n: str_(r.peoplen),
        coverage: str_(r.coverage),
        leak_control: str_(r.leakcontrol),
        leak_contains: str_(r.leakcontains),
        would_catch: str_(r.wouldcatch),
        would_catch_wrongly: str_(r.wouldcatchwrongly),
        verdict: str_(r.verdict),
        why: str_(r.why),
        merged_list: str_(r.mergedlist),
        shipped_intact: str_(r.shippedintact),
        example: str_(r.example),
        example_ref: str_(r.exampleref),
        example_withheld: str_(r.examplewithheld),
        corpus_n: str_(r.corpusn),
        control_n: str_(r.controln),
        notes: str_(r.notes)
      });
    });
    return { rows: out, declared: true, why: '' };
  } catch (e) {
    // NEVER an empty list presented as "nothing to teach": an unreadable house and an empty house are different…
    return { rows: [], declared: true,
             why: 'The proposals house could not be read: ' + String((e && e.message) || e) };
  }
}

/** Every decision ever taken, newest last. Append-only by construction. */
function commVocabularyRows_() {
  if (!commProposalsHouseId_(COMM_VOCAB_TAB)) {
    return { rows: [], declared: false,
             why: 'The vocabulary house is not declared yet — no decision can be recorded ' +
                  'until tools/mint_comm_vocabulary_house.py has run.' };
  }
  try {
    var rows = readTabNormalized_(hubTabWorkbook_(COMM_VOCAB_TAB), COMM_VOCAB_TAB);
    var out = [];
    rows.forEach(function (r) {
      var phrase = str_(r.phrasenorm) || commVocabularyNorm_(str_(r.phrase));
      if (!phrase) return;
      out.push({
        id: str_(r.id),
        created_at: str_(r.createdat),
        decision: str_(r.decision).toLowerCase(),
        vocabulary: str_(r.vocabulary),
        phrase: phrase,
        proposal_id: str_(r.proposalid),
        family: str_(r.family),
        evidence_n: str_(r.evidencen),
        people_n: str_(r.peoplen),
        coverage: str_(r.coverage),
        would_catch: str_(r.wouldcatch),
        would_catch_wrongly: str_(r.wouldcatchwrongly),
        example_ref: str_(r.exampleref),
        decided_by: str_(r.decidedby),
        decided_at: str_(r.decidedat) || str_(r.createdat),
        reason: str_(r.reason),
        source: str_(r.source)
      });
    });
    return { rows: out, declared: true, why: '' };
  } catch (e) {
    return { rows: [], declared: true,
             why: 'The vocabulary house could not be read: ' + String((e && e.message) || e) };
  }
}

// WHAT THE PLATFORM HAS LEARNED FOR ONE VOCABULARY — the engine's reader.
function commVocabularyLearned_(key) {
  var vocab = String(key || '');
  // THE RELEASE LIST CANNOT BE LEARNED, and this is the last of the three refusals rather than the first: even a…
  if (!vocab || COMM_VOCAB_FORBIDDEN.indexOf(vocab) !== -1) return [];
  if (COMM_VOCAB_PROPOSABLE.indexOf(vocab) === -1) return [];

  var cached = null;
  try {
    var hit = CacheService.getScriptCache().get(COMM_VOCAB_CACHE_KEY);
    if (hit) cached = JSON.parse(hit);
  } catch (e) { cached = null; }
  if (cached && cached[vocab]) return cached[vocab];

  var read = commVocabularyRows_();
  if (read.why) return [];            // NEVER cached: a failure is not an answer

  var byVocab = {};
  COMM_VOCAB_PROPOSABLE.forEach(function (v) { byVocab[v] = []; });
  // The release words, so a brake can never swallow one.
  var releases = commVocabularyShipped_('opt_in_phrases');

  read.rows.forEach(function (r) {
    if (r.decision !== 'approved') return;
    var v = r.vocabulary;
    if (!byVocab.hasOwnProperty(v)) return;
    if (releases.indexOf(r.phrase) !== -1) return;
    if (commVocabularyShipped_(v).indexOf(r.phrase) !== -1) return;   // already shipped
    if (byVocab[v].indexOf(r.phrase) !== -1) return;
    if (byVocab[v].length >= COMM_VOCAB_MAX_LEARNED) return;
    byVocab[v].push(r.phrase);
  });

  try {
    CacheService.getScriptCache().put(COMM_VOCAB_CACHE_KEY, JSON.stringify(byVocab), COMM_VOCAB_CACHE_SECONDS);
  } catch (e2) { /* a slower read at worst */ }
  return byVocab[vocab] || [];
}

/** Drop the learned cache, so a decision is live in seconds rather than in 45. */
function commVocabularyBust_() {
  try { CacheService.getScriptCache().remove(COMM_VOCAB_CACHE_KEY); } catch (e) { /* the TTL */ }
}

// MAY THIS PHRASE BE FILED UNDER THIS VOCABULARY?
function commVocabularyRefusal_(vocab, phrase, proposal) {
  if (COMM_VOCAB_FORBIDDEN.indexOf(vocab) !== -1) {
    return 'The opt-in list may never be taught. Approving a way to say "start" ' +
           'releases a suppression somebody asked for, and a false positive there ' +
           'texts a person who told us to stop.';
  }
  if (COMM_VOCAB_PROPOSABLE.indexOf(vocab) === -1) {
    return '"' + vocab + '" is not a vocabulary this door files into.';
  }
  if (!phrase) return 'The phrase is empty once normalised the way the lane normalises a reply.';
  if (phrase.length > COMM_VOCAB_MAX_CHARS) {
    return 'The phrase is ' + phrase.length + ' characters; a vocabulary entry is a whole short message.';
  }
  if (phrase.split(' ').length > COMM_VOCAB_MAX_TOKENS) {
    return 'The phrase is ' + phrase.split(' ').length + ' words. The lane compares the WHOLE ' +
           'body against each entry, so a phrase this long could never fire — approving it ' +
           'would change nothing and look like it had.';
  }
  if (commVocabularyShipped_('opt_in_phrases').indexOf(phrase) !== -1) {
    return 'The release list already carries "' + phrase + '". A brake is compared first, ' +
           'so filing it here would silence the people who typed it to be let back in.';
  }
  if (commVocabularyShipped_(vocab).indexOf(phrase) !== -1) {
    return 'The shipped list already carries "' + phrase + '" — approving it would change nothing.';
  }
  if (proposal) {
    if (String(proposal.status) === 'blocked' || String(proposal.verdict) === 'blocked') {
      return 'The counter marked this one blocked: ' + (proposal.why || 'it leaks into replies the ' +
             'machine already read correctly') + '.';
    }
    if (String(proposal.shipped_intact) !== 'yes') {
      return 'The counter could not show that every shipped brake word survives beside this ' +
             'phrase (shipped_intact = "' + str_(proposal.shipped_intact) + '"). Nothing is pasted ' +
             'anywhere by this door, but a drift between the two copies of the shipped list is ' +
             'a reason to stop, not a reason to proceed.';
    }
  }
  return '';
}

// ACTION commProposalsList — the words waiting for a person, with what each one would cost.
HUB_POLICY.commProposalsList = {
  file: 'CommProposals.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: {}
};
HUB_ACTIONS.commProposalsList = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();

  var props = commProposalsRows_();
  var decisions = commVocabularyRows_();

  // A decision is keyed on the proposal it answers, so a proposal that has been refused comes back wearing the…
  var byProposal = {}, byPhrase = {};
  decisions.rows.forEach(function (d) {
    if (d.proposal_id) byProposal[d.proposal_id] = d;
    byPhrase[d.vocabulary + '|' + d.phrase] = d;
  });

  var rows = [];
  props.rows.forEach(function (p) {
    var norm = commVocabularyNorm_(p.phrase);
    var decided = byProposal[p.id] || null;
    if (!decided) {
      // The counter re-mints an id from the phrase, so a proposal whose id changed shape is still recognised as the…
      for (var i = 0; i < COMM_VOCAB_PROPOSABLE.length; i++) {
        var hit = byPhrase[COMM_VOCAB_PROPOSABLE[i] + '|' + norm];
        if (hit) { decided = hit; break; }
      }
    }
    p.phrase_norm = norm;
    p.decision = decided ? decided.decision : '';
    p.decided_by = decided ? decided.decided_by : '';
    p.decided_at = decided ? decided.decided_at : '';
    p.decision_reason = decided ? decided.reason : '';
    p.decided_vocabulary = decided ? decided.vocabulary : '';
    rows.push(p);
  });

  var learned = {};
  COMM_VOCAB_PROPOSABLE.forEach(function (v) { learned[v] = commVocabularyLearned_(v); });

  var shipped = {};
  ['opt_out_phrases', 'opt_in_phrases', 'wrong_number_phrases'].forEach(function (v) {
    shipped[v] = commVocabularyShipped_(v);
  });

  return { status: 200, data: {
    rows: rows,
    proposable: COMM_VOCAB_PROPOSABLE,
    forbidden: COMM_VOCAB_FORBIDDEN,
    shipped: shipped,
    learned: learned,
    decisions: decisions.rows,
    houses: {
      proposals: { tab: COMM_PROPOSALS_TAB, declared: props.declared, why: props.why },
      vocabulary: { tab: COMM_VOCAB_TAB, declared: decisions.declared, why: decisions.why }
    }
  } };
};

// ACTION commProposalsDecide — a person's yes or no, appended as one row.
HUB_POLICY.commProposalsDecide = {
  file: 'CommProposals.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  // Nothing to stale: the screen re-reads its own two houses and the engine reads `comm_vocabulary` through a…
  invalidates: [], emits: [],
  params: {
    id: { type: 'string', required: true },
    decision: { type: 'string', required: true },
    vocabulary: { type: 'string' },
    reason: { type: 'string' }
  }
};
HUB_ACTIONS.commProposalsDecide = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  payload = payload || {};

  var id = str_(payload.id);
  var decision = str_(payload.decision).toLowerCase();
  if (!id) return { status: 400, message: 'Which proposal? An id is required.' };
  if (decision !== 'approve' && decision !== 'reject') {
    return { status: 400, message: 'A decision is "approve" or "reject".' };
  }

  // THE PHRASE COMES FROM THE HOUSE, NEVER FROM THE PAYLOAD.
  var props = commProposalsRows_();
  if (props.why) return { status: 409, message: props.why };
  var proposal = null;
  for (var i = 0; i < props.rows.length; i++) {
    if (props.rows[i].id === id) { proposal = props.rows[i]; break; }
  }
  if (!proposal) {
    return { status: 404, message: 'No proposal with id "' + id + '" is in ' + COMM_PROPOSALS_TAB + '.' };
  }

  var phrase = commVocabularyNorm_(proposal.phrase);
  var vocab = str_(payload.vocabulary);
  if (!vocab) {
    var allowed = String(proposal.vocabularies_allowed || '').split(/[,;]+/)
      .map(function (s) { return str_(s); }).filter(String);
    vocab = allowed.length === 1 ? allowed[0] : '';
  }

  var decisions = commVocabularyRows_();
  if (!decisions.declared || decisions.why) {
    return { status: 409, message: decisions.why ||
      'The vocabulary house is not declared, so a decision could not be recorded — and a ' +
      'decision nobody can read is not a decision.' };
  }

  // ALREADY DECIDED?
  for (var d = 0; d < decisions.rows.length; d++) {
    var row = decisions.rows[d];
    // A REFUSAL BINDS ACROSS EVERY LIST.
    var same = (row.proposal_id && row.proposal_id === id) ||
               (row.phrase === phrase &&
                (row.decision === 'rejected' || !vocab || row.vocabulary === vocab));
    if (same) {
      return { status: 200, data: { already: true, decision: row.decision, row: row,
               message: '"' + proposal.phrase + '" was already ' + row.decision +
                        (row.decided_by ? ' by ' + row.decided_by : '') +
                        (row.decided_at ? ' on ' + String(row.decided_at).slice(0, 10) : '') + '.' } };
    }
  }

  var now = new Date().toISOString();
  var who = str_(user && user.email) || 'asa-hub';

  // A REFUSAL IS A DECISION AND IT IS RECORDED IN THE SAME PLACE AS A YES.
  if (decision === 'reject') {
    var refusalNote = str_(payload.reason);
    hubAppendRow_(COMM_VOCAB_TAB, {
      id: 'CV_' + now.replace(/[^0-9]/g, '').slice(0, 14) + '_' + Utilities.getUuid().slice(0, 6),
      created_at: now, decision: 'rejected',
      // A refusal is filed under the vocabulary it was OFFERED for, and under nothing when the person never chose…
      vocabulary: vocab, phrase: proposal.phrase, phrase_norm: phrase,
      proposal_id: id, family: proposal.family,
      evidence_n: proposal.evidence_n, people_n: proposal.people_n,
      coverage: proposal.coverage, would_catch: proposal.would_catch,
      would_catch_wrongly: proposal.would_catch_wrongly,
      example_ref: proposal.example_ref,
      decided_by: who, decided_at: now,
      reason: refusalNote || 'refused on the screen; no reason typed',
      source: 'commProposalsDecide'
    });
    commVocabularyBust_();
    return { status: 200, data: { decision: 'rejected', phrase: proposal.phrase,
             message: '"' + proposal.phrase + '" is refused, and the counter will not raise it again.' } };
  }

  // ─── APPROVE ────────────────────────────────────────────────────────────
  if (!vocab) {
    return { status: 400, message: 'Choose which list this word joins — the proposal offers ' +
             (proposal.vocabularies_allowed || COMM_VOCAB_PROPOSABLE.join(', ')) + '.' };
  }
  var refusal = commVocabularyRefusal_(vocab, phrase, proposal);
  if (refusal) return { status: 400, message: refusal };

  if (commVocabularyLearned_(vocab).length >= COMM_VOCAB_MAX_LEARNED) {
    return { status: 409, message: 'The ' + vocab + ' list already carries ' + COMM_VOCAB_MAX_LEARNED +
             ' learned words, which is as long as a list a person can still hold in their head. ' +
             'Retire one in the house before teaching another.' };
  }

  // THE WHOLE OF WHAT AN APPROVAL DOES.
  hubAppendRow_(COMM_VOCAB_TAB, {
    id: 'CV_' + now.replace(/[^0-9]/g, '').slice(0, 14) + '_' + Utilities.getUuid().slice(0, 6),
    created_at: now, decision: 'approved',
    vocabulary: vocab, phrase: proposal.phrase, phrase_norm: phrase,
    proposal_id: id, family: proposal.family,
    evidence_n: proposal.evidence_n, people_n: proposal.people_n,
    coverage: proposal.coverage, would_catch: proposal.would_catch,
    would_catch_wrongly: proposal.would_catch_wrongly,
    example_ref: proposal.example_ref,
    decided_by: who, decided_at: now,
    reason: str_(payload.reason), source: 'commProposalsDecide'
  });
  commVocabularyBust_();

  return { status: 200, data: {
    decision: 'approved', vocabulary: vocab, phrase: phrase,
    learned: commVocabularyLearned_(vocab).length,
    message: '"' + phrase + '" joins ' + vocab + '. One row was appended and nothing else ' +
             'changed — the shipped words are untouched and the lane reads the new one within a minute.'
  } };
};

// ================================================================== THE MACHINE'S DOOR — the pure half…

// A value as the text this house stores.
function commProposalsText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

// A COUNT, OR '' — AND NEVER 0.
function commProposalsCount_(v) {
  var t = commProposalsText_(v);
  if (!t) return '';
  return /^\d+(?:\.\d+)?$/.test(t) ? t : '';
}

/** The lists a row offers a person, normalised. */
function commProposalsVocabList_(v) {
  var out = [];
  String(commProposalsText_(v) || '').split(/[,;]+/).forEach(function (s) {
    var n = commProposalsText_(s).toLowerCase();
    if (n && out.indexOf(n) === -1) out.push(n);
  });
  return out;
}

// Which release list a row offers, or '' — the one question asked before any other, because its answer is the only…
function commProposalsOffersRelease_(row) {
  var offered = commProposalsVocabList_((row || {}).vocabularies_allowed);
  for (var i = 0; i < offered.length; i++) {
    if (COMM_VOCAB_FORBIDDEN.indexOf(offered[i]) !== -1) return offered[i];
  }
  return '';
}

/** Is this column a person's to write? */
function commProposalsOwned_(key) {
  return COMM_PROPOSALS_PERSON_COLUMNS.indexOf(String(key)) !== -1;
}

// MAY THIS HANDED-OVER ROW BE FILED AT ALL?
function commProposalsFeedRefusal_(row) {
  var r = row || {};

  // THE RELEASE LIST MAY NEVER BE PROPOSED, AT ANY EVIDENCE LEVEL.
  var release = commProposalsOffersRelease_(r);
  if (release) {
    return 'the row offers ' + release + ', which is never proposed: approving one is a way ' +
           'to un-silence somebody who asked to be left alone, and that mistake arrives as a ' +
           'message already sent';
  }

  var id = commProposalsText_(r.id);
  if (!id) return 'no id — a proposal nothing can address cannot be re-read, matched or decided';
  // the id is never quoted back: the counter builds it out of the phrase, and a REFUSED row is one whose phrase was…
  if (!/^CP_[A-Za-z0-9_]+$/.test(id)) return 'the id is not one the counter mints';

  // A DECISION IS A PERSON'S.
  var status = commProposalsText_(r.status).toLowerCase();
  if (COMM_PROPOSALS_FEED_STATUS.indexOf(status) === -1) {
    return 'a machine may file "' + COMM_PROPOSALS_FEED_STATUS.join('" or "') + '", never "' +
           (status || '(nothing)') + '" — a decision belongs to the person who takes it';
  }

  var offered = commProposalsVocabList_(r.vocabularies_allowed);
  if (!offered.length) return 'the row names no list a person could file it under';

  var phrase = commVocabularyNorm_(r.phrase);
  if (!phrase) return 'the phrase is empty once normalised the way the lane normalises a reply';
  if (phrase.length > COMM_VOCAB_MAX_CHARS) {
    return 'the phrase is ' + phrase.length + ' characters; a vocabulary entry is a whole short message';
  }
  if (phrase.split(' ').length > COMM_VOCAB_MAX_TOKENS) {
    return 'the phrase is ' + phrase.split(' ').length + ' words, and the lane compares WHOLE ' +
           'bodies — it could never fire, so filing it would look like teaching and teach nothing';
  }
  return '';
}

// One handed-over row → the line this house stores, or null.
function commProposalsIngestClean_(row) {
  var r = row || {};
  if (commProposalsFeedRefusal_(r)) return null;
  return {
    id: commProposalsText_(r.id).slice(0, 120),
    /* carried for a row being born; never patched onto one that exists */
    created_at: commProposalsText_(r.created_at).slice(0, 40),
    status: commProposalsText_(r.status).toLowerCase(),
    vocabularies_allowed: commProposalsVocabList_(r.vocabularies_allowed).join(', '),
    phrase: commProposalsText_(r.phrase).slice(0, COMM_VOCAB_MAX_CHARS),
    tokens: commProposalsCount_(r.tokens),
    family: commProposalsText_(r.family).slice(0, 80),
    shape: commProposalsText_(r.shape).slice(0, 24),
    evidence_n: commProposalsCount_(r.evidence_n),
    people_n: commProposalsCount_(r.people_n),
    coverage: commProposalsCount_(r.coverage),
    leak_control: commProposalsCount_(r.leak_control),
    leak_contains: commProposalsCount_(r.leak_contains),
    would_catch: commProposalsCount_(r.would_catch),
    would_catch_wrongly: commProposalsCount_(r.would_catch_wrongly),
    verdict: commProposalsText_(r.verdict).slice(0, 24),
    why: commProposalsText_(r.why).slice(0, 400),
    merged_list: commProposalsText_(r.merged_list).slice(0, 1000),
    shipped_intact: commProposalsText_(r.shipped_intact).slice(0, 8),
    // THE WORDS TRAVEL ONLY AS FAR AS THE COUNTER ALREADY ALLOWED.
    example: commProposalsText_(r.example).slice(0, 300),
    example_ref: commProposalsText_(r.example_ref).slice(0, 200),
    example_withheld: commProposalsText_(r.example_withheld).slice(0, 200),
    corpus_n: commProposalsCount_(r.corpus_n),
    control_n: commProposalsCount_(r.control_n),
    notes: commProposalsText_(r.notes).slice(0, 400)
  };
}

// Which refused columns a hand-over carried, if any.
function commProposalsCrossed_(rows) {
  var hit = {}, names = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i] || {};
    for (var c = 0; c < COMM_PROPOSALS_REFUSED.length; c++) {
      var name = COMM_PROPOSALS_REFUSED[c];
      if (hit[name]) continue;
      if (Object.prototype.hasOwnProperty.call(r, name)) { hit[name] = true; names.push(name); }
    }
  }
  return names;
}

// ================================================================== THE MACHINE'S DOOR — the sheet half…

/** The house, through the one door. */
function commProposalsSheet_() {
  return hubTabEnsure_(COMM_PROPOSALS_TAB, COMM_PROPOSALS_COLUMNS);
}

// THE GRID, READ ONCE — every column of every row, which is what makes the answer "the house holds THESE proposals…
function commProposalsGrid_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { header: [], values: [] };
  return { header: values[0].map(String), values: values };
}

// A block of lines written as TEXT, always.
function commProposalsWrite_(sheet, startRow, lines, width) {
  var range = sheet.getRange(startRow, 1, lines.length, width);
  range.setNumberFormat('@');
  range.setValues(lines);
}

// UPSERT BY PROPOSAL ID — append what is new, patch what moved, touch nothing else.
function commProposalsUpsert_(sheet, incoming, header, values) {
  var col = {};
  for (var h = 0; h < header.length; h++) col[String(header[h])] = h;
  if (col.id === undefined) return { error: 'the ' + COMM_PROPOSALS_TAB + ' house lacks an "id" column' };

  var at = {};
  for (var r = 1; r < values.length; r++) {
    var id0 = commProposalsText_(values[r][col.id]);
    if (id0 && at[id0] === undefined) at[id0] = r;
  }

  var out = { inserted: 0, updated: 0, unchanged: 0, kept_decision: 0, appended: [], writes: 0 };
  var changed = {};
  incoming.forEach(function (item) {
    var id = commProposalsText_(item.id);
    if (!id) return;
    var row = at[id];
    if (row === undefined) {
      var line = header.map(function () { return ''; });
      line[col.id] = id;
      Object.keys(item).forEach(function (k) {
        if (k === 'id' || col[k] === undefined || commProposalsOwned_(k)) return;
        line[col[k]] = item[k];
      });
      out.appended.push(line);
      out.inserted++;
      // a key handed over twice in one payload patches its own new line rather than appending a second one
      at[id] = -(out.appended.length);
      return;
    }
    if (row < 0) {
      var pending = out.appended[-row - 1];
      Object.keys(item).forEach(function (k) {
        if (k === 'id' || col[k] === undefined || commProposalsOwned_(k)) return;
        pending[col[k]] = item[k] === null || item[k] === undefined ? '' : item[k];
      });
      return;
    }
    var cur = values[row], touched = false, held = false;
    Object.keys(item).forEach(function (k) {
      if (k === 'id' || k === 'created_at' || col[k] === undefined || commProposalsOwned_(k)) return;
      if (k === 'status' && col.status !== undefined &&
          COMM_PROPOSALS_DECIDED_STATUS.indexOf(
            commProposalsText_(cur[col.status]).toLowerCase()) !== -1) {
        held = true;
        return;
      }
      var v = item[k] === null || item[k] === undefined ? '' : item[k];
      if (commProposalsText_(cur[col[k]]) !== commProposalsText_(v)) { cur[col[k]] = v; touched = true; }
    });
    if (held) out.kept_decision++;
    if (touched) { changed[row] = true; out.updated++; } else out.unchanged++;
  });

  var idxs = [];
  for (var key in changed) {
    if (Object.prototype.hasOwnProperty.call(changed, key)) idxs.push(Number(key));
  }
  idxs.sort(function (a, b) { return a - b; });
  for (var i = 0; i < idxs.length;) {
    var start = idxs[i], end = start;
    while (i + 1 < idxs.length && idxs[i + 1] === end + 1) { i++; end = idxs[i]; }
    i++;
    var block = [];
    for (var rr = start; rr <= end; rr++) block.push(values[rr].slice(0, header.length));
    commProposalsWrite_(sheet, start + 1, block, header.length);
    out.writes++;
  }
  if (out.appended.length) {
    var first = sheet.getLastRow() + 1;
    var need = first + out.appended.length - 1;
    /* setValues never grows the grid; a house minted short would throw */
    if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
    commProposalsWrite_(sheet, first, out.appended, header.length);
    out.writes++;
  }
  return out;
}

// ACTION commProposalsIngest — what the counter counted, filed where a person can read it.
HUB_POLICY.commProposalsIngest = {
  file: 'CommProposals.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { rows: { required: true, type: 'array' } },
  roles: ['admin'], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.commProposalsIngest = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  var rows = (payload && payload.rows) || [];
  if (!rows.length) {
    // A DAY WITH NOTHING TO PROPOSE IS NOT A DAY THE LANE DID NOT RUN, and the relay says which in its own log.
    return { status: 200, data: { received: 0, kept: 0, refused: 0, release_refused: 0,
             overflow: 0, inserted: 0, updated: 0, unchanged: 0, writes: 0,
             converged: true, note: 'nothing was handed over' } };
  }
  if (!commProposalsHouseId_(COMM_PROPOSALS_TAB)) {
    return { status: 409, message: 'The ' + COMM_PROPOSALS_TAB + ' house is not declared — ' +
             'run tools/mint_comm_proposals_house.py. Nothing was written.' };
  }

  // one feed at a time: two passes reading the same tab would each decide a proposal is missing and each append it
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'The proposals feed is already running.' };
  try {
    // THE LINE, CHECKED BEFORE ANYTHING IS SHAPED.
    var crossed = commProposalsCrossed_(rows);

    var clean = [], seen = {}, refused = 0, release = 0, reasons = [], proposed = 0, blocked = 0;
    for (var i = 0; i < rows.length && clean.length < COMM_PROPOSALS_INGEST_CAP; i++) {
      if (commProposalsOffersRelease_(rows[i])) release++;
      var why = commProposalsFeedRefusal_(rows[i]);
      if (why) {
        refused++;
        if (reasons.indexOf(why) === -1 && reasons.length < 4) reasons.push(why);
        continue;
      }
      var item = commProposalsIngestClean_(rows[i]);
      if (!item) { refused++; continue; }
      if (seen[item.id]) { refused++; continue; }
      seen[item.id] = true;
      if (item.status === 'blocked') blocked++; else proposed++;
      clean.push(item);
    }
    var overflow = Math.max(0, rows.length - refused - clean.length);

    try {
      if (release) {
        // LOUD, AND THE SAME HOUR.
        hubSysLog_('asa-hub:comm', 'comm_proposals_release_refused', String(release) + ' row(s)',
                   { status: 200, message: 'the opt-in list is never proposed, at any evidence level' });
      }
      if (crossed.length) {
        hubSysLog_('asa-hub:comm', 'comm_proposals_columns_refused', crossed.join(', '),
                   { status: 200, message: 'a proposal carries counts and one proved phrase, never the pile' });
      }
    } catch (eL0) { /* the refusal stands whether or not it was filed */ }

    if (!clean.length) {
      return { status: 400, message: 'No usable row: ' + (reasons.join(' · ') || 'every row was refused') };
    }

    var sheet = commProposalsSheet_();
    // THE DECLARED SHAPE FIRST, AND ONLY WHEN THE HOUSE IS SHORT OF IT.
    ensureHeader_(sheet, COMM_PROPOSALS_COLUMNS);
    var read = commProposalsGrid_(sheet);
    var header = read.header;
    if (!header.length) {
      return { status: 409, message: 'The ' + COMM_PROPOSALS_TAB + ' house has no readable header.' };
    }
    if (!read.values.length) read.values = [header];
    var res = commProposalsUpsert_(sheet, clean, header, read.values);
    if (res.error) return { status: 400, message: res.error };

    var moved = res.inserted + res.updated;
    if (moved) { try { cacheBump_(cacheScope_(COMM_PROPOSALS_TAB)); } catch (eB) {} }

    try {
      if (moved || overflow || refused) {
        hubSysLog_('asa-hub:comm', 'comm_proposals_ingested',
                   res.inserted + ' added, ' + res.updated + ' patched, ' + res.unchanged +
                   ' unchanged — ' + res.writes + ' write(s) · ' + proposed + ' proposed · ' +
                   blocked + ' blocked' +
                   (res.kept_decision ? ' · ' + res.kept_decision + ' already answered by a person, kept' : '') +
                   (refused ? ' · ' + refused + ' refused at the door' : '') +
                   (overflow ? ' · ' + overflow + ' past the cap, not seen' : ''),
                   { status: 200 });
      }
    } catch (eL) { /* the rows landed either way */ }

    return { status: 200, data: {
      received: rows.length, kept: clean.length, refused: refused, release_refused: release,
      overflow: overflow, inserted: res.inserted, updated: res.updated,
      unchanged: res.unchanged, writes: res.writes, kept_decision: res.kept_decision,
      proposed: proposed, blocked: blocked, converged: moved === 0,
      dropped_columns: crossed, why: reasons
    } };
  } finally {
    lock.releaseLock();
  }
};
