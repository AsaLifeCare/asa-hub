// IST CONFIG — the training lane's settings, in a tab instead of in code.
// THE DECLARATION IS server/ist_config_defaults.json: every key, its group, its type, its limits, its shipped value…

/* ── BEGIN generated from server/ist_config_defaults.json (tools/emit_ist_config_gs.py) ── */
var IST_CONFIG_TAB = 'ist_config';
var IST_CONFIG_TINTS = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber', 'green'];
var IST_CONFIG_GROUPS = [
  {
    id: 'roster',
    title: 'Who counts as a person',
    blurb: 'Some roster cells hold a coverage label where a name goes (OPEN, STAFF, TBD). Each ' +
      'label left in creates a training obligation for somebody who does not exist, and the ' +
      'first-shift gate asks for a training nobody can receive.'
  },
  {
    id: 'first_shift',
    title: 'A first shift in a house',
    blurb: 'What counts as trained for a house, how long a training lasts, who trains a first ' +
      'shift and whether an assignment takes the training on. A settings read that fails ' +
      'never makes anybody look trained: it asks for the approval instead.'
  },
  {
    id: 'certification',
    title: 'The courses',
    blurb: 'The certification catalogue, the window that counts as expiring, and how each course ' +
      'is joined to the estate\'s own sheets.'
  },
  {
    id: 'screen',
    title: 'What the screens show',
    blurb: 'The IST table\'s columns and the Compliance Matrix\'s courses — order, headings, ' +
      'colours, page size. IST Records and the standalone Compliance Matrix are not installed ' +
      'by default (their addresses open Workforce Compliance instead); install either from ' +
      'Apps → Available to see those settings at work. The course list, the headings and the ' +
      'certification colours reach the Workforce Compliance roster and the Certifications ' +
      'Dashboard either way.'
  },
  {
    id: 'wording',
    title: 'The words on a row',
    blurb: 'What the Certification cell says, and the mark put on a row whose house left the map.'
  },
  {
    id: 'notice',
    title: 'The IST notice',
    blurb: 'Whether an employee already told about a training they owe is told again. What the ' +
      'notice says, who receives it and whether it is sent at all is the ist_due row, edited ' +
      'under The IST notice.'
  }
];
var IST_CONFIG_DEFAULTS = [
  {
    key: 'ist_non_person_names',
    group: 'roster',
    type: 'list',
    people_guard: 'whole',
    value: 'OPEN, NEW, FAMILY, LOCATION, NURSE, STAFF, TBD, AGENCY, VACANT, TBA, PRN',
    note: 'Roster cells that are a COVERAGE LABEL and not a person, compared whole and ignoring ' +
      'case (comma-separated). Each label left in creates a training obligation for somebody ' +
      'who does not exist; the first-shift gate reads the same list, so a label is never sent ' +
      'for a training approval either. The name of somebody in the people list is refused ' +
      'when you save. Emptying this cell restores the shipped list — it does not mean "every ' +
      'cell is a person".'
  },
  {
    key: 'ist_non_person_contains',
    group: 'roster',
    type: 'list',
    min_entry_length: 4,
    people_guard: 'contains',
    value: 'workshop',
    note: 'The same thing, matched ANYWHERE in the cell rather than whole (comma-separated, ' +
      'case-insensitive) — "WORKSHOP", "Workshop AM" and "workshop (B)" are one rule. A word ' +
      'here removes every employee whose name contains it from the IST table and from the ' +
      'first-shift gate, so each word needs at least 4 letters, and a word found inside the ' +
      'name of somebody in the people list is refused when you save.'
  },
  {
    key: 'ist_roster_lookback_days',
    group: 'roster',
    type: 'int',
    min: 0,
    max: 3650,
    unit: 'day',
    value: '0',
    note: 'How far back the rebuild reads the roster when it pairs employees with clients, in ' +
      'days. 0 reads the whole history, which is what the table has always been built from. A ' +
      'number here stops shifts older than that from creating NEW obligations; rows already ' +
      'in the table are never removed. Whole number, 0 to 3650.'
  },
  {
    key: 'ist_pair_requires_overlap',
    group: 'roster',
    type: 'yesno',
    value: 'yes',
    note: 'Whether an employee owes an IST on a client only if they worked at that house ON OR ' +
      'AFTER the client\'s start date. yes: somebody who left before the client arrived never ' +
      'owes that training. no: everybody ever rostered at the house owes it for every client ' +
      'mapped there. A client with no start date on file counts as overlapping either way.'
  },
  {
    key: 'ist_trained_scope',
    group: 'first_shift',
    type: 'choice',
    allowed: ['house', 'client'],
    value: 'house',
    note: 'What TRAINED FOR A HOUSE means at the first-shift gate. house: one completed IST at ' +
      'that house, for any of its clients, is enough. client: every client mapped to that ' +
      'house (Settings → IST, the house → client map) needs a completed IST first. If the map ' +
      'cannot be read under client, nobody is shown as trained and the approval is asked for.'
  },
  {
    key: 'ist_valid_days',
    group: 'first_shift',
    type: 'int',
    min: 0,
    max: 3650,
    unit: 'day',
    value: '0',
    note: 'How long a completed IST counts, in days from the day it was recorded (trainedAt); it ' +
      'still counts on the last of those days, by the Ohio date. 0: an IST never lapses. A ' +
      'completed row with no date stays current — a missing date never makes anybody ' +
      'untrained. A lapsed IST reads as owed on the gate, the wellbeing board, Workforce ' +
      'Compliance and IST Records, and the IST notice chases it. Whole number, 0 to 3650.'
  },
  {
    key: 'ist_trainer_must_be_free',
    group: 'first_shift',
    type: 'yesno',
    value: 'yes',
    note: 'Whether whoever trains a first shift must be FREE at that hour. yes: a house manager ' +
      '(or the approver) who is working somewhere else then cannot be the trainer, and the ' +
      'approval waits until one is free. no: the first house manager on file trains whatever ' +
      'they are working, and the row says they are working then.'
  },
  {
    key: 'ist_trainer_when_no_hm',
    group: 'first_shift',
    type: 'choice',
    allowed: ['approver', 'refuse'],
    value: 'approver',
    note: 'Who trains when the house has no house manager on file (or the only one is the person ' +
      'being trained). approver: whoever approves the first shift trains it. refuse: nobody ' +
      'can approve it until a house manager is on file for that house.'
  },
  {
    key: 'ist_assigner_owns_training',
    group: 'first_shift',
    type: 'yesno',
    value: 'yes',
    note: 'Whether a house manager (or above) who PUTS a person without an IST on a shift — a ' +
      'typed cell, a published Calendar Builder draft, a claimed open shift — takes that ' +
      'training on as theirs. yes: the assignment records their training approval. no: the ' +
      'assignment waits, and the training approval is raised on Requests for the house ' +
      'manager to decide.'
  },
  {
    key: 'ist_gate_certification',
    group: 'certification',
    type: 'course',
    value: 'dodd',
    note: 'Which certification the Certification cell of a new IST row reports on, by its short ' +
      'KEY from the course list (ist_cert_labels) — the key, not the name: "DODD" typed here ' +
      'would find nothing and report every person as having no certificate on file, so a word ' +
      'the course list does not carry is refused when you save, and so is a change to the ' +
      'course list that would drop this course. It is a NOTE on the row and never a blocker: ' +
      'the obligation is written whether or not the certificate is on file, because an ' +
      'obligation that vanishes with a missing certificate is the one you most need to see. ' +
      'mais reads the DODD MAIS scrape; every other course reads its date column in the ' +
      'estate\'s Master sheet and the exceptions tracker.'
  },
  {
    key: 'ist_gate_certification_label',
    group: 'certification',
    type: 'text',
    falls_back_with: 'ist_gate_certification',
    value: 'DODD',
    note: 'How that certification is NAMED in the note on the row ("no DODD certification on ' +
      'file"). Deliberately shorter than the course name in the course list — the note is ' +
      'read inside a table cell. When the course above is refused, this name goes back to its ' +
      'shipped value with it, so a note never names one course while reporting on another.'
  },
  {
    key: 'ist_cert_expiring_days',
    group: 'certification',
    type: 'int',
    min: 1,
    max: 365,
    unit: 'day',
    value: '60',
    note: 'How far ahead counts as EXPIRING, in days. 60 and not 30: a DODD or CPR renewal has to ' +
      'be booked, sat and issued, and a month is not enough notice to get somebody through ' +
      'that without a gap in which they cannot legally work a shift. Whole number, 1 to 365; ' +
      'the Settings screen refuses anything else, and a number typed straight into the sheet ' +
      'outside that range is ignored while 60 answers.'
  },
  {
    key: 'ist_requirements_window',
    group: 'certification',
    type: 'choice',
    allowed: ['own', 'ist'],
    value: 'own',
    note: 'Which window the requirements engine uses for the TRAINING requirements (the courses ' +
      'above). own: each requirement row\'s own warn_days in the requirements tab. ist: the ' +
      'expiring window above, so the engine and the certification matrix call the same course ' +
      'expiring on the same day. Documents keep their own warn_days either way.'
  },
  {
    key: 'ist_cert_labels',
    group: 'certification',
    type: 'pairs',
    value: 'dodd=DODD 8-Hour, cpr=CPR / First Aid, med1=Med Delivery 1, med2=Med Delivery 2, ' +
      'med3=Med Delivery 3, mais=MAIS Certification, money=Money Management, mandt=MANDT',
    note: 'THE COURSE LIST — short key on the left, the name people read on the right, comma ' +
      'separated. These names travel on every certification record, and the key is how a ' +
      'course is joined to its date, so add rather than replace. Removing a course here takes ' +
      'it off the SCREENS; it does not stop it being tracked or counted in "needs attention" ' +
      '— nothing typed in this cell can make a person look compliant. A course ADDED here ' +
      'reads as "no record either way" for everybody until a source names it too ' +
      '(ist_cert_master_columns). Removing the course the IST row reports on ' +
      '(ist_gate_certification) is refused until that setting names another course.'
  },
  {
    key: 'ist_cert_master_columns',
    group: 'certification',
    type: 'pairs',
    key_pattern: '^[a-z0-9_]+$',
    course_values: true,
    value: 'cpr_exp_date=cpr, dodd_8_hour_exp=dodd, med_1_exp_date=med1, med_2_exp_date=med2, ' +
      'med_3_exp_date=med3, money_mgt_date=money, mandt_exp_date=mandt',
    note: 'Which column of the estate\'s Master sheet holds each course\'s date — the column ' +
      'heading lowercased, with each run of spaces and punctuation turned into one underscore ' +
      '(DODD 8-Hour Exp is dodd_8_hour_exp), on the left; the course key on the right. This ' +
      'is the join: a column renamed in the estate\'s sheet is fixed HERE, in a minute, ' +
      'without a new release. The same join tells the onboarding sweep, Staff Documents and ' +
      'Employee 360 which column to fill and show.'
  },
  {
    key: 'ist_cert_training_keys',
    group: 'certification',
    type: 'pairs',
    course_values: true,
    value: 'cpr exp date=cpr, dodd 8-hour exp=dodd, dodd 8 hour exp=dodd, med 1 exp date=med1, med ' +
      '2 exp date=med2, med 3 exp date=med3, money mgt date=money',
    note: 'The same join for the estate\'s EXCEPTIONS tracker, whose labels are spelled out in ' +
      'words ("DODD 8-Hour Exp") and compared ignoring case. Several spellings may point at ' +
      'one course — the shipped cell lists DODD twice, with and without the hyphen. The right ' +
      'side is a course key.'
  },
  {
    key: 'ist_cert_source_tabs',
    group: 'certification',
    type: 'pairs',
    keys: ['trainings', 'mais', 'master'],
    value: 'trainings=Trainings Status, mais=Med Del Certs (MAIS), master=Master',
    note: 'Which tab of the estate\'s employee database each certification read opens: trainings ' +
      '(the exceptions tracker), mais (the DODD MAIS scrape) and master (one row per person, ' +
      'one column per course, holding the real dates). Master is also WRITTEN to — a renewed ' +
      'med-delivery expiry, an edited Employee 360 cell — so the tab named there is where ' +
      'those writes go. A save is refused unless the estate\'s book has every tab named, and ' +
      'the master tab carries the name column and at least one course date column. Only tab ' +
      'names go here: which spreadsheet is the estate\'s book is set by the platform, not in ' +
      'this tab.'
  },
  {
    key: 'ist_cert_source_fields',
    group: 'certification',
    type: 'pairs',
    keys: ['master.name', 'trainings.name', 'trainings.course', 'trainings.status', 'trainings.expires', 'mais.name', 'mais.status', 'mais.expires', 'mais.category'],
    value_pattern: '^[a-z0-9_]+([|+][a-z0-9_]+)*$',
    value: 'master.name=employee|name, trainings.name=name, trainings.course=training, ' +
      'trainings.status=status, trainings.expires=expiration_date, mais.name=name, ' +
      'mais.status=status, mais.expires=expiration, mais.category=cert_type',
    note: 'Which COLUMN of those tabs holds each fact, by the column heading lowercased with ' +
      'punctuation turned into underscores. Left: tab.fact (master.name, trainings.name, ' +
      'trainings.course, trainings.status, trainings.expires, mais.name, mais.status, ' +
      'mais.expires, mais.category). Right: the column; a | lists alternatives tried in ' +
      'order, a + joins columns with a space (search_first+search_last). A fact left out of ' +
      'this cell keeps its shipped column. A save is refused unless every column named exists ' +
      'in its tab. The certification screens and the rebuild of the IST table read the same ' +
      'cell.'
  },
  {
    key: 'ist_cert_tracker_statuses',
    group: 'certification',
    type: 'pairs',
    values: ['expiring', 'expired'],
    value: 'expired=expired, *=expiring',
    note: 'What each Status word of the exceptions tracker means: the tracker\'s word on the left ' +
      '(any case), the state on the right — expiring or expired. * stands for every word not ' +
      'listed. The tracker only lists what is wrong, so no word here can read as valid: ' +
      'nothing typed in this cell can make a person look compliant.'
  },
  {
    key: 'ist_cert_mais_statuses',
    group: 'certification',
    type: 'pairs',
    values: ['certified', 'expired', 'skip'],
    never_value: 'certified',
    never_words: ['expired', 'revoked', 'suspended', 'inactive', 'lapsed', 'denied', 'error'],
    value: 'certified=certified, ERROR*=skip, *=expired',
    note: 'What each Status word of the DODD MAIS scrape means: the scrape\'s word on the left ' +
      '(any case; a trailing * matches every word that starts with it), certified / expired / ' +
      'skip on the right. certified is valid or expiring by its date; skip ignores the row (a ' +
      'scraper error, not a record); * stands for every word not listed, and a word matching ' +
      'nothing reads expired. certified is refused for * and for words such as expired or ' +
      'revoked, so this cell cannot make every record look valid.'
  },
  {
    key: 'ist_columns',
    group: 'screen',
    type: 'pairs',
    value: 'staffName:Employee, clientName:Client, house:House, status:IST, dueDate:Needed by, ' +
      'certNote:Certification, notifiedAt:Last notice, notifyCount:Notices',
    note: 'THE IST RECORDS TABLE — which columns it shows, in which order, under which heading. ' +
      'Left of the colon is the column in the table (staffName, clientName, house, status, ' +
      'dueDate, certNote, notifiedAt, notifyCount, trainedAt, trainedBy, staffEmail, ' +
      'staffPhone, houseStatus, remindRequested); right of it is the heading. A column the ' +
      'screen does not ship is drawn as plain text, so any column the tab carries can be put ' +
      'on screen from here. Removing one hides it; it does not delete anything.'
  },
  {
    key: 'ist_statuses',
    group: 'screen',
    type: 'list',
    value: 'owed, done',
    note: 'The values the IST column can hold, and therefore what the filter offers. These are ' +
      'written into the rows themselves, so renaming one here does NOT rename it in the table ' +
      '— it only stops the old word being filterable. Add before you remove.'
  },
  {
    key: 'ist_status_tints',
    group: 'screen',
    type: 'pairs',
    values: ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber', 'green'],
    value: 'owed=amber, done=mint',
    note: 'The colour each IST status reads as, on IST Records and on Workforce Compliance. The ' +
      'platform has seven: mint, peach, lavender, pink, blue, amber, green — any other colour ' +
      'is refused when you save, and a status without a usable colour keeps its shipped one. ' +
      'Owed reads amber and done reads mint so the eye finds the debt first, which is the ' +
      'whole reason the table is coloured at all.'
  },
  {
    key: 'ist_page_size',
    group: 'screen',
    type: 'int',
    min: 5,
    max: 200,
    value: '25',
    note: 'How many IST rows a page of the table holds. Whole number, 5 to 200; the Settings ' +
      'screen refuses anything else, and a number typed straight into the sheet outside that ' +
      'range is ignored while 25 answers.'
  },
  {
    key: 'ist_matrix_columns',
    group: 'screen',
    type: 'list',
    course_entries: true,
    value: 'dodd, cpr, med1, med2, med3, mais',
    note: 'Which courses the STANDALONE Compliance Matrix screen shows as columns, in this order, ' +
      'by their short keys from the course list. That screen only: the Workforce Compliance ' +
      'roster and the Certifications Dashboard draw every course in the list above, because ' +
      'their "needs attention" count covers every course and a column missing from one of ' +
      'them would be an attention nobody can explain. A course left out here is still tracked ' +
      'and still reported.'
  },
  {
    key: 'ist_matrix_labels',
    group: 'screen',
    type: 'pairs',
    course_keys: true,
    value: 'dodd=DODD 8-Hr, cpr=CPR/FA, med1=Med Del 1, med2=Med Del 2, med3=Med Del 3, mais=DODD ' +
      'MAIS',
    note: 'The SHORT headings a matrix column uses — a few characters wide, so it cannot carry ' +
      'the full course name; the left side is the course key. A course with no short heading ' +
      'falls back to its name in the course list. Editing one here changes the heading on ' +
      'every certification matrix, including the Workforce Compliance roster; leaving a cell ' +
      'alone leaves each screen its own abbreviation.'
  },
  {
    key: 'ist_matrix_page_size',
    group: 'screen',
    type: 'int',
    min: 5,
    max: 200,
    value: '12',
    note: 'How many people a page of the standalone Compliance Matrix holds. Whole number, 5 to ' +
      '200; the Settings screen refuses anything else, and a number typed straight into the ' +
      'sheet outside that range is ignored while 12 answers.'
  },
  {
    key: 'ist_cert_status_tints',
    group: 'screen',
    type: 'pairs',
    keys: ['valid', 'expiring', 'expired', 'missing'],
    values: ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber', 'green'],
    value: 'valid=mint, expiring=amber, expired=pink, missing=pink',
    note: 'The colour each CERTIFICATION state reads as — valid, expiring, expired, missing — on ' +
      'the Compliance Matrix, the Certifications Dashboard and the Workforce Compliance ' +
      'roster. A state whose colour is EDITED here wins on every one of them; a state left at ' +
      'its shipped colour leaves each screen its own (the dashboard draws missing in grey, ' +
      'the donut in lavender). The seven colours are mint, peach, lavender, pink, blue, ' +
      'amber, green.'
  },
  {
    key: 'ist_dashboard_months',
    group: 'screen',
    type: 'int',
    min: 3,
    max: 24,
    unit: 'month',
    value: '12',
    note: 'How many months ahead the Certifications Dashboard\'s renewal timeline reaches, ' +
      'counting this month. Whole number, 3 to 24; the Settings screen refuses anything else, ' +
      'and a number typed straight into the sheet outside that range is ignored while 12 ' +
      'answers.'
  },
  {
    key: 'ist_note_no_certification',
    group: 'wording',
    type: 'template',
    placeholders: ['cert'],
    value: 'no {cert} certification on file',
    note: 'What the Certification cell says when the person holds no such certificate. {cert} is ' +
      'the short name above. This is a statement about the CERTIFICATE and never about the ' +
      'training: the IST row is written either way. The rebuild that fills the IST table ' +
      'writes it on every new row.'
  },
  {
    key: 'ist_note_expired',
    group: 'wording',
    type: 'template',
    placeholders: ['cert', 'date'],
    value: '{cert} expired {date}',
    note: 'The same cell when the certificate is past its date. {cert} is the short name, {date} ' +
      'the day it expired. The rebuild that fills the IST table writes it on every new row ' +
      'whose certificate is dated in the past.'
  },
  {
    key: 'ist_note_unreadable',
    group: 'wording',
    type: 'template',
    placeholders: ['cert', 'value'],
    value: '{cert} date unreadable: {value}',
    note: 'The same cell when a date is on file but nothing can read it. {value} is the cell as ' +
      'it stands, printed so somebody can go and fix it. Saying nothing here would turn a ' +
      'broken date into a clean record.'
  },
  {
    key: 'ist_stale_marker',
    group: 'wording',
    type: 'text',
    value: 'house no longer mapped',
    note: 'The word written on an IST row whose house left the map. The rows are KEPT and marked ' +
      '— never deleted, because a training somebody was already chasing does not disappear ' +
      'when a lookup changes. After this word changes, the next rebuild re-marks the rows ' +
      'still off the map with it, and clears the mark from rows whose house came back, ' +
      'whichever word they carry.'
  },
  {
    key: 'ist_notice_repeats',
    group: 'notice',
    type: 'yesno',
    value: 'no',
    note: 'Whether an employee already told about an IST they owe is told again without anybody ' +
      'asking. no: told once, and again only when somebody asks for another notice on IST ' +
      'Records. yes: the ist_due row\'s own pacing (its max attempts and frequency) decides ' +
      'when they are told again. An IST that lapses (ist_valid_days) is told about once ' +
      'either way.'
  }
];
/* ── END generated declaration ── */

