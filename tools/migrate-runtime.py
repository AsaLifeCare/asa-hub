#!/usr/bin/env python3
"""Reload the Runtime book from HUB_DB's legacy hiring tabs (read-only); --dry counts only."""
import json, re, sys, time, urllib.request, urllib.parse

DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
DRY = '--dry' in sys.argv
RT = '1mQf8W7czQ0QOvZSHL4ywTX-XHU9ti6MR4Tsd_lBS9oQ'  # ASA Hiring — Runtime

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


def api(sid, path, payload=None, method='GET', tries=5):
    for attempt in range(tries):
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
            if e.code in (429, 500, 502, 503) and attempt < tries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise


def norm(c):
    return re.sub(r'[^A-Za-z0-9]+', '', str(c)).lower()


def read_tab(tab):
    vals = api(DB, '/values/' + urllib.parse.quote(f"'{tab}'!A1:BZ")).get('values') or []
    if not vals:
        return []
    hdr = [norm(h) for h in vals[0]]
    return [dict(zip(hdr, [str(x) for x in row])) for row in vals[1:]
            if any(str(x).strip() for x in row)]


NOW = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
STAGE = {'new': 'new', 'phone screen': 'phone-screen', 'in person': 'interview',
         'onboarding': 'onboarding', 'hired': 'hired', 'ready to start': 'ready'}

# (tab, column) → canonical Fact ID; anything unmapped lands as legacy.<tab>.<column>
CANON = {}
import glob
for p in sorted(glob.glob('/opt/docker/docs/asa-hub/backup-2026-09-01/extraction/module-??-*.json')):
    for r in json.load(open(p))['tabs'].get('Facts', []):
        src = str(r.get('Current Source', '')).strip()
        dot = src.find('.')
        if dot == -1 or str(r.get('Current Resolver', '')).strip():
            continue
        key = (src[:dot], norm(src[dot + 1:]))
        CANON.setdefault(key, (str(r['Fact ID']), str(r.get('Type', ''))))

TABS = ['entity_candidates', 'entity_resume_analyses', 'entity_phone_screens',
        'entity_in_person_interviews', 'entity_onboardings', 'entity_hiring_events',
        'entity_resume_inbox', 'hiring_journey', 'hiring_sim_asks', 'hiring_sim_ai',
        'interview_asks', 'onboarding_packet', 'recruitment_contracts',
        'recruitment_docs', 'candidate_documents', 'tp_candidates', 'tp_resume',
        'tp_screens']
L = {}
for t in TABS:
    L[t] = read_tab(t)
    print(f'read {t:32} {len(L[t])} rows')

out = {'Subjects': [], 'Flow Instances': [], 'Facts': [], 'Action Attempts': [],
       'Documents': [], 'Events': []}


def fact(sub, key, val, tab, col):
    out['Facts'].append({'Fact Key': key, 'Subject ID': sub, 'Value': val,
                         'Type': '', 'Source': f'dissolution:{tab}.{col}',
                         'Evidence': '', 'Recorded At': NOW,
                         'Recorded By': 'dissolution', 'Instance ID': ''})


def facts_for(tab, row, sub):
    for col, val in row.items():
        v = str(val).strip()
        if not v or col in ('candidateid', 'candidatename', 'name', 'firstname'):
            continue
        canon = CANON.get((tab, col))
        fact(sub, canon[0] if canon else f'legacy.{tab}.{col}', v, tab, col)


seen = set()
for c in L['entity_candidates']:
    cid = c.get('candidateid', '').strip()
    if not cid:
        continue
    seen.add(cid)
    stage = STAGE.get(c.get('status', '').strip().lower(), '')
    out['Subjects'].append({
        'Subject ID': cid, 'Kind': 'candidate', 'Name': c.get('candidatename', ''),
        'Email': c.get('email', ''), 'Phone': c.get('phone', ''), 'Stage': stage,
        'Status': c.get('status', ''), 'Created At': c.get('createdat', ''),
        'Updated At': c.get('updatedat', ''), 'Source': 'dissolution:entity_candidates',
        'Notes': ('archived' if str(c.get('archived', '')).lower() == 'true' else '')})
    out['Flow Instances'].append({
        'Instance ID': 'FI_DISS_' + cid, 'Flow': 'hiring', 'Book ID': '',
        'Subject ID': cid, 'Stage': stage,
        'Status': 'closed' if str(c.get('archived', '')).lower() == 'true' else 'open',
        'Opened At': c.get('createdat', '') or NOW, 'Updated At': NOW,
        'Closed At': '', 'Opened By': 'dissolution', 'Parent Instance': '',
        'Notes': 'dissolution:entity_candidates'})
    facts_for('entity_candidates', c, cid)

for c in L['tp_candidates']:
    cid = c.get('candidateid', '').strip()
    if not cid:
        continue
    if cid not in seen:
        out['Subjects'].append({
            'Subject ID': cid, 'Kind': 'pool', 'Name': c.get('name', ''),
            'Email': c.get('email', ''), 'Phone': c.get('phone', ''),
            'Stage': '', 'Status': c.get('status', ''),
            'Created At': c.get('createdat', ''), 'Updated At': '',
            'Source': 'dissolution:tp_candidates', 'Notes': c.get('src', '')})
    facts_for('tp_candidates', c, cid)

