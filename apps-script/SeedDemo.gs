// seed() deletes every resource tab; a tab the platform cannot rebuild from elsewhere belongs here.
var SEED_NEVER = ['tasks'];

function seed() {
  var ss = getSpreadsheet_();
  var data = seedData_();
  var summary = {};

  Object.keys(RESOURCES).forEach(function (resource) {
    if (SEED_NEVER.indexOf(resource) !== -1) {
      summary[resource] = 'skipped — real data, never seeded';
      return;
    }
    var rows = data[resource] || [];
    var name = RESOURCES[resource].sheet;

    var existing = ss.getSheetByName(name);
    if (existing) ss.deleteSheet(existing);
    var sheet = ss.insertSheet(name);
    if (rows.length === 0) { summary[resource] = 0; return; }

    var now = new Date().toISOString();
    rows.forEach(function (row, i) {
      if (!row.id) row.id = Utilities.getUuid();
      if (!row.createdAt) row.createdAt = now;
      row.updatedAt = row.updatedAt || now;
    });
    var header = unionKeys_(rows);
    var matrix = [header];
    rows.forEach(function (row) {
      matrix.push(header.map(function (h) { return serialize_(row[h]); }));
    });
    sheet.getRange(1, 1, matrix.length, header.length).setValues(matrix);
    sheet.setFrozenRows(1);
    summary[resource] = rows.length;
  });

  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  Logger.log('Seed complete → ' + ss.getUrl());
  Logger.log(JSON.stringify(summary));
  return summary;
}

function unionKeys_(rows) {
  var keys = [];
  rows.forEach(function (row) {
    Object.keys(row).forEach(function (k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });
  });
  keys.sort(function (a, b) {
    var rank = function (k) {
      if (k === 'id') return 0;
      if (k === 'createdAt' || k === 'updatedAt') return 2;
      return 1;
    };
    return rank(a) - rank(b);
  });
  return keys;
}