var IST_CONFIG_CACHE_KEY = 'ist_cfg';
/** Where the last copy that really came from the sheet is kept. */
var IST_CONFIG_LAST_GOOD_PROP = 'IST_CONFIG_LAST_GOOD';
/** The refusals last logged — the log speaks when they change, not on every read. */
var IST_CONFIG_REFUSED_PROP = 'IST_CONFIG_REFUSED_SEEN';

/** The declaration row for one key, or null. */
function istConfigSpec_(key) {
  for (var i = 0; i < IST_CONFIG_DEFAULTS.length; i++) {
    if (IST_CONFIG_DEFAULTS[i].key === key) return IST_CONFIG_DEFAULTS[i];
  }
  return null;
}

/** The shipped value for one key, or '' when nothing ships it. */
function istConfigDefault_(key) {
  var d = istConfigSpec_(key);
  return d ? String(d.value) : '';
}

/** Sheet error text — a cell that reads as one of these holds no value at all. */
var IST_CONFIG_ERROR = /^#(ERROR!|REF!|NAME\?|VALUE!|DIV\/0!|N\/A|NULL!|NUM!)/;

// ------------------------------------------------------------------ PARSING AND THE CHECK — the same rules as…

/** A cell as its comma, semicolon or newline separated entries. */
function istCfgBits_(raw) {
  return String(raw == null ? '' : raw).split(/[,;\n]+/)
    .map(function (s) { return String(s).trim(); })
    .filter(function (s) { return !!s; });
}