for tab in ('entity_resume_analyses', 'entity_phone_screens',
            'entity_in_person_interviews', 'entity_onboardings',
            'tp_resume', 'tp_screens', 'onboarding_packet'):
    for row in L[tab]:
        sub = row.get('candidateid', '').strip()
        if sub:
            facts_for(tab, row, sub)

by_email = {c.get('email', '').strip().lower(): c.get('candidateid', '')
            for c in L['entity_candidates'] if c.get('email', '').strip()}
by_name = {c.get('candidatename', '').strip().lower(): c.get('candidateid', '')
           for c in L['entity_candidates'] if c.get('candidatename', '').strip()}
srid_to_sub = {}
for r in L['recruitment_contracts']:
    sub = (by_email.get(r.get('email', '').strip().lower(), '') or
           by_name.get(r.get('candidate', '').strip().lower(), ''))
    srid = r.get('signaturerequestid', '').strip()
    if srid:
        srid_to_sub[srid] = sub
    if not sub:
        continue
    if srid:
        fact(sub, 'hiring.application.present', 'true', 'recruitment_contracts', 'signaturerequestid')
    if r.get('status', '').strip():
        fact(sub, 'hiring.application.status', r['status'], 'recruitment_contracts', 'status')
    facts_for('recruitment_contracts', r, sub)

for d in L['candidate_documents']:
    out['Documents'].append({
        'Document ID': d.get('docrowid', '') or 'DOC_' + d.get('fileid', '')[:16],
        'Subject ID': d.get('candidateid', ''), 'Binding ID': d.get('docid', ''),
        'Registry': 'candidate_documents', 'File ID': d.get('fileid', ''),
        'File URL': d.get('fileurl', ''), 'Status': d.get('status', ''),
        'Verified By': d.get('reviewstatus', ''), 'Verified At': '',
        'Expires At': d.get('expireson', ''),
        'Notes': (d.get('doclabel', '') + ' · dissolution:candidate_documents').strip(' ·')})
for d in L['recruitment_docs']:
    srid = d.get('signaturerequestid', '').strip()
    out['Documents'].append({
        'Document ID': 'RD_' + srid[:20], 'Subject ID': srid_to_sub.get(srid, ''),
        'Binding ID': 'hiring.application_pdf', 'Registry': 'recruitment_docs',
        'File ID': '', 'File URL': d.get('docurl', ''), 'Status': 'fetched',
        'Verified By': d.get('fetchedby', ''), 'Verified At': d.get('fetchedat', ''),
        'Expires At': '', 'Notes': 'dissolution:recruitment_docs srid=' + srid})
for p in L['onboarding_packet']:
    sub = p.get('candidateid', '').strip()
    for col, val in p.items():
        if col.endswith('fileid') and str(val).strip():
            out['Documents'].append({
                'Document ID': 'PK_' + sub + '_' + col[:-6],
                'Subject ID': sub, 'Binding ID': 'packet.' + col[:-6],
                'Registry': 'onboarding_packet', 'File ID': str(val).strip(),
                'File URL': '', 'Status': 'on_file', 'Verified By': '',
                'Verified At': '', 'Expires At': '',
                'Notes': 'dissolution:onboarding_packet'})

STEP_ACTION = {'resume_request': 'hiring.resume.request',
               'cjis_request': 'hiring.cjis.request',
               'screen_invite': 'hiring.screen.invite',
               'screen_call': 'hiring.screen.invite',
               'decision_ask': 'hiring.decision.ask',
               'outreach': 'hiring.outreach.first_contact'}
for a in L['hiring_sim_asks']:
    step = a.get('step', '').strip()
    out['Action Attempts'].append({
        'Attempt ID': a.get('simaskid', ''), 'Action ID': STEP_ACTION.get(step, 'legacy:' + step),
        'Subject ID': a.get('candidateid', ''), 'Instance ID': '',
        'Status': a.get('state', ''), 'Parameters': a.get('payloadjson', ''),
        'Result': json.dumps({'sent': a.get('sentcount', ''), 'of': a.get('maxattempts', ''),
                              'every_minutes': a.get('intervalminutes', ''),
                              'answered_by': a.get('answeredby', '')}),
        'Requested At': a.get('createdat', ''), 'Completed At': a.get('answeredat', ''),
        'Requested By': 'dissolution:hiring_sim_asks',
        'Idempotency Key': a.get('simaskid', '')})
for a in L['interview_asks']:
    out['Action Attempts'].append({
        'Attempt ID': a.get('askid', ''), 'Action ID': 'hiring.interview.invite',
        'Subject ID': a.get('candidateid', ''), 'Instance ID': '',
        'Status': a.get('state', ''), 'Parameters': a.get('slotsjson', ''),
        'Result': json.dumps({'picked_date': a.get('pickeddate', ''),
                              'picked_time': a.get('pickedtime', ''),
                              'supervisor_reply': a.get('supervisorreply', '')}),
        'Requested At': a.get('invitedat', ''), 'Completed At': a.get('offeredat', ''),
        'Requested By': a.get('invitedby', '') or 'dissolution:interview_asks',
        'Idempotency Key': a.get('askid', '')})

