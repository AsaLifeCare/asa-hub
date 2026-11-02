#!/usr/bin/env python3
"""Append what the legacy sheets grew since the dissolution to the Essencial; append-only, --dry counts only."""
import glob, json, re, sys, time, urllib.request, urllib.parse

DRY = '--dry' in sys.argv
DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
APPS = '1zP_zDVlqah1eCUjAaxnFkcTacOwMcZSDH4YwPAoLyOY'
ESS = '1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug'

env = {}
for line in open('/opt/docker/asa-hub/server/.tools.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k] = v
data = urllib.parse.urlencode({
    'client_id': env['GS_GOOGLE_CLIENT_ID'],
    'client_secret': env['GS_GOOGLE_CLIENT_SECRET'],
    'refresh_token': env['GS_GOOGLE_REFRESH_TOKEN'],
    'grant_type': 'refresh_token'}).encode()
TOKEN = json.load(urllib.request.urlopen(urllib.request.Request(
    'https://oauth2.googleapis.com/token', data=data)))['access_token']


def api(sid, path, payload=None, method='GET', tries=8):
    for a in range(tries):
        req = urllib.request.Request(
            'https://sheets.googleapis.com/v4/spreadsheets/' + sid + path, method=method)
        req.add_header('Authorization', 'Bearer ' + TOKEN)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, body, timeout=180) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and a < tries - 1:
                time.sleep(5 * (a + 1))
                continue
            raise


def norm(c):
    return re.sub(r'[^A-Za-z0-9]+', '', str(c)).lower()


NOW = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

CANON = {}
for p in sorted(glob.glob('/opt/docker/docs/asa-hub/backup-2026-09-01/extraction/module-??-*.json')):
    for r in json.load(open(p))['tabs'].get('Facts', []):
        src = str(r.get('Current Source', '')).strip()
        dot = src.find('.')
        if dot == -1 or str(r.get('Current Resolver', '')).strip():
            continue
        CANON.setdefault((src[:dot], norm(src[dot + 1:])), str(r['Fact ID']))

# subject key column per tab; else candidateid, else tab#row
KEY = {'hiring_sim_config': 'key', 'hiring_alerts_config': 'key',
       'recruitment_config': 'key', 'hiring_policy': 'key',
       'recruitment_contracts': 'signaturerequestid', 'recruitment_docs': 'signaturerequestid',
       'hiring_sim_ai': 'messageid', 'interview_ask_ai': 'messageid',
       'entity_resume_inbox': 'fileid', 'candidate_documents': 'docrowid',
       'entity_hiring_events': 'eventid', 'hiring_journey': 'journeyid',
       'hiring_sim_asks': 'simaskid', 'interview_asks': 'askid', 'candidates': 'id'}
HIRING_TABS = ['entity_candidates', 'entity_resume_analyses', 'entity_phone_screens',
               'entity_in_person_interviews', 'entity_onboardings', 'entity_hiring_events',
               'entity_resume_inbox', 'hiring_journey', 'hiring_sim_asks', 'hiring_sim_ai',
               'hiring_sim_config', 'hiring_policy', 'hiring_alerts_config',
               'interview_asks', 'interview_ask_ai', 'onboarding_packet',
               'recruitment_config', 'recruitment_contracts', 'recruitment_docs',
               'candidate_documents', 'candidates', 'tp_candidates', 'tp_resume', 'tp_screens']
# the original migrate never wrote SKIP_COLS facts for these tabs
MIGRATE_ONLY = {'entity_candidates', 'entity_resume_analyses', 'entity_phone_screens',
                'entity_in_person_interviews', 'onboarding_packet',
                'tp_candidates', 'tp_resume', 'tp_screens'}
SKIP_COLS = {'candidateid', 'candidatename', 'name', 'firstname'}
APP_TABS = {'shopper_items': 'id', 'shopper_prices': 'id', 'meal_profile': 'id',
            'meal_log': 'id', 'learn_skills': 'id', 'learn_attempts': 'id',
            'travel_trips': 'id', 'mail': 'id'}