// A RAW `a=b, c=d` STRING as pairs, in the order they are written — or null when it holds no pair at all.
function istCfgPairsOf_(raw) {
  var map = {}, order = [], any = false;
  istCfgBits_(raw).forEach(function (bit) {
    var i = bit.indexOf('=');
    if (i === -1) i = bit.indexOf(':');
    if (i <= 0) return;
    var k = bit.slice(0, i).trim();
    var v = bit.slice(i + 1).trim();
    if (!k) return;
    if (!Object.prototype.hasOwnProperty.call(map, k)) order.push(k);
    map[k] = v;
    any = true;
  });
  return any ? { map: map, order: order } : null;
}

/** A whole number in ASCII digits, optionally followed by the key's own unit ("90 days"), or null. */
function istCfgIntValue_(key, raw) {
  var m = /^(-?[0-9]+)(?:[ \t]*([A-Za-z]+))?$/.exec(String(raw == null ? '' : raw).trim());
  if (!m) return null;
  var word = String(m[2] || '').toLowerCase();
  if (word) {
    var unit = String((istConfigSpec_(key) || {}).unit || '').toLowerCase();
    if (!unit || (word !== unit && word !== unit + 's')) return null;
  }
  return parseInt(m[1], 10);
}

/** The shipped course keys. */
function istCfgShippedCatalogue_() {
  return (istCfgPairsOf_(istConfigDefault_('ist_cert_labels')) || { order: [] }).order;
}

