#!/usr/bin/env python3
"""Mint the IST app book — the missing HALF of the pair.

THE RULE: an app needs TWO sheets to work — an ASA Hub and an ASA Data that
is its database. Five examples were checked to settle the shape.
Seen (Users, Guardian, Mail, Clients, Directors): every app is
an "ASA Apps — X" book — the boss's 12-tab matrix — hung on the Essencial
Registry with Context = the app id, beside its "ASA Data — X" house. IST
had the house only.

mint-data-books.py's own recipe: the 12 tabs with the boss-matrix.json
headers (Review Guide verbatim — its 19 rows), Conditions carrying the
REAL rules extracted from the code (never just the header — the
conditions-carry-data law), Actions as the doors, Facts as one row per
column, Document Registries naming the storage. Idempotent via books.json.

    python3 tools/mint_ist_book.py
"""
import json
import os
import time
import urllib.parse
import urllib.request

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
ESS = '1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug'
HOUSE_RECORDS = 'switchboard:props.HUB_HOUSE_IST_RECORDS_ID'
HOUSE_MAP = 'switchboard:props.HUB_HOUSE_IST_HOUSES_ID'


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


BOSS = json.load(open('/opt/docker/docs/asa-hub/backup-2026-09-01/boss-matrix.json'))
MATRIX = ['Overview', 'Conditions', 'Flow Bindings', 'Stage Hooks', 'Transitions',
          'Actions', 'Smart Comms', 'Facts', 'Forms', 'Documents',
          'Document Registries', 'Review Guide']
CTX, TITLE = 'ist', 'ASA Apps — IST Records'
COLS = ['id', 'createdAt', 'updatedAt', 'staffName', 'staffEmail', 'staffPhone', 'avatar',
        'clientName', 'house', 'dueDate', 'status', 'certNote',
        'trainedAt', 'trainedBy', 'notifiedAt', 'notifyCount', 'remindRequested', 'houseStatus']

hdrC = BOSS['Conditions'][0]
hdrA = BOSS['Actions'][0]
hdrF = BOSS['Facts'][0]
hdrR = BOSS['Document Registries'][0]


def row(hdr, **kw):
    d = {x: '' for x in hdr}
    for k, v in kw.items():
        col = k.replace('_', ' ').title().replace('Id', 'ID')
        for h in hdr:
            if h.lower().replace(' ', '').replace('/', '') == k.lower().replace('_', ''):
                col = h
                break
        d[col] = v
    return [d.get(x, '') for x in hdr]


# ── Conditions: the RULES the code actually enforces, one sentence each ──
CONDITIONS = [
    ('ist.pair.exists', 'A training pair exists only where the roster proves the employee '
     'worked at the house ON OR AFTER the client arrived — an obligation nobody could '
     'have owed is noise (tools/rebuild_ist.py overlap test).', 'system', '1'),
    ('ist.due.latest_of', 'The date owed is the LATEST of first qualifying shift and client '
     'start — a training dated before the client lived there proves nothing.', 'system', '0'),
    ('ist.status.done_means_proof', 'A row is done only with trainedAt AND trainedBy on it — '
     'the fact of the training, never a bare flip.', 'manager', '1'),
    ('ist.trainedat.server_stamped', 'Flipping status to done through the CRUD lane stamps '
     'trainedAt SERVER-side and clears it on leaving done (Main.gs stampWhen) — a '
     'client-sent trainedAt is never trusted there; bulk history loads write the tab '
     'directly.', 'system', '1'),
    ('ist.access.managers_only', 'The rows carry staff phones and e-mails: reads are refused '
     'to every role but admin and manager AT THE DATA (Main.gs istRecords guard) — the '
     'screen gate alone is not a gate.', 'system', '1'),
    ('ist.merge.never_delete', 'Rebuilds and imports MERGE, never replace, never delete — a '
     'pair that stops mapping gets houseStatus "house no longer mapped", not a DELETE.',
     'system', '1'),
    ('ist.cert.note_only', 'A missing MAIS certification is printed on the record '
     '(certNote); expiry is Certs.gs business, not this table\'s.', 'system', '0'),
    ('ist.intake.mark_trained', 'The Hub\'s own Mark-trained action is the intake since '
     '2026-09-08; the estate\'s Google Form is history, copied once by '
     'tools/import_ist_done.py.', 'manager', '0'),
]

# ── Actions: the doors, in the app books' own grammar ──
ACTIONS = [
    ('ist.list', 'gas:list(istRecords)', 'command', '',
     'the table, via the generic resource lane; roles admin+manager at the data'),
    ('ist.mark_trained', 'gas:update(istRecords)', 'command', '["id","status"]',
     'status→done; trainedAt stamped server-side (stampWhen)'),
    ('ist.remind', 'gas:istRemind', 'command', '["id"]',
     'queues the notice for Smart Comms; writes remindRequested/notifiedAt/notifyCount'),
    ('ist.rebuild_owed', 'tools:rebuild_ist.py', 'batch', '["--dry-run"]',
     'the owed derivation — roster×houses×clients off Postgres; depot-resolved'),
    ('ist.import_done', 'tools:import_ist_done.py', 'batch', '["--dry-run"]',
     'the one-time history copy from the estate form mirror; idempotent'),
]

