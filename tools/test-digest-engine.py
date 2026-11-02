#!/usr/bin/env python3
"""Parity of the decoder's Python port (server/digest_engine.py) with the decoder's own engine (apps-script/Digest.gs,
and ComplianceDocs.gs certReadVocab_). The engine runs in Node here and ONLY here, as the oracle; the port never runs
it. Every paper is read both ways — under the seed tables, under a words book, and as the certificate lane reads it
under certReadVocab_ with several expected kinds — and the readings are compared field by field, with the
redaction, the background-check result, the kinds table, the credentials and the book's dials. The verdict leg runs
the ledger lane's own runner (the Node script server/engine_verdict.py ran before the port, EVAL_JS below) against
digest_engine.verdict under the seed tables, the words books and the roster, new Date() pinned to the same day.

    python3 tools/test-digest-engine.py [--corpus texts.jsonl] [--book book.json] [--roster roster.json]
                                        [--engine apps-script/Digest.gs] [--jobs 4] [--only paper|verdict] [--show]

A corpus line is {"name": …, "text": …}; --book is the words book as the relay's copy folds it ({tab: [row, …]});
--roster is {"people": [...], "clients": [...]}. Only paths are printed, never a paper's words (--show prints the
two differing values, for the synthetic papers). Exits 1 on any difference."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import digest_engine as DE  # noqa: E402

ORACLE = r"""
const fs = require('node:fs'), vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ROSTER = {};
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {},
              str_: (v) => (v === null || v === undefined ? '' : String(v).trim()),
              randomHex_: (n) => 'x'.repeat(n),
              listRows_: (res) => ((ROSTER || {})[res] || []) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(input.engine, 'utf8'), ctx);
const cds = fs.readFileSync(input.compliance, 'utf8');
const from = cds.indexOf('function certReadVocab_(');
vm.runInContext(cds.slice(from, cds.indexOf('\n}\n', from) + 2), ctx);
const ownRows = ctx.digestVocabRows_;
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const tryIt = (fn) => { try { return { ok: fn() }; } catch (e) { return { error: String((e && e.name) || e) }; } };
const undef = (v) => (v === null ? undefined : v);

function bookOf(rows) {
  ctx.digestVocabRows_ = rows ? ((tab) => (rows[tab] || [])) : ownRows;
  ctx.DIGEST_VOCAB = null;
  const b = ctx.digestVocab_();
  ctx.DIGEST_VOCAB = null;
  ctx.digestVocabRows_ = ownRows;
  return b;
}
function under(b, fn) {
  ctx.DIGEST_VOCAB = b;
  ctx.DIGEST_ROSTER = null;
  try { return fn(); } finally { ctx.DIGEST_VOCAB = null; }
}

// the certificate lane's reading, as server/cert_reads.py ran it in Node before the port
function certReading(c, vocabIn, expect) {
  ROSTER = c.roster || {};
  ctx.digestVocabRows_ = ownRows;
  const vocab = vocabIn || null;
  if (vocab && typeof ctx.digestVocabRows_ === 'function') ctx.digestVocabRows_ = (tab) => (vocab[tab] || []);
  ctx.DIGEST_VOCAB = null;
  ctx.DIGEST_ROSTER = null;
  const book = ctx.digestVocab_();
  const certBook = Object.assign({}, book);
  if (book.credentials && book.credentials.length) {
    certBook.credentials = book.credentials.map((row) => {
      if (ctx.str_(row[4])) return row;
      const seed = ctx.DIGEST_CREDENTIALS.filter((s) => s[0] === ctx.str_(row[0]))[0];
      return seed ? [row[0], row[1], row[2], row[3], seed[4]] : row;
    });
  }
  if (book.kinds && book.kinds.length) {
    const kinds = book.kinds.slice();
    (expect || []).forEach((kind) => {
      const seed = ctx.DIGEST_DOC_KINDS.filter((s) => s[0] === kind)[0];
      if (!seed) return;
      for (let i = 0; i < kinds.length; i++) {
        if (kinds[i][0] !== kind) continue;
        const needles = (kinds[i][2] || []).slice();
        seed[2].forEach((n) => { if (needles.indexOf(n) === -1) needles.push(n); });
        kinds[i] = [kinds[i][0], kinds[i][1], needles, kinds[i][3]];
        return;
      }
      kinds.push(seed);
    });
    certBook.kinds = kinds;
  }
  ctx.DIGEST_VOCAB = certBook;
  const p = ctx.digestPaperFromText_(c.text || '', c.name || 'file', c.today || '');
  const wants = ctx.digestCredentialFor_(p.kind);
  const f = p.facts || {};
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  const out = {
    paper: { state: p.state, chars: p.chars, kind: p.kind, kind_score: p.kind_score, kind_alt: p.kind_alt,
             issued_on: p.issued_on, expires_on: p.expires_on, expires_source: p.expires_source, how: p.how || {},
             level: p.level, grid: p.grid || [], report_on: p.report_on, licence_dated: p.licence_dated === true,
             who: p.who, v: p.v,
             facts: { doc_kind: f.doc_kind || '', category: f.category || '', category_source: f.category_source || '',
                      issuer: f.issuer ? 1 : 0, dates: len(f.dates), pairs: len(f.pairs), numbers: len(f.numbers),
                      kind_score: f.kind_score || 0, chars: f.chars || 0 } },
    wants_expiry: !!(wants && wants.expires),
    no_expiry_ceiling: ctx.digestSetting_('no_expiry_ceiling', 60, 0, 84),
    floor: ctx.digestSetting_('distribute_confidence', 85, 50, 100),
    v: ctx.DIGEST_VERSION
  };
  ctx.DIGEST_VOCAB = null;
  ctx.digestVocabRows_ = ownRows;
  return JSON.parse(JSON.stringify(out));
}

