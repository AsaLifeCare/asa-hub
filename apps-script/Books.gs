// Books shelf: only US-federal public-domain or Creative Commons titles, with the licence on every row.

var BOOKS_FOLDER = 'ASA Hub — Books';
var BOOKS_INDEX_DOC = 'ASA Hub — Books — index';
var BOOKS_MAX_BYTES = 40 * 1024 * 1024;
// Apps Script gives a call ~6 minutes; a fetch pass stops before that.
var BOOKS_RUN_MS = 4 * 60 * 1000;

function booksFolder_() { return filesChildByName_(filesRoot_(), BOOKS_FOLDER); }

// Sources must serve static text to a plain fetch. SAMHSA: NCBI Bookshelf chapter urls, never NBK record pages (TOCs only).
var BOOKS_CATALOGUE = [
  {
    title: 'The Caregiver\'s Handbook',
    author: 'National Institute on Aging (NIH)',
    subject: 'Caregiving',
    licence: 'Public domain — work of the US federal government',
    source: 'https://order.nia.nih.gov/sites/default/files/2023-03/caregivers-handbook-nia_0.pdf',
    home: 'https://order.nia.nih.gov/publication/caregivers-handbook',
    summary: 'The whole of day-to-day care in one place: daily living, safety at home, medications, working with doctors, money and legal papers, and looking after the person doing the caring.',
    why: 'The closest thing to a manual for what a DSP does on a shift, written for people with no clinical training.'
  },
  {
    title: 'Caring for a Person With Alzheimer\'s Disease',
    author: 'National Institute on Aging (NIH)',
    subject: 'Dementia',
    licence: 'Public domain — work of the US federal government',
    source: 'https://order.nia.nih.gov/sites/default/files/2024-03/caring-for-a-Person-with-alzheimers-disease.pdf',
    home: 'https://order.nia.nih.gov/publication/caring-for-a-person-with-alzheimers-disease',
    summary: 'What changes as dementia progresses, how to handle bathing, dressing, eating and wandering, and what to do about the behaviours families find hardest.',
    why: 'Our houses hold people ageing into dementia; the behaviour chapters are the ones staff ask about most.'
  },
  {
    title: 'Caregiver skills training for families of children with developmental delays or disabilities — adaptation and implementation guide',
    author: 'World Health Organization',
    subject: 'Developmental disability',
    licence: 'CC BY-NC-SA 3.0 IGO',
    source: 'https://iris.who.int/bitstream/handle/10665/353581/9789240048850-eng.pdf?sequence=1',
    home: 'https://iris.who.int/handle/10665/353581',
    summary: 'WHO\'s programme for teaching everyday skills to the people around a person with a developmental disability — communication, engagement, routines, and managing challenging behaviour without force.',
    why: 'The evidence base under most of what we do, and it is written to be taught by non-specialists.'
  },
  {
    title: 'TIP 57 — Trauma-Informed Care in Behavioral Health Services',
    author: 'SAMHSA',
    subject: 'Trauma & behaviour',
    licence: 'Public domain — work of the US federal government',
    source: 'https://library.samhsa.gov/sites/default/files/sma14-4816.pdf',
    home: 'https://library.samhsa.gov/product/tip-57-trauma-informed-care-behavioral-health-services/sma14-4816',
    summary: 'What trauma does to a person, how it shows up as behaviour years later, and how a service can stop re-creating it. Includes screening, de-escalation and staff burnout.',
    why: 'Most "behaviours" our teams meet have a history behind them; this is the standard reference for reading one.'
  },
  {
    title: 'Trauma-Informed Care — Quick Guide for Clinicians',
    author: 'SAMHSA',
    subject: 'Trauma & behaviour',
    licence: 'Public domain — work of the US federal government',
    source: 'https://library.samhsa.gov/sites/default/files/sma15-4912.pdf',
    home: 'https://library.samhsa.gov/product/trauma-informed-care-behavioral-health-services-quick-guide-clinicians-based-tip-57/sma15',
    summary: 'The short form of TIP 57 — the principles, the warning signs and the responses, in a booklet somebody can read between shifts.',
    why: 'The version people actually finish. Good for a training day.'
  },
  {
    title: 'Dietary Guidelines for Americans, 2025–2030',
    author: 'USDA & US Department of Health and Human Services',
    subject: 'Nutrition',
    licence: 'Public domain — work of the US federal government',
    source: 'https://cdn.realfood.gov/DGA.pdf',
    home: 'https://www.realfood.gov/',
    summary: 'The current federal standard for what to eat, by life stage, with the reasoning behind every recommendation.',
    why: 'Menu planning and the diet sections of a service plan both answer to this document.'
  },
  {
    title: 'Anatomy and Physiology 2e',
    author: 'OpenStax (Rice University)',
    subject: 'Clinical grounding',
    licence: 'CC BY 4.0',
    source: 'https://openstax.org/details/books/anatomy-and-physiology-2e',
    home: 'https://openstax.org/details/books/anatomy-and-physiology-2e',
    summary: 'A full college anatomy and physiology course, free to read, print and adapt — including the nutrition and metabolism chapters.',
    why: 'When somebody asks WHY a medication or a positioning instruction matters, the answer is in here.'
  },
  {
    title: 'Notes on Nursing: What It Is, and What It Is Not',
    author: 'Florence Nightingale (1859)',
    subject: 'Caregiving',
    licence: 'Public domain — published 1859',
    source: 'https://www.gutenberg.org/files/17366/17366-h/17366-h.htm',
    home: 'https://www.gutenberg.org/ebooks/17366',
    summary: 'The founding text on caring for somebody in a room: air, light, noise, food, cleanliness, and the discipline of actually observing the person in front of you.',
    why: 'A hundred and sixty years old and still the clearest thing ever written about noticing a change in somebody.'
  },
  {
    title: 'Crisis Services: Effectiveness, Cost-Effectiveness and Funding Strategies',
    author: 'SAMHSA',
    subject: 'Crisis response',
    licence: 'Public domain — work of the US federal government',
    source: 'https://library.samhsa.gov/sites/default/files/sma14-4848.pdf',
    home: 'https://library.samhsa.gov/product/crisis-services-effectiveness-cost-effectiveness-and-funding-strategies/sma14-4848',
    summary: 'What actually works in a behavioural-health crisis — mobile teams, stabilization beds, warm lines — and the evidence behind each model.',
    why: 'The reference for why we de-escalate first and hospitalise last.'
  },
  {
    title: 'TAP 34 — Disaster Planning Handbook for Behavioral Health Programs',
    author: 'SAMHSA',
    subject: 'Emergency planning',
    licence: 'Public domain — work of the US federal government',
    source: 'https://library.samhsa.gov/sites/default/files/pep21-02-01-001.pdf',
    home: 'https://library.samhsa.gov/product/tap-34-disaster-planning-handbook-behavioral-health-programs/pep21-02-01-001',
    summary: 'How a residential program keeps running through a storm, an outbreak or an evacuation — planning templates, staff roles, and continuity of medication and records.',
    why: 'Our houses cannot close; this is the handbook for the day something tries to close them.'
  },
  {
    title: '2025 National Guidelines for a Behavioral Health Coordinated System of Crisis Care',
    author: 'SAMHSA',
    subject: 'Crisis response',
    licence: 'Public domain — work of the US federal government',
    source: 'https://library.samhsa.gov/sites/default/files/national-guidelines-crisis-care-pep24-01-037.pdf',
    home: 'https://library.samhsa.gov/product/national-behavioral-health-crisis-care-guidance/pep24-01-037',
    summary: 'The current national standard for crisis care: someone to call, someone to respond, a safe place to be — and how 988, mobile teams and receiving facilities fit together.',
    why: 'When a crisis call leaves the house, this is the system it enters; staff should know its shape.'
  },
  {
    title: 'Medication Errors',
    author: 'MedlinePlus (NIH/NLM)',
    subject: 'Medication safety',
    licence: 'Public domain — work of the US federal government',
    source: 'https://medlineplus.gov/medicationerrors.html',
    home: 'https://medlineplus.gov/medicationerrors.html',
    summary: 'What medication errors are, where they happen — wrong drug, wrong dose, wrong time — and the habits that prevent them at home and in care settings.',
    why: 'Half the incidents a MAR ever records start with one of the mistakes this page prevents.'
  },
  {
    title: 'Alzheimer\'s Caregivers',
    author: 'MedlinePlus (NIH/NLM)',
    subject: 'Dementia',
    licence: 'Public domain — work of the US federal government',
    source: 'https://medlineplus.gov/alzheimerscaregivers.html',
    home: 'https://medlineplus.gov/alzheimerscaregivers.html',
    summary: 'Day-to-day care in Alzheimer\'s — communication, bathing, dressing, wandering, agitation — with NIH guidance for each stage of the disease.',
    why: 'Our houses hold people ageing into dementia; the behaviour questions staff ask most are answered here.'
  },
  {
    title: 'Caregivers',
    author: 'MedlinePlus (NIH/NLM)',
    subject: 'Caregiving',
    licence: 'Public domain — work of the US federal government',
    source: 'https://medlineplus.gov/caregivers.html',
    home: 'https://medlineplus.gov/caregivers.html',
    summary: 'The whole caregiving job on one page: communicating with the person and their clinicians, help with daily living, and looking after the person doing the caring.',
    why: 'The static, machine-readable replacement for the walled ACL communication guides.'
  },
  {
    title: 'Dementia',
    author: 'MedlinePlus (NIH/NLM)',
    subject: 'Dementia',
    licence: 'Public domain — work of the US federal government',
    source: 'https://medlineplus.gov/dementia.html',
    home: 'https://medlineplus.gov/dementia.html',
    summary: 'What dementia is and is not, the conditions that cause it, how it is diagnosed, and what treatment and support exist.',
    why: 'The plain-language grounding under every dementia care plan our staff read.'
  },
  {
    title: 'Nutrition for Older Adults',
    author: 'MedlinePlus (NIH/NLM)',
    subject: 'Nutrition',
    licence: 'Public domain — work of the US federal government',
    source: 'https://medlineplus.gov/nutritionforolderadults.html',
    home: 'https://medlineplus.gov/nutritionforolderadults.html',
    summary: 'How nutritional needs change with age — fewer calories, more protein and key vitamins — and what a good plate looks like for an older adult.',
    why: 'Menu planning for our older residents starts here.'
  },
  {
    title: 'Patient and caregiver perspectives on quality of life in dementia: Evidence from a South Asian population',
    author: 'Jayakody & Arambepola — PLOS ONE',
    subject: 'Dementia',
    licence: 'CC BY 4.0',
    source: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0285701',
    home: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0285701',
    summary: 'What quality of life actually means to people living with dementia and to the people caring for them — in their own words, side by side.',
    why: 'The person\'s definition of a good day, not ours, is the care plan\'s target.'
  },
  {
    title: 'Factors influencing the caregiver burden for family caregivers of people with moderate-to-severe dementia: A structural equation modeling analysis',
    author: 'Qi, Ban, Wang et al. — PLOS ONE',
    subject: 'Caregiving',
    licence: 'CC BY 4.0',
    source: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0341719',
    home: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0341719',
    summary: 'A structural model of what actually drives caregiver burden in moderate-to-severe dementia, and which of those pressures are modifiable.',
    why: 'Burnout has causes, not moods; this names the ones a service can act on.'
  },
  {
    title: 'Facilitating the measurement and treatment of Behavioral and Psychological Symptoms of Dementia (BPSD) and understanding caregiver burden using wearable devices in Rural Taiwan — Protocol for a dyadic feasibility pilot study',
    author: 'Guu, Li, Lee et al. — PLOS ONE',
    subject: 'Dementia',
    licence: 'CC BY 4.0',
    source: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0342136',
    home: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0342136',
    summary: 'Measuring and treating the behavioural and psychological symptoms of dementia — agitation, sleep disruption, wandering — and the caregiver burden they create.',
    why: 'BPSD is the hardest part of a dementia shift; this is current evidence on reading it.'
  },
  {
    title: 'Clinical and behavioural features of SYNGAP1-related intellectual disability: a parent and caregiver description',
    author: 'Wright, Kenny, Eley et al. — Journal of Neurodevelopmental Disorders',
    subject: 'Developmental disability',
    licence: 'CC BY 4.0',
    source: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9164368/fullTextXML',
    home: 'https://europepmc.org/article/PMC/PMC9164368',
    summary: 'What SYNGAP1-related intellectual disability looks like day to day — seizures, sensory issues, sleep, behaviour — described by the parents and caregivers who live with it.',
    why: 'A caregiver-eye view of a genetic intellectual disability, from the people our staff\'s work most resembles.'
  },
  {
    title: 'Anticipatory grief among caregivers of people living with dementia: A scoping review',
    author: 'Rodriguez Colmenares, Alvarez, Gilbreath et al. — Palliative & Supportive Care',
    subject: 'Caregiving',
    licence: 'CC BY 4.0',
    source: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC13202407/fullTextXML',
    home: 'https://europepmc.org/article/PMC/PMC13202407',
    summary: 'The grief that starts long before a death — how it shows up in dementia caregivers, and what helps.',
    why: 'Staff grieve residents while still caring for them; naming that is the first support.'
  },
  {
    title: 'Trauma‐informed care in early intervention: Providers’ barriers, boundaries, and needs',
    author: 'Williams, Chudzik & Holden — Infant Mental Health Journal',
    subject: 'Trauma & behaviour',
    licence: 'CC BY 4.0',
    source: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12813253/fullTextXML',
    home: 'https://europepmc.org/article/PMC/PMC12813253',
    summary: 'What actually stops front-line providers from delivering trauma-informed care — the barriers, the role boundaries, and the support they say they need.',
    why: 'TIP 57 says what trauma-informed care is; this says why teams struggle to do it.'
  },
  {
    title: 'The effect of mindfulness-based intervention on depression in family caregivers of dementia patients: a meta-analysis and GRADE evaluation',
    author: 'Zhang, Zhang, Wang et al. — Frontiers in Psychology',
    subject: 'Caregiving',
    licence: 'CC BY 4.0',
    source: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC13201155/fullTextXML',
    home: 'https://europepmc.org/article/PMC/PMC13201155',
    summary: 'Pooled evidence on whether mindfulness practice actually lifts depression in people caring for somebody with dementia — and how strong that evidence is.',
    why: 'Caregiver wellbeing programmes should rest on evidence, not vibes; here is the evidence.'
  }
];