/** The course keys a join may name: the course list, and every shipped course (still tracked). */
function istCfgRefs_(catalogue) {
  var out = (catalogue || []).slice();
  istCfgShippedCatalogue_().forEach(function (k) { if (out.indexOf(k) === -1) out.push(k); });
  return out;
}

/** A pair giving `never_value` to a word that means a broken record, or to a * covering one. */
function istCfgNever_(spec, key, value) {
  if (!spec.never_value || String(value).trim().toLowerCase() !== String(spec.never_value).toLowerCase()) {
    return false;
  }
  var k = String(key).trim().toLowerCase();
  var words = (spec.never_words || []).map(function (w) { return String(w).toLowerCase(); });
  if (k.charAt(k.length - 1) === '*') {
    var p = k.slice(0, -1);
    return words.some(function (w) { return w.indexOf(p) === 0 || p.indexOf(w) === 0; });
  }
  return words.some(function (w) { return k.indexOf(w) === 0; });
}

/** Whether a key's check reads the course list. */
function istConfigUsesCatalogue_(key) {
  var spec = istConfigSpec_(key) || {};
  return spec.type === 'course' || !!spec.course_entries || !!spec.course_keys || !!spec.course_values;
}

/** '' when the cell is usable, else the reason. A blank cell is the shipped value, never wrong. */
function istConfigCheck_(key, raw, catalogue) {
  var spec = istConfigSpec_(key);
  if (!spec) return key + ' is not a setting this version reads';
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var cat = catalogue || istCfgShippedCatalogue_();
  var type = spec.type;
  if (type === 'int') {
    var n = istCfgIntValue_(key, s);
    if (n === null || (spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) {
      return key + ' takes a whole number from ' + spec.min + ' to ' + spec.max +
             ' — "' + s + '" is not one';
    }
    return '';
  }
  if (type === 'yesno') {
    return ['yes', 'no'].indexOf(s.toLowerCase()) !== -1 ? ''
      : key + ' takes yes or no — not "' + s + '"';
  }
  if (type === 'choice') {
    return (spec.allowed || []).indexOf(s.toLowerCase()) !== -1 ? ''
      : key + ' takes one of ' + (spec.allowed || []).join(', ') + ' — not "' + s + '"';
  }
  if (type === 'course') {
    if (cat.length && cat.indexOf(s) === -1) {
      return '"' + s + '" is not a course in the course list — use one of its short keys: ' +
             cat.join(', ');
    }
    return '';
  }
  if (type === 'list') {
    var entries = istCfgBits_(s);
    if (!entries.length) return key + ' holds no entry';
    var least = spec.min_entry_length || 0;
    var short = entries.filter(function (e) { return least && e.length < least; });
    if (short.length) {
      return short.join(', ') + ' — each entry needs at least ' + least + ' characters: a short ' +
             'word matched inside a name removes real people';
    }
    if (spec.course_entries) {
      var refsL = istCfgRefs_(cat);
      var wrongE = entries.filter(function (e) { return refsL.indexOf(e) === -1; });
      if (wrongE.length) return wrongE.join(', ') + ' — not a course key; use the short keys: ' + refsL.join(', ');
    }
    return '';
  }
  if (type === 'pairs') {
    var got = istCfgPairsOf_(s);
    if (!got) return key + ' holds no key=value pair';
    var bitsAll = istCfgBits_(s);
    for (var b = 0; b < bitsAll.length; b++) {
      var at = bitsAll[b].indexOf('=');
      if (at === -1) at = bitsAll[b].indexOf(':');
      if (at <= 0) return '"' + bitsAll[b] + '" is not a key=value pair';
      if (!bitsAll[b].slice(at + 1).trim()) return '"' + bitsAll[b] + '" has nothing after the =';
    }
    if (spec.keys) {
      var wrongK = got.order.filter(function (k) { return spec.keys.indexOf(k) === -1; });
      if (wrongK.length) return wrongK.join(', ') + ' — ' + key + ' knows only ' + spec.keys.join(', ');
    }
    if (spec.key_pattern) {
      var kre = new RegExp(spec.key_pattern);
      var wrongKP = got.order.filter(function (k) { return !kre.test(k); });
      if (wrongKP.length) {
        return wrongKP.join(', ') + ' — the left side is the column heading lowercased, with spaces ' +
               'and punctuation turned into _ (dodd_8_hour_exp)';
      }
    }
    var refs = istCfgRefs_(cat);
    if (spec.course_keys) {
      var wrongCK = got.order.filter(function (k) { return refs.indexOf(k) === -1; });
      if (wrongCK.length) return wrongCK.join(', ') + ' — not a course key; use the short keys: ' + refs.join(', ');
    }
    if (spec.values) {
      var wrongV = got.order.filter(function (k) {
        return spec.values.indexOf(String(got.map[k]).trim().toLowerCase()) === -1;
      }).map(function (k) { return k + '=' + got.map[k]; });
      if (wrongV.length) return wrongV.join(', ') + ' — the value must be one of ' + spec.values.join(', ');
    }
    if (spec.value_pattern) {
      var re = new RegExp(spec.value_pattern);
      var wrongP = got.order.filter(function (k) { return !re.test(String(got.map[k]).trim()); })
        .map(function (k) { return k + '=' + got.map[k]; });
      if (wrongP.length) {
        return wrongP.join(', ') + ' — a column is lowercase letters, digits and _, joined by | or +';
      }
    }
    if (spec.course_values) {
      var wrongCV = got.order.filter(function (k) { return refs.indexOf(String(got.map[k]).trim()) === -1; })
        .map(function (k) { return k + '=' + got.map[k]; });
      if (wrongCV.length) return wrongCV.join(', ') + ' — the right side must be a course key: ' + refs.join(', ');
    }
    if (spec.never_value) {
      var wrongN = got.order.filter(function (k) { return istCfgNever_(spec, k, got.map[k]); })
        .map(function (k) { return k + '=' + got.map[k]; });
      if (wrongN.length) {
        return wrongN.join(', ') + ' — ' + spec.never_value + ' is never given to * or to a word ' +
               'that means a lapsed or broken record';
      }
    }
    return '';
  }
  if (type === 'template') {
    var allowed = spec.placeholders || [];
    var seen = {}, wrongT = [];
    (s.match(/\{[^{}]*\}/g) || []).forEach(function (m) {
      var p = m.slice(1, -1);
      if (allowed.indexOf(p) === -1 && !seen[p]) { seen[p] = true; wrongT.push(p); }
    });
    if (wrongT.length) {
      wrongT.sort();
      return wrongT.map(function (w) { return '{' + w + '}'; }).join(', ') +
             ' is not filled in by this sentence — it knows ' +
             allowed.slice().sort().map(function (a) { return '{' + a + '}'; }).join(', ');
    }
    return '';
  }
  return '';
}

/** {value, problem} for one cell: itself, its usable entries, or the shipped value. */
function istConfigResolveOne_(key, raw, catalogue) {
  var spec = istConfigSpec_(key);
  var s = String(raw == null ? '' : raw).trim();
  if (!spec) return { value: s, problem: '' };
  if (!s) return { value: String(spec.value), problem: '' };
  var why = istConfigCheck_(key, s, catalogue);
  if (!why) return { value: spec.type === 'int' ? String(istCfgIntValue_(key, s)) : s, problem: '' };
  if (spec.type === 'list' || spec.type === 'pairs') {
    var kept = istCfgBits_(s).filter(function (b) { return !istConfigCheck_(key, b, catalogue); });
    if (kept.length) return { value: kept.join(', '), problem: why };
  }
  return { value: String(spec.value), problem: why };
}

/** The course keys a raw map carries, as its course list resolves. */
function istConfigCatalogueOf_(rawMap) {
  var v = istConfigResolveOne_('ist_cert_labels', (rawMap || {}).ist_cert_labels, null).value;
  return (istCfgPairsOf_(v) || { order: [] }).order;
}

/** The key this one falls back with, when that one is refused whole — else ''. */
function istConfigPartnerRefused_(rawMap, key, catalogue) {
  var partner = (istConfigSpec_(key) || {}).falls_back_with;
  if (!partner) return '';
  var got = istConfigResolveOne_(partner, (rawMap || {})[partner], catalogue);
  return (got.problem && got.value === istConfigDefault_(partner)) ? partner : '';
}

/** {values, problems} over a raw map: every declared key resolved, the refused ones named. */
function istConfigResolve_(rawMap) {
  var raw = rawMap || {};
  var catalogue = istConfigCatalogueOf_(raw);
  var values = {}, problems = {};
  IST_CONFIG_DEFAULTS.forEach(function (d) {
    var got = istConfigResolveOne_(d.key, raw[d.key], catalogue);
    values[d.key] = got.value;
    if (got.problem) problems[d.key] = got.problem;
  });
  IST_CONFIG_DEFAULTS.forEach(function (d) {
    var partner = istConfigPartnerRefused_(raw, d.key, catalogue);
    if (partner && values[d.key] !== String(d.value)) {
      values[d.key] = String(d.value);
      problems[d.key] = 'answers its shipped value with ' + partner + ', which is refused';
    }
  });
  return { values: values, problems: problems };
}

/** Every `key: why` a save of `values` over `stored` is refused for; a course-list change re-checks the keys it leaves alone. */
function istConfigSaveProblems_(values, stored) {
  var before = stored || {};
  var after = {};
  var k;
  for (k in before) if (Object.prototype.hasOwnProperty.call(before, k)) after[k] = before[k];
  for (k in values) if (Object.prototype.hasOwnProperty.call(values, k)) after[k] = values[k];
  var catBefore = istConfigCatalogueOf_(before);
  var catAfter = istConfigCatalogueOf_(after);
  var out = [];
  for (k in values) {
    if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
    var why = istConfigCheck_(k, values[k], catAfter);
    if (why) out.push(k + ': ' + why);
  }
  if (Object.prototype.hasOwnProperty.call(values, 'ist_cert_labels')) {
    IST_CONFIG_DEFAULTS.forEach(function (d) {
      if (Object.prototype.hasOwnProperty.call(values, d.key) || !istConfigUsesCatalogue_(d.key)) return;
      var cell = String(before[d.key] == null ? '' : before[d.key]).trim() || String(d.value);
      if (istConfigCheck_(d.key, cell, catAfter) && !istConfigCheck_(d.key, cell, catBefore)) {
        out.push(d.key + ': "' + cell + '" would no longer name a course in the course list this save ' +
                 'leaves — change ' + d.key + ' in the same save, or keep the course');
      }
    });
  }
  return out;
}

// The tab, created and seeded on first touch — nothing to install.
function istConfigSheet_() {
  var sheet = hubTabEnsure_(IST_CONFIG_TAB, ['key', 'value', 'note']);
  if (sheet.isRuntimeBacked) return sheet;

  var values = sheet.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0] || '').trim();
    if (k) have[k] = true;
  }
  var missing = IST_CONFIG_DEFAULTS.filter(function (d) { return !have[d.key]; });
  if (missing.length) {
    var lock = LockService.getScriptLock();
    var held = false;
    try { held = lock.tryLock(10000); } catch (eL) { held = false; }
    try {
      if (held) {
        var fresh = sheet.getDataRange().getValues();
        var now = {};
        for (var j = 1; j < fresh.length; j++) {
          var fk = String(fresh[j][0] || '').trim();
          if (fk) now[fk] = true;
        }
        missing = missing.filter(function (d) { return !now[d.key]; });
      } else {
        // never seed without the lock: a missing key costs one pass, a duplicate every save
        missing = [];
      }
      missing.forEach(function (d) {
        // a value starting with '+' or '=' would become a formula and read #ERROR!
        sheet.appendRow([d.key, hubCellSafe_(d.value), d.note]);
      });
    } finally {
      if (held) { try { lock.releaseLock(); } catch (eR) { /* released at exit */ } }
    }
    istConfigBump_();
  }
  istConfigHeal_(sheet);
  return sheet;
}