const books = { seed: bookOf(null), words: bookOf(input.words) };
if (input.real) books.real = bookOf(input.real);
const names = Object.keys(books);
const g = { consts: {} };
for (const n of input.consts) g.consts[n] = vm.runInContext(n, ctx);
g.books = {}; g.kinds = {}; g.cert_books = {}; g.cert_kinds = {}; g.credentials = {}; g.settings = {};
for (const n of names) {
  g.books[n] = JSON.parse(JSON.stringify(books[n]));
  g.kinds[n] = under(books[n], () => ctx.digestKinds_());
  g.cert_books[n] = input.expects.map((e) => JSON.parse(JSON.stringify(ctx.certReadVocab_(books[n], e))));
  g.cert_kinds[n] = input.expects.map((e) => under(ctx.certReadVocab_(books[n], e), () => ctx.digestKinds_()));
  g.credentials[n] = under(ctx.certReadVocab_(books[n], input.expects[input.expects.length - 1]),
                           () => input.kind_names.map((k) => ctx.digestCredentialFor_(k)));
  g.settings[n] = under(books[n], () => input.settings.map(
    (s) => ctx.digestSetting_(s[0], s[1], undef(s[2]), undef(s[3]))));
}
g.dashes = input.dash_samples.map((s) => ctx.digestPlainDashes_(s));
say(g);

for (const c of input.cases) {
  const r = { id: c.id, paper: {}, cert: {} };
  for (const n of names) {
    r.paper[n] = tryIt(() => {
      ROSTER = c.roster || {};
      return under(books[n], () => ctx.digestPaperFromText_(c.text, c.name, c.today));
    });
  }
  const sets = [['seed', null]].concat(input.real ? [['real', input.real]] : [['words', input.words]]);
  for (const [n, rows] of sets) {
    r.cert[n] = (n === 'seed' ? [input.expects[0]] : input.expects).map((e) => tryIt(() => certReading(c, rows, e)));
  }
  const kind = (r.paper.seed.ok || {}).kind || '';
  r.redact = tryIt(() => ctx.digestRedact_(c.text, kind));
  r.redact_ssn = tryIt(() => ctx.digestRedact_(c.text, 'ssn_card'));
  r.check = tryIt(() => ctx.digestCheckResult_(c.text));
  say(r);
}
"""

# The ledger lane's runner as server/engine_verdict.py ran it in Node before the port, verbatim: the oracle of the
# verdict leg.
EVAL_JS = r"""
const fs = require('node:fs'), vm = require('node:vm');
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {},
              str_: (v) => (v === null || v === undefined ? '' : String(v).trim()),
              randomHex_: (n) => 'x'.repeat(n),
              listRows_: (res) => (roster[res] || []) };