function booksRowFrom_(entry) {
  return {
    title: str_(entry.title),
    author: str_(entry.author),
    subject: str_(entry.subject),
    licence: str_(entry.licence),
    source: str_(entry.source),
    home: str_(entry.home),
    summary: str_(entry.summary),
    why: str_(entry.why),
    driveUrl: '',
    fileSize: '',
    fetchNote: '',
    addedAt: new Date().toISOString()
  };
}

/** Plant the catalogue, matched by source URL: a title gets edited, the URL is the publication. */
HUB_POLICY.booksSeed = {
  file: 'Books.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['books'], emits: []
};
HUB_ACTIONS.booksSeed = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var existing = listRows_('books', {});
  var bySource = {};
  for (var i = 0; i < existing.length; i++) {
    var s = str_(existing[i].source);
    if (s) bySource[s] = existing[i];
  }
  var added = 0, updated = 0;
  for (var j = 0; j < BOOKS_CATALOGUE.length; j++) {
    var row = booksRowFrom_(BOOKS_CATALOGUE[j]);
    var hit = bySource[row.source];
    if (!hit) {
      var refusedB = sheetDbRefused_(createRow_('books', row));
      if (refusedB) {
        return { status: refusedB.status, message: refusedB.message + ' — ' + added + ' added and ' +
                 updated + ' updated before the refusal.' };
      }
      added++;
      continue;
    }
    // The catalogue owns the description; what the fetch wrote on the row is never overwritten.
    delete row.driveUrl; delete row.fileSize; delete row.fetchNote; delete row.addedAt;
    updateRowById_('books', str_(hit.id), row);
    updated++;
  }
  return { status: 200, data: { added: added, updated: updated, total: BOOKS_CATALOGUE.length } };
};

