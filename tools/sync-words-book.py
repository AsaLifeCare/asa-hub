#!/usr/bin/env python3
"""Copy the word tabs from the depot into the Communication book; run right before flipping HUB_WORDS_BOOK_ID."""
import json, sys, time, urllib.parse, urllib.request

DEPOT = '1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg'
COMM_BOOK = '1uzqAdVM9eGdT7z8mheveZ6KUNEdGvhze-do5FYv6HeM'
TABS = ['Strings', 'Prompts', 'Steps']

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
with urllib.request.urlopen(urllib.request.Request(
        'https://oauth2.googleapis.com/token', data=data)) as r:
    TOKEN = json.load(r)['access_token']


def api(sid, path, payload=None, method='GET', tries=4):
    for attempt in range(tries):
        req = urllib.request.Request(
            'https://sheets.googleapis.com/v4/spreadsheets/' + sid + path,
            method=method)
        req.add_header('Authorization', 'Bearer ' + TOKEN)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, body, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < tries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            raise


dry = '--dry-run' in sys.argv
for tab in TABS:
    src = api(DEPOT, '/values/' + urllib.parse.quote(f"'{tab}'!A1:C"))
    vals = src.get('values') or []
    if dry:
        print(f'{tab}: depot holds {max(0, len(vals) - 1)} keys')
        continue
    api(COMM_BOOK, '/values/' + urllib.parse.quote(f"'{tab}'!A1:C") + ':clear',
        {}, 'POST')
    api(COMM_BOOK, '/values:batchUpdate',
        {'valueInputOption': 'RAW',
         'data': [{'range': f"'{tab}'!A1", 'values': vals}]}, 'POST')
    back = api(COMM_BOOK, '/values/' + urllib.parse.quote(f"'{tab}'!A1:A"))
    got = max(0, len(back.get('values') or []) - 1)
    want = max(0, len(vals) - 1)
    mark = 'OK' if got == want else 'MISMATCH'
    print(f'{tab}: {want} keys copied, {got} read back — {mark}')