/** What the heal changes, planned from ONE read (0-based rows): #ERROR cells, stale notes, duplicate keys. */
function istConfigHealPlan_(values) {
  var byKey = {};
  IST_CONFIG_DEFAULTS.forEach(function (d) { byKey[d.key] = d; });
  // the survivor carries a value, the first of those if several — a real edit outranks a seeded blank
  var seen = {}, doomed = [];
  for (var d = 1; d < values.length; d++) {
    var dk = String(values[d][0] || '').trim();
    if (!dk) continue;
    var dv = String(values[d][1] == null ? '' : values[d][1]).trim();
    if (seen[dk] === undefined) { seen[dk] = { row: d, value: dv }; continue; }
    if (!seen[dk].value && dv) { doomed.push(seen[dk].row); seen[dk] = { row: d, value: dv }; }
    else { doomed.push(d); }
  }
  var errors = [], notes = [];
  for (var i = 1; i < values.length; i++) {
    if (doomed.indexOf(i) !== -1) continue;
    var key = String(values[i][0] || '').trim();
    if (!key || !byKey[key]) continue;
    var val = String(values[i][1] == null ? '' : values[i][1]).trim();
    if (IST_CONFIG_ERROR.test(val)) errors.push({ row: i, value: String(byKey[key].value) });
    if (String(values[i][2] == null ? '' : values[i][2]) !== byKey[key].note) {
      notes.push({ row: i, note: byKey[key].note });
    }
  }
  doomed.sort(function (a, b) { return b - a; });
  return { errors: errors, notes: notes, doomed: doomed };
}