/** Download each book into the Drive folder; a link is written only for a file that provably arrived. */
HUB_POLICY.booksFetch = {
  file: 'Books.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['books'], emits: []
};
HUB_ACTIONS.booksFetch = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var only = str_(payload && payload.id);
  var rows = listRows_('books', {});
  var folder = booksFolder_();
  var started = Date.now();
  var fetched = 0, failed = 0, skipped = 0, stoppedEarly = false;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (only && str_(row.id) !== only) continue;
    if (!only && str_(row.driveUrl)) { skipped++; continue; }
    if (Date.now() - started > BOOKS_RUN_MS) { stoppedEarly = true; break; }

    var url = str_(row.source);
    if (!url) { skipped++; continue; }
    var res = null, note = '', code = 0;
    try {
      res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      code = res.getResponseCode();
    } catch (e) {
      note = 'The publisher did not answer: ' + String((e && e.message) || e).slice(0, 160);
    }
    if (!note && code !== 200) note = 'The publisher answered ' + code + '.';

    var blob = null;
    if (!note) {
      blob = res.getBlob();
      var bytes = blob.getBytes().length;
      var type = str_(blob.getContentType()).toLowerCase();
      var sourceIsPage = url.indexOf('.htm') !== -1;
      if (bytes < 4096) {
        note = 'What came back was too small to be the document (' + bytes + ' bytes).';
      } else if (bytes > BOOKS_MAX_BYTES) {
        note = 'The file is larger than the ' + Math.round(BOOKS_MAX_BYTES / 1024 / 1024) + 'MB limit.';
      } else if (type.indexOf('html') !== -1 && !sourceIsPage) {
        note = 'The publisher returned a web page instead of the file — it is likely refusing machine downloads.';
      }
    }

    if (note) {
      updateRowById_('books', str_(row.id), { fetchNote: note, driveUrl: '' });
      failed++;
      continue;
    }

    var ext = str_(blob.getContentType()).indexOf('pdf') !== -1 ? '.pdf'
      : (url.indexOf('.htm') !== -1 ? '.html' : '');
    var name = booksFileName_(str_(row.title)) + ext;
    var old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    var file = folder.createFile(blob.setName(name));
    updateRowById_('books', str_(row.id), {
      driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      fileSize: booksHumanSize_(blob.getBytes().length),
      fetchNote: ''
    });
    fetched++;
  }

  var indexUrl = booksWriteIndex_(folder);
  hubSysLog_(user && user.email, 'books_fetch', String(fetched) + ' fetched', { status: 200 });
  return {
    status: 200,
    data: {
      fetched: fetched, failed: failed, skipped: skipped,
      stopped_early: stoppedEarly, folder: folder.getUrl(), index: indexUrl
    }
  };
};