let roster = {};
const input = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
roster = input.roster || {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
/* THE WORDS COME FROM THE BOOK HERE TOO. In Apps Script the
   decoder reads its vocabulary out of the words book; in this context there
   is no SpreadsheetApp, so digestVocabRows_ threw, was caught, and every
   verdict this lane filed used the tables frozen in code — "vocab_from:
   seed". Two lanes, two vocabularies, the exact thing the shared engine was
   built to prevent. The Python side reads the same tabs with the service
   account and hands them in; the reader is replaced with one that answers
   from them. A run with no vocab behaves exactly as before. */
const vocab = input.vocab || null;
if (vocab && typeof ctx.digestVocabRows_ === 'function') {
  ctx.digestVocabRows_ = (tab) => (vocab[tab] || []);
  ctx.DIGEST_VOCAB = null;
}

const name = input.name || '';
let text = input.text || '';
const kind  = ctx.digestDocKind_(name, text);
/* THE SECRET LEAVES THE TEXT HERE TOO. This lane writes the same columns
   into the same sheet; a redaction only the engine performs is not a
   redaction — a card's number once reached the row in the clear. */
const secret = ctx.digestRedact_ ? ctx.digestRedact_(text, kind.kind) : { text: text, ssn_last4: [] };
text = secret.text;
const dates = ctx.digestDates_(name, text);
/* ONE LAW, BOTH RUNNERS. digestOne_ finishes its dates through this same
   function — the labelled reading first, then the pair, the single date and
   the catalog's renewal period. Calling digestDateRoles_ alone is what made
   this lane file a certificate with no expiry while the engine filed one. */
const roles = ctx.digestRolesFinish_
  ? ctx.digestRolesFinish_(kind.kind, ctx.digestDateRoles_(text), dates, '')
  : ctx.digestDateRoles_(text);
const pairs = ctx.digestPairs_(text);

/* the same ladder digestOne_ walks: the roster is proof, a printed label is
   evidence, the title is the last resort */
const whoGot = ctx.digestWhoIs_(text, name);
let who = whoGot ? whoGot.id : '';
let person = whoGot ? (whoGot.display || '') : '';
let source = person ? 'roster' : '';
if (!person) { person = ctx.digestNameFromTitle_(name) || ''; source = person ? 'title' : ''; }
if (!person) { person = ctx.digestNameFromText_(text) || ctx.digestNameFromPairs_(pairs) || ''; source = person ? 'field' : ''; }
if (person && source === 'title' && !ctx.DIGEST_PERSON_KINDS[kind.kind] &&
    text.toLowerCase().indexOf(person.toLowerCase()) === -1) { person = ''; source = ''; }

const seen = ctx.digestNameFromText_(text) || ctx.digestNameFromPairs_(pairs) || '';
const checked = ctx.digestPersonCheck_(person, seen);
if (checked.agree === 'corrected') { person = checked.person; who = checked.who; source = 'document'; }

const subject = ctx.digestSubject_(whoGot, person, kind.kind, text, name);
const issuer = ctx.digestIssuer_(text);
const numbers = ctx.digestNumbers_(text);
const ids = ctx.digestIds_(text);
if (who) ids.unshift(who);

const facts = { doc_kind: kind.kind, category: kind.category, category_source: 'doc_kind',
                issued_on: roles.issued, expires_on: roles.expires, issuer: issuer,
                who: who, person: person, person_source: source,
                person_agree: checked.agree || '',
                dates: dates, pairs: pairs, numbers: numbers,
                kind_score: kind.score || 0, chars: text.length };
const confidence = ctx.digestConfidence_(facts);
const expired = roles.expires
  ? (roles.expires < new Date().toISOString().slice(0, 10) ? 'yes' : 'no') : '';

process.stdout.write(JSON.stringify({
  doc_kind: kind.kind || '', digest_category: kind.category || 'other',
  digest_dates: JSON.stringify(dates),
  digest_names: JSON.stringify(ids.slice(0, 12)),
  digest_text_chars: String(text.length),
  person: person, person_id: who,
  subject_type: subject.type, subject: subject.subject,
  person_seen: checked.seen || '', person_agree: checked.agree || '',
  mentions: JSON.stringify(ctx.digestMentions_(text, name, who)),
  issued_on: roles.issued, expires_on: roles.expires,
  confidence: String(confidence),
  meta: { confidence: confidence, category_source: 'doc_kind',
          doc_kind: kind.kind, kind_score: kind.score || 0, kind_alt: kind.alt || '',
          issuer: issuer, issued_on: roles.issued, expires_on: roles.expires,
          expired: expired, who: who, person_source: source,
          person_seen: checked.seen || '', person_agree: checked.agree || '',
          v: ctx.DIGEST_VERSION, vocab_v: vocab ? (vocab.__v || 'book') : 'seed',
          vocab_from: vocab ? 'book' : 'seed',
          expires_source: roles.source || '', date_how: roles.how || {},
          /* WHAT THE KIND SAID THIS PAPER OWES AND THIS READING DID NOT GIVE.
             The second lane spends real CPU on a better reading, and this is
             what tells it whether spending is worth anything at all. */
          missing: ctx.digestMissing_ ? ctx.digestMissing_(kind.kind, {
            person: person, expires_on: roles.expires, issued_on: roles.issued,
            born_on: roles.born, issuer: issuer,
            number: (numbers && numbers.length) ? 'yes' : ''
          }) : [],
          born_on: roles.born || '',
          level: ctx.digestMedLevel_ && kind.kind === 'med_admin_cert' ? ctx.digestMedLevel_(text) : '',
          program: ctx.digestProgram_ && kind.kind === 'dodd_certification' ? ctx.digestProgram_(text) : '',
          ssn_last4: secret.ssn_last4,
          pairs: pairs, numbers: numbers, lane: 'python' }
}));
"""

# Runs EVAL_JS once per paper and book, as its own process would have: a fresh context over the engine, the input
# handed in as the file it read, and new Date() pinned to the same day the Python side is given.
VERDICT_ORACLE = r"""
const fs = require('node:fs'), vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ENGINE_SRC = fs.readFileSync(input.engine, 'utf8');
const RealDate = Date;
const PIN = RealDate.parse(input.today_utc + 'T12:00:00.000Z');
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(PIN); else super(...a); }
  static now() { return PIN; }
}
const run = vm.runInThisContext('(function (require, process, Date) {\n' + input.eval_js + '\n})');
for (const c of input.cases) {
  const r = { id: c.id, verdict: {} };
  for (const b of c.books) {
    const rows = input.books[b];
    const payload = JSON.stringify({ name: c.name, text: c.text, roster: c.roster || {}, vocab: rows });
    let out = '';
    const files = { readFileSync: (p) => (p === '/engine/Digest.gs' ? ENGINE_SRC : payload) };
    const req = (m) => (m === 'node:fs' ? files : require(m));
    const proc = { argv: ['node', 'eval.cjs', '/engine/Digest.gs', '/in.json'],
                   stdout: { write: (s) => { out += s; } } };
    try { run(req, proc, PinnedDate); r.verdict[b] = { ok: JSON.parse(out) }; }
    catch (e) { r.verdict[b] = { error: String((e && e.name) || e) }; }
  }
  process.stdout.write(JSON.stringify(r) + '\n');
}
"""

LANE_TABS = ["Digest Kinds", "Digest Categories", "Digest Labels", "Digest Issuers", "Digest Drawers"]
CONSTS = ["DIGEST_VERSION", "DIGEST_SCAN_CAP", "DIGEST_CATEGORIES", "DIGEST_VOCAB_TABS", "DIGEST_TYPE_NEVER",
          "DIGEST_CREDENTIALS", "DIGEST_DOC_KINDS", "DIGEST_MONTH_WORDS", "DIGEST_DATE_ROLE_WORDS", "DIGEST_DATE_TOKEN",
          "DIGEST_RENEWAL_FLOOR", "DIGEST_SINGLE_DATE_KINDS", "DIGEST_NAME_STOPWORDS", "DIGEST_NAME_LABELS",
          "DIGEST_NAME_VALUE", "DIGEST_ISSUERS", "DIGEST_REPORT_DATE_WORDS"]
EXPECTS = [[], ["cpr_first_aid"], ["med_admin_cert"], ["dodd_certification"],
           ["crisis_prevention", "crisis_prevention"], ["nope"],
           ["drivers_licence", "state_id", "passport", "work_authorization", "ssn_card", "birth_certificate"]]
SETTINGS = [["no_expiry_ceiling", 60, 0, 84], ["distribute_confidence", 85, 50, 100],
            ["intake_folder", "x", None, None], ["probe_frames", 4, 1, 8], ["missing", 7, None, None],
            ["reread_before_version", "", None, None], ["MAX_RETRIES", 2, 0, 5], ["confidence_floor", 85, 40, 100]]
DASHES = ["a\U00002010b\U00002011c\U00002012d\U00002013e\U00002014f\U00002015g\U00002212h\xadi", "", "plain - text",
          "\U00002016\U00002009"]
TODAY = "2026-10-18"

ROSTER = {
    "people": [{"id": "P1", "name": "Jane Q Testperson"}, {"id": "P2", "name": "  Jane   Testperson "},
               {"id": "P3", "name": "Zoë Ångström"}, {"id": "P4", "name": "Bob Builder"},
               {"id": "P5", "name": "Acme Services LLC"}, {"id": "P6", "name": "Solo"},
               {"id": "", "name": "No Id Person"}, {"id": 77, "name": "Numeric Idperson"},
               {"id": "P8", "name": "José Ñúñez-Ångström"}, {"id": "P9", "name": "O'Brien Mc-Kay"},
               {"id": "P10", "name": "American Red Cross Trainer"}],
    "clients": [{"client_key": "CL_ABCD1234", "id": "", "name": "Clara Clientname"},
                {"client_key": "", "id": "C2", "name": "Carl Otherclient"}, {"client_key": "CK3", "name": "Mono"}],
    "istHouses": [{"house_code": "CO1305", "address": "1305 5th Ave"}, {"label": "House FR12345 - Main", "x": 1},
                  {"id": "ab12345"}, {"3": "ZZ9999", "1": "QQ1111", "house": "nope"}, {"code": "BAD"},
                  {"house": "DE45678", "street_address": "45678 2nd St"}, None],
}
WORDS = {
    "Digest Kinds": [
        {"kind": "cpr_first_aid", "category": "certification_training", "needles": "cpr, first aid | bls",
         "file_hints": "cpr", "weight": "", "active": ""},
        {"kind": "dodd_certification", "category": "certification_training",
         "needles": "dodd certification, initial certification", "file_hints": "dodd|dsp", "weight": "2"},
        {"kind": "receipt", "category": "receipt_invoice", "needles": "receipt, Subtotal", "weight": "0.5"},
        {"kind": "off_kind", "category": "other", "needles": "x", "active": "OFF"},
        {"kind": "", "category": "other", "needles": "bad"},
        {"kind": "w_bad", "category": "other", "needles": "zzzq", "weight": "9"},
        {"kind": "background_check", "category": "legal", "needles": "bci, fbi, webcheck, background check",
         "file_hints": "bci, background"},
        {"kind": "application_resume", "category": "", "needles": "resume, work experience, education, skills",
         "file_hints": "resume", "weight": " 1.5 "},
        {"kind": "med_admin_cert", "category": "certification_training", "needles": "med cert",
         "weight": "1"},
        {"kind": "drivers_licence", "category": "identity", "needles": "driver license, dl no", "weight": "0x2"},
    ],
    "Digest Categories": [
        {"category": "identity", "needles": "passport, ssn", "order": "2"},
        {"category": "certification_training", "needles": "certificate, cpr", "order": "1"},
        {"category": "legal", "needles": "background check", "order": ""},
        {"category": "medical", "needles": "medication", "order": "x"},
        {"category": "", "needles": "nothing"},
        {"category": "timesheet", "needles": "", "order": "3"},
    ],
    "Digest Labels": [
        {"label": "employee\\s+name", "order": "2"}, {"label": "name", "order": "3"},
        {"label": "printed\\s+name", "order": "1"}, {"label": "", "order": "4"},
        {"label": "candidate", "order": "5", "active": "no"},
        {"label": "(?:número|nombre\\s+del\\s+empleado)", "order": "6"}, {"label": "emp{,2}", "order": "7"},
    ],
    "Digest Issuers": [
        {"name": "American Heart Association", "is_organisation": ""},
        {"name": "Ohio Attorney General", "is_organisation": "no"}, {"name": ""},
        {"name": "red cross", "is_organisation": "yes"},
    ],
    "Digest Drawers": [{"drawer_prefix": "MARS", "category": "medical"}, {"drawer_prefix": "isp", "category": ""}],
    "Digest Zip": [{"ext": ".PDF"}, {"extension": "docx"}, {"ext": ""}, {"ext": "constructor"}],
    "Digest Settings": [
        {"key": "no_expiry_ceiling", "value": "55"}, {"key": "Distribute_Confidence", "value": "90"},
        {"key": "intake_folder", "value": "Asa Hub - Form"}, {"key": "", "value": "1"},
        {"key": "probe_frames", "value": " 0x4 "}, {"key": "max_retries", "value": "1e0"},
        {"key": "confidence_floor", "value": "Infinity"}, {"key": "blank", "value": ""},
    ],
    "Form File Types": [{"ext": ".pdf", "mime": "application/pdf"}, {"ext": "exe", "mime": "x"},
                        {"ext": "constructor", "mime": "y"}, {"ext": "heic", "mime": ""}],
    "Digest Answer Facts": [{"fact": "expires_on", "needles": "expiration, valid until", "order": "2"},
                            {"fact": "person", "needles": "full name", "order": "1"}, {"fact": "", "needles": "x"}],
    "Digest Expects": [{"doc_kind": "cpr_first_aid", "must": "person, expires_on", "may": "issuer"},
                       {"doc_kind": "", "must": "x"}],
    "Digest Credentials": [
        {"doc_kind": "cpr_first_aid", "doc_id": "cpr_first_aid", "credential": "cpr", "requirement": "cpr",
         "expires": ""},
        {"doc_kind": "dodd_certification", "doc_id": "dodd_8hr", "credential": "dodd", "requirement": "dodd_8hr",
         "expires": "No"},
        {"doc_kind": "drivers_licence", "doc_id": "drivers_id", "credential": "", "requirement": "drivers_license",
         "expires": "yes"},
        {"doc_kind": "unknown_kind", "doc_id": "u", "credential": "", "requirement": "u", "expires": ""},
        {"doc_kind": "", "doc_id": "x"},
    ],
    "__v": "words",
}

LONG = ("CPR AED BLS Provider card. Issue Date: 03/10/2026. Renewal 03/2028. Name: Testperson, Jane. "
        "Medication Administration Record for July 2026; as of 07/01/2026 the individual received 5 mg. ") * 700

CASES = [
    ("cpr card", "eCard - Jane Testperson - CPR.pdf",
     "AMERICAN HEART ASSOCIATION\nBLS Provider\nCPR and AED Program\nThis card certifies that the above individual has "
     "successfully completed the cognitive and skills evaluations.\nJane Q Testperson\nIssue Date: 03/10/2026\n"
     "Recommended Renewal Date: 03/2028\nTraining Center Name: ASA LifeCare Training Center\nTraining Center ID: "
     "OH12345\nInstructor Name: John Example\neCard Code: 215412345678"),
    ("dodd certificate", "DODD cert.pdf",
     "Ohio Department of Developmental Disabilities\nProvider Certification\nThis is to certify that\nJANE Q "
     "TESTPERSON\nhas satisfactorily completed the requirements for Initial Certification as a Direct Support "
     "Professional (DSP) under OAC 5123\nCertification Number CI 1234567\nEffective Date: 01/05/2026\n"
     "Expiration Date: 01/05/2027\nDE'AHNI J WHEAT - DD00337028\n8 hour annual training"),
    ("med admin grid", "med del.pdf",
     "Ohio Department of Developmental Disabilities\nMedication Administration Certification\nName: Jane Q "
     "Testperson\nCategory 1 01/02/2025 01/02/2026 Certified\nCategory 2 - 02/03/2025 02/03/2027 Certified\n"
     "Cat III 03/04/2024 03/04/2025 Expired\nCategory ii 4/5/2025 4/5/2026 pending"),
    ("med admin single", "medication certificate.jpg",
     "Medication Administration Certification\nCategory 1 Medication\nThis certificate is proudly presented to\n"
     "Bob Builder\nDate: 02/03/2026"),
    ("drivers licence", "DL front.jpg",
     "OHIO\nUSA\nDRIVER LICENSE\nDL NO SA123456\n4a ISS 01/15/2022\n4b EXP 01/15/2030\nDOB 05/06/1990\n"
     "TESTPERSON\nJANE Q\n123 MAIN ST\nCOLUMBUS OH 43215\nCLASS D\nLicense Expiration noted"),
    ("background clear", "BCI webcheck.pdf",
     "Ohio Attorney General\nBureau of Criminal Investigation\nWebCheck Results\nApplicant Name: Jane Q Testperson\n"
     "BCI Completion Date: 08/01/2026\nDate Processed: 07/30/2026\nNo Record Found\nReason: Employment"),
    ("background records", "fbi check.pdf",
     "U.S. Department of Justice\nFederal Bureau of Investigation\nIdentity History Summary\nName: TESTPERSON, JANE\n"
     "Date of Search: 08/02/2026\nThe criminal history record follows.\nConvictions on file: 2"),
    ("offer letter", "Offer Letter.docx",
     "ASA LIFECARE\nOffer of Employment\nDear Jane Testperson,\nWe are pleased to extend this offer letter for the "
     "position of Direct Support Professional.\nRate of Pay: $15.00 per hour\nStart date of employment: September 3, "
     "2026\nPlease sign and return by 3rd day of August, 2026.\nSincerely, Human Resources"),
    ("w4 i9 packet", "new hire packet W-4 I-9.pdf",
     "Form W-4 Employee's Withholding Certificate 2026\nStep 1: Last Name: TESTPERSON First Name: JANE\n"
     "Social Security Number 123-45-6789\nForm I-9 Employment Eligibility Verification\nLast Name (Family Name) "
     "Testperson First Name (Given Name) Jane\nDate of Birth: 05/06/1990\nU.S. Social Security Number 123 45 6789\n"
     "Employee Signature Date Signed: 09/01/2026\nIT-4 Ohio withholding"),
    ("resume", "Jane_Testperson_Resume.pdf",
     "JANE Q TESTPERSON\nColumbus, OH 43215 | (614) 555-0100 | jane@example.com\nProfessional Summary\nCaring DSP.\n"
     "Work Experience\nCaregiver, Home Helpers 2019 - 2024\nEducation\nCentral High School, Diploma June 2010\n"
     "Skills\nCPR, First Aid\nReferences available upon request"),
    ("ssn card", "ss card.jpg",
     "SOCIAL SECURITY\nTHIS NUMBER HAS BEEN ESTABLISHED FOR\nJANE Q TESTPERSON\n123 45 6789\nalso 123456789 and "
     "123-456-7890\nSIGNATURE"),
    ("dob and ssn", "intake form.pdf",
     "Employee Name: Jane Testperson\nDate of Birth: 05/06/1990\nSSN: 123.45.6789\nPhone 614-555-0100\n"
     "Account 9876543210\nMember ID: ABC-12345\nDL: TX1234567"),
    ("empty", "blank.pdf", ""),
    ("whitespace", "", "\n\n \t \n\U0000feff"),
    ("non-ascii names", "Certificado – José.pdf",
     "Certificate of Completion\nThis certificate is proudly presented to\nJosé Ñúñez-Ångström\nfor completing the "
     "course on 12 de março\nName: ŻÓŁW, ŁUKASZ\nZoë Ångström has completed\nİSTANBUL OFİSİ\nΑΣ ΣΟΦΟΣ\n"
     "Completion Date: 09/09/2026"),
    ("astral", "resume 📄.pdf",
     "𝐉𝐀𝐍𝐄 𝐓𝐄𝐒𝐓𝐏𝐄𝐑𝐒𝐎𝐍\n📞 (614) 555-0100 ✉ jane@example.com\nResume\nWork Experience 😀😀😀 Expires: "
     "😀 01/02/2027\nIssued:😀😀 01/02/2025\nName: Jane Testperson 🙂"),
    ("birth certificate", "birth cert.pdf",
     "STATE OF OHIO\nCERTIFICATE OF LIVE BIRTH\nState File Number 1990012345\nChild's Name (First, Middle, Last)\n"
     "JANE QUINN TESTPERSON\nDate of Birth: May 6, 1990\nPlace of Birth: Columbus\nDate Filed by Registrar: "
     "05/20/1990"),
    ("auto insurance", "insurance card.pdf",
     "Auto Insurance Identification Card\nInsured: Jane Testperson\nPolicy Number: ABC1234567\nEffective 01/01/2026 "
     "to 07/01/2026\nVehicle: 2015 Honda Civic\nVIN 1HGCM82633A004352"),
    ("crlf nbsp", "card.png",
     "Name:\xa0Jane Testperson\r\nExpiration Date:\U00002028 12/31/2027\r\n\r\n\r\n\r\n"
     "Issue Date\U00003000 01/01/2025\r\nCPR\xa0certification"),
    ("driver abstract", "BMV abstract.pdf",
     "BUREAU OF MOTOR VEHICLES\nUnofficial 2-Year Driving Record\nLicense status as of 09/20/2026: VALID\n"
     "Record Date: 09/19/2026\nLicense Issue Date: 01/15/2022\nLicense Expiration Date: 01/15/2030"),
    ("caption row", "tb test.pdf",
     "Mantoux Tuberculin Skin Test\nIssue Date        Expiration Date\n01/02/2026        01/02/2028\n"
     "Patient Name: Jane Testperson"),
    ("proto key", "constructor notes.txt",
     "Constructor: Bob Builder\nToString: value here\nconstructor Bob Builder\nCompany: Acme"),
    ("written dates", "agreement.pdf",
     "Lease Agreement made the 3rd day of March, 2026 between Landlord and Tenant. Term from Jul-2026 through "
     "September 3, 2027. Security deposit due Sept. 1st, 2026; Rent Due monthly. Signed Dec 2026."),
    ("conflict", "cpr.pdf", "CPR card\nExpires: 01/01/2020\nIssued: 05/05/2024\nName: Jane Testperson"),
    ("filename only", "TB_Test_Corn_2026.pdf", "page 1"),
    ("dnr", "DNR order.pdf", "DNR Comfort Care\nDo Not Resuscitate order for Clara Clientname\nDate signed 02/02/2026"),
    ("long text", "MAR July 2026.pdf", LONG),
    ("no today", "cpr card.pdf", "CPR\nCompletion Date: 12/12/2099\nName: Bob Builder"),
    ("roster ambiguity", "cpr.pdf", "CPR first aid card for Jane Testperson and Bob Builder, issued 01/01/2026"),
    ("middle names", "cpr.pdf", "BLS card\nJANE MARIA QUINN TESTPERSON\nCARL X OTHERCLIENT\nIssued 01/01/2026"),
    ("stopword name", "Jane Testperson ID card.jpg", "ID CARD\nName: Card Holder\nState ID\nIdentification Card"),
    ("cats", "x.pdf", "Category: I\nCAT-2 something\ncategory 3"),
    ("pairs many", "form.pdf", "".join(f"Field {chr(65 + i % 26)}{i}: value {i}\n" for i in range(80))),
    ("numbers many", "cards.pdf", " ".join(f"card #{1000 + i}A policy no. P-{i:05d}" for i in range(12)) + " id 2026"),
    ("issuers", "x.pdf", "national safety council\nFIRST AID\nRED CROSS\n"),
    ("letterhead", "x.pdf", "\n\nab\nCOLUMBUS COUNTY BOARD OF DD\nsomething"),
    ("range dash", "x.pdf", "Coverage dates from 01/01/2026 – 12/31/2026 and valid 2026-01-01 through 2027-01-01"),
    ("month end", "x.pdf", "Valid thru 7/2028\nExp 07-28\nexpires on Jul 2028"),
    ("non-ascii label", "ficha.pdf", "FICHA DEL EMPLEADO\nNÚMERO: Joseph Testperson\nFecha 01/02/2026"),
    ("brace label", "x.pdf", "Record\nemp{,2}: Ana Maria Testperson\n"),
    ("line terminators", "x.pdf", "CPR card\U00002028Name\U00002029: Jane Testperson\x85Expires\x1c 01/02/2027\x0b"
     "Issued 01/02/2025\U00003000\nExp\xa0Date: 02/03/2027"),
    ("astral windows", "x.pdf", "Expires " + "😀" * 7 + " 01/02/2027\nIssued: " + "😀" * 3 + "01/02/2025\n"
     "THIS CERTIFICATE IS PROUDLY PRESENTED TO\n𝐀 Jane Testperson\n" + "😀" * 30000 + "\nCPR"),
    ("corrected by the paper", "Mary Unknown - CPR.pdf",
     "CPR card\nThis is to certify that Bob Builder has completed the course.\nCarl Otherclient attended.\n"
     "Issued 01/01/2026"),
    ("title name kept", "Bethany Foster - DODD 8hr.pdf",
     "DODD Certification\n8 hour annual training\nDODD ID: 1234567\nCL_ABCD1234 and USR_9x9x9x\nIssued 02/02/2026"),
    ("title name dropped", "Bethany Foster - Fire Drill.pdf", "Fire drill log\nHouse CO1305 evacuated in 2 min."),
    ("houses and mentions", "lease.pdf",
     "Lease Agreement for 1305 5th Ave and FR12345; also QQ1111 and ZZ9999 and DE45678 at 45678 2nd street. "
     "Witnesses: Bob Builder, Carl Otherclient, Clara Clientname, jane q testperson."),
    ("vehicle", "title.pdf", "Vehicle Registration\nVIN 1HGCM82633A004352\nOdometer reading 120000\nAB12345"),
    ("company", "invoice 12.pdf", "INVOICE\nBill to: Acme\nRemit to: X\nAmount due $40.00\nSubtotal $40.00"),
    ("expired card", "cpr.pdf", "CPR card\nName: Jane Testperson\nIssued: 01/01/2019\nExpires: 01/01/2021"),
    ("missing owed", "DL.jpg", "DRIVER LICENSE\nDL NO 1234\nCLASS D"),
]


def synthetic() -> list[dict]:
    out = []
    for i, (label, name, text) in enumerate(CASES):
        out.append({"id": f"synthetic:{label}", "name": name, "text": text,
                    "today": "" if label == "no today" else TODAY, "roster": ROSTER})
    out.append({"id": "synthetic:no roster", "name": "cpr.pdf", "text": CASES[0][2], "today": TODAY, "roster": {}})
    return out


def first_diff(a, b, path="$"):
    if type(a) is not type(b):
        return f"{path} (type {type(a).__name__} ≠ {type(b).__name__})"
    if isinstance(a, dict):
        ka, kb = list(a), list(b)
        if ka != kb:
            missing = [k for k in ka if k not in b] + [k for k in kb if k not in a]
            return f"{path} (keys {'differ: ' + ','.join(missing[:4]) if missing else 'in another order'})"
        for k in ka:
            d = first_diff(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path} (length {len(a)} ≠ {len(b)})"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    return None if a == b else path


def at_path(v, path):
    import re as _re
    for part in _re.findall(r"\.([^.\[\s]+)|\[(\d+)\]", path.split(" ")[0][1:]):
        try:
            v = v[part[0]] if part[0] else v[int(part[1])]
        except Exception:  # noqa: BLE001
            return "?"
    return v


def attempt(fn):
    try:
        return {"ok": json.loads(json.dumps(fn()))}
    except Exception as exc:  # noqa: BLE001 — an engine that throws throws on both sides
        return {"error": type(exc).__name__}


def same(js, py):
    if "error" in js or "error" in py:
        return None if ("error" in js) == ("error" in py) else f"$ (js {'threw' if 'error' in js else 'read'}, " \
                                                                f"py {'threw' if 'error' in py else 'read'})"
    return first_diff(js["ok"], py["ok"])


def python_side(c, books, sets):
    r = {"id": c["id"], "paper": {}, "cert": {}}
    for n, bk in books.items():
        r["paper"][n] = attempt(lambda bk=bk: DE.paper_from_text(c["text"], c["name"], c["today"], bk, c["roster"]))
    for n, rows in sets:
        r["cert"][n] = [attempt(lambda e=e, rows=rows: DE.cert_reading(c["text"] or "", c["name"] or "file",
                                                                       c["today"] or "", e, rows, c["roster"]))
                        for e in ([EXPECTS[0]] if n == "seed" else EXPECTS)]
    kind = (r["paper"]["seed"].get("ok") or {}).get("kind") or ""
    r["redact"] = attempt(lambda: DE.redact(c["text"], kind, books["seed"]))
    r["redact_ssn"] = attempt(lambda: DE.redact(c["text"], "ssn_card", books["seed"]))
    r["check"] = attempt(lambda: DE.check_result(c["text"], books["seed"]))
    return r


def compare_case(js, py):
    for n in js["paper"]:
        d = same(js["paper"][n], py["paper"][n])
        if d:
            return f"paper[{n}] {d}", (js["paper"][n], py["paper"][n])
    for n in js["cert"]:
        for i, (a, b) in enumerate(zip(js["cert"][n], py["cert"][n])):
            d = same(a, b)
            if d:
                return f"cert[{n}][expect {i}] {d}", (a, b)
    for key in ("redact", "redact_ssn", "check"):
        d = same(js[key], py[key])
        if d:
            return f"{key} {d}", (js[key], py[key])
    return None, None


def verdict_side(c, vbooks):
    return {"id": c["id"], "verdict": {b: attempt(lambda b=b: DE.verdict(c["name"], c["text"], c["roster"], vbooks[b],
                                                                         TODAY))
                                       for b in c["books"]}}


def compare_verdict(js, py):
    for b in js["verdict"]:
        d = same(js["verdict"][b], py["verdict"][b])
        if d:
            return f"verdict[{b}] {d}", (js["verdict"][b], py["verdict"][b])
    return None, None


_WORK: dict = {}


def _one(i: int):
    c = _WORK["cases"][i]
    started = time.monotonic()
    got = []
    if _WORK["js"]:
        d, pair = compare_case(json.loads(_WORK["js"][i]), python_side(c, _WORK["books"], _WORK["sets"]))
        got.append(("paper", d, pair))
    if _WORK["vjs"]:
        d, pair = compare_verdict(json.loads(_WORK["vjs"][i]), verdict_side(c, _WORK["vbooks"]))
        got.append(("verdict", d, pair))
    spent = time.monotonic() - started
    keep = _WORK["show"] and c["id"].startswith("synthetic")
    return c["id"], [(leg, d, pair if keep and d else None) for leg, d, pair in got], spent


def node(script: str, payload: dict) -> list[str] | None:
    with tempfile.TemporaryDirectory(prefix="digest-parity-") as work:
        js_file, in_file = Path(work) / "oracle.cjs", Path(work) / "in.json"
        js_file.write_text(script)
        in_file.write_text(json.dumps(payload))
        run = subprocess.run(["node", "--max-old-space-size=4096", str(js_file), str(in_file)], capture_output=True,
                             text=True, timeout=7200)
    if run.returncode != 0:
        print("the oracle did not run:", (run.stderr or "").strip().splitlines()[-3:])
        return None
    return [line for line in run.stdout.split("\n") if line]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=4, help="Python readers working at once (the oracle is one)")
    ap.add_argument("--corpus")
    ap.add_argument("--book")
    ap.add_argument("--roster")
    ap.add_argument("--engine", default=str(ROOT / "apps-script" / "Digest.gs"))
    ap.add_argument("--compliance", default=str(ROOT / "apps-script" / "ComplianceDocs.gs"))
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--only", choices=("paper", "verdict"), help="run one leg: the paper reading or the verdict")
    args = ap.parse_args()
    legs = (args.only,) if args.only else ("paper", "verdict")

    cases = synthetic()
    real = json.loads(Path(args.book).read_text()) if args.book else None
    vbooks = {"seed": None, "words": WORDS, "empty": {}}
    if real is not None:
        vbooks["real"] = real
        # the five tabs the ledger lane (server/form_digest.py VOCAB_TABS) hands its engine, under its own stamp
        vbooks["lane"] = {**{t: real.get(t) or [] for t in LANE_TABS}, "__v": "book:" + TODAY + "T00:00"}
    for c in cases:
        c["books"] = list(vbooks)
    if args.corpus:
        roster = json.loads(Path(args.roster).read_text()) if args.roster else ROSTER
        with open(args.corpus) as fh:
            for n, line in enumerate(fh):
                if line.strip():
                    d = json.loads(line)
                    cases.append({"id": f"corpus#{n + 1}", "name": d.get("name") or "", "text": d.get("text") or "",
                                  "today": TODAY, "roster": roster,
                                  "books": ["seed", "real", "lane"] if real is not None else ["seed", "words"]})
    lines: list[str] = []
    vlines: list[str] = []
    if "paper" in legs:
        kind_names = [k[0] for k in DE.DIGEST_DOC_KINDS] + ["", " cpr_first_aid ", "nope", "unknown_kind"]
        got = node(ORACLE, {"engine": args.engine, "compliance": args.compliance, "cases": cases, "words": WORDS,
                            "real": real, "expects": EXPECTS, "consts": CONSTS, "kind_names": kind_names,
                            "settings": SETTINGS, "dash_samples": DASHES})
        if got is None:
            return 2
        lines = got
    if "verdict" in legs:
        got = node(VERDICT_ORACLE, {"engine": args.engine, "eval_js": EVAL_JS, "today_utc": TODAY, "books": vbooks,
                                    "cases": [{k: c[k] for k in ("id", "name", "text", "roster", "books")}
                                              for c in cases]})
        if got is None:
            return 2
        vlines = got
    books = {"seed": DE.book(None), "words": DE.book(WORDS)}
    if real is not None:
        books["real"] = DE.book(real)
    sets = [("seed", None), ("real", real) if real is not None else ("words", WORDS)]
    bad = 0

    def report(label, d, pair=None):
        nonlocal bad
        if d:
            bad += 1
            print(f"DIFF {label}: {d}")
            if args.show and pair is not None and label.startswith(("synthetic", "global")):
                path = d.split(" ", 1)[1] if " " in d else d
                print("     js:", json.dumps(at_path(pair[0], path), ensure_ascii=False)[:300])
                print("     py:", json.dumps(at_path(pair[1], path), ensure_ascii=False)[:300])
        else:
            print(f"ok   {label}")

    if "paper" in legs:
        globals_(json.loads(lines[0]), books, report)
    if "verdict" in legs:
        # the lane's own door: engine_verdict.verdict is the port under the real clock
        sys.path.insert(0, str(ROOT / "server"))
        import engine_verdict as EV  # noqa: PLC0415
        for c in cases[:len(CASES) + 1]:
            for b in ("seed", "words", "empty"):
                got = json.loads(json.dumps(EV.verdict(c["name"], c["text"], c["roster"], vbooks[b])))
                want = json.loads(json.dumps(DE.verdict(c["name"], c["text"], c["roster"] or {}, vbooks[b] or None,
                                                        DE._utc_today())))
                d = first_diff(want, got)
                if d:
                    report(f"global:engine_verdict[{b}] {c['id']}", d)
        report("global:engine_verdict is the port", None)

    ok = {leg: {"synthetic": [0, 0], "corpus": [0, 0]} for leg in legs}
    slowest = (0.0, "")
    _WORK.update(cases=cases, js=lines[1:], vjs=vlines, books=books, sets=sets, vbooks=vbooks, show=args.show)
    if args.jobs > 1:
        import multiprocessing  # noqa: PLC0415
        pool = multiprocessing.get_context("fork").Pool(args.jobs)
        results = pool.imap(_one, range(len(cases)), chunksize=2)
    else:
        pool, results = None, map(_one, range(len(cases)))
    for case_id, got, spent in results:
        if spent > slowest[0]:
            slowest = (spent, case_id)
        group = "corpus" if case_id.startswith("corpus") else "synthetic"
        for leg, d, pair in got:
            ok[leg][group][1] += 1
            if not d:
                ok[leg][group][0] += 1
            report(f"{case_id} {leg}", d, pair)
        sys.stdout.flush()
    if pool is not None:
        pool.close()
        pool.join()

    long_text = LONG[:125000]
    started = time.monotonic()
    DE.paper_from_text(long_text, "MAR July 2026.pdf", TODAY, books["seed"], ROSTER)
    one = time.monotonic() - started
    started = time.monotonic()
    DE.verdict("MAR July 2026.pdf", long_text, ROSTER, real or WORDS, TODAY)
    two = time.monotonic() - started
    for leg in legs:
        print(f"{leg}: synthetic {ok[leg]['synthetic'][0]}/{ok[leg]['synthetic'][1]} ok; "
              f"corpus {ok[leg]['corpus'][0]}/{ok[leg]['corpus'][1]} ok")
    print(f"{bad} difference(s)")
    print(f"a {len(long_text)}-character paper reads in {one:.2f}s, its verdict in {two:.2f}s; the slowest case "
          f"(all its readings) took {slowest[0]:.2f}s "
          f"({slowest[1].split(':')[0] if slowest[1].startswith('synthetic') else 'corpus'})")
    return 1 if bad else 0


def globals_(g, books, report):
    py_consts = {n: getattr(DE, n) for n in CONSTS if n not in ("DIGEST_VERSION", "DIGEST_SCAN_CAP")}
    py_consts["DIGEST_VERSION"], py_consts["DIGEST_SCAN_CAP"] = DE.VERSION, DE.SCAN_CAP
    kind_names = [k[0] for k in DE.DIGEST_DOC_KINDS] + ["", " cpr_first_aid ", "nope", "unknown_kind"]
    for n in CONSTS:
        report(f"global:const {n}", first_diff(g["consts"][n], json.loads(json.dumps(py_consts[n]))),
               (g["consts"][n], py_consts[n]))
    for n, bk in books.items():
        py_book = json.loads(json.dumps(DE._out(bk)))
        report(f"global:book[{n}]", first_diff(g["books"][n], py_book), (g["books"][n], py_book))
        report(f"global:kinds[{n}]", first_diff(g["kinds"][n], json.loads(json.dumps(DE.kinds(bk)))))
        for i, e in enumerate(EXPECTS):
            cb = DE.cert_book(bk, e)
            report(f"global:cert_book[{n}][expect {i}]", first_diff(g["cert_books"][n][i],
                                                                    json.loads(json.dumps(DE._out(cb)))))
            report(f"global:cert_kinds[{n}][expect {i}]", first_diff(g["cert_kinds"][n][i],
                                                                     json.loads(json.dumps(DE.kinds(cb)))))
        cb = DE.cert_book(bk, EXPECTS[-1])
        creds = [DE.credential_for(k, cb) for k in kind_names]
        report(f"global:credentials[{n}]", first_diff(g["credentials"][n], json.loads(json.dumps(creds))))
        dials = [DE.setting(bk, *s) for s in SETTINGS]
        report(f"global:settings[{n}]", first_diff(g["settings"][n], json.loads(json.dumps(dials))),
               (g["settings"][n], dials))
    report("global:plain_dashes", first_diff(g["dashes"], [DE.plain_dashes(s) for s in DASHES]))


if __name__ == "__main__":
    sys.exit(main())