for j in L['hiring_journey']:
    out['Events'].append({
        'Event ID': j.get('journeyid', ''), 'Subject ID': j.get('candidateid', ''),
        'Kind': 'journey', 'Step': j.get('step', ''), 'Channel': j.get('channel', ''),
        'Title': j.get('title', ''),
        'Detail': (j.get('detail', '') + (' ref=' + j['ref'] if j.get('ref', '').strip() else '')),
        'To': j.get('to', ''), 'OK': j.get('ok', ''), 'At': j.get('at', ''),
        'By': j.get('by', ''), 'Rehearsal': j.get('rehearsal', ''),
        'Source': 'dissolution:hiring_journey'})
for e in L['entity_hiring_events']:
    out['Events'].append({
        'Event ID': e.get('eventid', ''), 'Subject ID': e.get('candidateid', ''),
        'Kind': 'calendar', 'Step': e.get('eventtype', ''), 'Channel': '',
        'Title': (e.get('withname', '') + ' · ' + e.get('location', '')).strip(' ·'),
        'Detail': e.get('notes', ''), 'To': '', 'OK': e.get('status', ''),
        'At': e.get('startsat', '') or (e.get('date', '') + ' ' + e.get('time', '')).strip(),
        'By': e.get('createdby', ''), 'Rehearsal': '',
        'Source': 'dissolution:entity_hiring_events'})
for r in L['entity_resume_inbox']:
    out['Events'].append({
        'Event ID': 'RI_' + r.get('fileid', '')[:22], 'Subject ID': r.get('candidateid', ''),
        'Kind': 'resume_inbox', 'Step': r.get('outcome', ''), 'Channel': 'drive',
        'Title': r.get('filename', ''), 'Detail': r.get('reason', ''),
        'To': '', 'OK': '', 'At': r.get('readat', ''), 'By': r.get('readby', ''),
        'Rehearsal': '', 'Source': 'dissolution:entity_resume_inbox'})
for m in L['hiring_sim_ai']:
    out['Events'].append({
        'Event ID': 'AI_' + m.get('messageid', '')[:22], 'Subject ID': '',
        'Kind': 'ai_memo', 'Step': m.get('verdict', ''), 'Channel': m.get('via', ''),
        'Title': m.get('names', ''), 'Detail': '', 'To': '', 'OK': '',
        'At': m.get('seenat', ''), 'By': '', 'Rehearsal': '',
        'Source': 'dissolution:hiring_sim_ai'})

for tab, rows in out.items():
    print(f'{tab:16} -> {len(rows)} rows')
if DRY:
    sys.exit(0)

# Clears each Runtime data tab before loading it.
HDRS = {
    'Subjects': ['Subject ID', 'Kind', 'Name', 'Email', 'Phone', 'Stage', 'Status',
                 'Created At', 'Updated At', 'Source', 'Notes'],
    'Flow Instances': ['Instance ID', 'Flow', 'Book ID', 'Subject ID', 'Stage', 'Status',
                       'Opened At', 'Updated At', 'Closed At', 'Opened By',
                       'Parent Instance', 'Notes'],
    'Facts': ['Fact Key', 'Subject ID', 'Value', 'Type', 'Source', 'Evidence',
              'Recorded At', 'Recorded By', 'Instance ID'],
    'Action Attempts': ['Attempt ID', 'Action ID', 'Subject ID', 'Instance ID', 'Status',
                        'Parameters', 'Result', 'Requested At', 'Completed At',
                        'Requested By', 'Idempotency Key'],
    'Documents': ['Document ID', 'Subject ID', 'Binding ID', 'Registry', 'File ID',
                  'File URL', 'Status', 'Verified By', 'Verified At', 'Expires At', 'Notes'],
    'Events': ['Event ID', 'Subject ID', 'Kind', 'Step', 'Channel', 'Title', 'Detail',
               'To', 'OK', 'At', 'By', 'Rehearsal', 'Source'],
}
for tab, rows in out.items():
    hdr = HDRS[tab]
    api(RT, '/values/' + urllib.parse.quote(f"'{tab}'!A2:Z100000") + ':clear', {}, 'POST')
    vals = [[str(r.get(c, '')) for c in hdr] for r in rows]
    for i in range(0, len(vals), 500):
        api(RT, '/values/' + urllib.parse.quote(f"'{tab}'!A1") +
            ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
            {'values': vals[i:i + 500]}, 'POST')
    back = api(RT, '/values/' + urllib.parse.quote(f"'{tab}'!A1:A"))
    got = max(0, len(back.get('values') or []) - 1)
    print(f'{tab:16} loaded {len(vals)} · readback {got} — ' +
          ('OK' if got == len(vals) else 'MISMATCH'))