def read_tab(sid, tab):
    vals = api(sid, '/values/' + urllib.parse.quote(f"'{tab}'!A1:BZ")).get('values') or []
    if not vals:
        return []
    hdr = [norm(h) for h in vals[0]]
    return [dict(zip(hdr, [str(x) for x in row])) for row in vals[1:]
            if any(str(x).strip() for x in row)]


def rowkey(tab, d, i, hub=True):
    if hub:
        k = str(d.get(KEY.get(tab, ''), '')).strip() or str(d.get('candidateid', '')).strip()
    else:
        k = str(d.get(APP_TABS.get(tab, 'id')) or d.get('userid') or
                d.get('email') or d.get('rowid') or '').strip()
    return k or f'{tab}#{i + 2}'


print('reading the Essencial …')
# Siblings share a subject: a cell is known if ANY fact for (tab, subject, column) carries it.
seen_vals = {}
vals = api(ESS, '/values/' + urllib.parse.quote("'Facts'!A1:I")).get('values') or []
for row in vals[1:]:
    row += [''] * (9 - len(row))
    src = str(row[4])
    if not src.startswith('dissolution:'):
        continue
    ref = src[len('dissolution:'):]
    dot = ref.find('.')
    if dot == -1:
        continue
    seen_vals.setdefault((ref[:dot], str(row[1]).strip(), ref[dot + 1:]), set()).add(str(row[2]))
migrated = {(t, s) for (t, s, _c) in seen_vals}
print(f'  {len(vals) - 1} facts · {len(migrated)} migrated rows known')


def existing_ids(tab, col='A'):
    v = api(ESS, '/values/' + urllib.parse.quote(f"'{tab}'!{col}2:{col}")).get('values') or []
    return {str(r[0]).strip() for r in v if r and str(r[0]).strip()}


subjects_have = existing_ids('Subjects')
instances_have = existing_ids('Flow Instances')
events_have = existing_ids('Events')
attempts_have = existing_ids('Action Attempts')
documents_have = existing_ids('Documents')

new_facts, new_subjects, new_instances = [], [], []
new_events, new_attempts, new_documents = [], [], []
STAGE = {'new': 'new', 'phone screen': 'phone-screen', 'in person': 'interview',
         'onboarding': 'onboarding', 'hired': 'hired', 'ready to start': 'ready'}


def emit(tab, sub, col, val):
    key = CANON.get((tab, col), f'legacy.{tab}.{col}')
    new_facts.append([key, sub, val, '', f'dissolution:{tab}.{col}', '',
                      NOW, 'dissolution', ''])


def sweep(sid, tab, hub=True):
    rows = read_tab(sid, tab)
    fresh = changed = 0
    for i, d in enumerate(rows):
        sub = rowkey(tab, d, i, hub)
        known = (tab, sub) in migrated
        for col, v in d.items():
            v = str(v).strip()
            if not col or not v:
                continue
            if hub and tab in MIGRATE_ONLY and col in SKIP_COLS:
                continue
            if not known:
                emit(tab, sub, col, v)
                fresh += 1
            elif v not in seen_vals.get((tab, sub, col), ()):
                emit(tab, sub, col, v)
                changed += 1
    if fresh or changed:
        print(f'  {tab:28} +{fresh} new-row facts · {changed} changed cells')
    return rows


# A deleted tab answers 400; skip the ones that are gone.
alive = {s['properties']['title']
         for s in api(DB, '?fields=sheets.properties.title')['sheets']}
alive_apps = {s['properties']['title']
              for s in api(APPS, '?fields=sheets.properties.title')['sheets']}
gone = [t for t in HIRING_TABS if t not in alive]
if gone:
    print(f'{len(gone)} hiring tab(s) no longer exist — they live in the depot: '
          + ', '.join(gone[:6]) + ('…' if len(gone) > 6 else ''))

L = {}
print('sweeping HUB_DB …')
for t in HIRING_TABS:
    L[t] = sweep(DB, t, hub=True) if t in alive else []
