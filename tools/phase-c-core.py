#!/usr/bin/env python3
"""usage: phase-c-core.py plan|copy|verify|arm|disarm|cut (run by hand only: users carries password hashes)"""
import json, sys, time, urllib.parse as up, urllib.request

HUB_DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
ESS = '1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug'
CORE_TITLE = 'ASA Hub — Core'
STATE = '/tmp/phase-c-core.json'

# users and hub_sessions last: the other eight prove the mechanism first
CENTRAL = ['tenants', 'user_worlds', 'apps', 'app_builder', 'app_badge_access',
           'app_tenant_access', 'config_badge_access', 'hub_resources',
           'users', 'hub_sessions']

env = {}
for line in open('/opt/docker/asa-hub/server/.tools.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env[k] = v
_d = up.urlencode({'client_id': env['GS_GOOGLE_CLIENT_ID'],
                   'client_secret': env['GS_GOOGLE_CLIENT_SECRET'],
                   'refresh_token': env['GS_GOOGLE_REFRESH_TOKEN'],
                   'grant_type': 'refresh_token'}).encode()
T = json.load(urllib.request.urlopen(urllib.request.Request(
    'https://oauth2.googleapis.com/token', data=_d)))['access_token']
S = 'https://sheets.googleapis.com/v4/spreadsheets/'


def api(url, payload=None, method='GET', tries=8):
    for a in range(tries):
        r = urllib.request.Request(url, method=method)
        r.add_header('Authorization', 'Bearer ' + T)
        b = json.dumps(payload).encode() if payload is not None else None
        if b: r.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(r, b, timeout=900) as x: return json.load(x)
        except Exception as e:
            if getattr(e, 'code', 0) in (400, 403, 404): raise
            if a < tries - 1: time.sleep(5 * (a + 1)); continue
            raise


def rd(sid, tab):
    return api(S + sid + '/values/' + up.quote(f"'{tab}'") +
               '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING'
               ).get('values') or []


def state(**kw):
    try: cur = json.load(open(STATE))
    except Exception: cur = {}
    if kw: cur.update(kw); json.dump(cur, open(STATE, 'w'))
    return cur


def fingerprint(grid):
    """Row count and ids only: two of these tabs carry credentials."""
    if not grid: return 0, set()
    low = [str(h).strip().lower() for h in grid[0]]
    if 'id' not in low: return max(0, len(grid) - 1), None
    i = low.index('id')
    return max(0, len(grid) - 1), {str(r[i]).strip() for r in grid[1:]
                                   if i < len(r) and str(r[i]).strip()}


def cmd_plan():
    tabs = {s['properties']['title'] for s in api(S + HUB_DB + '?fields=sheets.properties.title')['sheets']}
    print(f"HUB_DB holds {len(tabs)} tabs. Phase C would move:\n")
    for t in CENTRAL:
        if t not in tabs: print(f"   {t:<22} NOT IN HUB_DB — nothing to do"); continue
        n, _ = fingerprint(rd(HUB_DB, t))
        print(f"   {t:<22} {n:>6} rows")
    print(f"\nInto ONE workbook titled {CORE_TITLE!r}, every pointer naming the same id.")
    print("Nothing has been changed. Run `copy` when you want the workbook made.")


def cmd_copy():
    st = state()
    sid = st.get('core')
    if not sid:
        sid = api(S, {'properties': {'title': CORE_TITLE}}, 'POST')['spreadsheetId']
        state(core=sid); print(f"minted {CORE_TITLE}: {sid}")
    have = {s['properties']['title'] for s in api(S + sid + '?fields=sheets.properties.title')['sheets']}
    reqs = []
    for t in CENTRAL:
        if t in have: print(f"   {t}: already there"); continue
        grid = rd(HUB_DB, t)
        if not grid: print(f"   {t}: EMPTY in HUB_DB — skipped"); continue
        api(S + sid + ':batchUpdate', {'requests': [{'addSheet': {'properties': {
            'title': t, 'gridProperties': {'rowCount': max(1000, len(grid) + 500),
                                           'columnCount': max(26, len(grid[0]))}}}}]}, 'POST')
        for i in range(0, len(grid), 2000):
            chunk = grid[i:i + 2000]
            api(S + sid + '/values/' + up.quote(f"'{t}'!A1") +
                (':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS' if i else '?valueInputOption=RAW'),
                {'values': chunk}, 'POST' if i else 'PUT')
        print(f"   {t}: {len(grid)-1} rows copied")
    for s in api(S + sid + '?fields=sheets.properties')['sheets']:
        if s['properties']['title'] == 'Sheet1':
            api(S + sid + ':batchUpdate', {'requests': [{'deleteSheet': {'sheetId': s['properties']['sheetId']}}]}, 'POST')
    print("\ncopied. Run `verify`.")


def cmd_verify():
    sid = state().get('core')
    if not sid: sys.exit('no Core workbook yet — run `copy`')
    ok, bad = [], []
    for t in CENTRAL:
        hn, hi = fingerprint(rd(HUB_DB, t))
        cn, ci = fingerprint(rd(sid, t))
        if hi is None or ci is None:
            good = cn == hn; why = 'count only'
        else:
            missing = hi - ci; good = not missing
            why = 'id for id' if good else f'{len(missing)} row(s) only in HUB_DB'
        print(f"   {t:<22} hub {hn:>6}  core {cn:>6}   {'OK' if good else 'MISMATCH'} ({why})")
        (ok if good else bad).append(t)
    state(verified=ok)
    print(f"\n{len(ok)} verified, {len(bad)} mismatched")
    if bad: sys.exit('run `copy` again for the mismatched tabs before arming')
    print("Run `arm` when ready. Reads switch over; nothing is deleted.")


def _switch(tabs, value):
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    rows = [['switchboard.moved.' + t, t, value, '', 'switchboard:moved.' + t, '', now, 'operator', '']
            for t in tabs]
    api(S + ESS + '/values/' + up.quote("'Facts'!A1") +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {'values': rows}, 'POST')
    return now


def cmd_arm():
    st = state()
    sid, verified = st.get('core'), st.get('verified') or []
    if not sid or len(verified) != len(CENTRAL): sys.exit('verify all ten first')
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    rows = [['config.props.hubhouse' + t.replace('_', '') + 'id',
             'HUB_HOUSE_' + t.upper() + '_ID', sid, '',
             'switchboard:props.HUB_HOUSE_' + t.upper() + '_ID', '', now, 'operator', '']
            for t in CENTRAL]
    api(S + ESS + '/values/' + up.quote("'Facts'!A1") +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {'values': rows}, 'POST')
    at = _switch(CENTRAL, 'on')
    state(armed_at=time.time())
    print(f"ARMED at {at}. Every pointer names {sid}.")
    print("\n>>> SIGN OUT AND SIGN BACK IN NOW. <<<")
    print("    login fine  -> wait 5 minutes, then `cut`")
    print("    login broken-> `disarm`, and everything is exactly as it was")


def cmd_disarm():
    at = _switch(CENTRAL, '')
    state(armed_at=0)
    print(f"DISARMED at {at}. HUB_DB answers again within the 300s cache.")


def cmd_cut():
    st = state()
    if not st.get('armed_at'): sys.exit('not armed')
    waited = time.time() - st['armed_at']
    if waited < 310:
        sys.exit(f'only {int(waited)}s since arming — the switch cache is 300s. Wait.')
    if len(st.get('verified') or []) != len(CENTRAL): sys.exit('verify all ten first')
    gid = {s['properties']['title']: s['properties']['sheetId']
           for s in api(S + HUB_DB + '?fields=sheets.properties')['sheets']}
    reqs = [{'deleteSheet': {'sheetId': gid[t]}} for t in CENTRAL if t in gid]
    api(S + HUB_DB + ':batchUpdate', {'requests': reqs}, 'POST')
    left = [s['properties']['title'] for s in api(S + HUB_DB + '?fields=sheets.properties.title')['sheets']]
    print(f"CUT {len(reqs)}. HUB_DB now {len(left)} tabs: {', '.join(left) or '(empty)'}")


if __name__ == '__main__':
    cmds = {'plan': cmd_plan, 'copy': cmd_copy, 'verify': cmd_verify,
            'arm': cmd_arm, 'disarm': cmd_disarm, 'cut': cmd_cut}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    cmds[sys.argv[1]]()
