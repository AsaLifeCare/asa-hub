#!/usr/bin/env python3
"""Mint hiring's ten data books (15 Journal … 24 Roster); idempotent via books.json and the Registry."""
import json, os, re, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
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
T = json.load(urllib.request.urlopen(urllib.request.Request(
    'https://oauth2.googleapis.com/token', data=data)))['access_token']
S = 'https://sheets.googleapis.com/v4/spreadsheets/'


def api(url, payload=None, method='GET', tries=6):
    for a in range(tries):
        r = urllib.request.Request(url, method=method)
        r.add_header('Authorization', 'Bearer ' + T)
        b = json.dumps(payload).encode() if payload is not None else None
        if b:
            r.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(r, b, timeout=180) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and a < tries - 1:
                time.sleep(6 * (a + 1))
                continue
            raise


DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
ESS = '1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug'
BOSS = json.load(open('/opt/docker/docs/asa-hub/backup-2026-09-01/boss-matrix.json'))
MATRIX = ['Overview', 'Conditions', 'Flow Bindings', 'Stage Hooks', 'Transitions',
          'Actions', 'Smart Comms', 'Facts', 'Forms', 'Documents',
          'Document Registries', 'Review Guide']
hdrF = BOSS['Facts'][0]
hdrR = BOSS['Document Registries'][0]
CENSUS = json.load(open(os.path.join(HERE, 'legacy-census.json')))

# tab, context slug, book title, key column as spelled in the tab
TEN = [
    ('hiring_journey',       'journal',     'ASA Hiring — 15 Journal',     'journey_id'),
    ('candidate_documents',  'vault',       'ASA Hiring — 16 Vault',       'doc_row_id'),
    ('hiring_sim_asks',      'followups',   'ASA Hiring — 17 Follow-ups',  'sim_ask_id'),
    ('interview_asks',       'invitations', 'ASA Hiring — 18 Invitations', 'ask_id'),
    ('entity_hiring_events', 'calendar',    'ASA Hiring — 19 Calendar',    'event_id'),
    ('entity_resume_inbox',  'inbox',       'ASA Hiring — 20 Inbox',       'file_id'),
    ('entity_onboardings',   'visits',      'ASA Hiring — 21 Visits',      'candidate_id'),
    ('hiring_policy',        'rulebook',    'ASA Hiring — 22 Rulebook',    'key'),
    ('interview_ask_ai',     'verdicts',    'ASA Hiring — 23 Verdicts',    'message_id'),
    ('candidates',           'roster',      'ASA Hiring — 24 Roster',      'id'),
]


def norm(c):
    return re.sub(r'[^A-Za-z0-9]+', '', str(c)).lower()


books = json.load(open(os.path.join(HERE, 'books.json')))
made = []
for tab, ctx, title, key in TEN:
    bkey = 'data-' + tab
    if bkey in books:
        print(f'{tab:24} already {books[bkey]}')
        continue
    vals = api(S + DB + '/values/' + urllib.parse.quote(f"'{tab}'!A1:BZ1")).get('values') or [[]]
    cols = [str(c) for c in (vals[0] if vals else []) if str(c).strip()]
    if not cols:
        cols = [str(c) for c in ((CENSUS.get(tab) or {}).get('header') or [])]
    if not cols:
        raise SystemExit(f'{tab}: no header anywhere — refusing to mint an empty schema')
    body = {'properties': {'title': title},
            'sheets': [{'properties': {'title': t, 'gridProperties': {'frozenRowCount': 1}}}
                       for t in MATRIX]}
    sid = api(S, body, 'POST')['spreadsheetId']
    facts = [hdrF]
    for c in cols:
        d = {x: '' for x in hdrF}
        d['Fact ID'] = 'legacy.' + tab + '.' + norm(c)
        d['Adapter'] = tab.split('_')[0]
        d['Type'] = 'string'
        d['Current Source'] = tab + '.' + c
        d['Complete Fact Config'] = json.dumps(
            {'adapter': tab.split('_')[0], 'current_source': tab + '.' + c,
             'type': 'string'}, separators=(',', ':'))
        facts.append([d[x] for x in hdrF])
    reg = {x: '' for x in hdrR}
    reg['Registry ID'] = tab
    reg['Layer'] = 'dissolved legacy tab'
    reg['Storage / Source'] = 'ASA — Essencial / Facts (dissolution:' + tab + '.*)'
    reg['Record ID'] = key
    reg['Label'] = title.split('— ')[-1]
    reg['Kind'] = 'row store'
    reg['Core Fields / Parameters'] = ','.join(cols)[:900]
    reg['Status'] = 'dissolved 2026-09-02'
    for t in MATRIX:
        if t in ('Overview', 'Review Guide', 'Facts', 'Document Registries'):
            continue
        api(S + sid + '/values/' + urllib.parse.quote(f"'{t}'!A1") + '?valueInputOption=RAW',
            {'values': [BOSS[t][0]]}, 'PUT')
    api(S + sid + '/values/' + urllib.parse.quote("'Facts'!A1") + '?valueInputOption=RAW',
        {'values': facts}, 'PUT')
    api(S + sid + '/values/' + urllib.parse.quote("'Document Registries'!A1") + '?valueInputOption=RAW',
        {'values': [hdrR, [reg[x] for x in hdrR]]}, 'PUT')
    api(S + sid + '/values/' + urllib.parse.quote("'Review Guide'!A1") + '?valueInputOption=RAW',
        {'values': [[str(c) for c in r] for r in BOSS['Review Guide']]}, 'PUT')
    api(S + sid + '/values/' + urllib.parse.quote("'Overview'!A1") + '?valueInputOption=RAW',
        {'values': [[f'{title}. The {tab} tab, in his matrix. Its rows left ASA Hub — DB '
                     f'on 2026-09-02 and live in ASA — Essencial as facts stamped '
                     f'dissolution:{tab}.<column>; a row is identified by {key}. This book '
                     f'says what each column IS; the runtime holds the values.']]}, 'PUT')
    books[bkey] = sid
    json.dump(books, open(os.path.join(HERE, 'books.json'), 'w'), indent=1)
    made.append((tab, ctx, title, sid))
    print(f'{tab:24} {sid}  ({len(cols)} columns)')

regrows = api(S + ESS + '/values/' + urllib.parse.quote('Registry!A1:E')).get('values') or []
have = {str(r[0]).strip() for r in regrows[1:] if r}
add = []
for tab, ctx, title, _ in TEN:
    sid = books.get('data-' + tab)
    if not sid or ctx in have:
        continue
    add.append([ctx, sid, 'on', f'{title} (data: {tab})', ''])
if add:
    api(S + ESS + '/values/' + urllib.parse.quote('Registry!A1') +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {'values': add}, 'POST')
print(f'\n{len(made)} books minted · {len(add)} registry rows hung')
for tab, ctx, title, sid in made:
    print(f'  {title}  {sid}')