# A tab that moved house never also dissolves: an archive beside a live tab.
print('ASA Hub — Apps: skipped on purpose — those tabs MOVED HOUSE, they do '
      'not dissolve (' + ', '.join(sorted(APP_TABS)) + ')')

for c in L['entity_candidates']:
    cid = c.get('candidateid', '').strip()
    if not cid:
        continue
    stage = STAGE.get(c.get('status', '').strip().lower(), '')
    if cid not in subjects_have:
        new_subjects.append([cid, 'candidate', c.get('candidatename', ''), c.get('email', ''),
                             c.get('phone', ''), stage, c.get('status', ''),
                             c.get('createdat', ''), c.get('updatedat', ''),
                             'dissolution:entity_candidates',
                             'archived' if str(c.get('archived', '')).lower() == 'true' else ''])
    if 'FI_DISS_' + cid not in instances_have:
        new_instances.append(['FI_DISS_' + cid, 'hiring', '', cid, stage,
                              'closed' if str(c.get('archived', '')).lower() == 'true' else 'open',
                              c.get('createdat', '') or NOW, NOW, '', 'dissolution', '',
                              'dissolution:entity_candidates'])
for c in L['tp_candidates']:
    cid = c.get('candidateid', '').strip()
    if cid and cid not in subjects_have and not any(s[0] == cid for s in new_subjects):
        new_subjects.append([cid, 'pool', c.get('name', ''), c.get('email', ''),
                             c.get('phone', ''), '', c.get('status', ''),
                             c.get('createdat', ''), '', 'dissolution:tp_candidates',
                             c.get('src', '')])

for j in L['hiring_journey']:
    jid = j.get('journeyid', '').strip()
    if jid and jid not in events_have:
        new_events.append([jid, j.get('candidateid', ''), 'journey', j.get('step', ''),
                           j.get('channel', ''), j.get('title', ''),
                           (j.get('detail', '') + (' ref=' + j['ref'] if j.get('ref', '').strip() else '')),
                           j.get('to', ''), j.get('ok', ''), j.get('at', ''), j.get('by', ''),
                           j.get('rehearsal', ''), 'dissolution:hiring_journey'])
for e in L['entity_hiring_events']:
    eid = e.get('eventid', '').strip()
    if eid and eid not in events_have:
        new_events.append([eid, e.get('candidateid', ''), 'calendar', e.get('eventtype', ''), '',
                           (e.get('withname', '') + ' · ' + e.get('location', '')).strip(' ·'),
                           e.get('notes', ''), '', e.get('status', ''),
                           e.get('startsat', '') or (e.get('date', '') + ' ' + e.get('time', '')).strip(),
                           e.get('createdby', ''), '', 'dissolution:entity_hiring_events'])
for r in L['entity_resume_inbox']:
    eid = 'RI_' + r.get('fileid', '')[:22]
    if r.get('fileid', '').strip() and eid not in events_have:
        new_events.append([eid, r.get('candidateid', ''), 'resume_inbox', r.get('outcome', ''),
                           'drive', r.get('filename', ''), r.get('reason', ''), '', '',
                           r.get('readat', ''), r.get('readby', ''), '',
                           'dissolution:entity_resume_inbox'])
for m in L['hiring_sim_ai']:
    eid = 'AI_' + m.get('messageid', '')[:22]
    if m.get('messageid', '').strip() and eid not in events_have:
        new_events.append([eid, '', 'ai_memo', m.get('verdict', ''), m.get('via', ''),
                           m.get('names', ''), '', '', '', m.get('seenat', ''), '', '',
                           'dissolution:hiring_sim_ai'])

STEP_ACTION = {'resume_request': 'hiring.resume.request', 'cjis_request': 'hiring.cjis.request',
               'screen_invite': 'hiring.screen.invite', 'screen_call': 'hiring.screen.invite',
               'decision_ask': 'hiring.decision.ask', 'outreach': 'hiring.outreach.first_contact'}