/** Repair the tab: every change is planned from a read made INSIDE the lock, never from an older copy. */
function istConfigHeal_(sheet) {
  try {
    var first = istConfigHealPlan_(sheet.getDataRange().getValues());
    if (!first.errors.length && !first.notes.length && !first.doomed.length) return;
    var lock = LockService.getScriptLock(), held = false;
    try { held = lock.tryLock(10000); } catch (eL) { held = false; }
    // without the lock another execution may be moving the rows: repair next time
    if (!held) return;
    var fixed = 0;
    try {
      var plan = istConfigHealPlan_(sheet.getDataRange().getValues());
      plan.errors.forEach(function (e) { sheet.getRange(e.row + 1, 2).setValue(hubCellSafe_(e.value)); });
      plan.notes.forEach(function (n) { sheet.getRange(n.row + 1, 3).setValue(n.note); });
      // bottom first, after the writes above, so no index moves under them
      plan.doomed.forEach(function (row) { sheet.deleteRow(row + 1); });
      fixed = plan.errors.length + plan.doomed.length;
      if (plan.doomed.length) {
        try {
          hubSysLog_('asa-hub:heal', 'ist_config_dedup',
                     plan.doomed.length + ' duplicate row(s) removed', { status: 200 });
        } catch (eLg) { /* the collapse matters more than the note */ }
      }
    } finally {
      try { lock.releaseLock(); } catch (eR) { /* released at exit */ }
    }
    if (fixed) istConfigBump_();
  } catch (e) { /* a broken cell is better than a broken read */ }
}

// The whole tab as {key: raw cell}, memoised per execution and cached 60s.
var IST_CONFIG_MEMO = null;
var IST_CONFIG_SOURCE = '';
var IST_CONFIG_BLIND_LOGGED = false;
/** The memo resolved once — readers ask per roster cell. Keyed by the memo it came from. */
var IST_CONFIG_RESOLVED = null;

function istConfig_() {
  if (IST_CONFIG_MEMO) return IST_CONFIG_MEMO;

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache) {
    var hit = null;
    try { hit = cache.get(IST_CONFIG_CACHE_KEY); } catch (eG) { hit = null; }
    if (hit) {
      try {
        IST_CONFIG_MEMO = JSON.parse(hit);
        IST_CONFIG_SOURCE = 'sheet';
        return IST_CONFIG_MEMO;
      } catch (eP) { /* re-read below */ }
    }
  }

  var cfg = null;
  try {
    var values = istConfigSheet_().getDataRange().getValues();
    cfg = {};
    for (var i = 1; i < values.length; i++) {
      var key = String(values[i][0] || '').trim();
      if (!key) continue;
      var raw = String(values[i][1] == null ? '' : values[i][1]);
      // an #ERROR! cell holds no value: it reads as empty, which is the shipped value
      cfg[key] = IST_CONFIG_ERROR.test(raw.trim()) ? '' : raw;
    }
  } catch (eS) { cfg = null; }

  if (cfg) {
    IST_CONFIG_SOURCE = 'sheet';
    try { cache && cache.put(IST_CONFIG_CACHE_KEY, JSON.stringify(cfg), 60); } catch (eU) {}
    // keep what is already known: a later execution that cannot reach the tab answers with this
    try {
      var props = PropertiesService.getScriptProperties();
      var was = props.getProperty(IST_CONFIG_LAST_GOOD_PROP);
      var nowJson = JSON.stringify(cfg);
      if (was !== nowJson) props.setProperty(IST_CONFIG_LAST_GOOD_PROP, nowJson);
    } catch (eW) { /* a config that cannot be remembered still answers today */ }
    IST_CONFIG_MEMO = cfg;
    istConfigLogProblems_(cfg);
    return cfg;
  }

  // the tab did not answer: last known, then the shipped floor — and said
  var last = null;
  try {
    var saved = PropertiesService.getScriptProperties().getProperty(IST_CONFIG_LAST_GOOD_PROP);
    if (saved) last = JSON.parse(saved);
  } catch (eR) { last = null; }

  if (last && typeof last === 'object') {
    IST_CONFIG_SOURCE = 'last known';
    IST_CONFIG_MEMO = last;
  } else {
    IST_CONFIG_SOURCE = 'shipped';
    var floor = {};
    IST_CONFIG_DEFAULTS.forEach(function (d) { floor[d.key] = String(d.value); });
    IST_CONFIG_MEMO = floor;
  }
  if (!IST_CONFIG_BLIND_LOGGED) {
    IST_CONFIG_BLIND_LOGGED = true;
    try {
      hubSysLog_('asa-hub:ist', 'ist_config_unreadable',
                 'the ' + IST_CONFIG_TAB + ' tab could not be read — serving the ' +
                 IST_CONFIG_SOURCE + ' copy; nothing about who owes a training changed',
                 { status: 200 });
    } catch (eLg) { /* the answer matters more than the note */ }
  }
  return IST_CONFIG_MEMO;
}

/** Where this execution's configuration came from: sheet · last known · shipped. */
function istConfigSource_() {
  if (!IST_CONFIG_MEMO) istConfig_();
  return IST_CONFIG_SOURCE || 'shipped';
}

/** True when the tab itself did not answer this execution. */
function istConfigBlind_() {
  return istConfigSource_() !== 'sheet';
}

/** Drop both caches after a write — the memo dies with the round trip. */
function istConfigBump_() {
  IST_CONFIG_MEMO = null;
  IST_CONFIG_SOURCE = '';
  IST_CONFIG_RESOLVED = null;
  try { CacheService.getScriptCache().remove(IST_CONFIG_CACHE_KEY); } catch (e) {}
}

/** The configuration this execution reads, resolved once per memo. */
function istConfigResolved_() {
  var cfg;
  try { cfg = istConfig_() || {}; } catch (e) { cfg = {}; }
  if (IST_CONFIG_RESOLVED && IST_CONFIG_RESOLVED.from === cfg) return IST_CONFIG_RESOLVED;
  var r = istConfigResolve_(cfg);
  IST_CONFIG_RESOLVED = { from: cfg, values: r.values, problems: r.problems };
  return IST_CONFIG_RESOLVED;
}

/** Every refused cell as {key: reason}, over a raw map (default: the tab as read). */
function istConfigProblems_(cfg) {
  return cfg ? istConfigResolve_(cfg).problems : istConfigResolved_().problems;
}