function booksFileName_(title) {
  return str_(title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'book';
}

function booksHumanSize_(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (Math.round(bytes / 1024 / 1024 * 10) / 10) + ' MB';
}

function booksWriteIndex_(folder) {
  var rows = listRows_('books', {});
  if (!rows.length) return '';
  var doc = null;
  var it = folder.getFilesByName(BOOKS_INDEX_DOC);
  if (it.hasNext()) {
    doc = DocumentApp.openById(it.next().getId());
    doc.getBody().clear();
  } else {
    doc = DocumentApp.create(BOOKS_INDEX_DOC);
    var f = DriveApp.getFileById(doc.getId());
    folder.addFile(f);
    DriveApp.getRootFolder().removeFile(f);
  }
  var body = doc.getBody();
  body.appendParagraph('ASA Hub — Books').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(
    'Every title here is free to read and to share: a work of the US federal ' +
    'government (public domain by statute) or published under a Creative ' +
    'Commons licence. The licence is printed with each one — check it before ' +
    'reprinting anything for a training day.'
  );
  body.appendParagraph('Updated ' + new Date().toISOString().slice(0, 10) +
                       ' · ' + rows.length + ' titles').setItalic(true);

  var bySubject = {}, order = [];
  for (var i = 0; i < rows.length; i++) {
    var s = str_(rows[i].subject) || 'General';
    if (!bySubject[s]) { bySubject[s] = []; order.push(s); }
    bySubject[s].push(rows[i]);
  }
  order.sort();
  for (var k = 0; k < order.length; k++) {
    body.appendParagraph(order[k]).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    var list = bySubject[order[k]];
    for (var j = 0; j < list.length; j++) {
      var r = list[j];
      body.appendParagraph(str_(r.title)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph(str_(r.author)).setItalic(true);
      if (str_(r.summary)) body.appendParagraph(str_(r.summary));
      if (str_(r.why)) body.appendParagraph('Why it is here: ' + str_(r.why));
      body.appendParagraph('Licence: ' + str_(r.licence));
      body.appendParagraph('Source: ' + str_(r.home || r.source));
      if (str_(r.driveUrl)) body.appendParagraph('In this folder: ' + str_(r.title));
      else if (str_(r.fetchNote)) body.appendParagraph('Not downloaded — ' + str_(r.fetchNote));
    }
  }
  doc.saveAndClose();
  return doc.getUrl();
}

// A model's suggestion survives only on a host whose whole catalogue is provably free; a claimed licence is not proof.
var BOOKS_TRUSTED_HOSTS = [
  'gutenberg.org', 'openstax.org', 'iris.who.int',
  'nia.nih.gov', 'order.nia.nih.gov', 'samhsa.gov', 'library.samhsa.gov',
  'store.samhsa.gov', 'cdc.gov', 'stacks.cdc.gov', 'dietaryguidelines.gov',
  'nimh.nih.gov', 'ninds.nih.gov', 'acl.gov', 'eldercare.acl.gov',
  'journals.plos.org', 'ebi.ac.uk', 'europepmc.org', 'medlineplus.gov',
  'ncbi.nlm.nih.gov'
];

function booksHostTrusted_(url) {
  var m = /^https?:\/\/([^\/]+)/i.exec(str_(url));
  if (!m) return false;
  var host = m[1].toLowerCase().replace(/^www\./, '');
  for (var i = 0; i < BOOKS_TRUSTED_HOSTS.length; i++) {
    var t = BOOKS_TRUSTED_HOSTS[i];
    if (host === t || host.slice(-(t.length + 1)) === '.' + t) return true;
  }
  return false;
}

HUB_POLICY.booksMine = {
  file: 'Books.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['books'], emits: []
};
function booksLicenceFree_(licence) {
  return /public domain|cc[- ]by|creative commons|us federal government/i.test(str_(licence));
}

HUB_ACTIONS.booksMine = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  if (typeof screenAiChat_ !== 'function') {
    return { status: 503, message: 'No model provider is configured.' };
  }

  var rounds = Math.max(1, Math.min(3, Number(payload && payload.rounds) || 2));
  var added = 0, refused = 0, refusedWhy = [], via = '';

  for (var round = 0; round < rounds; round++) {
    var existing = listRows_('books', {});
    var haveSrc = {}, haveTitle = {};
    existing.forEach(function (r) {
      if (str_(r.source)) haveSrc[str_(r.source)] = true;
      if (str_(r.title)) haveTitle[str_(r.title).toLowerCase()] = true;
    });

    var ask =
      'You curate a free professional library for a company that runs group homes for adults ' +
      'with developmental disabilities in Ohio (direct support professionals, house managers, nurses).\n' +
      'The shelf already holds: ' + existing.map(function (r) { return str_(r.title); }).join('; ').slice(0, 2200) + '\n\n' +
      'Suggest up to 10 MORE genuinely free publications, ONLY from these publishers: ' +
      'Project Gutenberg (gutenberg.org), OpenStax (openstax.org), WHO IRIS (iris.who.int), ' +
      'NIA (nia.nih.gov / order.nia.nih.gov), SAMHSA (library.samhsa.gov), CDC (cdc.gov / stacks.cdc.gov), ' +
      'ACL (acl.gov), NIMH (nimh.nih.gov), NINDS (ninds.nih.gov), Dietary Guidelines (dietaryguidelines.gov).\n' +
      'Relevant subjects: caregiving, dementia and ageing, developmental disability, autism, ' +
      'de-escalation and trauma, crisis response, communication, nutrition, medication safety, ' +
      'seizure response and epilepsy, diabetes care, infection control, oral health, fall prevention, ' +
      'safe lifting and positioning, documentation and incident reporting, caregiver wellbeing, first aid.\n' +
      'Prefer DIRECT FILE URLS (a PDF on the publisher\'s own host) over landing pages. ' +
      'Only real, currently-published documents — never guess a URL you are not sure exists.\n' +
      'Reply with JSON only:\n' +
      '{"books":[{"title":"...","author":"<publisher or author>","subject":"<2-3 words>",' +
      '"licence":"<the real licence, named — e.g. \'Public domain — work of the US federal government\', \'CC BY 4.0\'>",' +
      '"source":"<https URL on one of those hosts>",' +
      '"home":"<landing page URL>","summary":"<2 sentences>","why":"<1 sentence: why THIS workforce needs it>"}]}';

    var res = null;
    try { res = screenAiChat_(ask, 0.3, 'ai_book_licence'); } catch (e) { res = null; }
    if (!res || !res.ok) {
      if (round === 0) return { status: 502, message: 'No provider answered.' };
      break;
    }
    via = str_(res.via);
    var parsed = null;
    try { parsed = JSON.parse(str_(res.content)); } catch (e2) { parsed = null; }
    var books = (parsed && parsed.books) || [];
    var addedThisRound = 0;

    for (var i = 0; i < books.length && addedThisRound < 12; i++) {
      var b = books[i];
      var src = str_(b.source), title = str_(b.title);
      if (!title || !src) { refused++; continue; }
      if (!booksHostTrusted_(src) || (str_(b.home) && !booksHostTrusted_(b.home))) {
        refused++;
        if (refusedWhy.length < 6) refusedWhy.push(title + ' (untrusted host)');
        continue;
      }
      if (!booksLicenceFree_(b.licence)) {
        refused++;
        if (refusedWhy.length < 6) refusedWhy.push(title + ' (unproven licence)');
        continue;
      }
      if (haveSrc[src] || haveTitle[title.toLowerCase()]) { refused++; continue; }
      var refusedN = sheetDbRefused_(createRow_('books', {
        title: title, author: str_(b.author), subject: str_(b.subject) || 'General',
        licence: str_(b.licence), source: src, home: str_(b.home) || src,
        summary: str_(b.summary), why: str_(b.why),
        driveUrl: '', fileSize: '', fetchNote: '',
        via: via, addedAt: new Date().toISOString()
      }));
      if (refusedN) {
        return { status: refusedN.status, message: refusedN.message + ' — ' + added +
                 ' book(s) were added before the refusal.' };
      }
      haveSrc[src] = true; haveTitle[title.toLowerCase()] = true;
      added++; addedThisRound++;
    }
    if (!addedThisRound) break;
  }

  hubSysLog_(user && user.email, 'books_mine', added + ' added, ' + refused + ' refused', { status: 200 });
  return { status: 200, data: { added: added, refused: refused, refused_named: refusedWhy, via: via, rounds: rounds } };
};

// --- Reading inside the platform ---

function booksStripHtml_(html) {
  var s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
       .replace(/<header[\s\S]*?<\/header>/gi, ' ')
       .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
       .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
       .replace(/<!--[\s\S]*?-->/g, ' ');
  // JATS XML (Europe PMC): tables, reference lists and xref markers are noise as prose.
  s = s.replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, ' ')
       .replace(/<ref-list[\s\S]*?<\/ref-list>/gi, ' ')
       .replace(/<xref[\s\S]*?<\/xref>/gi, ' ');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|sec|title|abstract)>/gi, '\n\n')
       .replace(/<br\s*\/?>/gi, '\n')
       .replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
       .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); });
  return s;
}