try:
    books = json.load(open(os.path.join(HERE, 'books.json')))
except FileNotFoundError:
    books = {}
if 'app-ist' in books:
    print(f'already minted: {books["app-ist"]}')
    sid = books['app-ist']
else:
    body = {'properties': {'title': TITLE},
            'sheets': [{'properties': {'title': t, 'gridProperties': {'frozenRowCount': 1}}}
                       for t in MATRIX]}
    sid = api(S, body, 'POST')['spreadsheetId']

    for t in MATRIX:
        if t in ('Overview', 'Review Guide'):
            continue
        api(S + sid + '/values/' + urllib.parse.quote(f"'{t}'!A1") + '?valueInputOption=RAW',
            {'values': [BOSS[t][0]]}, 'PUT')

    cond_rows = [hdrC]
    for cid, truth, owner, blocking in CONDITIONS:
        cond_rows.append(row(hdrC, condition_id=cid, version='1.0', family='ist',
                             truth=truth, owner_role=owner, blocking=blocking,
                             machine_resolved='0'))
    api(S + sid + '/values/' + urllib.parse.quote("'Conditions'!A1") + '?valueInputOption=RAW',
        {'values': cond_rows}, 'PUT')

    act_rows = [hdrA]
    for aid, handler, mode, params, note in ACTIONS:
        act_rows.append(row(hdrA, action_id=aid, handler=handler, mode=mode,
                            parameters=params,
                            complete_action_config=json.dumps(
                                {'handler': handler, 'mode': mode, 'note': note},
                                separators=(',', ':'))))
    api(S + sid + '/values/' + urllib.parse.quote("'Actions'!A1") + '?valueInputOption=RAW',
        {'values': act_rows}, 'PUT')

    fact_rows = [hdrF]
    for c in COLS:
        fact_rows.append(row(hdrF, fact_id='ist.' + c.lower(), adapter='ist', type='string',
                             current_source='ist_records.' + c,
                             complete_fact_config=json.dumps(
                                 {'adapter': 'ist', 'current_source': 'ist_records.' + c,
                                  'type': 'string'}, separators=(',', ':'))))
    api(S + sid + '/values/' + urllib.parse.quote("'Facts'!A1") + '?valueInputOption=RAW',
        {'values': fact_rows}, 'PUT')

    reg_rows = [hdrR,
                row(hdrR, registry_id='ist_records', layer='data house',
                    **{'Storage / Source': f'ASA Data — IstRecords, via {HOUSE_RECORDS}'},
                    record_id='id', label='Who owes a client training, and who does not',
                    kind='row store'),
                row(hdrR, registry_id='ist_houses', layer='data house',
                    **{'Storage / Source': f'ASA Data — IstHouses, via {HOUSE_MAP}'},
                    record_id='id', label='Which house each client lives in',
                    kind='map')]
    api(S + sid + '/values/' + urllib.parse.quote("'Document Registries'!A1") + '?valueInputOption=RAW',
        {'values': reg_rows}, 'PUT')

    api(S + sid + '/values/' + urllib.parse.quote("'Review Guide'!A1") + '?valueInputOption=RAW',
        {'values': [[str(c) for c in r] for r in BOSS['Review Guide']]}, 'PUT')

    api(S + sid + '/values/' + urllib.parse.quote("'Overview'!A1") + '?valueInputOption=RAW',
        {'values': [[f'{TITLE}. The IST app: who has been trained on which client, and who '
                     f'still owes it. The rows live in ASA Data — IstRecords (declared by '
                     f'{HOUSE_RECORDS} + moved.ist_records); the house map lives in '
                     f'ASA Data — IstHouses. Derivation: tools/rebuild_ist.py (owed, off the '
                     f'Postgres roster) and tools/import_ist_done.py (the estate form history, '
                     f'copied once 2026-09-08). Intake since then: the Mark-trained action. '
                     f'This book says what the table IS; the house holds the values.']]}, 'PUT')

    books['app-ist'] = sid
    json.dump(books, open(os.path.join(HERE, 'books.json'), 'w'), indent=1)
    print(f'minted: {TITLE} = {sid}')

# hang it on the Registry (Context = the app id; skip when present)
regrows = api(S + ESS + '/values/' + urllib.parse.quote('Registry!A1:E')).get('values') or []
have = {str(r[0]).strip() for r in regrows[1:] if r}
if CTX in have:
    print(f'registry already carries "{CTX}"')
else:
    api(S + ESS + '/values/' + urllib.parse.quote('Registry!A1') +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
        {'values': [[CTX, sid, 'on', 'app book', '']]}, 'POST')
    print(f'registry: hung "{CTX}" → {sid}')
