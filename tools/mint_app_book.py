#!/usr/bin/env python3
"""Mint the "ASA Apps — X" book of an app's pair; the primary header is read live so Facts never guess a schema."""
import json
import os
import sys
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
hdrC, hdrA, hdrF, hdrR = (BOSS[t][0] for t in
                          ('Conditions', 'Actions', 'Facts', 'Document Registries'))


def row(hdr, **kw):
    """A key that matches no header must raise, never drop silently."""
    norm = lambda s: ''.join(c for c in s.lower() if c.isalnum())
    by_norm = {norm(h): h for h in hdr}
    d = {x: '' for x in hdr}
    for k, v in kw.items():
        h = by_norm.get(norm(k))
        if h is None:
            raise SystemExit(f"row(): no header matches '{k}' in {hdr[:6]}… — refusing a silent drop")
        d[h] = v
    return [d.get(x, '') for x in hdr]


def depot_state():
    rows = api(S + ESS + '/values/' + urllib.parse.quote("'Facts'!A2:I999999")).get('values') or []
    st = {}
    for r in rows:
        if len(r) > 4 and r[4]:
            st[str(r[4])] = str(r[2]) if len(r) > 2 else ''
    return st


APPS = {
    'quality': {
        'title': 'ASA Apps — Quality Indicators',
        'primary_tab': 'activity',
        'overview': ('The Quality Indicators dashboard: KPIs and trends against DODD '
                     'benchmarks and internal targets, computed over the shared activity '
                     'tab. The app WRITES nothing — it is a reading of work already '
                     'recorded. Ships enabled:false; a person installs it from the App '
                     'Hub and the choice persists (the installed-exception list).'),
        'conditions': [
            ('quality.source.activity', 'Every KPI is computed over the shared activity '
             'tab — the app invents no number and writes no row.', 'system', '0'),
            ('quality.benchmarks.declared', 'A benchmark is a DECLARED target (DODD or '
             'internal), never derived from the data it judges.', 'admin', '0'),
            ('quality.install.persists', 'The app ships enabled:false; installing it is a '
             'personal choice carried by the installed-exception list in the prefs row.',
             'system', '0'),
        ],
        'actions': [
            ('quality.read', 'gas:list(activity)', 'command', '',
             'the KPIs\' one source, via the generic resource lane'),
        ],
        'registries': [
            ('activity', 'data house', 'ASA Data house via switchboard:props.HUB_HOUSE_ACTIVITY_ID',
             'id', 'The activity stream the KPIs read', 'row store'),
        ],
    },
    'compliance-engine': {
        'title': 'ASA Apps — Compliance Engine',
        'primary_tab': 'requirements',
        'overview': ('The Compliance Engine: obligations as DATA. The requirements '
                     'catalog says what must be true; the engine materializes verdicts '
                     'into requirement_states; events carry what happened. Humans edit '
                     'REQUIREMENTS; the engine owns the states matrix — editing a '
                     'verdict by hand is lying to the mirror.'),
        'conditions': [
            ('engine.obligations.are_data', 'A requirement is a ROW, not code — adding an '
             'obligation is an edit to the catalog, never a deploy.', 'admin', '1'),
            ('engine.states.engine_owned', 'requirement_states is the engine\'s '
             'materialized verdict matrix — recomputed, never hand-edited.', 'system', '1'),
            ('engine.events.feed', 'Events are the facts verdicts are computed from; an '
             'event is appended, never rewritten.', 'system', '1'),
        ],
        'actions': [
            ('engine.requirements.list', 'gas:requirementsList', 'command', '', 'the catalog'),
            ('engine.requirements.upsert', 'gas:requirementsUpsert', 'command',
             '["id","fields"]', 'edit the obligation, admin door'),
            ('engine.requirements.delete', 'gas:requirementsDelete', 'command', '["id"]',
             'retire an obligation'),
            ('engine.states.read', 'gas:list(requirement_states)', 'command', '',
             'the verdict matrix, read-only for people'),
            ('engine.events.read', 'gas:list(events)', 'command', '', 'what happened'),
        ],
        'registries': [
            ('requirements', 'data house', 'ASA Data house via switchboard:props.HUB_HOUSE_REQUIREMENTS_ID',
             'id', 'The obligations catalog', 'row store'),
            ('requirement_states', 'data house', 'ASA Data house via switchboard:props.HUB_HOUSE_REQUIREMENT_STATES_ID',
             'id', 'The engine\'s verdict matrix', 'materialized matrix'),
            ('events', 'data house', 'ASA Data house via switchboard:props.HUB_HOUSE_EVENTS_ID',
             'event_id', 'The event stream', 'append-only log'),
        ],
    },
    'family': {
        'title': 'ASA Apps — Family Portal',
        'primary_tab': 'care_docs',
        'overview': ('The Family Portal: updates and welcome packets for families, read '
                     'from the care_docs collection "family" (client-scoped — a family '
                     'reaches its own client only). The app ships enabled:false: the '
                     'portal experience is still to be built (coverage ledger kill list '
                     'item 9 — the intranet\'s 11-section Family portal is the real '
                     'blocker for retiring the legacy book). The data pair stands ready: '
                     'ASA Data — CareDocs, declared 2026-09-08.'),
        'conditions': [
            ('family.scope.client', 'Every read is CLIENT-SCOPED at the data (care_docs '
             'clientScoped in Main.gs) — a family session reaches its own client only.',
             'system', '1'),
            ('family.collection.family', 'The portal shows the "family" collection of '
             'care_docs — updates and welcome packets, never clinical rows.', 'system', '1'),
            ('family.portal.unbuilt', 'The app is deliberately disabled until the portal '
             'is built — the legacy intranet Family portal is the standing reference.',
             'admin', '0'),
        ],
        'actions': [
            ('family.updates.read', 'gas:list(careDocs)', 'command',
             '["collection=family"]', 'the family updates, client-scoped'),
        ],
        'registries': [
            ('care_docs', 'data house', 'ASA Data — CareDocs via switchboard:props.HUB_HOUSE_CARE_DOCS_ID',
             'id', 'Family updates and welcome packets', 'row store'),
        ],
    },
    'behavior': {
        'title': 'ASA Apps — Behavior Support',
        'primary_tab': 'behavior_signals',
        'overview': ('Behavior Support: a WELLBEING reading of the people who work in '
                     'the platform. The relay measures, from the platform\'s own log '
                     'mirror, which apps each person actually uses, whether they work '
                     'with forms or client images, where they may stand, when their '
                     'hours fall and how their roster runs; those counted signals are '
                     'filed in behavior_signals, the GENERIC input house — anything '
                     'may enter it in the same shape (who, what, how much, when, who '
                     'says so). A paragraph is then composed OVER that arithmetic '
                     'through the platform\'s single AI door and stored in '
                     'behavior_readings, one row per person, bought only when the '
                     'facts moved. It is never a performance score and never ranks '
                     'anybody: the verdicts are about sustainability — nights, '
                     'weekends, unbroken runs — and "quiet" is the absence of '
                     'evidence, not a fault.'),
        'conditions': [
            ('behavior.measure.own_log', 'Every number comes from the platform\'s OWN '
             'audit log, mirrored into Postgres — the app records nothing new about '
             'anybody and reads no message, document or client record.', 'system', '0'),
            ('behavior.machines.apart', 'The platform\'s own sweeps (matrix-engine, '
             'auto-graduate, trigger, asa-hub:*) are counted apart; nobody\'s rhythm is '
             'judged on a machine\'s work.', 'system', '1'),
            ('behavior.quiet.is_not_fault', 'An account the log cannot see reads "quiet" '
             'and every verdict "unknown" — never a zero dressed as a finding.',
             'system', '1'),
            ('behavior.verdicts.sustainability', 'A verdict is about SUSTAINABILITY '
             '(nights, weekends, unbroken runs, six-shift weeks), never productivity, '
             'and never a comparison between two people.', 'admin', '1'),
            ('behavior.reading.over_facts', 'The model may only reword the counted facts '
             'it is shown; it invents nothing, ranks nobody, and a dead model returns '
             'the LAST reading rather than an invention.', 'system', '1'),
            ('behavior.reading.hash_gated', 'A reading is bought only when the facts '
             'moved (the signals hash) or a person asks for a fresh one — a page view '
             'never costs a completion.', 'system', '0'),
            ('behavior.read.badged', 'A reading about a person is read by an admin, or '
             'by a manager wearing the House Manager badge — and the slice behind the '
             'screen is admin-only.', 'admin', '1'),
        ],
        'actions': [
            ('behavior.signals.ingest', 'gas:behaviorSignalsIngest', 'command',
             '["rows"]', 'the relay files what it measured; upsert by id, never a delete'),
            ('behavior.readings.list', 'gas:behaviorReadings', 'command', '',
             'every stored reading, for the board'),
            ('behavior.profile.read', 'gas:behaviorProfile', 'command', '["subject_key"]',
             'one person: every signal the house holds, and their reading'),
            ('behavior.reading.compose', 'gas:behaviorEvaluate', 'command',
             '["subject_key","refresh"]', 'the AI door, hash-gated, one person at a time'),
            ('behavior.cortex.note', 'gas:behaviorCortexNote', 'command',
             '["subject_key","note"]', 'what the cortex said, kept beside the reading'),
        ],
        'registries': [
            ('behavior_signals', 'data house',
             'ASA Data — BehaviorSignals via switchboard:props.HUB_HOUSE_BEHAVIOR_SIGNALS_ID',
             'id', 'The generic observation sink — anything may enter', 'row store'),
            ('behavior_readings', 'data house',
             'ASA Data — BehaviorReadings via switchboard:props.HUB_HOUSE_BEHAVIOR_READINGS_ID',
             'id', 'One composed reading per person', 'row store'),
        ],
    },
}