// PDF exports break per line, not per paragraph: those are re-flowed by sentence rhythm.
function booksParagraphs_(text) {
  var t = String(text || '').replace(/\r/g, '');
  var parts = t.split(/\n{2,}/);
  if (parts.length < 4 && t.length > 4000) {
    var lines = t.split('\n');
    parts = [];
    var cur = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) { if (cur) { parts.push(cur); cur = ''; } continue; }
      cur = cur ? cur + ' ' + ln : ln;
      if (/[.!?:]$/.test(ln) && cur.length > 300) { parts.push(cur); cur = ''; }
    }
    if (cur) parts.push(cur);
  }
  var out = [];
  var total = 0;
  for (var j = 0; j < parts.length && out.length < 400; j++) {
    var p = parts[j].replace(/\s+/g, ' ').trim();
    if (p.length < 3) continue;
    p = p.slice(0, 2000);
    total += p.length;
    out.push(p);
    if (total > 60000) { out.push('… (the text continues at the source)'); break; }
  }
  return out;
}

function booksPdfText_(fileId, why) {
  var note = function (msg) { if (why) why.reason = msg; };
  var token = ScriptApp.getOAuthToken();
  var auth = { Authorization: 'Bearer ' + token };
  var copy = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?supportsAllDrives=true',
    { method: 'post', contentType: 'application/json', headers: auth,
      payload: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: 'books-read-tmp' }),
      muteHttpExceptions: true });
  if (copy.getResponseCode() >= 400) {
    note('Drive refused to convert it (HTTP ' + copy.getResponseCode() + ')');
    return '';
  }
  var docId = JSON.parse(copy.getContentText()).id;
  var text = '';
  try {
    var exp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text%2Fplain',
      { headers: auth, muteHttpExceptions: true });
    if (exp.getResponseCode() < 400) text = exp.getContentText();
    else note('the converted copy could not be exported (HTTP ' + exp.getResponseCode() + ')');
  } catch (err) { note('the export threw: ' + String((err && err.message) || err)); }
  try {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + docId + '?supportsAllDrives=true',
      { method: 'delete', headers: auth, muteHttpExceptions: true });
  } catch (err) {}
  var out = String(text || '').slice(0, 90000);
  if (!out.trim()) {
    note(why && why.reason ? why.reason : 'it converted but held no text — a scan, which needs eyes');
    return '';
  }
  return out;
}

