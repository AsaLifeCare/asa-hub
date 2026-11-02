#!/usr/bin/env python3
"""ONE SPREADSHEET PER FUNCTIONALITY — the homes for the big tabs.

The law: each of their sheets is one
functionality, so each becomes one spreadsheet of ours. No generic piles.

Each home: a single data tab carrying the tab's REAL header and every row,
copied verbatim from HUB_DB and verified by count before anything is
claimed. The matrix book that DESCRIBES the functionality stays separate
(twelve tabs, untouched). Nothing is deleted from HUB_DB here — that
happens only after HUB_TAB_HOME points at the home and is published.
"""
import json, os, sys, time, urllib.request, urllib.parse

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
DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
KEYS = '10-XuWomnI9p2260WW4OetS-wpSSEWCaIByR3PKZQvDY'
ESS = '1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug'


def api(url, payload=None, method='GET', tries=10):
    for a in range(tries):
        r = urllib.request.Request(url, method=method)
        r.add_header('Authorization', 'Bearer ' + T)
        b = json.dumps(payload).encode() if payload is not None else None
        if b:
            r.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(r, b, timeout=300) as resp:
                return json.load(resp)
        except Exception:
            if a < tries - 1:
                time.sleep(5 * (a + 1))
                continue
            raise


# tab -> (functionality name, the property the code will read)
HOMES = [
    ('quo_transcripts', 'Calls', 'HUB_CALLS_BOOK_ID'),
    ('quo_messages', 'Texts', 'HUB_TEXTS_BOOK_ID'),
    ('quo_summaries', 'Recaps', 'HUB_RECAPS_BOOK_ID'),
    ('mar_entries', 'Doses', 'HUB_DOSES_BOOK_ID'),
    ('mar_errors', 'Slips', 'HUB_SLIPS_BOOK_ID'),
    ('finance_transactions', 'Ledger', 'HUB_LEDGER_BOOK_ID'),
    ('requirement_states', 'States', 'HUB_STATES_BOOK_ID'),
    ('books_text', 'Pages', 'HUB_PAGES_BOOK_ID'),
    ('recon_errors', 'Discrepancies', 'HUB_DISCREPANCIES_BOOK_ID'),
    ('time_punches', 'Punches', 'HUB_PUNCHES_BOOK_ID'),
]

books = json.load(open(os.path.join(HERE, 'books.json')))
made = []
for tab, name, prop in HOMES:
    key = 'home-' + tab
    vals = api(S + DB + '/values/' + urllib.parse.quote(f"'{tab}'!A1:CZ")).get('values') or []
    if not vals:
        print(f'{tab:22} empty in HUB_DB — skipped')
        continue
    rows = len(vals) - 1
    width = max(len(r) for r in vals)
    if key in books:
        sid = books[key]
    else:
        sid = api(S, {'properties': {'title': 'ASA Data — ' + name},
                      'sheets': [{'properties': {
                          'title': tab, 'gridProperties': {
                              'rowCount': max(1000, rows + 200),
                              'columnCount': max(26, width + 4),
                              'frozenRowCount': 1}}}]}, 'POST')['spreadsheetId']
        books[key] = sid
        json.dump(books, open(os.path.join(HERE, 'books.json'), 'w'), indent=1)
    # pad every row to the same width; the API drops ragged tails otherwise
    grid = [list(r) + [''] * (width - len(r)) for r in vals]
    api(S + sid + '/values/' + urllib.parse.quote(f"'{tab}'!A1:CZ") + ':clear', {}, 'POST')
    for i in range(0, len(grid), 2000):
        api(S + sid + '/values/' + urllib.parse.quote(f"'{tab}'!A{i + 1}") +
            '?valueInputOption=RAW', {'values': grid[i:i + 2000]}, 'PUT')
    # COUNT THE GRID, NOT COLUMN A (learned on perf_incidents):
    # 1,123 of its 1,946 rows carry no emp_id, so an A:A read reports a third
    # of the tab and a perfect copy looks like a loss.
    back = max(0, len(api(S + sid + '/values/' + urllib.parse.quote(f"'{tab}'!A1:CZ")).get('values') or []) - 1)
    ok = back == rows
    made.append({'tab': tab, 'name': name, 'prop': prop, 'id': sid,
                 'rows': rows, 'copied': back, 'ok': ok})
    print(f'{tab:22} → ASA Data — {name:14} {rows:6} rows · copied {back:6} · {"OK" if ok else "MISMATCH"}  {sid}')

# the ids land in the Keys ledger — the platform's own record of where things live
if made:
    rows = [[m['prop'], m['id'], f"ASA Data — {m['name']} (home of {m['tab']}, one spreadsheet per functionality)"]
            for m in made if m['ok']]
    have = {str(r[0]).strip() for r in (api(S + KEYS + '/values/' + urllib.parse.quote("'Facts'!D2:D")).get('values') or []) for r in [r]}
    api(S + ESS + '/values/' + urllib.parse.quote("'Facts'!A1") +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
        {'values': [['config.props.' + m['prop'].lower().replace('_', ''), m['prop'], m['id'], '',
                     'switchboard:props.' + m['prop'], '',
                     time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'switchboard', '']
                    for m in made if m['ok']]}, 'POST')
    hdrF = (api(S + KEYS + '/values/' + urllib.parse.quote("'Facts'!A1:Z1")).get('values') or [[]])[0]
    frows = []
    for m in made:
        if not m['ok']:
            continue
        d = {x: '' for x in hdrF}
        d['Fact ID'] = 'config.props.' + m['prop'].lower().replace('_', '')
        d['Adapter'] = 'props'
        d['Type'] = 'string'
        d['Current Source'] = 'props.' + m['prop']
        d['Complete Fact Config'] = json.dumps(
            {'adapter': 'props', 'current_source': 'props.' + m['prop'], 'type': 'string'},
            separators=(',', ':'))
        frows.append([d[x] for x in hdrF])
    if frows:
        api(S + KEYS + '/values/' + urllib.parse.quote("'Facts'!A1") +
            ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {'values': frows}, 'POST')

json.dump(made, open(os.path.join(HERE, 'homes.json'), 'w'), indent=1)
good = sum(1 for m in made if m['ok'])
print(f'\n{good}/{len(made)} homes built and verified · ids recorded in the Keys ledger and the depot')
print('NOTHING deleted from HUB_DB — that waits for HUB_TAB_HOME to point here and be published.')