/** Logged when the set of refused cells changes — never on every fresh read. */
function istConfigLogProblems_(cfg) {
  try {
    var problems = istConfigProblems_(cfg);
    var keys = Object.keys(problems).sort();
    var print = keys.map(function (k) { return k + ': ' + problems[k]; }).join('; ');
    var props = PropertiesService.getScriptProperties();
    if (String(props.getProperty(IST_CONFIG_REFUSED_PROP) || '') === print) return;
    props.setProperty(IST_CONFIG_REFUSED_PROP, print);
    if (!keys.length) return;
    hubSysLog_('asa-hub:ist', 'ist_config_refused',
               keys.length + ' cell(s) refused, their usable entries or shipped values answer — ' + print,
               { status: 200 });
  } catch (e) { /* the answer matters more than the note */ }
}

// ------------------------------------------------------------------ THE READERS — a blank or refused cell answers…

/** One cell as text, as the declaration resolves it. */
function istCfgText_(key) {
  if (!istConfigSpec_(key)) {
    var cfg = {};
    try { cfg = istConfig_() || {}; } catch (e) { cfg = {}; }
    return String(cfg[key] == null ? '' : cfg[key]).trim();
  }
  return String(istConfigResolved_().values[key]);
}

/** One cell as a list. A cell that parses to nothing is not a list of nothing. */
function istCfgList_(key) {
  var out = istCfgBits_(istCfgText_(key));
  return out.length ? out : istCfgBits_(istConfigDefault_(key));
}

/** One cell as `a=b, c=d` pairs, in the order they are written. */
function istCfgPairs_(key) {
  return istCfgPairsOf_(istCfgText_(key)) ||
         istCfgPairsOf_(istConfigDefault_(key)) ||
         { map: {}, order: [] };
}

/** A whole number from a cell, inside the declared range (or the one given), or the shipped value. */
function istCfgInt_(key, min, max) {
  var spec = istConfigSpec_(key) || {};
  var lo = min !== undefined ? min : spec.min;
  var hi = max !== undefined ? max : spec.max;
  var fallback = parseInt(istConfigDefault_(key), 10);
  if (!isFinite(fallback)) fallback = 0;
  var n = istCfgIntValue_(key, istCfgText_(key));
  if (n === null) return fallback;
  if (lo !== undefined && n < lo) return fallback;
  if (hi !== undefined && n > hi) return fallback;
  return n;
}

/** A yes/no cell as a boolean. */
function istCfgYes_(key) {
  return String(istCfgText_(key)).trim().toLowerCase() === 'yes';
}

/** A choice cell, lowercased, always one of its allowed words. */
function istCfgChoice_(key) {
  var spec = istConfigSpec_(key) || {};
  var got = String(istCfgText_(key)).trim().toLowerCase();
  return (spec.allowed || []).indexOf(got) !== -1 ? got : istConfigDefault_(key);
}

/** Today in Ohio as YYYY-MM-DD — the day an IST lapse is counted on. */
function istOhioToday_() {
  try { return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

/** A completed IST still counts on day `ist_valid_days` after trainedAt; no date or 0 never lapses. */
function istLapsed_(trainedAt, today) {
  var days = istCfgInt_('ist_valid_days');
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(trainedAt || '').trim());
  if (!days || !m) return false;
  var t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today || istOhioToday_()));
  if (!t) return false;
  var dayOf = function (x) { return Date.UTC(+x[1], +x[2] - 1, +x[3]) / 86400000; };
  return dayOf(t) > dayOf(m) + days;
}

// ------------------------------------------------------------------ THE TWO DOORS…

// Read the configuration for Settings → IST and the IST screens.
HUB_POLICY.istConfigGet = {
  file: 'IstConfig.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.istConfigGet = function (payload, user) {
  if (!user || user.is_service || ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }
  // level the tab here: istConfig_ seeds nothing while the 60s cache is warm
  try { istConfigSheet_(); } catch (eSeed) { /* the values below still answer */ }
  var cfg = istConfig_();
  var source = istConfigSource_();
  var resolved = istConfigResolve_(cfg);

  var known = {};
  var rows = IST_CONFIG_DEFAULTS.map(function (d) {
    known[d.key] = true;
    var cell = cfg[d.key];
    return {
      key: d.key,
      // the RESOLVED value — what the platform uses: usable entries, or the shipped value
      value: resolved.values[d.key],
      raw: cell === undefined ? '' : String(cell),
      default_value: String(d.value),
      note: d.note,
      group: d.group || 'ist',
      type: d.type || 'text',
      min: d.min === undefined ? null : d.min,
      max: d.max === undefined ? null : d.max,
      allowed: d.allowed || null,
      keys: d.keys || null,
      values: d.values || null,
      placeholders: d.placeholders || null,
      value_pattern: d.value_pattern || null,
      // a cell the check refused: said, and answered by its usable entries or the shipped value
      problem: resolved.problems[d.key] || ''
    };
  });

  // a row only in the sheet is reported, never swallowed
  var extra = [];
  for (var k in cfg) {
    if (!Object.prototype.hasOwnProperty.call(cfg, k) || known[k]) continue;
    extra.push({ key: k, value: String(cfg[k]), note: 'This backend version does not read this key.' });
  }

  return { status: 200, data: {
    rows: rows,
    groups: IST_CONFIG_GROUPS,
    tints: IST_CONFIG_TINTS,
    unknown_rows: extra,
    tab: IST_CONFIG_TAB,
    source: source,
    blind: source !== 'sheet',
    blind_reason: source === 'sheet' ? ''
      : 'The ' + IST_CONFIG_TAB + ' tab could not be read. Showing the ' + source +
        ' configuration. Nothing about who owes a training changed — a failed read is not ' +
        'a person without training.'
  } };
};

/** Who may save: the master, or an admin wearing a badge the `ist` row of the settings badge matrix names (no row: any admin). */
function istConfigMayEdit_(user) {
  if (!user || user.is_service || String(user.role) !== 'admin') return false;
  try {
    if (typeof hubIsMaster_ === 'function' && hubIsMaster_(String(user.email || ''))) return true;
  } catch (eM) { /* not the master: the badge rule decides */ }
  var rule = [];
  try {
    var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), CONFIG_BADGE_TAB);
    for (var i = 0; i < rows.length; i++) {
      if (str_(rows[i].sectionid) !== 'ist') continue;
      rule = userTypesFromRaw_(rows[i].badges).types;
      break;
    }
  } catch (eR) { rule = []; }   // an unreadable matrix narrows nothing, as on screen
  if (!rule.length) return true;
  var worn = (typeof userBadgesWorn_ === 'function')
    ? userBadgesWorn_(user.types, user.role) : userTypesFromRaw_(user.types).types;
  return rule.some(function (b) { return worn.indexOf(b) !== -1; });
}