def main() -> None:
    ctx = sys.argv[1] if len(sys.argv) > 1 else ''
    if ctx not in APPS:
        sys.exit('usage: mint_app_book.py <' + '|'.join(APPS) + '>')
    spec = APPS[ctx]

    depot = depot_state()
    ptr = f"switchboard:props.HUB_HOUSE_{spec['primary_tab'].upper()}_ID"
    house = depot.get(ptr, '').strip()
    cols = []
    if house:
        for tab in (spec['primary_tab'], 'Data'):
            try:
                vals = api(S + house + '/values/' + urllib.parse.quote(f"'{tab}'!A1:BZ1")).get('values') or [[]]
                cols = [str(c) for c in vals[0] if str(c).strip()]
                if cols:
                    break
            except Exception:
                continue
    if not cols:
        sys.exit(f"could not read the {spec['primary_tab']} header from its house ({ptr}) — "
                 f"declare the house first; a guessed schema is worse than none.")

    try:
        books = json.load(open(os.path.join(HERE, 'books.json')))
    except FileNotFoundError:
        books = {}
    bkey = 'app-' + ctx
    if bkey in books:
        sid = books[bkey]
        print(f'already minted: {sid}')
    else:
        sid = api(S, {'properties': {'title': spec['title']},
                      'sheets': [{'properties': {'title': t, 'gridProperties': {'frozenRowCount': 1}}}
                                 for t in MATRIX]}, 'POST')['spreadsheetId']
        for t in MATRIX:
            if t in ('Overview', 'Review Guide'):
                continue
            api(S + sid + '/values/' + urllib.parse.quote(f"'{t}'!A1") + '?valueInputOption=RAW',
                {'values': [BOSS[t][0]]}, 'PUT')
        cond = [hdrC] + [row(hdrC, condition_id=cid, version='1.0', family=ctx, truth=truth,
                             owner_role=owner, blocking=blocking, machine_resolved='0')
                         for cid, truth, owner, blocking in spec['conditions']]
        api(S + sid + '/values/' + urllib.parse.quote("'Conditions'!A1") + '?valueInputOption=RAW',
            {'values': cond}, 'PUT')
        acts = [hdrA] + [row(hdrA, action_id=aid, handler=handler, mode=mode, parameters=params,
                             complete_action_config=json.dumps(
                                 {'handler': handler, 'mode': mode, 'note': note},
                                 separators=(',', ':')))
                         for aid, handler, mode, params, note in spec['actions']]
        api(S + sid + '/values/' + urllib.parse.quote("'Actions'!A1") + '?valueInputOption=RAW',
            {'values': acts}, 'PUT')
        facts = [hdrF] + [row(hdrF, fact_id=f"{ctx}.{c.lower()}", adapter=ctx, type='string',
                              current_source=f"{spec['primary_tab']}.{c}",
                              complete_fact_config=json.dumps(
                                  {'adapter': ctx, 'current_source': f"{spec['primary_tab']}.{c}",
                                   'type': 'string'}, separators=(',', ':')))
                          for c in cols]
        api(S + sid + '/values/' + urllib.parse.quote("'Facts'!A1") + '?valueInputOption=RAW',
            {'values': facts}, 'PUT')
        regs = [hdrR] + [row(hdrR, registry_id=rid, layer=layer,
                             **{'Storage / Source': storage},
                             record_id=rec, label=label, kind=kind)
                         for rid, layer, storage, rec, label, kind in spec['registries']]
        api(S + sid + '/values/' + urllib.parse.quote("'Document Registries'!A1") + '?valueInputOption=RAW',
            {'values': regs}, 'PUT')
        api(S + sid + '/values/' + urllib.parse.quote("'Review Guide'!A1") + '?valueInputOption=RAW',
            {'values': [[str(c) for c in r] for r in BOSS['Review Guide']]}, 'PUT')
        api(S + sid + '/values/' + urllib.parse.quote("'Overview'!A1") + '?valueInputOption=RAW',
            {'values': [[spec['overview']]]}, 'PUT')
        books[bkey] = sid
        json.dump(books, open(os.path.join(HERE, 'books.json'), 'w'), indent=1)
        print(f"minted: {spec['title']} = {sid} ({len(cols)} columns documented)")

    regrows = api(S + ESS + '/values/' + urllib.parse.quote('Registry!A1:E')).get('values') or []
    have = {str(r[0]).strip() for r in regrows[1:] if r}
    if ctx in have:
        print(f'registry already carries "{ctx}"')
    else:
        api(S + ESS + '/values/' + urllib.parse.quote('Registry!A1') +
            ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
            {'values': [[ctx, sid, 'on', 'app book', '']]}, 'POST')
        print(f'registry: hung "{ctx}" → {sid}')


if __name__ == '__main__':
    main()
