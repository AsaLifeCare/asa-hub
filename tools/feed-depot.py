#!/usr/bin/env python3
"""Append each one-tab house's header schema and pointer facts to the Essencial, only when changed."""
import json
import sys
import time
import urllib.parse
import urllib.request

ESSENCIAL_ID = '1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug'
TEMPLATE_ID = '1hYOkEHldO4HDK5IWjWU9ZW1J9mTCiCVnHDTQAeuquOQ'
ENV_PATH = '/opt/docker/asa-hub/server/.tools.env'

HOUSES = [
    '1bLSxXOzmNS8gURKpDP9cnhPzk2qquPNqUS7CGd0og50',   # ASA Data — Calls
    '1LTjGr4SwGiH1vRIcxXEiHO916lfKbK986dqb4OOst5E',   # ASA Data — Discrepancies
    '1_iaA96LaWHr2cmQri__07Kc5fIv57ORbnUgyXpaVDEQ',   # ASA Data — Doses
    '1Z8Y_Fy-ev3XGIBr6J8jnNyvvRWw1oppJ5udJ4NsFb80',   # ASA Data — Ledger
    '1vfudoXe0_KOqM7hX-8yPgD4mR8pdXoeCfTj48SFGq70',   # ASA Data — Pages
    '1v8cjlnGBwAF6D8lSO_Yp86dTUfZYTSWjDPLEWzL5cdY',   # ASA Data — Punches
    '1QvwIN5zYNL17hPwIV4DSkdIhKQJa89qTlYBIl86asuI',   # ASA Data — Recaps
    '1SvjfWgjiMC9lzB73PoveTc9pjqgjZ4ATp5OohCsz8p4',   # ASA Data — Slips
    '1JLHYYp0Wf7bEQIE8S1rjme2yhArDp_AarpoYe4gj7p0',   # ASA Data — States
    '1iah-NnxyheBhiiAi2GwfqO-MXjfTxRhBkXo0UjZJEMg',   # ASA Data — Texts
]


def token():
    env = {}
    for line in open(ENV_PATH):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k] = v
    body = urllib.parse.urlencode({
        'client_id': env['GS_GOOGLE_CLIENT_ID'],
        'client_secret': env['GS_GOOGLE_CLIENT_SECRET'],
        'refresh_token': env['GS_GOOGLE_REFRESH_TOKEN'],
        'grant_type': 'refresh_token'}).encode()
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=body)
    return json.load(urllib.request.urlopen(req))['access_token']


TOKEN = token()
SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/'


def api(url, payload=None, method='GET', tries=8):
    for attempt in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header('Authorization', 'Bearer ' + TOKEN)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, body, timeout=300) as resp:
                return json.load(resp)
        except Exception as err:
            if getattr(err, 'code', 0) in (400, 403, 404):
                raise
            if attempt < tries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise


def depot_state():
    """Newest Value per Source on the Facts tab; the last row wins."""
    rows = api(SHEETS + ESSENCIAL_ID + '/values/' +
               urllib.parse.quote("'Facts'!A2:I999999")).get('values') or []
    state = {}
    for row in rows:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ''
    return state


def main():
    houses = sys.argv[1:] or HOUSES
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    have = depot_state()
    out = []
    for sid in houses:
        if sid == TEMPLATE_ID or sid == ESSENCIAL_ID:
            print('refused (not a house):', sid)
            continue
        meta = api(SHEETS + sid + '?fields=properties.title,sheets.properties.title')
        title = meta['properties']['title']
        tabs = [s['properties']['title'] for s in meta['sheets']]
        if len(tabs) != 1:
            print(f'SKIP {title}: a house carries ONE tab, this has {len(tabs)}')
            continue
        tab = tabs[0]
        header = (api(SHEETS + sid + '/values/' +
                      urllib.parse.quote(f"'{tab}'!1:1")).get('values') or [[]])[0]
        header = [str(h) for h in header if str(h).strip()]
        if not header:
            print(f'SKIP {title}: no readable header — nothing feeds a lie')
            continue

        schema_src = 'schema:' + tab + '.header'
        schema_val = json.dumps(header, separators=(',', ':'))
        if have.get(schema_src) != schema_val:
            out.append(['schema.' + tab + '.header', '__schema', schema_val, '',
                        schema_src, '', now, 'feed-depot', ''])
            print(f'{title}: schema {schema_src} ({len(header)} columns)')

        key = 'HUB_HOUSE_' + tab.upper() + '_ID'
        props_src = 'switchboard:props.' + key
        if have.get(props_src) != sid:
            out.append(['config.props.' + key.lower().replace('_', ''), key, sid, '',
                        props_src, '', now, 'feed-depot', ''])
            print(f'{title}: pointer {key} = {sid[:12]}…')

    if not out:
        print('depot already current — nothing to write')
        return
    api(SHEETS + ESSENCIAL_ID + '/values/' + urllib.parse.quote("'Facts'!A1") +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
        {'values': out}, 'POST')
    print(f'\n{len(out)} fact(s) appended to the Essencial')
    fresh = depot_state()
    bad = [r[4] for r in out if fresh.get(r[4]) != r[2]]
    print('VERIFY:', 'all present' if not bad else 'MISSING: ' + ', '.join(bad))


if __name__ == '__main__':
    main()