/** Refusals that need the people list: a coverage label that is somebody's name. */
function istConfigPeopleProblems_(values) {
  var guarded = IST_CONFIG_DEFAULTS.filter(function (d) {
    return d.people_guard && Object.prototype.hasOwnProperty.call(values, d.key) &&
           String(values[d.key] == null ? '' : values[d.key]).trim();
  });
  if (!guarded.length) return [];
  var names = [];
  try {
    withoutIspClients_(peopleMerged_(listRows_('people', {}))).forEach(function (p) {
      var n = String(p.name || '').trim();
      if (n) names.push(n);
    });
  } catch (e) { names = null; }
  if (!names || !names.length) {
    return guarded.map(function (d) {
      return d.key + ': the people list could not be read, so nothing proves no real person matches — ' +
             'nothing was written';
    });
  }
  var out = [];
  guarded.forEach(function (d) {
    istCfgBits_(values[d.key]).forEach(function (entry) {
      var up = entry.toUpperCase();
      var hit = names.filter(function (n) {
        var person = n.toUpperCase();
        return d.people_guard === 'contains' ? person.indexOf(up) !== -1 : person === up;
      });
      if (hit.length) {
        out.push(d.key + ': "' + entry + '" matches ' + hit.slice(0, 3).join(', ') +
                 (hit.length > 3 ? ' and ' + (hit.length - 3) + ' more' : '') +
                 ' in the people list — a coverage label may never be a real person');
      }
    });
  });
  return out;
}

/** Refusals that need the estate's book: a tab or a column the cells name that is not there. */
function istConfigEstateProblems_(values, stored) {
  var touches = ['ist_cert_source_tabs', 'ist_cert_source_fields'].filter(function (k) {
    return Object.prototype.hasOwnProperty.call(values, k);
  });
  if (!touches.length) return [];
  var after = {}, k;
  for (k in stored) if (Object.prototype.hasOwnProperty.call(stored, k)) after[k] = stored[k];
  for (k in values) if (Object.prototype.hasOwnProperty.call(values, k)) after[k] = values[k];
  var tabsOf = istCfgPairsOf_(istConfigResolveOne_('ist_cert_source_tabs', after.ist_cert_source_tabs, null).value) || { map: {} };
  var shippedTabs = istCfgPairsOf_(istConfigDefault_('ist_cert_source_tabs')).map;
  var fieldsOf = istCfgPairsOf_(istConfigResolveOne_('ist_cert_source_fields', after.ist_cert_source_fields, null).value) || { map: {} };
  var shippedFields = istCfgPairsOf_(istConfigDefault_('ist_cert_source_fields')).map;
  var masterCols = istCfgPairsOf_(istConfigResolveOne_('ist_cert_master_columns', after.ist_cert_master_columns,
                                                       istConfigCatalogueOf_(after)).value) || { order: [] };
  var ss;
  try { ss = ssOpen_(hubId_('CERT_SOURCE_ID')); } catch (eO) { ss = null; }
  if (!ss) {
    return touches.map(function (t) {
      return t + ': the estate\'s book could not be opened to confirm its tabs and columns — nothing was written';
    });
  }
  var out = [];
  var headers = {};
  ['trainings', 'mais', 'master'].forEach(function (which) {
    var tab = String(tabsOf.map[which] || shippedTabs[which] || '').trim();
    var sheet = null;
    try { sheet = ss.getSheetByName(tab); } catch (eS) { sheet = null; }
    if (!sheet) { out.push('ist_cert_source_tabs: the estate\'s book has no tab named "' + tab + '" (' + which + ')'); return; }
    var head = [];
    try { head = (sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || []).map(estateKey_); }
    catch (eH) { head = []; }
    headers[which] = head;
  });
  var has = function (which, spec) {
    var head = headers[which];
    if (!head) return true;   // the missing tab is already said
    return String(spec || '').split('|').some(function (alt) {
      return alt.split('+').every(function (c) { return head.indexOf(String(c).trim()) !== -1; });
    });
  };
  ['master.name', 'trainings.name', 'trainings.course', 'trainings.status', 'trainings.expires',
   'mais.name', 'mais.status', 'mais.expires', 'mais.category'].forEach(function (fact) {
    var spec = String(fieldsOf.map[fact] || shippedFields[fact] || '');
    if (!has(fact.split('.')[0], spec)) {
      out.push('ist_cert_source_fields: no column ' + spec.split('|').join(' or ') + ' in the ' +
               fact.split('.')[0] + ' tab (' + fact + ')');
    }
  });
  if (headers.master && !masterCols.order.some(function (c) { return headers.master.indexOf(c) !== -1; })) {
    out.push('ist_cert_source_tabs: the master tab carries none of the course date columns in ' +
             'ist_cert_master_columns — it is not the estate\'s Master');
  }
  return out;
}

// Save edited cells.
HUB_POLICY.istConfigSet = {
  file: 'IstConfig.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.istConfigSet = function (payload, user) {
  if (!istConfigMayEdit_(user)) return hubDenied_();
  var values = (payload && payload.values) || {};
  var known = {};
  IST_CONFIG_DEFAULTS.forEach(function (d) { known[d.key] = true; });

  var unknown = [];
  for (var uk in values) {
    if (Object.prototype.hasOwnProperty.call(values, uk) && !known[uk]) unknown.push(uk);
  }
  if (unknown.length) {
    return { status: 400, message: 'This backend version does not know: ' + unknown.join(', ') +
             ' — publish the latest Apps Script version and save again.' };
  }

  // the declaration first, against the cells as last read; the course list as THIS SAVE leaves it
  var refused = istConfigSaveProblems_(values, istConfig_());
  if (refused.length) return { status: 400, message: 'Not saved — ' + refused.join(' · ') };

  var sheet, data;
  try {
    sheet = istConfigSheet_();
    data = sheet.getDataRange().getValues();
  } catch (eRead) {
    return { status: 503, message: 'The ' + IST_CONFIG_TAB + ' tab could not be read, so nothing was ' +
             'written — a save into a tab nobody can read would be a change nobody can check.' };
  }
  var stored = {};
  for (var s = 1; s < data.length; s++) {
    var sk = String(data[s][0] || '').trim();
    if (sk) stored[sk] = String(data[s][1] == null ? '' : data[s][1]);
  }
  refused = istConfigSaveProblems_(values, stored)
    .concat(istConfigPeopleProblems_(values))
    .concat(istConfigEstateProblems_(values, stored));
  if (refused.length) return { status: 400, message: 'Not saved — ' + refused.join(' · ') };

  var lock = LockService.getScriptLock(), held = false;
  try { held = lock.tryLock(10000); } catch (eL) { held = false; }
  if (!held) return { status: 503, message: 'Another change to the ' + IST_CONFIG_TAB + ' tab is in progress — try again.' };
  var changed = 0;
  try {
    // rows are addressed from a read made inside the lock, never from an older copy
    data = sheet.getDataRange().getValues();
    var nextRow = data.length + 1;
    var put = function (row, v) {
      var cell = sheet.getRange(row, 2);
      // stored as text: 'TRUE' or '1/2' must read back as typed, not as a boolean or a date
      if (typeof cell.setNumberFormat === 'function') cell.setNumberFormat('@');
      cell.setValue(hubCellSafe_(v));
    };
    for (var key in values) {
      if (!Object.prototype.hasOwnProperty.call(values, key) || !known[key]) continue;
      var v = String(values[key] == null ? '' : values[key]);
      var found = false;
      // every row with this key: the reader takes the last, so a duplicate would hide the save
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][0]).trim() === key) { put(r + 1, v); found = true; }
      }
      if (!found) {
        var def = istConfigSpec_(key);
        sheet.appendRow([key, '', def ? def.note : '']);
        put(nextRow, v);
        nextRow++;
      }
      changed++;
    }
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* released at exit */ }
  }
  istConfigBump_();
  hubSysLog_(user && user.email, 'ist_config_set', changed + ' key(s) updated', { status: 200 });
  return { status: 200, data: { saved: changed,
    message: changed + ' key(s) saved to the ' + IST_CONFIG_TAB + ' tab. Apps Script reads the ' +
             'new value from now on — no publish needed.' } };
};