/** Read a book in the platform: the stored copy first, else scraped or converted from a trusted host, cached six hours. */
HUB_POLICY.booksRead = {
  file: 'Books.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager', 'staff', 'client'],
  params: { id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.booksRead = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which book?' };
  // Same key booksTextReplace_ clears.
  var cacheKey = 'books_read_v2_' + id;
  try {
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return { status: 200, data: JSON.parse(hit) };
  } catch (eC) {}
  var rows = listRows_('books', {});
  var row = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].id) === id) { row = rows[i]; break; }
  }
  if (!row) return { status: 404, message: 'That book is not on the shelf.' };
  // Stored copy first (books_text), so a publisher outage cannot blank the reader.
  try {
    var stored = [];
    var via = '';
    readTabNormalized_(hubTabWorkbook_(BOOKS_TEXT_TAB), BOOKS_TEXT_TAB).forEach(function (t) {
      if (str_(t.bookid) !== id) return;
      via = str_(t.via) || via;
      stored.push({ ord: Number(t.ord) || 0, text: str_(t.text) });
    });
    if (stored.length >= 3) {
      stored.sort(function (a, b) { return a.ord - b.ord; });
      var kept = { title: str_(row.title), author: str_(row.author), via: via || 'stored',
                   paragraphs: stored.map(function (t) { return t.text; }) };
      return { status: 200, data: kept };
    }
  } catch (eStored) {}
  var url = str_(row.source) || str_(row.home);
  if (!url) return { status: 400, message: 'This row names no source to read.' };
  if (!booksHostTrusted_(url)) {
    return { status: 403, message: 'That host is not on the trusted list — open it at the source instead.' };
  }
  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } });
  } catch (e) {
    return { status: 502, message: 'The publisher did not answer: ' + String((e && e.message) || e).slice(0, 160) };
  }
  if (res.getResponseCode() !== 200) {
    return { status: 502, message: 'The publisher answered ' + res.getResponseCode() + '.' };
  }
  var blob = res.getBlob();
  var type = str_(blob.getContentType()).toLowerCase();
  var out;
  if (type.indexOf('pdf') !== -1) {
    if (blob.getBytes().length > 15 * 1024 * 1024) {
      return { status: 413, message: 'This PDF is too large to read inline — a curator can fetch it to the shelf instead.' };
    }
    var tmp = booksFolder_().createFile(blob.setName('read-tmp-' + id + '.pdf'));
    var why = {};
    var text = '';
    try { text = booksPdfText_(tmp.getId(), why); }
    finally { try { tmp.setTrashed(true); } catch (eT) {} }
    if (!text) return { status: 422, message: 'The PDF held no readable text' + (why.reason ? ' — ' + why.reason : '.') };
    out = { title: str_(row.title), author: str_(row.author), via: 'pdf',
            paragraphs: booksParagraphs_(text) };
  } else {
    out = { title: str_(row.title), author: str_(row.author), via: 'scrape',
            paragraphs: booksParagraphs_(booksStripHtml_(res.getContentText())) };
  }
  if (!out.paragraphs.length) {
    return { status: 422, message: 'Nothing readable came back from the source.' };
  }
  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(out), 21600); } catch (eP) {}
  return { status: 200, data: out };
};