function minutesAgo_(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function seedData_() {
  return {
    people: seedPeople_(),
    candidates: seedCandidates_(),
    documents: seedDocuments_(),
    videos: seedVideos_(),
    events: seedEvents_(),
    notifications: seedNotifications_(),
    apps: seedApps_(),
    activity: seedActivity_()
  };
}

function seedPeople_() {
  var base = [
    ['Maya Chen',      'Senior Product Designer', 'Design',      'Lisbon, PT',  'Active',       92, '2022-03-14'],
    ['Tom Becker',     'Backend Engineer',        'Engineering', 'Berlin, DE',  'Active',       78, '2021-07-05'],
    ['Priya Nair',     'People Partner',          'People',      'London, UK',  'On leave',     64, '2023-01-23'],
    ['Daniel Osei',    'Design Manager',          'Design',      'Accra, GH',   'Active',       88, '2020-11-02'],
    ['Sofia Marino',   'Data Analyst',            'Operations',  'Milan, IT',   'Offboarding',  41, '2023-05-15'],
    ['Jonas Weber',    'QA Engineer',             'Engineering', 'Munich, DE',  'Active',       83, '2022-09-12']
  ];
  var extraNames = [
    'Lena Fischer', 'Owen Grant', 'Amara Diallo', 'Lucas Moreau', 'Hannah Kim',
    'Rafael Costa', 'Emily Watson', 'Noah Andersson', 'Isabella Rossi', 'Ethan Wright',
    'Chloe Dubois', 'Mateo Alvarez', 'Yuki Tanaka', 'Oliver Bennett', 'Freya Larsen',
    'Gabriel Santos', 'Aisha Rahman', 'Liam O Connor', 'Zara Ahmed', 'Luca Bianchi',
    'Nora Haddad', 'Felix Wagner', 'Ingrid Johansson', 'Diego Fernandez', 'Clara Nielsen',
    'Adam Kowalczyk', 'Ruby Chen', 'Marcus Silva', 'Elif Yilmaz', 'Hugo Laurent',
    'Sara Novak', 'Victor Hugo Mendes', 'Anya Petrova', 'Samuel Adeyemi', 'Julia Kramer',
    'Oscar Lindqvist', 'Mia Thompson', 'Karim El-Sayed', 'Tara O Brien', 'Andre Ferreira',
    'Wren Halliday', 'Nils Bergstrom'
  ];
  var rolesByDept = {
    Engineering: ['Frontend Engineer', 'Backend Engineer', 'DevOps Engineer', 'QA Engineer', 'Staff Engineer', 'Mobile Engineer'],
    Design:      ['Product Designer', 'UX Researcher', 'Brand Designer', 'Design Technologist'],
    Operations:  ['Data Analyst', 'Operations Manager', 'BizOps Associate', 'Support Lead'],
    People:      ['People Partner', 'Recruiter', 'Office Manager', 'L&D Specialist'],
    Finance:     ['Accountant', 'Financial Analyst', 'Payroll Specialist', 'Controller']
  };
  var depts = ['Engineering', 'Design', 'Operations', 'People', 'Finance'];
  var locations = ['Berlin, DE', 'Lisbon, PT', 'London, UK', 'Sao Paulo, BR', 'Toronto, CA',
    'Amsterdam, NL', 'New York, US', 'Madrid, ES', 'Accra, GH', 'Milan, IT',
    'Munich, DE', 'Dublin, IE', 'Warsaw, PL', 'Stockholm, SE'];
  var managers = {
    Engineering: 'Lena Fischer', Design: 'Daniel Osei', Operations: 'Sofia Marino',
    People: 'Priya Nair', Finance: 'Owen Grant'
  };

  var rows = [];
  for (var i = 0; i < 48; i++) {
    var name, role, dept, location, status, engagement, startDate;
    if (i < base.length) {
      var b = base[i];
      name = b[0]; role = b[1]; dept = b[2]; location = b[3];
      status = b[4]; engagement = b[5]; startDate = b[6];
    } else {
      name = extraNames[i - base.length];
      dept = depts[i % depts.length];
      var rolePool = rolesByDept[dept];
      role = rolePool[i % rolePool.length];
      location = locations[(i * 5) % locations.length];
      status = (i % 11 === 7) ? 'On leave' : (i % 13 === 9) ? 'Offboarding' : 'Active';
      engagement = 45 + ((i * 37) % 52);
      var year = 2019 + (i % 6);
      var month = 1 + ((i * 7) % 12);
      var day = 1 + ((i * 11) % 27);
      startDate = year + '-' + pad2_(month) + '-' + pad2_(day);
    }
    var slug = name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
    var start = new Date(startDate + 'T00:00:00Z');
    var tenureYears = Math.max(0.1, Math.round(((Date.now() - start.getTime()) / (365.25 * 86400000)) * 10) / 10);
    rows.push({
      id: 'p-' + pad2_(i + 1),
      name: name,
      email: slug + '@asahub.com',
      role: role,
      department: dept,
      location: location,
      status: status,
      engagement: engagement,
      startDate: startDate,
      avatar: seedAnimalAvatar_(i),
      phone: '+351 91 555 0' + (100 + i),
      manager: name === managers[dept] ? '' : managers[dept],
      tenure: tenureYears,
      projects: 1 + ((i * 7) % 8),
      ptoLeft: 2 + ((i * 5) % 20)
    });
  }
  return rows;
}

function seedCandidates_() {
  // [name, role, source, rating, daysInStage], in stage order (see stageOf).
  var C = [
    ['Nina Kowalski',    'Backend Engineer',        'Website',  0, 2],
    ['Jonas Weber',      'QA Engineer',             'Referral', 0, 5],
    ['Leo Martins',      'Product Designer',        'LinkedIn', 0, 1],
    ['Hana Sato',        'Data Analyst',            'Website',  0, 3],
    ['Omar Farouk',      'Backend Engineer',        'Agency',   0, 6],
    ['Greta Lind',       'Frontend Engineer',       'LinkedIn', 0, 4],
    ['Pavel Novak',      'QA Engineer',             'Website',  0, 8],
    ['Renata Souza',     'Product Designer',        'Referral', 0, 9],
    ['Alex Rivera',      'Product Designer',        'LinkedIn', 3, 4],
    ['Mariam Haddad',    'Backend Engineer',        'Agency',   4, 9],
    ['Chris Donnelly',   'Data Analyst',            'Website',  3, 6],
    ['Petra Novakova',   'QA Engineer',             'Referral', 4, 12],
    ['Sam Okafor',       'Frontend Engineer',       'LinkedIn', 3, 7],
    ['Julia Brandt',     'Backend Engineer',        'Website',  4, 10],
    ['Tom Becker',       'Senior Backend Engineer', 'Referral', 4, 11],
    ['Amelia Stone',     'Senior Product Designer', 'LinkedIn', 4, 8],
    ['Ravi Patel',       'Backend Engineer',        'Agency',   4, 14],
    ['Lisa Moreau',      'Data Analyst',            'Website',  3, 6],
    ['Iris van Dijk',    'Product Designer',        'Website',  5, 6],
    ['Marco Rossi',      'Backend Engineer',        'Referral', 5, 4],
    ['Kenji Sato',       'Data Analyst',            'LinkedIn', 5, 2],
    ['Elena Popova',     'QA Engineer',             'Referral', 4, 1],
    ['David Miller',     'Frontend Engineer',       'Website',  5, 3]
  ];
  var stageOf = function (i) {
    if (i < 8) return 'applied';
    if (i < 14) return 'screening';
    if (i < 18) return 'interview';
    if (i < 20) return 'offer';
    return 'hired';
  };
  var locations = ['Berlin, DE', 'Lisbon, PT', 'London, UK', 'Amsterdam, NL', 'Warsaw, PL', 'Remote'];
  var recruiters = ['Priya Nair', 'Priya Nair', 'Daniel Osei'];

  return C.map(function (c, i) {
    var daysInProcess = c[4] + ({ applied: 0, screening: 6, interview: 12, offer: 20, hired: 26 })[stageOf(i)];
    return {
      id: 'c-' + pad2_(i + 1),
      name: c[0],
      role: c[1],
      stage: stageOf(i),
      source: c[2],
      rating: c[3],
      daysInStage: c[4],
      daysInProcess: daysInProcess,
      location: locations[i % locations.length],
      appliedDate: new Date(Date.now() - daysInProcess * 86400000).toISOString().slice(0, 10),
      recruiter: recruiters[i % recruiters.length],
      avatar: seedAnimalAvatar_(i),
      match: c[3] === 0 ? '' : 70 + ((i * 6) % 26),
      interviewsDone: ({ applied: 0, screening: 0, interview: 2, offer: 3, hired: 3 })[stageOf(i)]
    };
  });
}

function seedDocuments_() {
  var D = [
    ['Remote Work Policy', 'policies', 2, 'Maya Chen', 8, 'published',
      'How we work from anywhere — core hours, equipment, and travel guidelines.',
      [['Core hours', 'We overlap between 10:00 and 15:00 in your local timezone. Outside that window you plan your day however you work best — async by default, meetings by exception.',
        'If a meeting must land outside your core hours, the organizer is expected to record it and share notes the same day.'],
       ['Equipment', 'Every full-time employee gets a home-office budget on day one and a refresh every two years. Order what you need; no approvals for standard items.',
        'Keep your equipment list updated in the Inventory app so support can help you quickly when something breaks.'],
       ['Working from abroad', 'You can work from another country for up to 30 days per year. Tell your manager and the People team before you book — some locations have tax implications we need to check.'],
       ['Security at home', 'Lock your screen when you step away, keep your home router updated, and use the company VPN on public networks. Full details live in Security Basics.'],
       ['Questions', 'This policy is owned by the People team. Ping #people-ops anytime — unclear policy is a bug, and we fix bugs.']]],
    ['Onboarding Handbook', 'handbook', 1, 'Priya Nair', 12, 'published',
      'Your first 30 days at ASA Hub: tools, rituals, and people to meet.',
      [['Week one', 'Get your accounts, meet your onboarding buddy, and ship something tiny on day three. Small wins compound — the goal of week one is confidence, not output.',
        'Your buddy is your first stop for every question. There are no dumb questions in week one; there are only undocumented answers.'],
       ['Rituals', 'Monday all-hands at 09:30, demos on Friday, and one virtual coffee roulette per week. Join what you can; everything is recorded.'],
       ['Your first month', 'By day 30 you should have shipped a real change, met every team lead, and completed the Academy onboarding channel. Your manager checks in weekly.']]],
    ['Design Principles', 'product', 3, 'Daniel Osei', 6, 'published',
      'Five principles that guide every screen we ship.',
      [['Calm, not flashy', 'ASA Hub is a daily-driver tool. Motion is functional, color is semantic, and nothing competes with the user\u2019s own content.'],
       ['Everything is a card', 'Content lives in soft, rounded cards on a quiet canvas. Elevation is whisper-quiet — hierarchy comes from spacing and type, not shadows.'],
       ['Green means go', 'One primary accent marks actions, active states and good news. Pastel tints categorize; they never decorate randomly.'],
       ['Dark at night', 'Dark mode is a parallel token set tuned by hand, never an inversion. Every screen must read beautifully in both.'],
       ['Apps grow', 'The product is a platform: adding an app is as cheap as adding a JSON object, and the interface should make that legible.']]],
    ['API & Apps Script Guide', 'engineering', 4, 'Tom Becker', 10, 'published',
      'Connecting the platform to Google Apps Script: drivers, envelopes, CORS.',
      [['Two drivers', 'The frontend talks to a single API facade with two interchangeable drivers: mock (default, in-memory) and apps-script (your deployed web app). Switch in Settings → API.',
        'Both drivers implement the same surface: list, get, create, update and delete over eight resources.'],
       ['The envelope', 'Every response is JSON: { "status": 200, "data": … } on success, or { "status": 4xx, "message": "…" } on error. Unknown resources return 404.'],
       ['CORS and text/plain', 'Apps Script cannot answer CORS preflights, so the frontend posts JSON as text/plain — a "simple request" that needs no preflight. It looks odd; it works everywhere.'],
       ['SheetDB', 'One spreadsheet, one tab per resource, header row = field names. IDs are UUIDs, timestamps are ISO strings. Run seed() once and live mode matches the demo.']]],
    ['Time Off Policy', 'policies', 2, 'Priya Nair', 5, 'published',
      'PTO, holidays, and leave — simple and generous by design.',
      [['PTO', '25 days per year, plus your local public holidays. Take at least two full weeks — rested people do better work.',
        'Log time off in the People app; your balance appears on your profile. No approval needed under 5 days, just a heads-up to your team.'],
       ['Leave', 'Parental, compassionate and medical leave are handled case by case with the People team. Your job is safe; your privacy is respected.']]],
    ['Brand Voice', 'handbook', 1, 'Maya Chen', 4, 'published',
      'How ASA Hub sounds: calm, clear, human.',
      [['Tone', 'We write like a competent colleague, not a corporation. Short sentences. No jargon when a plain word works. Never exclamation marks in error messages.',
        'Celebrate quietly: "3 people archived" beats "Woohoo! You archived 3 people!".'],
       ['Words we avoid', 'Utilize (use), leverage (use), synergy (never), please (only when the user has to do extra work).']]],
    ['Q1 Product Review', 'product', 3, 'Daniel Osei', 9, 'draft',
      'What shipped, what we learned, what\u2019s next.',
      [['What shipped', 'The vertical pipeline template, dark-mode polish across every page type, and table virtualization for 1k+ rows. Pipeline adoption is the quarter\u2019s headline metric.'],
       ['What we learned', 'Users install apps when the App Hub tells the "added over time" story — NEW pills and version captions outperformed every onboarding email.'],
       ['What\u2019s next', 'Q2: Expenses leaves beta, the app-builder schema preview goes real, and the activity feed becomes cross-app. Draft — do not share externally.']]],
    ['Security Basics', 'engineering', 4, 'Sofia Marino', 6, 'published',
      'Passwords, 2FA, device hygiene — the non-negotiables.',
      [['Passwords & 2FA', 'Use the company password manager for everything. Two-factor authentication is mandatory on your Google account, the code host, and the admin console.'],
       ['Devices', 'Full-disk encryption on, automatic updates on, screen lock under 5 minutes. Report a lost device within one hour — we can remote-wipe, but only if we know.'],
       ['Phishing', 'We run simulated phishing quarterly. When in doubt, forward the mail to security@asahub.com and never open the attachment.']]],
    ['Expense Guide', 'policies', 2, 'Owen Grant', 5, 'published',
      'What you can expense and how to file it in under 5 minutes.',
      [['The rules', 'If it helps you do your job and costs less than your monthly budget, expense it — no pre-approval. Travel, books, courses and home-office gear are all fair game.'],
       ['Filing', 'Snap the receipt, pick a category, submit in the Expenses app. Finance reimburses every Friday. Missing receipt? A card statement works under €50.']]]
  ];
  return D.map(function (d, i) {
    return {
      id: 'doc-' + pad2_(i + 1),
      title: d[0],
      collection: d[1],
      cover: '/docs/cover-0' + d[2] + '.png',
      author: d[3],
      authorAvatar: seedAnimalAvatar_(i),
      readMinutes: d[4],
      status: d[5],
      excerpt: d[6],
      sections: d[7].map(function (s) {
        return { heading: s[0], paragraphs: s.slice(1) };
      }),
      updatedLabel: ['Feb 10', 'Feb 8', 'Feb 6', 'Feb 4', 'Jan 30', 'Jan 28', 'Feb 9', 'Jan 22', 'Jan 18'][i]
    };
  });
}

function seedVideos_() {
  // [title, channel, duration "m:ss", instructor, progress %, views, ageLabel]
  var V = [
    ['Welcome to ASA Hub',                  'onboarding', '12:40', 'Maya Chen',    100, 1200, '2w ago'],
    ['Your First Week: Tools & Setup',      'onboarding', '8:24',  'Jonas Weber',  100, 860,  '2w ago'],
    ['How Our Apps Work: The Registry',     'product',    '9:58',  'Daniel Osei',  45,  640,  '3d ago'],
    ['Security Essentials',                 'security',   '6:12',  'Sofia Marino', 0,   510,  '5d ago'],
    ['Building Pages from Schemas',         'product',    '14:03', 'Tom Becker',   0,   420,  '1w ago'],
    ['Phishing, Passwords & 2FA',           'security',   '7:45',  'Sofia Marino', 0,   690,  '1w ago'],
    ['The Hiring Pipeline, End to End',     'onboarding', '10:31', 'Priya Nair',   100, 380,  '2w ago'],
    ['Design System Walkthrough',           'product',    '11:17', 'Maya Chen',    0,   350,  '2w ago'],
    ['Incident Response Basics',            'security',   '5:52',  'Tom Becker',   0,   290,  '3w ago'],
    ['Async Communication Norms',           'onboarding', '6:48',  'Priya Nair',   0,   450,  '3w ago'],
    ['Roadmap Q&A — Q1',                    'product',    '15:20', 'Daniel Osei',  0,   780,  '4d ago'],
    ['Data Privacy at ASA Hub',             'security',   '8:09',  'Sofia Marino', 0,   310,  '2h ago']
  ];
  var descriptions = {
    onboarding: 'Everything new joiners need — from accounts and rituals to how the platform itself is put together.',
    product:    'How ASA Hub works under the hood: the registry, page schemas, and the design system behind every screen.',
    security:   'Practical security for everyone: passwords, phishing, incident response and data privacy basics.'
  };
  return V.map(function (v, i) {
    var parts = v[2].split(':');
    var seconds = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    return {
      id: 'vid-' + pad2_(i + 1),
      title: v[0],
      channel: v[1],
      duration: v[2],
      durationSec: seconds,
      instructor: v[3],
      instructorAvatar: seedAnimalAvatar_(i),
      progress: v[4],
      views: v[5],
      thumb: '/videos/thumb-0' + ((i % 6) + 1) + '.png',
      description: descriptions[v[1]],
      featured: i === 0,
      publishedLabel: v[6]
    };
  });
}

function seedEvents_() {
  // [resourceId, date, start, end, title, type, attendees, location]
  var E = [
    ['u-maya',   '2025-02-10', '09:30', '10:15', 'Design review',                'review',    ['u-maya', 'u-daniel'],          'Studio room'],
    ['u-tom',    '2025-02-10', '10:00', '12:00', 'Deep work: API driver',        'focus',     ['u-tom'],                       'Desk'],
    ['u-priya',  '2025-02-10', '11:00', '11:45', 'Screening call — Mariam H.',   'interview', ['u-priya'],                     'Google Meet'],
    ['u-daniel', '2025-02-10', '14:00', '15:00', '1:1 with Maya',                'meeting',   ['u-daniel', 'u-maya'],          'Google Meet'],
    ['u-sofia',  '2025-02-10', '08:00', '19:00', 'Out of office',                'ooo',       ['u-sofia'],                     '—'],
    ['u-priya',  '2025-02-11', '14:00', '15:00', 'Panel interview — Tom Becker', 'interview', ['u-priya', 'u-maya', 'u-daniel'], 'Google Meet'],
    ['u-tom',    '2025-02-11', '09:00', '10:30', 'Schema refactor',              'focus',     ['u-tom'],                       'Desk'],
    ['u-maya',   '2025-02-11', '10:30', '11:00', 'Standup',                      'meeting',   ['u-maya', 'u-tom', 'u-daniel'], 'Google Meet'],
    ['u-daniel', '2025-02-11', '16:00', '17:00', 'Portfolio review',             'review',    ['u-daniel'],                    'Studio room'],
    ['u-maya',   '2025-02-12', '09:30', '10:00', 'All-hands',                    'meeting',   ['u-maya', 'u-daniel', 'u-tom'], 'Town hall'],
    ['u-priya',  '2025-02-12', '13:00', '14:00', 'Offer call — Iris v.D.',       'interview', ['u-priya'],                     'Google Meet'],
    ['u-sofia',  '2025-02-12', '10:00', '12:00', 'Dashboard metrics',            'focus',     ['u-sofia'],                     'Desk'],
    ['u-tom',    '2025-02-13', '11:00', '12:30', 'Code review',                  'review',    ['u-tom', 'u-maya'],             'Google Meet'],
    ['u-maya',   '2025-02-13', '15:00', '16:00', 'Usability session',            'review',    ['u-maya'],                      'Studio room'],
    ['u-priya',  '2025-02-13', '09:00', '09:45', 'Screening — Alex R.',          'interview', ['u-priya'],                     'Google Meet'],
    ['u-daniel', '2025-02-14', '10:00', '11:00', 'Hiring sync',                  'meeting',   ['u-daniel', 'u-priya'],         'Google Meet'],
    ['u-tom',    '2025-02-14', '14:00', '16:00', 'Deep work',                    'focus',     ['u-tom'],                       'Desk'],
    ['u-maya',   '2025-02-14', '16:30', '17:00', 'Week wrap',                    'meeting',   ['u-maya', 'u-daniel'],          'Google Meet'],
    ['u-sofia',  '2025-02-14', '13:00', '13:30', 'Data handoff',                 'meeting',   ['u-sofia', 'u-tom'],            'Google Meet']
  ];
  return E.map(function (e, i) {
    return {
      id: 'ev-' + pad2_(i + 1),
      resourceId: e[0],
      date: e[1],
      start: e[2],
      end: e[3],
      title: e[4],
      type: e[5],
      attendees: e[6],
      location: e[7],
      status: 'confirmed',
      notes: e[5] === 'interview' ? 'Bring portfolio exercise.' : ''
    };
  });
}

function seedNotifications_() {
  // [type, appId, actor, title, body, minutesAgo, read, priority, href]
  var N = [
    ['mention', 'knowledge', 'Priya Nair',  'mentioned you in Remote Work Policy',
      '…can you review the equipment section before Thursday? @alex', 12, false, 'high', '/app/knowledge/docs/doc-01'],
    ['app', 'hiring', '', 'Tom Becker moved to Offer',
      '18 days in process — 4 days faster than average.', 34, false, 'normal', '/app/hiring/pipeline'],
    ['reminder', 'schedule', '', 'Panel interview in 45 minutes',
      'Tom Becker · Tue 14:00 · with Maya and Daniel', 60, false, 'high', '/app/schedule/week'],
    ['app', 'academy', '', 'New lesson: Data Privacy at ASA Hub',
      'Security channel · 8 min', 120, false, 'normal', '/app/academy/videos'],
    ['system', '', '', 'Platform updated to v1.4.0',
      'New: vertical pipeline template, dark-mode polish, faster tables.', 180, true, 'normal', ''],
    ['mention', 'knowledge', 'Daniel Osei', 'mentioned you in Q1 Product Review',
      'Great quarter for the platform story — added a note on the Q2 section.', 300, true, 'normal', '/app/knowledge/docs/doc-07'],
    ['app', 'people', '', '5 people imported successfully',
      'From people-import.csv — 3 in Engineering, 2 in Design.', 1500, true, 'normal', '/app/people/directory'],
    ['reminder', 'expenses', '', 'Time to submit February expenses',
      'Expenses app · due Friday', 1560, true, 'normal', '/apps'],
    ['app', 'apps', '', 'New app available: Inventory v0.4.2',
      'Added over time, just like that — enable it in the App Hub.', 2880, true, 'normal', '/apps'],
    ['reminder', 'academy', '', 'Finish your onboarding checklist',
      'Academy · 2 lessons left in the Onboarding channel.', 4300, true, 'normal', '/app/academy/videos'],
    ['mention', 'knowledge', 'Maya Chen', 'commented on Design Principles',
      'Love the new principles page — added a note on principle 4.', 5700, true, 'normal', '/app/knowledge/docs/doc-03'],
    ['system', '', '', 'New sign-in from Lisbon, PT',
      'If this wasn\u2019t you, review your security settings.', 7100, true, 'normal', '/settings'],
    ['app', 'overview', '', 'Your weekly digest is ready',
      '248 active people · 12 open roles · 86 docs published.', 8600, true, 'low', '/app/overview/home'],
    ['system', '', '', 'Welcome to ASA Hub',
      'Your workspace is ready — explore the App Hub to add apps over time.', 10000, true, 'normal', '/apps']
  ];
  return N.map(function (n, i) {
    return {
      id: 'n-' + pad2_(i + 1),
      type: n[0],
      appId: n[1],
      actor: n[2],
      title: n[3],
      body: n[4],
      createdAt: minutesAgo_(n[5]),
      read: n[6],
      priority: n[7],
      href: n[8]
    };
  });
}

function seedApps_() {
  var A = [
    // [id, name, tagline, icon, accent, category, version, isNew, enabled, pages]
    ['overview', 'Overview', 'A calm dashboard of everything happening today.',
      'layout-dashboard', 'green', 'Workspace', '1.4.0', false, true,
      [{ id: 'home', type: 'dashboard', title: 'Home' }]],
    ['people', 'People', 'The long-list sheet for everyone in your org.',
      'users', 'blue', 'Manage', '1.2.0', false, true,
      [{ id: 'directory', type: 'sheet', title: 'Directory' }, { id: 'profile', type: 'detail', title: 'Profile' }]],
    ['hiring', 'Hiring Pipeline', 'Map every hiring process as a flowing, downward pipeline.',
      'git-branch', 'lavender', 'Manage', '1.2.0', false, true,
      [{ id: 'pipeline', type: 'pipeline', title: 'Pipeline' }, { id: 'candidate', type: 'detail', title: 'Candidate' }]],
    ['knowledge', 'Knowledge', 'Documents, policies and guides — beautifully readable.',
      'book-open', 'peach', 'Library', '1.1.0', false, true,
      [{ id: 'docs', type: 'documents', title: 'Knowledge Base' }]],
    ['academy', 'Academy', 'Video lessons with progress that remembers you.',
      'play-circle', 'pink', 'Library', '1.0.0', true, true,
      [{ id: 'videos', type: 'videos', title: 'Academy' }]],
    ['schedule', 'Schedule', 'Your team\u2019s week, in soft pastel blocks.',
      'calendar', 'mint', 'Workspace', '1.3.0', false, true,
      [{ id: 'week', type: 'schedule', title: 'Team Schedule' }]],
    ['expenses', 'Expenses', 'File and approve expenses in minutes. (Beta)',
      'receipt', 'amber', 'Manage', '0.9.0', true, false,
      [{ id: 'expenses', type: 'sheet', title: 'Expenses' }]],
    ['inventory', 'Inventory', 'Track equipment and swag across offices.',
      'package', 'blue', 'Library', '0.4.2', true, false,
      [{ id: 'stock', type: 'sheet', title: 'Stock' }]]
  ];
  return A.map(function (a) {
    return {
      id: a[0],
      name: a[1],
      tagline: a[2],
      icon: a[3],
      accent: a[4],
      category: a[5],
      version: a[6],
      isNew: a[7],
      enabled: a[8],
      pages: a[9],
      notifications: ['app', 'system']
    };
  });
}

function seedActivity_() {
  // [actor, action, target, appId, minutesAgo]
  var F = [
    ['Priya Nair',  'moved',           'Tom Becker to Offer',                 'hiring',    12],
    ['App Hub',     'installed',       'Academy v1.0',                        'apps',      60],
    ['Maya Chen',   'published',       'Remote Work Policy',                  'knowledge', 180],
    ['Daniel Osei', 'mentioned you in','Q1 Product Review',                   'knowledge', 300],
    ['Tom Becker',  'commented on',    'API & Apps Script Guide',             'knowledge', 1500],
    ['Priya Nair',  'imported',        '5 people into People',                'people',    1560],
    ['Sofia Marino','scheduled',       'Data handoff',                        'schedule',  1600],
    ['Kenji Sato',  'signed the offer —','Hired as Data Analyst',             'hiring',    2900],
    ['Jonas Weber', 'completed',       'onboarding module 4',                 'academy',   4300],
    ['System',      'detected',        'a new sign-in from Lisbon, PT',       '',          7100],
    ['Overview',    'generated',       'the weekly digest',                   'overview',  8600],
    ['System',      'welcomed',        'you to ASA Hub',                      '',          10000]
  ];
  return F.map(function (f, i) {
    return {
      id: 'a-' + pad2_(i + 1),
      actor: f[0],
      action: f[1],
      target: f[2],
      appId: f[3],
      createdAt: minutesAgo_(f[4])
    };
  });
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

var SEED_ANIMAL_AVATARS = [
  '/assets/library/animals/cat.jpg',
  '/assets/library/animals/dog.jpg',
  '/assets/library/animals/red-panda.jpg',
  '/assets/library/animals/fox.jpg',
  '/assets/library/animals/barn-owl.jpg',
  '/assets/library/animals/rabbit.jpg',
  '/assets/library/animals/penguin.jpg',
  '/assets/library/animals/squirrel.jpg',
  '/assets/library/animals/horse.jpg',
  '/assets/library/animals/otter.jpg',
  '/assets/library/animals/parrot.jpg',
  '/assets/library/animals/turtle.jpg',
  '/assets/library/animals/highland-cow.jpg'
];
function seedAnimalAvatar_(i) {
  return SEED_ANIMAL_AVATARS[((i % SEED_ANIMAL_AVATARS.length) + SEED_ANIMAL_AVATARS.length) % SEED_ANIMAL_AVATARS.length];
}

function whereIsMyData() {
  var ss = getSpreadsheet_();
  Logger.log('Spreadsheet: ' + ss.getUrl());
  Object.keys(RESOURCES).forEach(function (r) {
    var sheet = ss.getSheetByName(RESOURCES[r].sheet);
    Logger.log(r + ': ' + (sheet ? Math.max(0, sheet.getLastRow() - 1) + ' rows' : '(tab missing)'));
  });
}