for a in L['hiring_sim_asks']:
    aid = a.get('simaskid', '').strip()
    if aid and aid not in attempts_have:
        step = a.get('step', '').strip()
        new_attempts.append([aid, STEP_ACTION.get(step, 'legacy:' + step),
                             a.get('candidateid', ''), '', a.get('state', ''),
                             a.get('payloadjson', ''),
                             json.dumps({'sent': a.get('sentcount', ''), 'of': a.get('maxattempts', ''),
                                         'every_minutes': a.get('intervalminutes', ''),
                                         'answered_by': a.get('answeredby', '')}),
                             a.get('createdat', ''), a.get('answeredat', ''),
                             'dissolution:hiring_sim_asks', aid])
for a in L['interview_asks']:
    aid = a.get('askid', '').strip()
    if aid and aid not in attempts_have:
        new_attempts.append([aid, 'hiring.interview.invite', a.get('candidateid', ''), '',
                             a.get('state', ''), a.get('slotsjson', ''),
                             json.dumps({'picked_date': a.get('pickeddate', ''),
                                         'picked_time': a.get('pickedtime', ''),
                                         'supervisor_reply': a.get('supervisorreply', '')}),
                             a.get('invitedat', ''), a.get('offeredat', ''),
                             a.get('invitedby', '') or 'dissolution:interview_asks', aid])

for d in L['candidate_documents']:
    did = d.get('docrowid', '') or 'DOC_' + d.get('fileid', '')[:16]
    if did.strip() and did not in documents_have:
        new_documents.append([did, d.get('candidateid', ''), d.get('docid', ''),
                              'candidate_documents', d.get('fileid', ''), d.get('fileurl', ''),
                              d.get('status', ''), d.get('reviewstatus', ''), '',
                              d.get('expireson', ''),
                              (d.get('doclabel', '') + ' · dissolution:candidate_documents').strip(' ·')])
for d in L['recruitment_docs']:
    srid = d.get('signaturerequestid', '').strip()
    did = 'RD_' + srid[:20]
    if srid and did not in documents_have:
        new_documents.append([did, '', 'hiring.application_pdf', 'recruitment_docs', '',
                              d.get('docurl', ''), 'fetched', d.get('fetchedby', ''),
                              d.get('fetchedat', ''), '', 'dissolution:recruitment_docs srid=' + srid])
for p in L['onboarding_packet']:
    sub = p.get('candidateid', '').strip()
    for col, val in p.items():
        if col.endswith('fileid') and str(val).strip():
            did = 'PK_' + sub + '_' + col[:-6]
            if did not in documents_have:
                new_documents.append([did, sub, 'packet.' + col[:-6], 'onboarding_packet',
                                      str(val).strip(), '', 'on_file', '', '', '',
                                      'dissolution:onboarding_packet'])

plan = {'Facts': new_facts, 'Subjects': new_subjects, 'Flow Instances': new_instances,
        'Events': new_events, 'Action Attempts': new_attempts, 'Documents': new_documents}
print()
for t, rows in plan.items():
    print(f'{t:16} delta {len(rows)}')
if DRY:
    sys.exit(0)

meta = api(ESS, '?fields=sheets(properties(title,sheetId,gridProperties(rowCount)))')
grid = {s['properties']['title']: s['properties'] for s in meta['sheets']}
for t, rows in plan.items():
    if not rows:
        continue
    cur = len(api(ESS, '/values/' + urllib.parse.quote(f"'{t}'!A1:A")).get('values') or [])
    need = cur + len(rows) + 50
    g = grid[t]
    if g['gridProperties']['rowCount'] < need:
        api(ESS, ':batchUpdate', {'requests': [{'updateSheetProperties': {
            'properties': {'sheetId': g['sheetId'], 'gridProperties': {'rowCount': need}},
            'fields': 'gridProperties.rowCount'}}]}, 'POST')
    for i in range(0, len(rows), 500):
        api(ESS, '/values/' + urllib.parse.quote(f"'{t}'!A1") +
            ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
            {'values': rows[i:i + 500]}, 'POST')
    back = len(api(ESS, '/values/' + urllib.parse.quote(f"'{t}'!A1:A")).get('values') or []) - 1
    print(f'{t:16} appended {len(rows)} · tab now {back} rows')
print('delta landed')