// --- The platform's own copy (books_text) ---

var BOOKS_TEXT_TAB = 'books_text';
var BOOKS_TEXT_HEADER = ['bookId', 'title', 'via', 'ord', 'text'];

function booksTextSheet_() {
  var existed = !!hubTabSheet_(BOOKS_TEXT_TAB);
  var sheet = hubTabEnsure_(BOOKS_TEXT_TAB, BOOKS_TEXT_HEADER);
  if (existed) ensureHeader_(sheet, BOOKS_TEXT_HEADER);
  return sheet;
}

// Old rows go in contiguous runs bottom-up, new ones land as one setValues block (never appendRow per paragraph).
function booksTextReplace_(sheet, bookId, title, via, paragraphs) {
  var values = sheet.getDataRange().getValues();
  var idxs = [];
  for (var i = 1; i < values.length; i++) {
    if (str_(values[i][0]) === bookId) idxs.push(i + 1);
  }
  for (var j = idxs.length - 1; j >= 0; j--) {
    var end = idxs[j], start = end;
    while (j > 0 && idxs[j - 1] === start - 1) { j--; start = idxs[j]; }
    sheet.deleteRows(start, end - start + 1);
  }
  var out = [];
  for (var k = 0; k < paragraphs.length; k++) {
    out.push([bookId, str_(title), str_(via), String(k), String(paragraphs[k]).slice(0, 8000)]);
  }
  if (out.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, out.length, BOOKS_TEXT_HEADER.length).setValues(out);
  }
  try { CacheService.getScriptCache().remove('books_read_v2_' + bookId); } catch (eC) {}
}

