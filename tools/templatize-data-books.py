#!/usr/bin/env python3
"""Rebuild the ten ASA Hiring data books from the template's sheets; book IDs stay the same."""
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


def api(url, payload=None, method='GET', tries=8):
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
                time.sleep(5 * (a + 1))
                continue
            raise


TPL = '1hYOkEHldO4HDK5IWjWU9ZW1J9mTCiCVnHDTQAeuquOQ'
MATRIX = ['Overview', 'Conditions', 'Flow Bindings', 'Stage Hooks', 'Transitions',
          'Actions', 'Smart Comms', 'Facts', 'Forms', 'Documents',
          'Document Registries', 'Review Guide']
BOSS = json.load(open('/opt/docker/docs/asa-hub/backup-2026-09-01/boss-matrix.json'))
hdrF = BOSS['Facts'][0]
hdrR = BOSS['Document Registries'][0]
CENSUS = json.load(open(os.path.join(HERE, 'legacy-census.json')))
books = json.load(open(os.path.join(HERE, 'books.json')))
DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'

TEN = [
    ('hiring_journey',       'ASA Hiring — 15 Journal',     'journey_id'),
    ('candidate_documents',  'ASA Hiring — 16 Vault',       'doc_row_id'),
    ('hiring_sim_asks',      'ASA Hiring — 17 Follow-ups',  'sim_ask_id'),
    ('interview_asks',       'ASA Hiring — 18 Invitations', 'ask_id'),
    ('entity_hiring_events', 'ASA Hiring — 19 Calendar',    'event_id'),
    ('entity_resume_inbox',  'ASA Hiring — 20 Inbox',       'file_id'),
    ('entity_onboardings',   'ASA Hiring — 21 Visits',      'candidate_id'),
    ('hiring_policy',        'ASA Hiring — 22 Rulebook',    'key'),
    ('interview_ask_ai',     'ASA Hiring — 23 Verdicts',    'message_id'),
    ('candidates',           'ASA Hiring — 24 Roster',      'id'),
]


def norm(c):
    return re.sub(r'[^A-Za-z0-9]+', '', str(c)).lower()


tpl_sheets = [(s['properties']['title'], s['properties']['sheetId'])
              for s in api(S + TPL + '?fields=sheets.properties')['sheets']]

for tab, title, key in TEN:
    sid = books['data-' + tab]
    old = [s['properties'] for s in api(S + sid + '?fields=sheets.properties')['sheets']]
    already = {p['title'] for p in old}
    if already == set(MATRIX) and any(p.get('templated') for p in old):
        pass
    new_ids = {}
    for tname, tsid in tpl_sheets:
        res = api(S + TPL + '/sheets/' + str(tsid) + ':copyTo',
                  {'destinationSpreadsheetId': sid}, 'POST')
        new_ids[tname] = res['sheetId']
    reqs = [{'deleteSheet': {'sheetId': p['sheetId']}} for p in old]
    for i, tname in enumerate(MATRIX):
        reqs.append({'updateSheetProperties': {
            'properties': {'sheetId': new_ids[tname], 'title': tname, 'index': i},
            'fields': 'title,index'}})
    api(S + sid + ':batchUpdate', {'requests': reqs}, 'POST')

    vals = api(S + DB + '/values/' + urllib.parse.quote(f"'{tab}'!A1:BZ1")).get('values') or [[]]
    cols = [str(c) for c in (vals[0] if vals else []) if str(c).strip()]
    if not cols:
        cols = [str(c) for c in ((CENSUS.get(tab) or {}).get('header') or [])]
    facts = []
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
    api(S + sid + '/values/' + urllib.parse.quote("'Facts'!A2") + '?valueInputOption=RAW',
        {'values': facts}, 'PUT')
    api(S + sid + '/values/' + urllib.parse.quote("'Document Registries'!A2") + '?valueInputOption=RAW',
        {'values': [[reg[x] for x in hdrR]]}, 'PUT')
    api(S + sid + '/values/' + urllib.parse.quote("'Overview'!A1") + '?valueInputOption=RAW',
        {'values': [[f'{title}. The {tab} tab, in his matrix. Its rows left ASA Hub — DB '
                     f'on 2026-09-02 and live in ASA — Essencial as facts stamped '
                     f'dissolution:{tab}.<column>; a row is identified by {key}. This book '
                     f'says what each column IS; the runtime holds the values.']]}, 'PUT')
    print(f'{title:30} rebuilt from template · {len(cols)} facts')
print('done')
