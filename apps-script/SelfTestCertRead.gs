/** Certificate reading: an uploaded paper's dates are read by the decoder and kept on its own ledger row only; the eye opens the caller's own document (the master's any) through the platform, never a link, and only as a PDF or a picture; only the master confirms a date into the record. The ledger, the roster, the accounts, Drive, the Master and the decoder's words book are stood in for. */
function stCertRead_(out) {
  var keep = { rows: complianceDocsRows_, people: complianceDocsPeople_, accounts: complianceDocsAccounts_,
               patch: complianceDocsPatch_, fileRead: complianceDocsFileRead_, paper: digestReadPaper_,
               store: complianceDocsStore_, folder: complianceDocsSharedFolder_, mode: hubTestModeOn_,
               driveFile: complianceDocsDriveFile_,
               readRow: complianceDocsReadRow_, masterNow: complianceMasterNow_,
               masterWrite: complianceWriteMasterDate_, reqs: requirementsAll_, onStaff: cgBlockStatuses_,
               verdict: certReadVerdict_, catalog: filesCatalog_,
               master: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX, roster: DIGEST_ROSTER, vocab: DIGEST_VOCAB,
               vocabRows: digestVocabRows_, cacheSvc: CacheService, bump: staffProfilesBump_ };
  var TODAY = '2026-09-27';
  var CPR = 'American Red Cross Training Services\nCertificate of Completion\nAnn Able\n' +
            'has successfully completed requirements for\nAdult First Aid/CPR/AED\n' +
            'Date Completed: 4/17/2026\nValid Until: 4/17/2028\nConducted by: Angels In Mission';
  var DODD = 'Ohio Department of Developmental Disabilities\nDODD Certification\nDirect Support Professional\n' +
             'Ann Able\nCertification Number CI 12345\nCompleted: 08/01/2026';
  var MANDT = 'The Mandt System\nCrisis Prevention and De-escalation Training\nAnn Able\n' +
              'has completed Relational and Technical Mandt training\nCompleted: 06/02/2026';
  var BEN = CPR.replace('Ann Able', 'Ben Baker');
  var CPR_ONE_DATE = 'American Heart Association\nHeartsaver CPR AED\nAnn Able\nIssue Date: 03/14/2026';
  var MED2 = 'Ohio Department of Developmental Disabilities\nMedication Administration Certification\nCategory 2\n' +
             'Ann Able\nEffective Date: 01/31/2026\nExpiration Date: 01/31/2027';
  var GRID = 'DODD Personnel\nAnn Able\nCertification Type Effective Expiration Status\n' +
             'Cat - I 12/17/2025 12/17/2026 Certified\nCat - II 01/10/2024 01/10/2025 Expired\n' +
             'Cat - III 06/10/2026 06/10/2027 Certified';
  var UNKNOWN_NAME = 'American Red Cross Training Services\nCertificate of Completion\nName: Test Person\n' +
                     'Adult First Aid/CPR/AED\nDate Completed: 4/17/2026\nValid Until: 4/17/2028';
  // an abstract prints the licence's expiry beside the day it was drawn
  var ABSTRACT = 'Ohio Bureau of Motor Vehicles\nUnofficial 2-Year Driving Record\nAnn Able\n' +
                 'License Status as of: 09/20/2026\nLicense Class: D\nLicense Expiration: 04/17/2029\n' +
                 'No convictions are on this record';
  var ABSTRACT_NO_DAY = 'Ohio Bureau of Motor Vehicles\nUnofficial 2-Year Driving Record\nAnn Able\n' +
                        'License Expiration: 04/17/2029\nNo convictions are on this record';
  // the licence's own issue day printed above the day the record was drawn
  var ABSTRACT_BOTH = 'Ohio Bureau of Motor Vehicles\nUnofficial 2-Year Driving Record\nAnn Able\n' +
                      'License Issue Date: 03/01/2025\nRecord Date: 09/20/2026\nLicense Expiration: 04/17/2029';
  var ABSTRACT_LICENCE_DAYS = 'Ohio Bureau of Motor Vehicles\nUnofficial 2-Year Driving Record\nAnn Able\n' +
                              'Issue Date: 03/01/2025\nExpiration Date: 04/17/2029\nNo convictions';
  var ABSTRACT_ISSUED = 'Ohio Bureau of Motor Vehicles\nUnofficial 2-Year Driving Record\nAnn Able\n' +
                        'Date Issued: 09/20/2026\nNo convictions are on this record';
  var LICENCE = 'OHIO\nDriver License\nANN ABLE\nDOB 01/02/1990\nISS 03/01/2025\nEXP 04/17/2029\nClass D\n' +
                'Bureau of Motor Vehicles';
  // one category's certificate, no grid: the category line is the paper naming itself
  var MED1 = 'Ohio Department of Developmental Disabilities\nMedication Administration Certification\nCategory 1\n' +
             'Ann Able\nEffective Date: 01/31/2026\nExpiration Date: 01/31/2027';
  var MED_NO_CATEGORY = 'Ohio Department of Developmental Disabilities\nMedication Administration Certification\n' +
                        'Ann Able\nEffective Date: 01/31/2026\nExpiration Date: 01/31/2027';
  var MANDT_CERT = 'The Mandt System\nCertificate of Completion\nAnn Able\nRelational and Technical Mandt training\n' +
                   'Completed: 06/02/2026\nExpires: 06/02/2027';
  var req = function (id) {
    return REQUIREMENTS_CATALOG.filter(function (r) { return r.req_id === id; })[0];
  };
  var paper = function (text) { return digestPaperFromText_(text, 'upload.jpg', TODAY); };
  var verdict = function (id, text, subject) { return certReadVerdict_(req(id), paper(text), subject); };

  var roster = [
    { id: 'p-ann', name: 'Ann Able', email: 'ann.roster@example.org', status: 'Active',
      createdAt: '2025-06-01T00:00:00.000Z' },
    { id: 'p-ben', name: 'Ben Baker', status: 'Active' }
  ];
  var acct = function (id, name, email, extra) {
    var row = { userid: id, displayname: name, email: email, peopleid: '', active: 'TRUE', mergedinto: '' };
    Object.keys(extra || {}).forEach(function (k) { row[k] = extra[k]; });
    return row;
  };
  var accounts = [
    acct('u-ann', 'Annie', 'ann@example.org', { peopleid: 'people:p-ann',
                                                contactsources: JSON.stringify({ people_id: 'name' }) }),
    acct('u-ben', 'Ben Baker', 'ben@example.org'),
    acct('u-boss', 'Platform', 'boss@example.org'),
    acct('u-ada', 'Ada Admin', 'ada@example.org')
  ];
  var who = function (id, name, email, role, extra) {
    var u = { id: id, email: email, display_name: name, role: role };
    Object.keys(extra || {}).forEach(function (k) { u[k] = extra[k]; });
    return u;
  };
  var ann = who('u-ann', 'Annie', 'ann@example.org', 'staff', { people_id: 'people:p-ann' });
  var boss = who('u-boss', 'Platform', 'boss@example.org', 'admin');
  var ada = who('u-ada', 'Ada Admin', 'ada@example.org', 'admin');
  var visitBoss = who('u-boss', 'Ann Able', 'boss@example.org', 'admin',
                      { visiting_member: 'mem_selftest', acting_for: 'u-boss' });
  var ledger = [];
  var reset = function () {
    ledger = [
      { id: 'k1', person: 'Ann Able', cert: 'CPR / First Aid', name: 'card.jpg',
        url: 'https://drive.google.com/file/d/FILE_ann_card_1/view', by: 'ann@example.org', at: '2026-09-01T10:00:00Z',
        fileid: 'FILE_ann_card_1', reqid: 'cpr', readstate: 'pending', readtries: '' },
      { id: 'k2', person: 'Ben Baker', cert: 'DODD 8-Hour', name: 'ben.pdf',
        url: 'https://drive.google.com/file/d/FILE_ben_dodd_2/view', by: 'ben@example.org', at: '2026-09-02T10:00:00Z',
        fileid: 'FILE_ben_dodd_2', reqid: 'dodd', readstate: 'read', readkind: 'dodd_certification',
        issuedon: '2026-08-01', expireson: '2027-08-01', readhow: 'derived:12m', readconfidence: '88' },
      { id: 'k3', person: 'Ann Able', cert: 'Med Delivery 1', name: 'med.pdf', url: '', at: '2026-09-03T10:00:00Z',
        fileid: 'FILE_ann_med_3', reqid: 'med1', readstate: 'pending' },
      { id: 'k4', person: 'Ann Able', cert: 'MAIS Certification', name: 'mais.pdf', url: '', at: '2026-09-04T10:00:00Z',
        fileid: 'FILE_ann_mais_4', reqid: 'mais', readstate: 'pending' },
      { id: 'k5', person: 'Ann Able', cert: 'CPR / First Aid', name: 'old.jpg',
        url: 'https://drive.google.com/file/d/OLDFILE_ann_card_5/view', by: 'ann@example.org', at: '2026-01-05T10:00:00Z' },
      { id: 'k6', person: 'Ann Able', cert: 'DODD 8-Hour', name: 'dodd.pdf', url: '', at: '2026-09-06T10:00:00Z',
        fileid: 'FILE_ann_dodd_6', reqid: 'dodd', readstate: 'unread', readwhy: 'No expiry date could be read from this file.' },
      { id: 'k9', person: 'Ann Able', cert: 'Driver\'s Abstract', name: 'abstract.pdf', url: '', at: '2026-09-09T10:00:00Z',
        fileid: 'FILE_ann_abs_9', reqid: 'drive_abstract', readstate: 'pending', rosterid: 'p-ann' },
      // filed for a roster row since gone, under a name a later hire carries
      { id: 'k10', person: 'Ann Able', cert: 'CPR / First Aid', name: 'earlier.jpg', url: '', at: '2025-02-10T10:00:00Z',
        fileid: 'FILE_earlier_10', reqid: 'cpr', readstate: 'read', rosterid: 'p-gone' },
      { id: 'k11', person: 'Ann Able', cert: 'CPR / First Aid', name: 'mine.jpg', url: '', at: '2026-09-11T10:00:00Z',
        fileid: 'FILE_ann_card_11', reqid: 'cpr', readstate: 'read', rosterid: 'people:p-ann' },
      // an older row, no roster id, filed before the caller's roster row was created
      { id: 'k12', person: 'Ann Able', cert: 'CPR / First Aid', name: 'before.jpg', url: '', at: '2024-11-01T10:00:00Z',
        fileid: 'FILE_before_12', reqid: '', readstate: '' },
      // stored with a type the eye never draws
      { id: 'k13', person: 'Ann Able', cert: 'CPR / First Aid', name: 'card.pdf', url: '', at: '2026-09-13T10:00:00Z',
        fileid: 'FILE_html_13', reqid: 'cpr', readstate: 'unread', rosterid: 'p-ann' },
      // an older row filed before the roster row was made again, from the caller's own sign-in
      { id: 'k14', person: 'Ann Able', cert: 'DODD 8-Hour', name: 'own.pdf', url: '', at: '2024-10-01T10:00:00Z',
        by: ' ANN@example.org', fileid: 'FILE_ann_own_14', reqid: '', readstate: '' }
    ];
  };
  var storedTypes = { FILE_html_13: 'text/html' };
  var iter = function (list) {
    var i = 0;
    return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
  };
  var folderIn = function (name, parent) {
    return { getName: function () { return name; }, getParents: function () { return iter(parent ? [parent] : []); } };
  };
  var home = folderIn('Compliance Docs', folderIn('Platform', null));
  // every ledger file stands in Compliance Docs/<cert> unless a check says otherwise
  var filedHere = function () { return { getParents: function () { return iter([folderIn('CPR / First Aid', home)]); } }; };
  var patches = [], files = [], reads = [], stored = [], copies = 0, masterWrites = [], swept = [];
  var nowValue = '2026-08-01', paperText = CPR, paperFails = false;
  try {
    // the code's own decoder tables, whatever the live words book says
    DIGEST_VOCAB = { kinds: [], categories: [], labels: [], issuers: [], orgs: [], drawers: [], credentials: [],
                     answers: [], expects: [], zip: {}, types: {}, settings: {}, bad: 0, source: 'seed', v: 'seed' };
    DIGEST_ROSTER = [{ id: 'people:p-ann', name: 'ann able', display: 'Ann Able', kind: 'staff' },
                     { id: 'people:p-ben', name: 'ben baker', display: 'Ben Baker', kind: 'staff' }];
    requirementsAll_ = function () { return { source: 'fallback', rows: REQUIREMENTS_CATALOG.slice() }; };
    // the renewal rule's floor, whatever the live document catalogue says
    filesCatalog_ = function () { return []; };
    HUB_MASTER_EMAIL_CACHE = 'boss@example.org';
    HUB_MEMBER_CTX = null;
    cgBlockStatuses_ = function () { return { active: true, admin: true }; };
    complianceDocsPeople_ = function () { return roster; };
    complianceDocsAccounts_ = function () { return accounts; };
    complianceDocsRows_ = function () { return ledger.map(function (r) { return JSON.parse(JSON.stringify(r)); }); };
    complianceDocsPatch_ = function (id, fields) {
      patches.push({ id: id, fields: fields });
      var row = ledger.filter(function (r) { return r.id === id; })[0];
      if (!row) return false;
      Object.keys(fields).forEach(function (k) {
        var v = fields[k];
        row[normKey_(k)] = typeof v === 'string' ? v.replace(/^'/, '') : v;
      });
      return true;
    };
    complianceDocsDriveFile_ = filedHere;
    complianceDocsFileRead_ = function (fileId) {
      files.push(fileId);
      return { name: 'card.jpg', mime: storedTypes[fileId] || 'image/jpeg', size: 3, b64: 'QUJD' };
    };
    digestReadPaper_ = function (fileId, mime, name) {
      reads.push(fileId);
      if (paperFails) return { state: 'error', why: 'Drive answered 500', chars: 0 };
      return digestPaperFromText_(paperText, name, TODAY);
    };
    complianceMasterNow_ = function (person, field) {
      return { ok: true, value: nowValue, why: '', person: person, field: field };
    };
    complianceWriteMasterDate_ = function (person, field, value, expected, user) {
      masterWrites.push([person, field, value, str_(expected), user.email].join('|'));
      return { ok: true };
    };

    // --- what the paper says, against what its requirement asks ---
    var good = verdict('cpr', CPR, 'p-ann');
    stEq_(out, 'cert reading: a CPR card naming its own person reads its expiry, anchored to the row\'s roster id',
          [good.state, good.kind, good.expires_on, good.how, good.person_source].join(' '),
          'read cpr_first_aid 2028-04-17 paper document');
    stAssert_(out, 'cert reading: that reading clears the decoder\'s own settling floor',
              good.confidence >= 85, String(good.confidence));
    stEq_(out, 'cert reading: a DODD paper on the CPR row is a kind mismatch, in words',
          verdict('cpr', DODD, 'p-ann').why, 'This reads as a DODD certificate, not a CPR / First Aid.');
    var dodd = verdict('dodd', DODD, 'p-ann');
    stEq_(out, 'cert reading: a DODD certificate prints its completion day, and its expiry follows the renewal rule',
          [dodd.state, dodd.issued_on, dodd.expires_on, dodd.how].join(' '), 'read 2026-08-01 2027-08-01 derived:12m');
    var mandt = verdict('mandt', MANDT, 'p-ann');
    stEq_(out, 'cert reading: a dated requirement whose paper carries no expiry is unread, and says so',
          mandt.state + ' ' + mandt.why, 'unread ' + CERT_READ_WORDS.noExpiry);
    stEq_(out, 'cert reading: an expiry worked out from another kind\'s renewal rule never stands on a row that asks ' +
          'no kind', verdict('money', CPR_ONE_DATE, 'p-ann').why, CERT_READ_WORDS.noExpiry);
    stEq_(out, 'cert reading: a paper naming another roster person is unread',
          verdict('cpr', BEN, 'p-ann').why, CERT_READ_WORDS.someone);
    stEq_(out, 'cert reading: a paper naming a roster person cannot stand for a row filed under no settled roster row',
          verdict('cpr', CPR, '').why, CERT_READ_WORDS.someone);
    var aboutClient = paper(CPR);
    aboutClient.who = 'client:jane_doe';
    stEq_(out, 'cert reading: a paper about a client is nobody\'s staff record',
          certReadVerdict_(req('cpr'), aboutClient, 'p-ann').why, CERT_READ_WORDS.someone);
    stEq_(out, 'cert reading: a roster id is compared bare, whichever way the ledger spells it',
          certReadVerdict_(req('cpr'), paper(CPR), 'people:p-ann').state, 'read');
    var lone = verdict('cpr', UNKNOWN_NAME, 'p-ann');
    stEq_(out, 'cert reading: a name the roster does not know refuses nothing; the row\'s own anchor stands',
          lone.state + ' ' + lone.person_source, 'read ledger');
    var low = certReadVerdict_(req('cpr'), { state: 'read', chars: 30, kind: 'cpr_first_aid', kind_score: 12,
      expires_on: '2027-01-01', expires_source: 'paper', facts: { chars: 30, doc_kind: 'cpr_first_aid',
      category: 'certification_training', category_source: 'doc_kind' } }, '');
    stAssert_(out, 'cert reading: a reading under the settling floor is unread, with its number',
              low.state === 'unread' && /not sure enough/.test(low.why) && low.confidence < 85, JSON.stringify(low));
    stEq_(out, 'cert reading: a HEIC photo is unread, and the words say which format can be read',
          certReadVerdict_(req('cpr'), { state: 'heic', chars: 0 }, 'p-ann').why, CERT_READ_WORDS.heic);
    stEq_(out, 'cert reading: a file with no words is unread', verdict('cpr', '', 'p-ann').why, CERT_READ_WORDS.empty);
    stEq_(out, 'cert reading: a Category 2 certificate on the Med Delivery 1 row is a mismatch',
          verdict('med1', MED2, 'p-ann').why, 'This reads as a Category 2 medication certificate, not a Med Delivery 1.');
    var grid = verdict('med1', GRID, 'p-ann');
    stEq_(out, 'cert reading: a certification grid gives each category its own line — Cat I\'s expiry, never Cat III\'s',
          [grid.state, grid.expires_on, grid.how].join(' '), 'read 2026-12-17 grid');
    stEq_(out, 'cert reading: the date each record keeps is an expiry, the document\'s own date (the abstract\'s), ' +
          'or none', ['dodd', 'cpr', 'money', 'driver_license', 'drive_abstract', 'mais'].map(function (id) {
            return id + ':' + (complianceDocsDateRole_(req(id)) || '-');
          }).join(' '), 'dodd:expires cpr:expires money:expires driver_license:expires drive_abstract:issued mais:-');
    var abs = verdict('drive_abstract', ABSTRACT, 'p-ann');
    stEq_(out, 'cert reading: an abstract reads as the day it was drawn, and the licence expiry it prints is never ' +
          'taken as its own', [abs.state, abs.issued_on, abs.expires_on || '-', abs.how].join(' '),
          'read 2026-09-20 - issued:report');
    var both = verdict('drive_abstract', ABSTRACT_BOTH, 'p-ann');
    stEq_(out, 'cert reading: an abstract printing the licence\'s own issue day beside its record date reads the record ' +
          'date, never the licence\'s', [both.state, both.issued_on, both.expires_on || '-', both.how].join(' '),
          'read 2026-09-20 - issued:report');
    var licenceDays = verdict('drive_abstract', ABSTRACT_LICENCE_DAYS, 'p-ann');
    stEq_(out, 'cert reading: an abstract that prints a licence\'s issue and expiry days and no day of its own is ' +
          'unread, and keeps no issue day', [licenceDays.state, licenceDays.issued_on || '-', licenceDays.why].join(' '),
          'unread - ' + CERT_READ_WORDS.noRecordDay);
    stEq_(out, 'cert reading: an abstract whose only date is a licence expiry is unread, and says so',
          verdict('drive_abstract', ABSTRACT_NO_DAY, 'p-ann').why, CERT_READ_WORDS.noRecordDay);
    var issuedAbs = verdict('drive_abstract', ABSTRACT_ISSUED, 'p-ann');
    stEq_(out, 'cert reading: an abstract that prints only the day it was issued, and no licence date, reads that day',
          [issuedAbs.state, issuedAbs.issued_on, issuedAbs.how].join(' '), 'read 2026-09-20 issued:forward');
    stEq_(out, 'cert reading: a licence on the abstract row is a kind mismatch — its issue day is never the abstract\'s',
          verdict('drive_abstract', LICENCE, 'p-ann').why, 'This reads as a driver\'s license, not a Driver\'s Abstract.');
    stEq_(out, 'cert reading: a CPR card on an I-9 row is a kind mismatch, never the I-9 document\'s expiry',
          verdict('i9_type_1', CPR, 'p-ann').why, 'This reads as a CPR / First Aid card, not an I-9 Type 1.');
    var i9 = verdict('i9_type_2', LICENCE, 'p-ann');
    stEq_(out, 'cert reading: a driver\'s licence on an I-9 row reads its expiry',
          [i9.state, i9.kind, i9.expires_on].join(' '), 'read drivers_licence 2029-04-17');
    stAssert_(out, 'cert reading: both I-9 rows ask an identity paper the I-9 accepts',
              ['i9_type_1', 'i9_type_2'].every(function (id) {
                return CERT_READ_KINDS[id].join() === 'drivers_licence,state_id,passport,work_authorization,ssn_card,' +
                                                       'birth_certificate';
              }), '');
    var noExpiryPaper = function (kind, expires) {
      return { state: 'read', chars: 120, kind: kind, kind_score: 14, expires_on: expires || '',
               expires_source: expires ? 'paper' : '', facts: {} };
    };
    var ssCard = certReadVerdict_(req('i9_type_2'), noExpiryPaper('ssn_card', ''), 'p-ann');
    var ssMisread = certReadVerdict_(req('i9_type_1'), noExpiryPaper('ssn_card', '2031-01-01'), 'p-ann');
    var birth = certReadVerdict_(req('i9_type_2'), noExpiryPaper('birth_certificate', ''), 'p-ann');
    stAssert_(out, 'cert reading: a Social Security card or a birth certificate on an I-9 row is the right paper with ' +
              'no expiry to give — it says so rather than reading as a failed scan, keeps no expiry even when one ' +
              'was read off it, and hands the date to HR',
              ssCard.state === 'unread' && ssCard.why === 'A Social Security card carries no expiry, so it gives this ' +
              'record no date — HR confirms the date.' && ssMisread.state === 'unread' && ssMisread.expires_on === '' &&
              ssMisread.why === ssCard.why && birth.why === 'A birth certificate carries no expiry, so it gives this ' +
              'record no date — HR confirms the date.', JSON.stringify([ssCard, ssMisread, birth]));
    var ssOther = noExpiryPaper('ssn_card', '');
    ssOther.who = 'people:p-ben';
    stEq_(out, 'cert reading: …and a card naming someone else still says so first',
          certReadVerdict_(req('i9_type_2'), ssOther, 'p-ann').why, CERT_READ_WORDS.someone);
    var med1 = verdict('med1', MED1, 'p-ann');
    stEq_(out, 'cert reading: a single-category medication certificate reads its expiry on its own row — its category ' +
          'line is the paper naming itself', [med1.state, med1.expires_on].join(' '), 'read 2027-01-31');
    stEq_(out, 'cert reading: the same certificate on another category\'s row is a mismatch',
          verdict('med2', MED1, 'p-ann').why, 'This reads as a Category 1 medication certificate, not a Med Delivery 2.');
    stAssert_(out, 'cert reading: a medication certificate with no category line still reads only faintly',
              /reads only faintly/.test(verdict('med1', MED_NO_CATEGORY, 'p-ann').why), '');
    var mandtCert = verdict('mandt', MANDT_CERT, 'p-ann');
    stEq_(out, 'cert reading: a Mandt certificate of completion reads as crisis prevention, with its expiry',
          [mandtCert.state, mandtCert.kind, mandtCert.expires_on].join(' '), 'read crisis_prevention 2027-06-02');
    var pure =[certReadVerdict_, digestPaperFromText_].map(stCode_).join('\n');
    stAssert_(out, 'cert reading: the verdict and the reading of words touch no sheet, file or sender',
              !/SpreadsheetApp|DriveApp|UrlFetchApp|appendRow|setValue|hubSysLog_|rpcSend_|MailApp/.test(pure), '');

    // --- the eye: the caller's own document, the master's any, never a link ---
    reset();
    var mine = HUB_ACTIONS.certDocFile({ id: 'k1' }, ann);
    stAssert_(out, 'cert reading: the owner opens their own document — its bytes, and no link of any kind',
              mine.status === 200 && mine.data.b64 === 'QUJD' && files.join() === 'FILE_ann_card_1' &&
              !/drive\.google|url/i.test(JSON.stringify(mine)), JSON.stringify(mine));
    files = [];
    var theirs = HUB_ACTIONS.certDocFile({ id: 'k2' }, ann);
    stAssert_(out, 'cert reading: someone else\'s document is refused in words that name nobody, and never opened',
              theirs.status === 403 && theirs.message === CERT_READ_WORDS.notYours && files.length === 0,
              JSON.stringify(theirs));
    var nothing = HUB_ACTIONS.certDocFile({ id: 'nope' }, ann);
    stAssert_(out, 'cert reading: an id that is on no row answers the same words — a guess learns nothing',
              nothing.status === 403 && nothing.message === CERT_READ_WORDS.notYours, JSON.stringify(nothing));
    stAssert_(out, 'cert reading: the master opens any document',
              HUB_ACTIONS.certDocFile({ id: 'k2' }, boss).status === 200 && files.join() === 'FILE_ben_dodd_2', '');
    files = [];
    stAssert_(out, 'cert reading: a visit that wears the master\'s e-mail opens nothing of anybody\'s',
              HUB_ACTIONS.certDocFile({ id: 'k2' }, visitBoss).status !== 200 && files.length === 0, '');
    HUB_ACTIONS.certDocFile({ id: 'k5' }, ann);
    stEq_(out, 'cert reading: an older row with no file column is opened by the id inside its link',
          files.join(), 'OLDFILE_ann_card_5');

    // --- the eye answers a PDF or a picture only: the SPA frames it on the platform's own origin ---
    var html = HUB_ACTIONS.certDocFile({ id: 'k13' }, ann);
    var htmlBoss = HUB_ACTIONS.certDocFile({ id: 'k13' }, boss);
    stAssert_(out, 'cert reading: a file stored as a type the eye never draws is refused to its owner and the master ' +
              'alike, and no bytes are answered', html.status === 415 && html.message === CERT_READ_WORDS.unshown &&
              !('data' in html) && htmlBoss.status === 415 && !('data' in htmlBoss), JSON.stringify([html, htmlBoss]));
    stAssert_(out, 'cert reading: the eye reads a file\'s type before its bytes, and answers it only as that type',
              /complianceDocsShownType_\(stored, name\)[\s\S]*getBlob/.test(stCode_(keep.fileRead)) &&
              /mime: shown/.test(stCode_(HUB_ACTIONS.certDocFile)), '');
    stEq_(out, 'cert reading: the type the eye answers — HTML, XHTML and SVG never; an older file stored with no type by ' +
          'its name; JPEG under either name', [
            complianceDocsShownType_('text/html', 'card.pdf'), complianceDocsShownType_('application/xhtml+xml', 'x.png'),
            complianceDocsShownType_('image/svg+xml', 'x.svg'), complianceDocsShownType_('application/octet-stream', 'old.jpg'),
            complianceDocsShownType_('', 'old.html'), complianceDocsShownType_('image/jpg', 'a'),
            complianceDocsShownType_('application/pdf', 'a')
          ].join(','), ',,,image/jpeg,,image/jpeg,application/pdf');

    // --- the ledger's file id is followed only into the compliance folder ---
    reset();
    var touched = [];
    var driveFile = function (id, parent) {
      return { getParents: function () { return iter(parent ? [parent] : []); },
               getSize: function () { touched.push('size:' + id); return 3; },
               getName: function () { return 'card.jpg'; }, getMimeType: function () { return 'image/jpeg'; },
               getBlob: function () { touched.push('bytes:' + id); return { getBytes: function () { return [65, 66, 67]; } }; } };
    };
    var drive = {
      FILE_ann_card_1: driveFile('FILE_ann_card_1', folderIn('CPR / First Aid', home)),
      FILE_ben_dodd_2: driveFile('FILE_ben_dodd_2', folderIn('Payroll', folderIn('Finance', null))),
      FILE_ann_med_3: driveFile('FILE_ann_med_3', null)
    };
    var stubRead = complianceDocsFileRead_, homeFile = null, strayFile = null, orphanFile = null;
    complianceDocsDriveFile_ = function (id) { return drive[id]; };
    complianceDocsFileRead_ = keep.fileRead;
    try {
      homeFile = HUB_ACTIONS.certDocFile({ id: 'k1' }, ann);
      strayFile = HUB_ACTIONS.certDocFile({ id: 'k2' }, boss);
      orphanFile = HUB_ACTIONS.certDocFile({ id: 'k3' }, boss);
    } finally { complianceDocsDriveFile_ = filedHere; complianceDocsFileRead_ = stubRead; }
    stAssert_(out, 'cert reading: a file in Compliance Docs/<cert> is answered; a row pointed at a file anywhere else ' +
              'the account can read, or at one in no folder, answers no bytes to anybody — the master included — ' +
              'and neither its size nor its bytes are read',
              homeFile.status === 200 && homeFile.data.b64 === 'QUJD' && strayFile.status === 404 &&
              strayFile.message === CERT_READ_WORDS.stray && !('data' in strayFile) && orphanFile.status === 404 &&
              touched.join() === 'size:FILE_ann_card_1,bytes:FILE_ann_card_1',
              JSON.stringify([homeFile, strayFile, orphanFile, touched]));

    // --- an older row carries no roster id: it is the caller's only when filed after their roster row was created ---
    reset(); files = [];
    var before = HUB_ACTIONS.certDocFile({ id: 'k12' }, ann);
    var annIds = function () {
      return (HUB_ACTIONS.certUploadsList({}, ann).data.uploads || []).map(function (u) { return u.id; });
    };
    var listedNow = annIds();
    stAssert_(out, 'cert reading: an older row filed before the caller\'s roster row was created is someone else\'s — ' +
              'refused in words that name nobody, never opened, and left out of the list',
              before.status === 403 && before.message === CERT_READ_WORDS.notYours && files.length === 0 &&
              listedNow.indexOf('k12') === -1 && listedNow.indexOf('k5') !== -1, JSON.stringify([before, listedNow]));
    files = [];
    var ownSignIn = HUB_ACTIONS.certDocFile({ id: 'k14' }, ann);
    stAssert_(out, 'cert reading: an older row filed before the roster row was made again, but from the caller\'s own ' +
              'sign-in, is theirs — listed and opened', ownSignIn.status === 200 && files.join() === 'FILE_ann_own_14' &&
              listedNow.indexOf('k14') !== -1, JSON.stringify([ownSignIn, listedNow]));
    roster[0].createdAt = '';
    var ageless = null, agelessBefore = null, agelessList = [], agelessStamped = null, agelessEarlier = null;
    files = [];
    try {
      ageless = HUB_ACTIONS.certDocFile({ id: 'k5' }, ann);
      agelessBefore = HUB_ACTIONS.certDocFile({ id: 'k12' }, ann);
      agelessList = annIds();
      agelessStamped = HUB_ACTIONS.certDocFile({ id: 'k11' }, ann);
      agelessEarlier = HUB_ACTIONS.certDocFile({ id: 'k10' }, ann);
    } finally { roster[0].createdAt = '2025-06-01T00:00:00.000Z'; }
    stAssert_(out, 'cert reading: with no creation day on the roster row (the live roster keeps none) an older row is ' +
              'the name\'s, as the list always gave it — listed and opened by its own person; a row stamped for ' +
              'another roster row is still refused',
              ageless.status === 200 && agelessBefore.status === 200 &&
              files.join() === 'OLDFILE_ann_card_5,FILE_before_12,FILE_ann_card_11' &&
              agelessList.indexOf('k5') !== -1 && agelessList.indexOf('k12') !== -1 && agelessStamped.status === 200 &&
              agelessEarlier.status === 403 && agelessEarlier.message === CERT_READ_WORDS.notYours,
              JSON.stringify([ageless, agelessBefore, agelessList, agelessStamped, agelessEarlier]));
    stAssert_(out, 'cert reading: the eye and the list follow one rule — the eye asks the list\'s own test and adds no ' +
              'rule of its own about an older row', /complianceDocsMine_\(row, self\)/.test(stCode_(complianceDocsOwnRow_)) &&
              stCode_(complianceDocsOwnRow_).indexOf('complianceDocsFiledSince_') === -1, '');
    files = [];
    stAssert_(out, 'cert reading: the master opens an older row whatever its age',
              HUB_ACTIONS.certDocFile({ id: 'k12' }, boss).status === 200 && files.join() === 'FILE_before_12', '');

    // --- an open visit wears the visited account: it is neither that person nor the master ---
    reset(); files = []; reads = []; patches = [];
    var visitAnn = who('u-ann', 'Annie', 'ann@example.org', 'staff',
                       { people_id: 'people:p-ann', visiting_member: 'mem_selftest', acting_for: 'u-ann' });
    var visitFile = null, visitRead = null, visitList = null;
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-ann', email: 'ann@example.org' };
    try {
      visitFile = HUB_ACTIONS.certDocFile({ id: 'k1' }, visitAnn);
      visitRead = HUB_ACTIONS.certDocRead({ id: 'k1' }, visitAnn);
      visitList = HUB_ACTIONS.certUploadsList({}, visitAnn);
    } finally { HUB_MEMBER_CTX = null; }
    stAssert_(out, 'cert reading: an admin visiting a staff member opens none of their documents and reads none — ' +
              'refused in words that name nobody, no file read and no row patched',
              visitFile.status === 403 && visitFile.message === CERT_READ_WORDS.notYours && visitRead.status === 403 &&
              files.length === 0 && reads.length === 0 && patches.length === 0, JSON.stringify([visitFile, visitRead]));
    var flagOnly = HUB_ACTIONS.certDocFile({ id: 'k1' }, visitAnn);
    stAssert_(out, 'cert reading: the visit mark on the session alone refuses too',
              flagOnly.status === 403 && files.length === 0, JSON.stringify(flagOnly));
    var visitMaster = null;
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-ann', email: 'ann@example.org' };
    try { visitMaster = HUB_ACTIONS.certUploadsList({}, boss); } finally { HUB_MEMBER_CTX = null; }
    stAssert_(out, 'cert reading: a visit is answered no row of the list — the visited person\'s or anybody\'s — in ' +
              'words typed as the caller\'s own scope', visitList.status === 403 && !visitList.data &&
              visitList.message === CERT_READ_WORDS.visit && visitList.scope === 'own' && visitMaster.status === 403 &&
              !visitMaster.data, JSON.stringify([visitList, visitMaster]));

    // --- a name reused after its roster row is gone reaches none of the earlier person's papers ---
    reset(); files = [];
    var earlier = HUB_ACTIONS.certDocFile({ id: 'k10' }, ann);
    stAssert_(out, 'cert reading: a paper stamped for another roster row under the same name is refused and never ' +
              'opened', earlier.status === 403 && earlier.message === CERT_READ_WORDS.notYours && files.length === 0,
              JSON.stringify(earlier));
    stAssert_(out, 'cert reading: a paper stamped with the caller\'s own roster id opens (ids compared bare)',
              HUB_ACTIONS.certDocFile({ id: 'k11' }, ann).status === 200 && files.join() === 'FILE_ann_card_11', '');
    var ownIds = (HUB_ACTIONS.certUploadsList({}, ann).data.uploads || []).map(function (u) { return u.id; });
    stAssert_(out, 'cert reading: the list leaves out the earlier person\'s paper and keeps the caller\'s own',
              ownIds.indexOf('k10') === -1 && ownIds.indexOf('k11') !== -1 && ownIds.indexOf('k1') !== -1, ownIds.join());

    // --- a row reached only through a roster e-mail a writer typed is listed, never opened ---
    reset(); files = [];
    roster.push({ id: 'p-cara', name: 'Cara Cole', email: 'max@example.org', status: 'Active' });
    accounts.push(acct('u-max', 'Max M.', 'max@example.org'));
    ledger.push({ id: 'k15', person: 'Cara Cole', cert: 'CPR / First Aid', name: 'cara.jpg', url: '',
                  at: '2026-09-15T10:00:00Z', by: 'hr@example.org', fileid: 'FILE_cara_15', reqid: 'cpr',
                  readstate: 'read', rosterid: 'p-cara' });
    var maxUser = who('u-max', 'Max M.', 'max@example.org', 'manager');
    var benSelf = who('u-ben', 'Ben Baker', 'ben@example.org', 'staff');
    var maxFile = null, maxList = null, benFile = null, maxLinked = null, maxLinkedList = null, linkedFiles = [];
    try {
      maxFile = HUB_ACTIONS.certDocFile({ id: 'k15' }, maxUser);
      maxList = HUB_ACTIONS.certUploadsList({}, maxUser);
      benFile = HUB_ACTIONS.certDocFile({ id: 'k2' }, benSelf);
      // the contact merge links the same account to that row on the e-mail the writer typed there
      accounts[accounts.length - 1] = acct('u-max', 'Max M.', 'max@example.org',
                                           { peopleid: 'people:p-cara', contactsources: JSON.stringify({ people_id: 'email' }) });
      var filesBefore = files.length;
      maxLinked = HUB_ACTIONS.certDocFile({ id: 'k15' }, maxUser);
      maxLinkedList = HUB_ACTIONS.certUploadsList({}, maxUser);
      linkedFiles = files.slice(filesBefore);
    } finally { roster.pop(); accounts.pop(); }
    var maxIds = ((maxList && maxList.data && maxList.data.uploads) || []).map(function (u) { return u.id; });
    stAssert_(out, 'cert reading: a manager on no roster row, whose e-mail a writer put on another person\'s row, ' +
              'is listed that row\'s papers as before but opens none of them; an account holding its own exact ' +
              'roster name opens its own, and a link the roster name proved opens as the owner\'s',
              maxFile.status === 403 && maxFile.message === CERT_READ_WORDS.bridged && maxIds.join() === 'k15' &&
              benFile.status === 200 && files.join() === 'FILE_ben_dodd_2' &&
              HUB_ACTIONS.certDocFile({ id: 'k1' }, ann).status === 200,
              JSON.stringify([maxFile, maxIds, benFile, files]));
    var maxLinkedIds = ((maxLinkedList && maxLinkedList.data && maxLinkedList.data.uploads) || [])
      .map(function (u) { return u.id; });
    stAssert_(out, 'cert reading: a link the e-mail proved, to a row under another name than the account\'s, is ' +
              'bridged too — listed, never opened, no file read',
              maxLinked.status === 403 && maxLinked.message === CERT_READ_WORDS.bridged && maxLinkedIds.join() === 'k15' &&
              linkedFiles.length === 0, JSON.stringify([maxLinked, maxLinkedIds, linkedFiles]));

    // --- the reading: the owner's own row, kept on that row ---
    reset(); patches = []; reads = [];
    var theirRead = HUB_ACTIONS.certDocRead({ id: 'k2' }, ann);
    stAssert_(out, 'cert reading: someone else\'s document is never read for a non-master',
              theirRead.status === 403 && reads.length === 0 && patches.length === 0, JSON.stringify(theirRead));
    var read = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann);
    stEq_(out, 'cert reading: the owner\'s upload is read, and its status words and dates come back on the row',
          [read.status, read.data && read.data.read_state, read.data && read.data.expires_on,
           read.data && read.data.req_id].join(' '), '200 read 2028-04-17 cpr');
    stAssert_(out, 'cert reading: the attempt is counted before the reading, and the verdict lands on that row ' +
              'with its day kept as text', patches.length === 2 && patches[0].fields.read_state === 'pending' &&
              patches[0].fields.read_tries === 1 && patches[1].fields.read_state === 'read' &&
              patches[1].fields.expires_on === "'2028-04-17" && patches[1].fields.read_v === "'" + DIGEST_VERSION &&
              read.data.read_v === DIGEST_VERSION,
              JSON.stringify(patches));
    reads = [];
    var again = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann);
    stAssert_(out, 'cert reading: a row already read answers its verdict without a second reading',
              again.status === 200 && again.data.read_state === 'read' && reads.length === 0, JSON.stringify(again));
    reset(); patches = []; reads = [];
    var byMaster = HUB_ACTIONS.certDocRead({ id: 'k1' }, boss);
    stAssert_(out, 'cert reading: the master\'s reading anchors the paper to the roster row the ledger name folds to',
              byMaster.data.read_state === 'read' && reads.length === 1, JSON.stringify(byMaster));
    // the Staff app files a paper for someone else, then reads and opens it from the master's own session
    reset(); patches = []; reads = []; files = [];
    var bossRead = HUB_ACTIONS.certDocRead({ id: 'k1' }, boss);
    var bossFile = HUB_ACTIONS.certDocFile({ id: 'k1' }, boss);
    stAssert_(out, 'cert reading: the real master reads and opens a paper filed for someone else',
              bossRead.status === 200 && bossRead.data.read_state === 'read' && reads.join() === 'FILE_ann_card_1' &&
              bossFile.status === 200 && files.join() === 'FILE_ann_card_1', JSON.stringify([bossRead, bossFile]));
    reset(); patches = []; reads = []; files = [];
    var benManager = who('u-ben', 'Ben Baker', 'ben@example.org', 'manager');
    var widened = [HUB_ACTIONS.certDocRead({ id: 'k1' }, ada), HUB_ACTIONS.certDocFile({ id: 'k1' }, ada),
                   HUB_ACTIONS.certDocRead({ id: 'k1' }, benManager), HUB_ACTIONS.certDocFile({ id: 'k1' }, benManager)];
    stAssert_(out, 'cert reading: an administrator or a manager who files papers for others reads and opens none of ' +
              'theirs — that stays the real master\'s', widened.every(function (r) { return r.status === 403; }) &&
              reads.length === 0 && files.length === 0 && patches.length === 0, JSON.stringify(widened));
    reset(); paperFails = true;
    var t1 = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann);
    var t2 = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann);
    var t3 = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann);
    paperFails = false;
    stEq_(out, 'cert reading: a file that cannot be opened stays pending for the sweep until its tries are spent',
          [t1.data.read_state, t2.data.read_state, t3.data.read_state].join(' '), 'pending pending unread');
    stAssert_(out, 'cert reading: the spent reading says so and hands the date to HR',
              /could not be read after 3 tries/.test(t3.data.read_why), t3.data.read_why);
    reset(); paperText = DODD;
    var wrongKind = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann);
    paperText = CPR;
    stEq_(out, 'cert reading: a wrong paper is kept as unread with its reason, never as the requirement',
          wrongKind.data.read_state + ' ' + wrongKind.data.read_why,
          'unread This reads as a DODD certificate, not a CPR / First Aid.');
    reset(); patches = []; paperText = ABSTRACT;
    var absRead = HUB_ACTIONS.certDocRead({ id: 'k9' }, ann);
    paperText = CPR;
    stAssert_(out, 'cert reading: an abstract\'s row keeps the day it was drawn and no expiry',
              absRead.status === 200 && absRead.data.read_state === 'read' && absRead.data.issued_on === '2026-09-20' &&
              absRead.data.expires_on === '' && patches[1].fields.expires_on === '' &&
              patches[1].fields.issued_on === "'2026-09-20", JSON.stringify([absRead, patches]));

    // --- the reading follows the ledger's file id only into the compliance folder, as the eye does ---
    reset(); patches = []; reads = [];
    var strayRead = null, driveDown = null;
    complianceDocsDriveFile_ = function () {
      return { getParents: function () { return iter([folderIn('2026', folderIn('Payroll', null))]); } };
    };
    try { strayRead = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann); } finally { complianceDocsDriveFile_ = filedHere; }
    var strayLast = (patches[patches.length - 1] || {}).fields || {};
    reset();
    complianceDocsDriveFile_ = function () { throw new Error('Drive answered 500'); };
    try { driveDown = HUB_ACTIONS.certDocRead({ id: 'k1' }, ann); } finally { complianceDocsDriveFile_ = filedHere; }
    stAssert_(out, 'cert reading: a row pointed at a file outside the compliance folder is never read — it lands ' +
              'unread in the eye\'s own words; a folder lookup that failed reads nothing and stays pending',
              strayRead.status === 200 && strayRead.data.read_state === 'unread' &&
              strayRead.data.read_why === CERT_READ_WORDS.stray && strayLast.read_state === 'unread' &&
              strayLast.read_why === CERT_READ_WORDS.stray && driveDown.status === 200 &&
              driveDown.data.read_state === 'pending' && reads.length === 0,
              JSON.stringify([strayRead, driveDown, reads]));

    // --- tries: a reading that died with its execution, and a verdict that threw ---
    reset(); reads = []; patches = [];
    ledger[0].readtries = '3';
    var dead = keep.readRow(complianceDocsRows_()[0]);
    stAssert_(out, 'cert reading: a pending row whose tries were spent by readings that died is closed as unread ' +
              'before any reading', dead.data.read_state === 'unread' && /could not be read after 3 tries/.test(dead.data.read_why) &&
              reads.length === 0 && patches.length === 1 && patches[0].fields.read_state === 'unread' &&
              patches[0].fields.read_tries === 3, JSON.stringify([dead, patches]));
    reset();
    var broke = [];
    certReadVerdict_ = function () { throw new Error('the verdict broke'); };
    try {
      for (var bt = 0; bt < 3; bt++) broke.push(HUB_ACTIONS.certDocRead({ id: 'k1' }, ann));
    } finally { certReadVerdict_ = keep.verdict; }
    stEq_(out, 'cert reading: a verdict that throws stays pending for the sweep, and at the cap lands as unread',
          broke.map(function (b) { return b.data && b.data.read_state; }).join(' ') + ' ' +
          /could not be read after 3 tries/.test((broke[2].data || {}).read_why), 'pending pending unread true');
    var readerCode = stCode_(keep.paper);
    stAssert_(out, 'cert reading: a certificate is read without the media probe — the relay keeps what it probes — ' +
              'and a conversion Drive refused throws, so it is read again rather than taken as a file with no words',
              readerCode.indexOf('digestDocProbe_') === -1 && /digestReadText_\(fileId, m, n, true\)/.test(readerCode) &&
              /if \(strict\) throw new Error\('Drive would not convert/.test(stCode_(digestConvertRead_)), '');
    var tmpQ = digestTmpQuery_('2026-09-27T10:00:00.000Z');
    stAssert_(out, 'cert reading: the scratch copies the sweep deletes are this account\'s own converted Docs and ' +
              'Sheets named digest-tmp, an hour old or more',
              tmpQ.indexOf("title = 'digest-tmp'") !== -1 && tmpQ.indexOf("'me' in owners") !== -1 &&
              tmpQ.indexOf('trashed = false') !== -1 && tmpQ.indexOf("modifiedDate < '2026-09-27T10:00:00.000Z'") !== -1 &&
              tmpQ.indexOf("mimeType = 'application/vnd.google-apps.document'") !== -1 &&
              DIGEST_TMP_OLD_MS >= 3600000, tmpQ);
    stAssert_(out, 'cert reading: the digest sweep deletes left-behind scratch copies inside its own budget, and the ' +
              'conversion names its copy by the same name',
              /digestTmpTidy_\(function \(\) \{ return DIGEST_BUDGET_MS/.test(stCode_(digestSweepMaybe_)) &&
              /name: DIGEST_TMP_NAME/.test(stCode_(digestConvertRead_)), '');

    // --- the sweep: only a reading that died, a few per pass, inside the budget ---
    reset();
    var fresh = new Date(new Date().getTime() - 60000).toISOString();
    ledger.push({ id: 'k7', person: 'Ann Able', cert: 'CPR / First Aid', at: fresh, fileid: 'F7', reqid: 'cpr',
                  readstate: 'pending' });
    ledger.push({ id: 'k8', person: 'Ben Baker', cert: 'CPR / First Aid', at: '2026-01-01T00:00:00Z', fileid: 'F8',
                  reqid: 'cpr', readstate: 'pending' });
    complianceDocsReadRow_ = function (row) { swept.push(row.id); return { status: 200 }; };
    var n = certDocReadSweep_(function () { return 170000; });
    stEq_(out, 'cert reading: the sweep takes the oldest pending rows first, at most three a pass, and leaves a ' +
          'fresh upload to its own door', n + ' ' + swept.join(','), '3 k8,k1,k3');
    swept = [];
    stEq_(out, 'cert reading: the sweep starts nothing on a budget under a minute',
          certDocReadSweep_(function () { return 30000; }) + ' ' + swept.length, '0 0');
    ledger.forEach(function (r) { if (r.id !== 'k7') r.readstate = 'read'; });
    stEq_(out, 'cert reading: an upload minutes old is its own door\'s to read, never the sweep\'s',
          certDocReadSweep_(function () { return 170000; }) + ' ' + swept.length, '0 0');
    complianceDocsReadRow_ = keep.readRow;
    stAssert_(out, 'cert reading: the digest sweep rings it inside its own budget',
              /certDocReadSweep_\(function \(\) \{ return DIGEST_BUDGET_MS/.test(stCode_(digestSweepMaybe_)), '');

    // --- confirming into the record: the master only ---
    reset(); masterWrites = []; patches = [];
    var confirm = function (u, id, date, expected) {
      return HUB_ACTIONS.certUploadConfirm({ id: id, date: date, expected: expected }, u);
    };
    var refusedAll = [confirm(ann, 'k6', '2027-08-01', '2026-08-01'), confirm(ada, 'k6', '2027-08-01', '2026-08-01'),
                      confirm(visitBoss, 'k6', '2027-08-01', '2026-08-01')];
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-ann', email: 'ann@example.org' };
    try { refusedAll.push(confirm(boss, 'k6', '2027-08-01', '2026-08-01')); } finally { HUB_MEMBER_CTX = null; }
    stAssert_(out, 'cert reading: a staff member, another admin, a visit wearing the master\'s e-mail and an open ' +
              'visit are refused, and nothing is written',
              refusedAll.every(function (r) { return r.status === 403 && r.message === CERT_CONFIRM_WORDS.master; }) &&
              masterWrites.length === 0 && patches.length === 0, JSON.stringify(refusedAll));
    stEq_(out, 'cert reading: Med Delivery dates are the registry check\'s, never confirmed here',
          confirm(boss, 'k3', '2027-01-31', '').message, CERT_CONFIRM_WORDS.med + ' Nothing was written.');
    stEq_(out, 'cert reading: MAIS has no date column to confirm into',
          confirm(boss, 'k4', '2027-01-31', '').message, CERT_CONFIRM_WORDS.mais + ' Nothing was written.');
    stEq_(out, 'cert reading: a day that is not on the calendar is refused',
          confirm(boss, 'k6', '2027-02-30', '2026-08-01').status, 400);
    var stale = confirm(boss, 'k6', '2027-08-01', '2025-01-01');
    stAssert_(out, 'cert reading: a record that changed since it was shown refuses with what it holds now',
              stale.status === 409 && stale.data.current === '2026-08-01' && masterWrites.length === 0,
              JSON.stringify(stale));
    var done = confirm(boss, 'k6', '2027-08-01', '2026-08-01');
    stAssert_(out, 'cert reading: the master\'s confirmation writes the requirement\'s own date column through the ' +
              'one Master writer, and stamps the ledger row',
              done.status === 200 && masterWrites.join() === 'Ann Able|DODD 8-Hour Exp|2027-08-01|2026-08-01|boss@example.org' &&
              patches.length === 1 && patches[0].fields.confirmed_on === "'2027-08-01" &&
              patches[0].fields.confirmed_by === 'boss@example.org', JSON.stringify([done, masterWrites, patches]));
    var record = HUB_ACTIONS.certUploadRecord({ id: 'k6' }, boss);
    stEq_(out, 'cert reading: the master reads what the record holds, the witness a confirmation is checked against',
          [record.data.record, record.data.date_source, record.data.confirm.allowed].join(' '),
          '2026-08-01 DODD 8-Hour Exp true');
    stEq_(out, 'cert reading: nobody else reads the record through it', HUB_ACTIONS.certUploadRecord({ id: 'k6' }, ann).status, 403);
    stEq_(out, 'cert reading: the record door says why a Med Delivery row takes no confirmation',
          HUB_ACTIONS.certUploadRecord({ id: 'k3' }, boss).data.confirm.why, CERT_CONFIRM_WORDS.med);
    masterWrites = [];
    var absRecord = HUB_ACTIONS.certUploadRecord({ id: 'k9' }, boss);
    var absDone = confirm(boss, 'k9', '2026-09-20', '2026-08-01');
    stAssert_(out, 'cert reading: an abstract\'s confirmation writes the day it was drawn into the abstract\'s own date ' +
              'column, which the record door names as the document\'s date',
              absRecord.data.date_role === 'issued' && absRecord.data.confirm.allowed === true && absDone.status === 200 &&
              masterWrites.join() === 'Ann Able|Driver\'s Abstract (Latest)|2026-09-20|2026-08-01|boss@example.org',
              JSON.stringify([absRecord, absDone, masterWrites]));
    masterWrites = []; patches = [];
    var earlierRecord = HUB_ACTIONS.certUploadRecord({ id: 'k10' }, boss);
    var earlierDone = confirm(boss, 'k10', '2027-02-10', '2026-08-01');
    stAssert_(out, 'cert reading: a paper stamped for another roster row than the one its name finds now is never ' +
              'confirmed into the record that name finds, and the record door says why',
              earlierRecord.data.confirm.allowed === false && earlierRecord.data.confirm.why === CERT_CONFIRM_WORDS.earlier &&
              earlierDone.status === 409 && earlierDone.message === CERT_CONFIRM_WORDS.earlier + ' Nothing was written.' &&
              masterWrites.length === 0 && patches.length === 0, JSON.stringify([earlierRecord, earlierDone]));
    complianceDocsPeople_ = function () { return null; };
    var rosterDown = null;
    try { rosterDown = confirm(boss, 'k9', '2026-09-20', '2026-08-01'); } finally {
      complianceDocsPeople_ = function () { return roster; };
    }
    stAssert_(out, 'cert reading: a stamped paper is not confirmed while the roster cannot be read',
              rosterDown.status === 503 && masterWrites.length === 0, JSON.stringify(rosterDown));
    // a stamped paper whose roster row carries an Employee ID reads and writes the Master row carrying that id
    var knownIds = [];
    var stubNow = complianceMasterNow_, stubWrite = complianceWriteMasterDate_;
    complianceMasterNow_ = function (person, field, knownId) {
      knownIds.push('now:' + str_(knownId));
      return stubNow(person, field);
    };
    complianceWriteMasterDate_ = function (person, field, value, expected, user, knownId) {
      knownIds.push('write:' + str_(knownId));
      return stubWrite(person, field, value, expected, user);
    };
    roster[0].employee_id = 'E77';
    try {
      reset(); masterWrites = []; patches = [];
      HUB_ACTIONS.certUploadRecord({ id: 'k9' }, boss);
      confirm(boss, 'k9', '2026-09-20', '2026-08-01');
      HUB_ACTIONS.certUploadRecord({ id: 'k6' }, boss);
    } finally {
      delete roster[0].employee_id;
      complianceMasterNow_ = stubNow;
      complianceWriteMasterDate_ = stubWrite;
    }
    stEq_(out, 'cert reading: a paper stamped for a roster row carrying an Employee ID is read and written by that id; ' +
          'an unstamped paper is found by its name', knownIds.join(' '), 'now:E77 now:E77 write:E77 now:');

    // --- the upload: a requirement names its own label, and a test copy stays out of the live archive ---
    var storedTypes2 = [];
    complianceDocsStore_ = function (person, cert, name, mime, b64, user, rq, rosterId) {
      stored.push([person, cert, rq ? rq.req_id : '', str_(rosterId)].join('|'));
      storedTypes2.push(mime);
      return { status: 200, data: { person: person, cert: cert } };
    };
    var typed = function (filename, mime) {
      return HUB_ACTIONS.certDocUpload({ req_id: 'cpr', filename: filename, mime: mime, base64: 'QUJD' }, ann);
    };
    var badTypes = [typed('card.pdf', 'text/html'), typed('card.png', 'application/xhtml+xml'),
                    typed('card.svg', 'image/svg+xml'), typed('card.jpg', 'image/png'), typed('card.html', ''),
                    typed('card', 'application/octet-stream')];
    stAssert_(out, 'cert reading: HTML named as a PDF, XHTML named as a picture, an SVG, a name and a type that disagree, ' +
              'and a file whose type cannot be told file nothing, in words',
              badTypes.every(function (b) { return b.status === 400 && b.message === CERT_DOC_TYPE_WORDS + ' Nothing was filed.'; }) &&
              stored.length === 0, JSON.stringify(badTypes));
    typed('card.pdf', 'application/pdf'); typed('photo.HEIC', 'application/octet-stream'); typed('scan', 'image/jpg');
    typed('photo.heic', 'image/heif'); typed('card.jpeg', '');
    stEq_(out, 'cert reading: a file is stored only as a PDF or picture type — by its name, or the type sent when the ' +
          'name has none', storedTypes2.join(), 'application/pdf,image/heic,image/jpeg,image/heic,image/jpeg');
    stored = []; storedTypes2 = [];
    stAssert_(out, 'cert reading: the store itself refuses any other type before anything is decoded',
              keep.store('Ann Able', 'CPR / First Aid', 'x.pdf', 'text/html', 'QUJD', ann, null, 'p-ann').status === 400, '');
    var up = function (reqId, cert) {
      return HUB_ACTIONS.certDocUpload({ req_id: reqId, cert: cert, filename: 'card.jpg', mime: 'image/jpeg',
                                         base64: 'QUJD' }, ann);
    };
    var unknown = up('nope', 'CPR / First Aid');
    var form = up('i9_form', 'I-9 Form');
    var check = up('sam', 'SAM');
    stAssert_(out, 'cert reading: an unknown requirement, a form HR files and a check HR records file nothing',
              unknown.status === 400 && form.message === 'HR files this form. Nothing was filed.' &&
              check.message === 'HR records this one. Nothing was filed.' && stored.length === 0,
              JSON.stringify([unknown, form, check]));
    up('cpr', 'Anything Typed');
    stEq_(out, 'cert reading: a requirement id files under the catalogue\'s label, whatever text came with it, stamped ' +
          'with the roster id the name settled to', stored.join(), 'Ann Able|CPR / First Aid|cpr|p-ann');
    stored = [];
    var nobody = HUB_ACTIONS.certDocUpload({ req_id: 'cpr', filename: 'card.jpg', mime: 'image/jpeg', base64: 'QUJD' },
                                           boss);
    stAssert_(out, 'cert reading: the master\'s session names whose record a paper goes on — naming nobody files ' +
              'nothing, never under the master\'s own name', nobody.status === 400 && nobody.message === CERT_UPLOAD_NOBODY &&
              stored.length === 0, JSON.stringify(nobody));
    HUB_ACTIONS.certDocUpload({ req_id: 'cpr', person: 'ann  ABLE', filename: 'card.jpg', mime: 'image/jpeg',
                                base64: 'QUJD' }, boss);
    stEq_(out, 'cert reading: named, the master files under that roster row\'s spelling, stamped with its roster id',
          stored.join(), 'Ann Able|CPR / First Aid|cpr|p-ann');
    stored = [];
    var nameless = HUB_ACTIONS.certDocUpload({ req_id: 'cpr', person: ' -- ', filename: 'card.jpg', mime: 'image/jpeg',
                                               base64: 'QUJD' }, boss);
    stAssert_(out, 'cert reading: a name with no letters or digits names nobody — the master\'s upload is refused as ' +
              'naming no one, and nothing is filed', nameless.status === 400 && nameless.message === CERT_UPLOAD_NOBODY &&
              stored.length === 0, JSON.stringify(nameless));
    // the session a visit really is (Main.gs doPost): the visited account, clamped, with the visit's mark
    var adaVisitsAnn = who('u-ann', 'Annie', 'ann@example.org', 'staff',
                           { people_id: 'people:p-ann', visiting_member: 'mem_selftest', acting_for: 'u-ann' });
    var visitUp = null, visitWaits = null;
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-ann', email: 'ann@example.org' };
    try {
      visitUp = HUB_ACTIONS.certDocUpload({ req_id: 'cpr', filename: 'card.jpg', mime: 'image/jpeg', base64: 'QUJD' },
                                          adaVisitsAnn);
      visitWaits = complianceDocsReadWaits_(req('cpr'), adaVisitsAnn);
    } finally { HUB_MEMBER_CTX = null; }
    stAssert_(out, 'cert reading: a visit files on the visited person\'s record, as every write of a visit lands, but ' +
              'its paper is never left waiting for a reading, so it never moves their requirement row',
              visitUp.status === 200 && stored.join() === 'Ann Able|CPR / First Aid|cpr|p-ann' && visitWaits === false &&
              complianceDocsReadWaits_(req('cpr'), ann) === true &&
              complianceDocsReadWaits_(req('cpr'), adaVisitsAnn) === false &&
              complianceDocsReadWaits_(req('i9_form'), ann) === false && complianceDocsReadWaits_(null, ann) === false &&
              stCode_(keep.store).indexOf("complianceDocsReadWaits_(owed, user) ? 'pending' : ''") !== -1,
              JSON.stringify([visitUp, stored, visitWaits]));
    stored = [];
    var keepSwitched = HUB_BE_ANOTHER, switchedGate = null, ownGate = 'unset';
    try {
      HUB_BE_ANOTHER = { target: { display_name: 'Ann Able', email: 'ann@example.org' } };
      switchedGate = beAnotherPolicyGate_('certDocUpload');
      HUB_BE_ANOTHER = null;
      ownGate = beAnotherPolicyGate_('certDocUpload');
    } finally { HUB_BE_ANOTHER = keepSwitched; }
    stAssert_(out, 'cert reading: a switched session wearing another account files no document on anybody\'s record — ' +
              'refused at the policy door before the handler; a session of one\'s own is let through',
              !!switchedGate && switchedGate.status === 409 && switchedGate.code === 'be_another_refused' &&
              ownGate === null, JSON.stringify([switchedGate, ownGate]));
    stAssert_(out, 'cert reading: the store stamps the roster id, and its catalogue lookup can never cost the filing',
              stCode_(keep.store).indexOf("try { owed = complianceDocsReqOf_('', cert); } catch") !== -1 &&
              stCode_(keep.store).indexOf('roster_id: hubCellSafe_(complianceDocsRosterId_(rosterId))') !== -1, '');
    var asked = 0;
    complianceDocsSharedFolder_ = function () { asked++; return { createFile: function () { copies++; } }; };
    hubTestModeOn_ = function () { throw new Error('the switch cannot be read'); };
    var unreadable = complianceDocsSharedCopy_('blob');
    hubTestModeOn_ = function () { return true; };
    var testing = complianceDocsSharedCopy_('blob');
    stAssert_(out, 'cert reading: the shared archive copy is skipped while test mode is on, and when the switch ' +
              'cannot be read', unreadable === false && testing === false && asked === 0 && copies === 0, '');
    hubTestModeOn_ = function () { return false; };
    stAssert_(out, 'cert reading: with test mode off the courtesy copy is made',
              complianceDocsSharedCopy_('blob') === true && copies === 1, '');
    stAssert_(out, 'cert reading: the store makes its archive copy only through the test-mode gate',
              stCode_(keep.store).indexOf('complianceDocsSharedCopy_(blob)') !== -1 &&
              stCode_(keep.store).indexOf('COMPLIANCE_SHARED_FOLDER_ID') === -1, '');

    // --- a filing, a reading and a confirmation retire the Staff app's cached answers for that person only ---
    var bumped = [];
    staffProfilesBump_ = function (action, key) { bumped.push(action + ':' + key); };
    HUB_ACTIONS.certDocUpload({ req_id: 'cpr', person: 'Ben Baker', filename: 'card.jpg', mime: 'image/jpeg',
                                base64: 'QUJD' }, boss);
    reset(); patches = []; masterWrites = [];
    HUB_ACTIONS.certDocRead({ id: 'k1' }, ann);
    confirm(boss, 'k6', '2027-08-01', '2026-08-01');
    var noBump = [up('sam', 'SAM'), confirm(boss, 'k6', '2027-08-01', '1999-01-01')];
    var staffReads = function (key) {
      return CERT_STAFF_READS.map(function (a) { return a + ':' + key; }).join(' ');
    };
    stEq_(out, 'cert reading: the Staff app\'s compliance, actions and documents answers are retired for the person a ' +
          'paper was filed, read or confirmed for — and not by a refused filing or a refused confirmation',
          bumped.join(' ') + ' | ' + noBump.map(function (r) { return r.status; }).join(' '),
          [staffReads('benbaker'), staffReads('annable'), staffReads('annable')].join(' ') + ' | 400 409');
    staffProfilesBump_ = keep.bump;

    // --- the list carries the reading; nothing reaches the company record or anybody ---
    reset();
    var listed = HUB_ACTIONS.certUploadsList({}, ann);
    var k5 = (listed.data.uploads || []).filter(function (u) { return u.id === 'k5'; })[0] || {};
    var k11 = (listed.data.uploads || []).filter(function (u) { return u.id === 'k11'; })[0] || {};
    stAssert_(out, 'cert reading: the list carries each row\'s reading, file id and the roster id it was filed for, ' +
              'an older row\'s file id from its link',
              k5.file_id === 'OLDFILE_ann_card_5' && k5.read_state === '' && 'confirmed_on' in k5 && k5.roster_id === '' &&
              k11.roster_id === 'p-ann' &&
              (listed.data.uploads || []).every(function (u) { return u.person === 'Ann Able'; }), JSON.stringify([k5, k11]));
    var door = [HUB_ACTIONS.certDocRead, HUB_ACTIONS.certDocFile, HUB_ACTIONS.certUploadConfirm,
                HUB_ACTIONS.certUploadRecord, keep.readRow, certReadVerdict_, certDocReadSweep_, keep.paper,
                digestPaperFromText_, keep.patch].map(stCode_).join('\n');
    stAssert_(out, 'cert reading: no reading writes staff_clearance, the engine\'s states, the candidate documents ' +
              'or a Master cell of its own, and none of these doors logs or sends',
              !/clearanceRecordUpload_|clearanceSet|requirement_states|candidate_documents|emp360WriteCell_|digestSettle_|hubSysLog_|Logger\.log|rpcSend_|rpcCall_|MailApp/.test(door),
              '');
    stAssert_(out, 'cert reading: the new doors declare their lanes, roles and the id they need',
              HUB_POLICY.certDocFile.params.id.required === true && HUB_POLICY.certDocRead.params.id.required === true &&
              HUB_POLICY.certDocRead.cost === 'minutes' && HUB_POLICY.certUploadConfirm.roles.join() === 'admin' &&
              HUB_POLICY.certUploadConfirm.lane === 'tool' &&
              HUB_POLICY.certUploadConfirm.invalidates.join() === 'certMatrix,staffCerts' &&
              HUB_POLICY.certUploadRecord.roles.join() === 'admin' && HUB_POLICY.certDocUpload.params.req_id.type === 'string',
              '');
    reset(); files = []; reads = []; patches = [];
    var batched = ['certDocFile', 'certDocRead'].map(function (a) {
      return bulkWriteOne_({ action: a, payload: { id: 'k1' } }, ann, '');
    });
    stAssert_(out, 'cert reading: a batch carries neither the eye nor the reading, so neither answer is ever kept ' +
              'under a batch\'s receipt', batched.every(function (b) {
                return b.status === 400 && b.message === 'bulkWrite carries writes only.';
              }) && files.length === 0 && reads.length === 0 && patches.length === 0, JSON.stringify(batched));

    // --- the live words book: its credentials carry no `expires` column, its Mandt row lacks the Mandt System ---
    reset(); patches = []; reads = [];
    // file names that say nothing, so the words alone decide the kind
    ledger.push({ id: 'k16', person: 'Ann Able', cert: 'DODD 8-Hour', name: 'scan.jpg', url: '', at: '2026-09-16T10:00:00Z',
                  fileid: 'FILE_ann_dodd_16', reqid: 'dodd', readstate: 'pending', rosterid: 'p-ann' });
    ledger.push({ id: 'k17', person: 'Ann Able', cert: 'Mandt', name: 'scan.jpg', url: '', at: '2026-09-17T10:00:00Z',
                  fileid: 'FILE_ann_mandt_17', reqid: 'mandt', readstate: 'pending', rosterid: 'p-ann' });
    var liveTabs = {};
    liveTabs[DIGEST_VOCAB_TABS.credentials] = DIGEST_CREDENTIALS.map(function (c) {
      return { notes: '', active: 'on', doc_id: c[1], doc_kind: c[0], credential: c[2], requirement: c[3] };
    });
    liveTabs[DIGEST_VOCAB_TABS.kinds] = DIGEST_DOC_KINDS.map(function (k) {
      var opts = k[3] || {};
      return { kind: k[0], category: k[1], active: 'on', weight: opts.w === undefined ? '' : String(opts.w),
               file_hints: (opts.file || []).join(', '),
               needles: k[2].filter(function (n) { return k[0] !== 'crisis_prevention' || n !== 'the mandt system'; }).join(', ') };
    });
    digestVocabRows_ = function (tab) { return liveTabs[tab] || []; };
    CacheService = { getScriptCache: function () {
      return { get: function () { return null; }, put: function () {} };
    } };
    DIGEST_VOCAB = null;
    var liveBook = digestVocab_();
    var liveMandt = (liveBook.kinds.filter(function (k) { return k[0] === 'crisis_prevention'; })[0] || [])[2] || [];
    var bareDodd = certReadVerdict_(req('dodd'), paper(DODD), 'p-ann');
    var bareMandt = paper(MANDT_CERT).kind;
    paperText = DODD;
    var liveDodd = HUB_ACTIONS.certDocRead({ id: 'k16' }, ann);
    paperText = MANDT_CERT;
    var liveMandtRead = HUB_ACTIONS.certDocRead({ id: 'k17' }, ann);
    paperText = CPR;
    var bookAfter = DIGEST_VOCAB;
    var settleCred = digestCredentialFor_('dodd_certification');
    stAssert_(out, 'cert reading: the live book\'s shape is loaded — no expires on any credential and no "the mandt ' +
              'system" needle — and read as the digest reads it, a DODD completion-only paper has no expiry and a ' +
              'Mandt certificate reads as a generic certificate',
              liveBook.source === 'book' && liveBook.credentials.length === DIGEST_CREDENTIALS.length &&
              liveBook.credentials.every(function (c) { return c[4] === ''; }) && liveMandt.length > 0 &&
              liveMandt.indexOf('the mandt system') === -1 && bareDodd.state === 'unread' &&
              bareDodd.why === CERT_READ_WORDS.noExpiry && bareMandt === 'certificate',
              JSON.stringify([liveBook.credentials, liveMandt, bareDodd.why, bareMandt]));
    stEq_(out, 'cert reading: on that book a DODD completion-only paper reads, its expiry derived from the renewal ' +
          'months, because a credential the book gives no expires takes the shipped one',
          [liveDodd.status, liveDodd.data && liveDodd.data.read_state, liveDodd.data && liveDodd.data.issued_on,
           liveDodd.data && liveDodd.data.expires_on, liveDodd.data && liveDodd.data.read_how].join(' '),
          '200 read 2026-08-01 2027-08-01 derived:12m');
    stEq_(out, 'cert reading: on that book a Mandt certificate on the Mandt row reads as its kind, with its expiry — ' +
          'the kind the requirement expects carries the shipped needles',
          [liveMandtRead.status, liveMandtRead.data && liveMandtRead.data.read_state,
           liveMandtRead.data && liveMandtRead.data.read_kind, liveMandtRead.data && liveMandtRead.data.expires_on].join(' '),
          '200 read crisis_prevention 2027-06-02');
    var saysNo = certReadVocab_({ credentials: [['dodd_certification', 'dodd_8hr', 'dodd', 'dodd_8hr', 'no']],
                                  kinds: liveBook.kinds }, ['dodd_certification']);
    var saysNoMandt = (saysNo.kinds.filter(function (k) { return k[0] === 'crisis_prevention'; })[0] || [])[2] || [];
    stAssert_(out, 'cert reading: a value the book does give stands, and only the expected kind takes the shipped ' +
              'needles — a DODD row never lends them to the Mandt kind',
              saysNo.credentials[0][4] === 'no' && saysNoMandt.indexOf('the mandt system') === -1 &&
              certReadVocab_({ kinds: [], credentials: [] }, ['crisis_prevention']).kinds.length === 0,
              JSON.stringify([saysNo.credentials, saysNoMandt]));
    stAssert_(out, 'cert reading: the book is put back after each reading, and the digest and its settlement still ' +
              'read it as it is — the book\'s DODD credential still gives no expiry there',
              bookAfter === liveBook && settleCred && settleCred.expires === false &&
              digestKinds_() === liveBook.kinds, JSON.stringify(settleCred));
    var bookReaders = [digestVocab_, keep.vocabRows, digestCredentials_, digestCredentialFor_, digestKinds_, digestDocKind_, digestRolesFinish_,
                       digestConfidence_, digestSettle_, digestSettleSweep_, digestOne_].map(stCode_).join('\n');
    var readRowCode = stCode_(keep.readRow);
    stAssert_(out, 'cert reading: the book\'s readers and the settlement name nothing of the certificate read\'s view, ' +
              'the book still reads the expires column as written, and the read door wraps both the reading and the ' +
              'verdict in that view, which is pure',
              !/certRead/.test(bookReaders) &&
              /String\(creds\[cr\]\.expires \|\| ''\)\.trim\(\)/.test(stCode_(digestVocab_)) &&
              readRowCode.split('certReadWithVocab_(expect, function').length === 3 &&
              !/SpreadsheetApp|DriveApp|CacheService|hubSysLog_|digestVocab_\(/.test(stCode_(certReadVocab_)), '');
  } finally {
    staffProfilesBump_ = keep.bump;
    digestVocabRows_ = keep.vocabRows;
    CacheService = keep.cacheSvc;
    complianceDocsRows_ = keep.rows;
    complianceDocsPeople_ = keep.people;
    complianceDocsAccounts_ = keep.accounts;
    complianceDocsPatch_ = keep.patch;
    complianceDocsFileRead_ = keep.fileRead;
    complianceDocsDriveFile_ = keep.driveFile;
    digestReadPaper_ = keep.paper;
    complianceDocsStore_ = keep.store;
    complianceDocsSharedFolder_ = keep.folder;
    hubTestModeOn_ = keep.mode;
    complianceDocsReadRow_ = keep.readRow;
    complianceMasterNow_ = keep.masterNow;
    complianceWriteMasterDate_ = keep.masterWrite;
    requirementsAll_ = keep.reqs;
    cgBlockStatuses_ = keep.onStaff;
    certReadVerdict_ = keep.verdict;
    filesCatalog_ = keep.catalog;
    HUB_MASTER_EMAIL_CACHE = keep.master;
    HUB_MEMBER_CTX = keep.member;
    DIGEST_ROSTER = keep.roster;
    DIGEST_VOCAB = keep.vocab;
  }
}