function booksHarvestOne_(row) {
  var url = str_(row.source) || str_(row.home);
  if (!url) return { why: 'This row names no source to read.' };
  if (!booksHostTrusted_(url)) return { why: 'That host is not on the trusted list.' };
  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } });
  } catch (e) {
    return { why: 'The publisher did not answer: ' + String((e && e.message) || e).slice(0, 140) };
  }
  if (res.getResponseCode() !== 200) {
    return { why: 'The publisher answered ' + res.getResponseCode() + '.' };
  }
  var blob = res.getBlob();
  var type = str_(blob.getContentType()).toLowerCase();
  var paras;
  if (type.indexOf('pdf') !== -1) {
    var tmp = booksFolder_().createFile(blob.setName('harvest-tmp-' + str_(row.id) + '.pdf'));
    var whyObj = {};
    var text = '';
    try { text = booksPdfText_(tmp.getId(), whyObj); }
    finally { try { tmp.setTrashed(true); } catch (eT) {} }
    if (!text) return { why: 'The PDF held no readable text' + (whyObj.reason ? ' — ' + whyObj.reason : '.') };
    paras = booksParagraphs_(text);
  } else {
    paras = booksParagraphs_(booksStripHtml_(res.getContentText()));
  }
  if (paras.length < 3) {
    return { why: 'Only ' + paras.length + ' readable paragraph' + (paras.length === 1 ? '' : 's') +
                  ' came back — a bot wall or an empty page, not the book.' };
  }
  return { paragraphs: paras };
}

/** Store the text of books still missing a copy, from inside Apps Script; 3 books or 4 minutes per press. */
HUB_POLICY.booksHarvest = {
  file: 'Books.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['books'], emits: []
};
HUB_ACTIONS.booksHarvest = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var started = Date.now();
  var counts = {};
  try {
    // Count where booksTextSheet_ writes, or every book reads as missing and re-harvests forever.
    readTabNormalized_(hubTabWorkbook_(BOOKS_TEXT_TAB), BOOKS_TEXT_TAB).forEach(function (t) {
      var b = str_(t.bookid);
      if (b) counts[b] = (counts[b] || 0) + 1;
    });
  } catch (eTab) {}
  var rows = listRows_('books', {});
  var need = [];
  for (var i = 0; i < rows.length; i++) {
    if ((counts[str_(rows[i].id)] || 0) < 3) need.push(rows[i]);
  }
  var harvested = [], failed = [];
  var sheet = null;
  for (var n = 0; n < need.length; n++) {
    if (harvested.length >= 3 || Date.now() - started > BOOKS_RUN_MS) break;
    var row = need[n];
    var got = booksHarvestOne_(row);
    if (got.why) { failed.push({ title: str_(row.title), why: got.why }); continue; }
    if (!sheet) sheet = booksTextSheet_();
    booksTextReplace_(sheet, str_(row.id), str_(row.title), 'harvest', got.paragraphs);
    harvested.push(str_(row.title));
  }
  hubSysLog_(user && user.email, 'books_harvest',
             harvested.length + ' harvested, ' + failed.length + ' failed', { status: 200 });
  return { status: 200, data: {
    harvested: harvested, failed: failed,
    remaining: need.length - harvested.length
  } };
};

/** Upload a book's PDF or HTML by hand: held on the shelf and its text stored in the same call. */
HUB_POLICY.booksFileUpload = {
  file: 'Books.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { id: { required: true, type: 'string' } },
  invalidates: ['books'], emits: []
};
HUB_ACTIONS.booksFileUpload = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which book?' };
  var rows = listRows_('books', {});
  var row = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].id) === id) { row = rows[i]; break; }
  }
  if (!row) return { status: 404, message: 'That book is not on the shelf.' };
  var name = str_(payload.filename) || 'book';
  var mime = str_(payload.mime).toLowerCase();
  var isPdf = mime.indexOf('pdf') !== -1 || /\.pdf$/i.test(name);
  var isHtml = mime.indexOf('html') !== -1 || /\.html?$/i.test(name);
  if (!isPdf && !isHtml) {
    return { status: 400, message: 'A PDF or an HTML file — that is what the reader can hold.' };
  }
  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'The file is required.' };
  // ~15MB decoded: base64 carries 4/3 of the bytes.
  if (b64.length > 21000000) {
    return { status: 400, message: 'The file is too large — up to 15MB.' };
  }
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty.' };

  var ext = isPdf ? '.pdf' : '.html';
  var driveName = booksFileName_(str_(row.title)) + ext;
  var folder = booksFolder_();
  var old = folder.getFilesByName(driveName);
  while (old.hasNext()) old.next().setTrashed(true);
  var file = folder.createFile(Utilities.newBlob(
    bytes, mime || (isPdf ? 'application/pdf' : 'text/html'), driveName));
  updateRowById_('books', id, {
    driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    fileSize: booksHumanSize_(bytes.length),
    fetchNote: ''
  });

  var note = '';
  var stored = 0;
  var whyObj = {};
  var text = isPdf ? booksPdfText_(file.getId(), whyObj)
                   : booksStripHtml_(Utilities.newBlob(bytes, 'text/html', driveName).getDataAsString());
  var paras = text ? booksParagraphs_(text) : [];
  if (paras.length >= 3) {
    booksTextReplace_(booksTextSheet_(), id, str_(row.title), 'upload', paras);
    stored = paras.length;
  } else {
    note = 'The file is held on the shelf, but its text could not be stored' +
           (whyObj.reason ? ' — ' + whyObj.reason : (text ? ' — too little readable text came out.' : '.'));
  }
  hubSysLog_(user && user.email, 'books_upload', driveName + ' (' + stored + ' paragraphs)', { status: 200 });
  return { status: 200, data: {
    saved: driveName,
    driveUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    fileSize: booksHumanSize_(bytes.length),
    paragraphs: stored,
    note: note
  } };
};
