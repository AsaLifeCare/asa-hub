"""The recruiters' book (RECRUIT_BOOK_ID) moved into the Hub: its seven tabs beside the two houses the book's pass keeps
uploaded (resource_rows.upload) and proved row for row, and the Recruiters' Book app (a Studio app, app_recruiters_book,
in the apps house) made over all nine — each tab a sheet page that adds, edits and removes rows. The app is the
master's alone until App Control releases it (sheet_resources.gate's app gate, the SPA's "no row = the master's").
A rehearsal (rolled back) also proves the gate, a row edited and made through the generic verbs, and the book's pass
leaving the Hub's rows alone. A rehearsal unless UPLOAD=1.

From the repo root:

    RUNNER=<scratchpad> [UPLOAD=1] python3 tools/upload-recruit-book.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("UPLOAD_RECRUIT_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "upload_recruit_book.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"UPLOAD_RECRUIT_INPROC": "1", "UPLOAD": os.environ.get("UPLOAD", "")})],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import comm_recruit as CRT  # noqa: E402
import comm_recruit_writes as CRW  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import recruit_book as RB  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

keep = os.environ.get("UPLOAD") == "1"
APP = SR.RECRUITERS_APP
results: dict[str, str] = {}
facts: dict[str, object] = {}
TABS = {r: s["tab"] for r, s in SR.BOOKED.items() if s.get("book") == "RECRUIT_BOOK_ID"}
ICONS = {"Archive of Onboarding Checklist": "archive", "Resume Analysis": "file-search",
         "Phone Screen Analysis": "phone", "Phone Interview Script": "message-square-text",
         "Text Messages": "message-square", "Dashboard": "contact", "Documents Uploaded": "upload"}
# a page's title where the tab's own name wraps onto two lines
TITLES = {"Archive of Onboarding Checklist": "Archive of Onboarding"}
# the columns a recruiter reads first, as the book shows them (recruit_book.SHEET_ORDER holds the rest)
SHOWN = {"recruitPipeline": ["Candidate Name", "Status", "Hire ?", "Score", "Phone", "Location", "Screener",
                             "Screen Date", "Shifts", "PT/FT"],
         "recruitOnboarding": ["Candidate Name", "Status", "Phone", "Email", "Score", "Earliest Start Date",
                               "Background Check", "8 Hr Train", "CPR/1st Aid", "Med Del", "DL / ID", "HS Diploma"]}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


def label(h: str) -> str:
    first = gsjs.trim(h.split("\n")[0])
    return (first[:40] + "…") if len(first) > 40 else first or h


def page(pid: str, title: str, icon: str, resource: str, heads: list[str], entity: tuple[str, str]) -> dict:
    """One sheet page over a house: its first columns shown, every column editable, rows added and removed."""
    heads = [h for h in heads if h and h not in ("id", "createdAt", "updatedAt")]
    shown = [h for h in SHOWN.get(resource, []) if h in heads] or heads[:8]
    name_key = next((h for h in ("Candidate Name", "Name", "First Name") if h in heads), shown[0] if shown else "")
    fields = [{"key": h, "label": label(h), **({"type": "textarea"} if len(h) > 60 or "Notes" in h else {})}
              for h in heads]
    return {"id": pid, "type": "sheet", "title": title, "icon": icon, "dataSource": {"resource": resource},
            "config": {
                "entity": list(entity), "searchable": True, "searchPlaceholder": f"Search {entity[1]}…",
                "columns": [{"key": h, "label": label(h), "sortable": True,
                             "kind": "avatar+text" if h == name_key else "chip" if h in ("Status", "Hire ?")
                             else "text"} for h in shown],
                "primaryAction": {"label": f"Add {entity[0]}", "icon": "plus", "form": {
                    "title": f"Add {entity[0]}", "resource": resource, "perm": "people.edit", "wide": True,
                    "fields": [dict(f, **({"required": True} if f["key"] == name_key else {})) for f in fields]}},
                "editForm": {"title": f"Edit {entity[0]}", "resource": resource, "perm": "people.edit",
                             "fields": fields},
                "rowDelete": {"perm": "people.edit"},
                "rowActions": [{"id": "edit", "label": f"Edit {entity[0]}", "icon": "pencil"},
                               {"id": "delete", "label": f"Remove {entity[0]}", "icon": "trash-2"}],
                "pagination": {"pageSize": 25}}}


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
users = L.Reads(db, None).users()
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
other = next((u for u in users if gsjs.str_(u.get("role")) == "admin" and u is not master
              and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        tok = SC._WRITE.set({"write_id": "upload:recruit-book"})
        for res, tab in TABS.items():
            facts[f"upload {res}"] = RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
            unlike = RR.unlike_copy(res, SR.copy_of(db, res).ref)
            check(f"{res} holds every row of its copy, cell for cell", not unlike["missing"] and not unlike["differ"],
                  unlike)
        reads = L.Reads(db, None)
        pages = [page("pipeline", "Talent Pipeline", "user-search", "recruitPipeline",
                      RR.columns(reads, "recruitPipeline"), ("candidate", "candidates")),
                 page("onboarding", "Onboarding Checklist", "clipboard-check", "recruitOnboarding",
                      RR.columns(reads, "recruitOnboarding"), ("new hire", "new hires"))]
        for res, tab in TABS.items():
            pages.append(page(res[2:3].lower() + res[3:], TITLES.get(tab, tab), ICONS.get(tab, "table"), res,
                              RR.columns(reads, res),
                              ("row", "rows")))
        now = W.now_iso(reads)
        row = {"id": APP, "name": "Recruiters' Book", "tagline": "The recruiters' pipeline, onboarding and screens.",
               "icon": "briefcase", "accent": "lavender", "category": "Hiring", "version": "1.0.0", "isNew": "True",
               "source": "studio", "enabled": "True", "pages": json.dumps(pages), "createdAt": now, "updatedAt": now}
        held = [(k, c) for k, c in RR.table_rows(reads, "hubApps") if gsjs.str_(c.get("id")) == APP]
        if held:
            RR.update(reads, "hubApps", held[0][0], held[0][1], {**row, "createdAt": held[0][1].get("createdAt")},
                      "asa-hub:recruit-book")
        else:
            RR.create(reads, "hubApps", row, "asa-hub:recruit-book")
        SC._WRITE.reset(tok)
        facts["pages"] = [(p["id"], p["dataSource"]["resource"], len(p["config"]["columns"]),
                           len(p["config"]["editForm"]["fields"])) for p in pages]
        check("the app is in the apps house with its nine pages", len(pages) == 9 and any(
            gsjs.str_(c.get("id")) == APP for _k, c in RR.table_rows(L.Reads(db, None), "hubApps")))
        check("every page names a house the generic verbs serve", all(p["dataSource"]["resource"] in SR.SPECS
                                                                       for p in pages))
        if not keep:
            # the gate: the master's alone until App Control releases it
            m = L.Session(L.Reads(db, None), master)
            check("the master opens the recruiters' book", SR.gate(m, "recruitPipeline", "list") is None,
                  SR.gate(m, "recruitPipeline", "list"))
            if other is not None:
                o = L.Session(L.Reads(db, None), other)
                got = SR.gate(o, "recruitPipeline", "list")
                check("an admin without App Control's row does not", bool(got) and got.get("status") == 403, got)
            # a recruiter's edit and a new row through the generic verbs, then the book's pass
            wid = "Wzzrecruitcheck0001"
            tok = SC._WRITE.set({"write_id": wid})
            pipe = RR.table_rows(L.Reads(db, None), "recruitPipeline")
            key, cells = next((k, c) for k, c in pipe if c.get("id") and c.get("Candidate Name"))
            d = SR.update_row(L.Session(L.Reads(db, None), master), "recruitPipeline",
                              {"id": cells["id"], "Notes": "zz hub note"})
            check("the master edits a row", d.answer.get("status") == 200, d.answer)
            made = SR.create_row(L.Session(L.Reads(db, None), master), "recruitPipeline",
                                 {"Candidate Name": "Zz Hubcandidate", "Status": "New"})
            check("the master adds a row", made.answer.get("status") == 200, made.answer)
            new_id = gsjs.str_((made.answer.get("data") or {}).get("id"))
            # the book's pass with the sheet's own lines: the row edited here and the row made here stay the Hub's
            doc = RB.build_copy(RB.read_source(), time.time()) if RB.read_source().get("ok") else None
            heads = ["id"] + [h for h in RR.columns(L.Reads(db, None), "recruitPipeline") if h != "id"]
            grid = [[gsjs.str_(c.get(h)) for h in heads] for k, c in pipe]
            CRW._rewrite(L.Reads(db, None), "recruitPipeline", heads, grid)
            after = {gsjs.str_(c.get("id")): c for _k, c in RR.table_rows(L.Reads(db, None), "recruitPipeline")}
            check("the book's pass leaves the row edited in the Hub as the Hub has it",
                  after.get(cells["id"], {}).get("Notes") == "zz hub note", after.get(cells["id"]))
            check("the book's pass never removes a row made in the Hub", new_id in after, new_id)
            SC._WRITE.reset(tok)
            facts["the copy the pass reads"] = bool(doc)
        W.HELD.reset(token)
    failed = [k for k, v in results.items() if v != "ok"]
    if keep and not failed:
        conn.commit()
        facts["committed"] = True
    else:
        conn.rollback()
        facts["committed"] = False
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
