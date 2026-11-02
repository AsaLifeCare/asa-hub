"""People's photos and house photos answered by asa-hub-app (app/photo_doors.py over app/house_images.py and
app/person_photos.py), on a temporary images folder and the live copy in asa-hub-db.
- The disk: a picture is kept as <house>/<time>.<ext> or people/<app>/<key>/<time>.<ext>, never over another, and read
  back whole with its type; an empty, oversized or non-picture body, a bad house code or record folder, and a folder
  without its .gitkeep are refused in the relay's words; where() tallies what each app keeps.
- The five doors mount on the app's routes and answer with this app's gates: a house photo is kept for the master or a
  holder of locations.house who reads every house uncut, never for anyone else, never for a house the registry does not
  list (nor while it cannot be read); it is read by a session that sees the house. A person's photo is planned by
  photoPlan, kept, then named by the record's own write (asked once more while the write lock is held, let go void when
  unanswered); it is read by a session one of the apps showing that person opens to. Where is the master's alone.
Nothing is written to the images folder or to asa-hub-db: pictures land in a temporary folder that is removed, and the
photo's naming write is answered by a stand-in.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-photo-doors.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("PHOTO_DOORS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_photo_doors.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    with open("app/front_door_routes.json", encoding="utf-8") as fh:
        routes = fh.read()
    env_file = os.path.join(runner, "photo_doors_env.json")
    with open(env_file, "w", encoding="utf-8") as fh:
        json.dump({"PHOTO_DOORS_INPROC": "1", "FD_ROUTES": routes}, fh)
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, "@" + env_file],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import asyncio  # noqa: E402
import base64  # noqa: E402
import shutil  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
import urllib.parse  # noqa: E402

_WORK = tempfile.mkdtemp(prefix="photo-doors-")
with open(_WORK + "/routes.json", "w", encoding="utf-8") as _fh:
    _fh.write(os.environ.pop("FD_ROUTES"))
os.environ["HUB_FRONT_DOOR_ROUTES"] = _WORK + "/routes.json"
os.environ["HUB_IMAGES_DIR"] = _WORK + "/images"
os.environ["HUB_IMAGES_HOST_DIR"] = "/host/asa-hub/images"
os.environ["HUB_APP_PACK_DIR"] = _WORK + "/packs"


class _Response:
    def __init__(self, content=b"", status_code=200, media_type=None, headers=None):
        self.body = content if isinstance(content, (bytes, bytearray)) else str(content).encode()
        self.status_code, self.media_type, self.headers = status_code, media_type, dict(headers or {})


async def _in_thread(fn, *a, **k):
    return await asyncio.to_thread(fn, *a, **k)


# the web framework these modules import, which this container does not carry: only names, never served
_fa, _fr, _sc = (types.ModuleType(n) for n in ("fastapi", "fastapi.responses", "starlette.concurrency"))
_fa.Header = lambda default=None, **_k: default
_fa.Request = object
_fa.Response = _fr.Response = _fr.JSONResponse = _Response
_sc.run_in_threadpool = _in_thread
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})

import editions as E  # noqa: E402
import envelope  # noqa: E402
import front_door as FD  # noqa: E402
import gsjs  # noqa: E402
import house_images as H  # noqa: E402
import houses  # noqa: E402
import hubdb  # noqa: E402
import lane_gate as LG  # noqa: E402
import live_finish as LF  # noqa: E402
import locations as L  # noqa: E402
import person_photos as P  # noqa: E402
import photo_doors as PD  # noqa: E402
import photos  # noqa: E402
import scope as sc  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


JPEG = b"\xff\xd8\xff\xe0" + b"j" * 2048
PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 1024
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"w" * 512
GIF = b"GIF89a" + b"g" * 64


def b64(data: bytes) -> bytes:
    return json.dumps({"name": "x", "mime": "image/jpeg", "b64": base64.b64encode(data).decode()}).encode()


def files(folder: str) -> list[str]:
    try:
        return sorted(n for n in os.listdir(folder) if not n.startswith("."))
    except OSError:
        return []


def refused(fn, *a) -> str:
    try:
        fn(*a)
    except (ValueError, OSError) as exc:
        return f"{type(exc).__name__}: {exc}"
    return "kept"


# ---- the disk --------------------------------------------------------------------------------------------------------
root = str(H.ROOT)
check("the images folder is the temporary one", root.startswith(_WORK) and str(P._dir("clients", "k")).startswith(root),
      root)
check("a folder without its .gitkeep keeps nothing", H.problem() == f"the images folder is not mounted at {root}"
      and refused(H.save, "ABD1305", JPEG) == f"OSError: the images folder is not mounted at {root}"
      and not os.path.exists(root + "/ABD1305"), H.problem())
os.makedirs(root)
open(root + "/" + H.MARK, "w").close()
check("with it the folder is mounted", H.problem() == "")
now = 1761500000.123
one, two, three = (H.save("ABD1305", JPEG, now), H.save("ABD1305", JPEG + b"2", now),
                   H.save("ABD1305", PNG, now))
kept = files(root + "/ABD1305")
check("a house photo is kept as <house>/<time>.<ext>, never over another",
      (one["name"], two["name"], three["name"]) == ("20251026T173320123Z.jpg", "20251026T173320124Z.jpg",
                                                    "20251026T173320123Z.png")
      and kept == sorted([one["name"], two["name"], three["name"]])
      and one["path"] == f"{H.PREFIX}/ABD1305/{one['name']}" and one["type"] == "image/jpeg"
      and one["bytes"] == len(JPEG) and three["type"] == "image/png", (one, two, three, kept))
check("only the photos are left, readable by the group alone",
      not [n for n in os.listdir(root + "/ABD1305") if n.startswith(".up-")]
      and (os.stat(root + "/ABD1305/" + one["name"]).st_mode & 0o777) == 0o640)
check("read back whole with its type", H.read("ABD1305", one["name"]) == (JPEG, "image/jpeg")
      and H.read("ABD1305", two["name"]) == (JPEG + b"2", "image/jpeg")
      and H.read("ABD1305", three["name"]) == (PNG, "image/png"))
check("names that are not a photo's read nothing", H.read("abd1305", one["name"]) is None
      and H.read("ABD1305", "../x.jpg") is None and H.read("ABD1305", "20251026T000000000Z.jpg") is None)
check("the refusals, in the relay's words",
      refused(H.save, "abd1305", JPEG) == "ValueError: house: a house code, such as ABD1305."
      and refused(H.save, "ABD1305", b"") == "ValueError: The picture arrived empty."
      and refused(H.save, "ABD1305", JPEG[:3] + b"x" * H.MAX_BYTES) == "ValueError: The picture is larger than 5 MB."
      and refused(H.save, "ABD1305", GIF) == "ValueError: A house photo is a JPEG, PNG or WebP picture."
      and files(root + "/ABD1305") == kept)
url = "https://asamylife.asalifecare.com" + one["path"]
check("the registry's thumbnail_url names the house", H.url_house(url) == "ABD1305"
      and houses._KEPT_PHOTO.match(url) is not None and H.url_house("https://x.y/hub-lanes/other/ABD1305/a.jpg") == "")
person = P.save("clients", "C-1.k", WEBP)
check("a person's photo is kept as people/<app>/<key>/<time>.<ext>",
      files(root + "/people/clients/C-1.k") == [person["name"]] and person["type"] == "image/webp"
      and person["path"] == f"{P.PREFIX}/clients/C-1.k/{person['name']}", person)
m = photos.PATH_RE.fullmatch(person["path"])
check("its path is the one photoPlan's write names", m is not None and m.groups()[:2] == ("clients", "C-1.k"))
check("and it reads back", P.read("clients", "C-1.k", person["name"]) == (WEBP, "image/webp")
      and P.read("staff", "C-1.k", person["name"]) is None and P.read("clients", "..k", person["name"]) is None)
check("a folder no app owns, or a key that is no folder, is refused",
      refused(P.save, "nope", "k", JPEG) == "ValueError: No such record folder."
      and refused(P.save, "clients", ".k", JPEG) == "ValueError: No such record folder."
      and refused(P.save, "clients", "a..b", JPEG) == "ValueError: No such record folder."
      and refused(P.save, "staff", "k", GIF) == "ValueError: A photo is a JPEG, PNG or WebP picture.")
w = P.where()
by = {a["label"]: a for a in w["apps"]}
check("where: the folder as the server names it, and what each app keeps",
      w["root"] == "/host/asa-hub/images" and w["inside"] == root and w["mounted"] is True and w["why"] == ""
      and by["Locations"]["folder"] == "/host/asa-hub/images/<HOUSE CODE>"
      and (by["Locations"]["records"], by["Locations"]["photos"]) == (1, 3)
      and by["Locations"]["bytes"] == 2 * len(JPEG) + 1 + len(PNG)
      and (by["Clients"]["records"], by["Clients"]["photos"]) == (1, 1)
      and all(by[k]["photos"] == 0 for k in ("Staff", "SSA", "Families", "Staff Candidates", "Client Candidates")), w)
shutil.rmtree(root + "/people")
shutil.rmtree(root + "/ABD1305")

# ---- the app's own reads, the sessions and the doors' stand-ins ------------------------------------------------------
db = hubdb.HubDb()


def caller(said: dict, reads: L.Reads, action: str = "", module=None) -> dict:
    """main.caller's account: the users row the session names, then where it stands."""
    uid, role = gsjs.trim(str(said.get("uid") or "")), gsjs.trim(str(said.get("role") or "")).lower()
    row = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == uid and not gsjs.str_(u.get("mergedinto"))),
               None)
    if row is None:
        raise sc.Defer("the account's users row is not in asa-hub-db")
    user = sc.user_from_row(row)
    if (said.get("is_master") is True) != sc.is_real_master(user) or user["role"].lower() != role:
        raise sc.Defer("the users row and the session disagree")
    return envelope.settle(user, said, reads, action, module)


FD.M = types.SimpleNamespace(DB=db, DRIVE=None, _own=lambda: None, caller=caller)
CALLS: list[dict] = []
WRITES: list = []
SCOPE_SILENT = [False]


async def call_app(app_id, action, user, payload, write_id="", at=0.0):
    """front_door.call_app's contract: a read runs the app's own door on the copy; the photo's write is scripted."""
    CALLS.append({"app": app_id, "action": action, "user": dict(user), "payload": dict(payload), "write_id": write_id})
    module = {"locations": L, "photos": photos}.get(app_id)
    if module is not None and action in module.ACTIONS:
        if action == PD.SCOPE and SCOPE_SILENT[0]:
            return None

        def run(reads: L.Reads) -> dict:
            return module.ACTIONS[action](L.Session(reads, caller(user, reads, action, module)), payload)
        env = await asyncio.to_thread(LG.in_reads, run)
        return json.dumps(env).encode(), time.time(), env, None, 0.0
    said = WRITES.pop(0) if WRITES else None
    env = said(payload) if callable(said) else said
    return None if env is None else (json.dumps(env).encode(), time.time(), env, None, 0.0)


LANDED: list = []
VOIDS: list = []
FD.call_app = call_app
FD.settle_void_soon = lambda app_id, write_id: VOIDS.append((app_id, write_id))
LF.final_landed = lambda action, raw, content: LANDED.append((action, raw, content))
TOKENS: dict[str, FD.Session] = {}


async def session(token: str):
    return TOKENS.get(token)
FD.session = session

reads = L.Reads(db, None)
raw_users = [u for u in reads.users() if not gsjs.str_(u.get("mergedinto"))]
master_row = next((u for u in raw_users if sc.is_master_email(u.get("email"))), None)
check("the master's users row is in the copy", master_row is not None)
TOKENS["master"] = FD.Session(ok=True, role="admin", uid=gsjs.str_((master_row or {}).get("userid")), is_master=True)
TOKENS["ended"] = FD.Session(ok=False)
TOKENS["ghost"] = FD.Session(ok=True, role="staff", uid="U-not-an-account")
homes = reads.homes()
codes = sorted(h["code"] for h in homes)
facts["houses on the registry"] = len(codes)
house = codes[0] if codes else "ABD1305"


def bearer(token: str) -> str:
    return f"Bearer {token}" if token else ""


class FakeApp:
    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], object] = {}

    def _on(self, method: str, path: str):
        def take(fn):
            self.routes[(method, path)] = fn
            return fn
        return take

    def get(self, path: str):
        return self._on("GET", path)

    def post(self, path: str):
        return self._on("POST", path)


class Req:
    def __init__(self, body: bytes, length: str | None = None) -> None:
        self.headers = {"content-length": str(len(body)) if length is None else length}
        self.body = body

    async def stream(self):
        for i in range(0, len(self.body), 65536):
            yield self.body[i:i + 65536]


class Resp:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


def answer_of(r) -> tuple[int, dict]:
    return r.status_code, json.loads(r.body)


async def main() -> None:
    app = FakeApp()
    taken = PD.install(app)
    paths = sorted(app.routes)
    check("the five doors mount on the app", paths == sorted([
        ("POST", "/hub-lanes/locations/image/{code}"), ("GET", "/hub-lanes/locations/image/{code}/{name}"),
        ("GET", "/hub-lanes/photos/where"), ("POST", "/hub-lanes/photos/{folder}/{key}"),
        ("GET", "/hub-lanes/photos/{folder}/{key}/{name}")]) and len(taken) == 5
        and PD._forget in FD.SESSIONS_FORGOTTEN, paths)
    up = app.routes[("POST", "/hub-lanes/locations/image/{code}")]
    see = app.routes[("GET", "/hub-lanes/locations/image/{code}/{name}")]
    where = app.routes[("GET", "/hub-lanes/photos/where")]
    pup = app.routes[("POST", "/hub-lanes/photos/{folder}/{key}")]
    psee = app.routes[("GET", "/hub-lanes/photos/{folder}/{key}/{name}")]

    async def put(code: str, token: str, body: bytes, length: str | None = None) -> tuple[dict, dict]:
        resp = Resp()
        got = await up(code, Req(body, length), resp, authorization=bearer(token))
        return got, resp.headers

    # ---- the house photo, kept ----
    got, hdr = await put("A1", "master", b64(JPEG))
    check("a bad house code is refused first", got == {"status": 400, "reason": "request",
                                                       "message": "house: a house code, such as ABD1305."}
          and hdr.get("Cache-Control") == "no-store", got)
    no = {"status": 403, "reason": "edition", "message": "Replacing a house photo is not open to you."}
    check("without a session, or with one ended or unknown, it is not open",
          (await put(house, "", b64(JPEG)))[0] == no and (await put(house, "ended", b64(JPEG)))[0] == no
          and (await put(house, "ghost", b64(JPEG)))[0] == no)
    got, _ = await put("ZZZ999", "master", b64(JPEG))
    check("a house the registry does not list gets no folder",
          got == {"status": 404, "reason": "missing", "message": "No house ZZZ999 is on the houses list."}, got)
    homes_was = L.Reads.homes
    L.Reads.homes = lambda self: (_ for _ in ()).throw(hubdb.Unreadable("held back by the test"))
    try:
        got, _ = await put(house, "master", b64(JPEG))
    finally:
        L.Reads.homes = homes_was
    check("a registry that cannot be read is said, never taken for a missing house",
          got.get("status") == 503 and got.get("reason") == "unreadable" and not files(f"{root}/{house}"), got)
    os.unlink(root + "/" + H.MARK)
    got, _ = await put(house, "master", b64(JPEG))
    open(root + "/" + H.MARK, "w").close()
    check("an unmounted folder keeps nothing", got == {"status": 503, "reason": "unmounted", "message":
                                                       f"The photo cannot be kept: the images folder is not mounted at "
                                                       f"{root}."}, got)
    too_big = {"status": 413, "reason": "request", "message": "The picture is larger than 5 MB. Nothing was kept."}
    cap = H.MAX_BYTES * 4 // 3 + 64 * 1024
    check("a body past the cap is refused, declared or streamed",
          (await put(house, "master", b"{}", str(cap + 1)))[0] == too_big
          and (await put(house, "master", b"x" * (cap + 10), "10"))[0] == too_big)
    check("a picture past 5 MB inside the cap is refused by the disk's own check",
          (await put(house, "master", b64(JPEG[:3] + b"x" * (H.MAX_BYTES + 1))))[0] == {
              "status": 400, "reason": "request", "message": "The picture is larger than 5 MB."}
          and not files(f"{root}/{house}"))
    check("a body that is no picture is refused in the relay's words",
          (await put(house, "master", b"not json"))[0] == {"status": 400, "reason": "request",
                                                            "message": "Send {name, mime, b64}: one picture."}
          and (await put(house, "master", b64(GIF)))[0] == {"status": 400, "reason": "request",
                                                             "message": "A house photo is a JPEG, PNG or WebP picture."}
          and not files(f"{root}/{house}"))
    got, _ = await put(house, "master", b64(JPEG))
    data = got.get("data") or {}
    check("the master keeps a house photo", got.get("status") == 200 and data.get("house") == house
          and files(f"{root}/{house}") == [data.get("name")] and data.get("bytes") == len(JPEG)
          and data.get("path") == f"{H.PREFIX}/{house}/{data.get('name')}", got)
    house_photo = data.get("name") or ""

    # an employee: no edition, then locations.house opened to them, kept only while they read every house uncut
    staff = None
    tried = 0
    for row in raw_users:
        u = sc.user_from_row(row)
        if u["role"].lower() in ("staff", "manager") and not sc.is_real_master(u) and u["id"] \
                and not E.allows(L.EDITION["house"], u, {E.EDITIONS_KEY: ""}) and tried < 40:
            tried += 1
            s = FD.Session(ok=True, role=u["role"].lower(), uid=u["id"])
            if await LG.released(s, L.APP_ID):
                staff = (u, s)
                break
    facts["an employee Locations is released to, without the house edition"] = bool(staff)
    if staff:
        u, s = staff
        TOKENS["staff"] = s
        config_was = L.Reads.config
        try:
            L.Reads.config = lambda self: {**config_was(self), E.EDITIONS_KEY: json.dumps(
                [{"id": L.EDITION["house"], "on": False, "people": [u["id"]], "badge": ""}])}
            got_off, _ = await put(house, "staff", b64(PNG))
            check("without locations.house they keep nothing",
                  got_off == no and len(files(f"{root}/{house}")) == 1, got_off)
            L.Reads.config = lambda self: {**config_was(self), E.EDITIONS_KEY: json.dumps(
                [{"id": L.EDITION["house"], "on": True, "people": [u["id"]], "badge": ""}])}
            got_on, _ = await put(house, "staff", b64(PNG))
        finally:
            L.Reads.config = config_was
        check("holding it, they keep one", got_on.get("status") == 200 and len(files(f"{root}/{house}")) == 2, got_on)

    # ---- the house photo, read ----
    async def look(code: str, name: str, token: str):
        return await see(code, name, authorization=bearer(token))

    r = await look(house, house_photo, "master")
    check("the master reads it whole", r.status_code == 200 and r.body == JPEG and r.media_type == "image/jpeg"
          and r.headers.get("Cache-Control") == "private, max-age=86400, immutable"
          and r.headers.get("X-Content-Type-Options") == "nosniff")
    none = (404, {"status": 404, "message": "No such photo."})
    check("anyone else is told no such photo", answer_of(await look(house, house_photo, "")) == none
          and answer_of(await look(house, house_photo, "ended")) == none
          and answer_of(await look(house, "20251026T000000000Z.jpg", "master")) == none
          and answer_of(await look(house.lower(), house_photo, "master")) == none)
    if staff:
        check("an employee Locations is released to reads it", (await look(house, house_photo, "staff")).body == JPEG)
    # a client held to the houses they live in: their own house, never another
    client = None
    for row in raw_users:
        u = sc.user_from_row(row)
        if u["role"].lower() != "client" or not u["client_key"]:
            continue
        try:
            v = L.Session(L.Reads(db, None), u).viewer()
        except Exception:  # noqa: BLE001 - a scope the copy cannot tell is not a client to try
            continue
        if v and L.narrowed(v) and v.get("house_codes"):
            client = (u, list(v["house_codes"]))
            break
    facts["a client held to their houses"] = bool(client)
    if client:
        u, theirs = client
        TOKENS["client"] = FD.Session(ok=True, role="client", uid=u["id"])
        other = next((c for c in codes if c not in theirs), "")
        mine = (await asyncio.to_thread(H.save, theirs[0], JPEG))["name"]
        not_mine = (await asyncio.to_thread(H.save, other, JPEG))["name"] if other else ""
        got_mine = await look(theirs[0], mine, "client")
        check("a client reads their own house's photo", got_mine.status_code == 200 and got_mine.body == JPEG,
              got_mine.status_code)
        check("and never another house's", bool(other) and answer_of(await look(other, not_mine, "client")) == none
              and (await look(other, not_mine, "master")).status_code == 200, other)
        scoped = [c for c in CALLS if c["action"] == PD.SCOPE and c["user"].get("uid") == u["id"]]
        check("their houses are Locations' own locationScope, asked once and held",
              len(scoped) == 1 and scoped[0]["user"]["uid"] == u["id"], len(scoped))
    TOKENS["unsure"] = FD.Session(ok=True, role="client", uid="U-unsure")
    SCOPE_SILENT[0] = True
    try:
        r = await look(house, house_photo, "unsure")
    finally:
        SCOPE_SILENT[0] = False
    check("a scope Python did not answer is unsure, not a refusal",
          answer_of(r) == (503, {"status": 503, "message": "Who may see the house could not be checked just now. "
                                                           "Try again."}) and "unsure" not in PD._house_scopes)

    # ---- a person's photo ----
    roster = [r for r in reads.client_rows() if photos.KEY_RE.fullmatch(gsjs.trim(gsjs.or_text(r.get("client_key"))))]
    asked = gsjs.trim(gsjs.or_text(roster[0].get("client_key"))) if roster else ""
    as_master = LG.user_of(TOKENS["master"], PD.PLAN)
    direct = await asyncio.to_thread(LG.in_reads, lambda rd: photos.plan(L.Session(rd, caller(
        as_master, rd, PD.PLAN, photos)), {"app": "clients", "key": asked}))
    key = str((direct.get("data") or {}).get("key") or "")
    check("photoPlan names a client record for the master", direct.get("status") == 200 and bool(key)
          and (direct.get("data") or {}).get("folder") == "clients", direct)
    shelf = f"{root}/people/clients/{key}"

    async def send(folder: str, k: str, token: str, body: bytes) -> dict:
        return await pup(folder, k, Req(body), Resp(), authorization=bearer(token))

    check("a folder no app owns is no record", await send("nope", key, "master", b64(JPEG)) == {
        "status": 404, "reason": "missing", "message": "No such record."})
    check("the picture is checked before anyone is asked",
          await send("clients", key, "master", b64(b"")) == {"status": 400, "reason": "request",
                                                              "message": "The picture arrived empty."}
          and await send("clients", key, "master", b64(GIF)) == {"status": 400, "reason": "request",
                                                                  "message": "A photo is a JPEG, PNG or WebP picture."}
          and not [c for c in CALLS if c["action"] == PD.PLAN])
    check("without a session: sign in", await send("clients", key, "", b64(JPEG)) == {
        "status": 401, "message": "Authentication required."} and not files(shelf))
    check("a plan Python did not answer keeps nothing", await send("clients", key, "ghost", b64(JPEG)) == PD.UNKEPT
          and not files(shelf))
    if staff:
        try:
            theirs_plan = await asyncio.to_thread(LG.in_reads, lambda rd: photos.plan(L.Session(rd, caller(
                LG.user_of(TOKENS["staff"], PD.PLAN), rd, PD.PLAN, photos)), {"app": "clients", "key": key}))
        except Exception as exc:  # noqa: BLE001 - a session main.caller defers is the unanswered case above
            theirs_plan = {"deferred": type(exc).__name__}
        if theirs_plan.get("status") not in (None, 200):
            check("photoPlan's refusal is the answer, nothing kept",
                  await send("clients", key, "staff", b64(JPEG)) == theirs_plan and not files(shelf), theirs_plan)
        else:
            facts["photoPlan for the employee tried"] = theirs_plan.get("status") or theirs_plan
    WRITES[:] = [{"status": 409, "message": "A write is in progress for this record — try again in a moment."},
                 lambda p: {"status": 200, "data": {"app": "clients", "key": key, "photo": p["path"]},
                            "_write": {"final": True}}]
    CALLS.clear()
    got = await send("clients", key, "master", b64(JPEG))
    named = [c for c in CALLS if c["action"] == "clientProfilePhoto"]
    plan = next((c for c in CALLS if c["action"] == PD.PLAN), {})
    on_disk = files(shelf)
    path = f"{P.PREFIX}/clients/{key}/{on_disk[0]}" if on_disk else ""
    check("photoPlan is asked for the record, as the master", plan.get("app") == "photos"
          and plan.get("payload") == {"app": "clients", "key": key} and plan.get("user", {}).get("is_master") is True,
          plan)
    check("kept, then named by the record's own write, asked once more under the same id while the lock is held",
          got == {"status": 200, "data": {"app": "clients", "key": key, "photo": path}} and len(named) == 2
          and named[0]["write_id"] == named[1]["write_id"] and named[0]["write_id"].startswith("W")
          and named[0]["app"] == "clients" and named[0]["payload"] == {"client": key, "path": path,
                                                                       "bytes": len(JPEG)}
          and named[0]["user"].get("asked") == "clientProfilePhoto" and len(on_disk) == 1, (got, named))
    landed = LANDED[-1] if LANDED else ("", b"", b"")
    rung = json.loads(urllib.parse.parse_qs(landed[1].decode())["body"][0]) if landed[1] else {}
    check("its pack and roster rung as a kept write", landed[0] == "clientProfilePhoto"
          and rung == {"token": "master", "action": "clientProfilePhoto", "payload": {"client": key}}
          and json.loads(landed[2]).get("status") == 200 and "_write" not in json.loads(landed[2]), rung)
    WRITES[:] = [None]
    VOIDS.clear()
    got = await send("clients", key, "master", b64(PNG))
    check("a write Python did not answer: the relay's words, let go void, the picture left unshown on disk",
          got == PD.UNKEPT and len(VOIDS) == 1 and VOIDS[0][0] == "clients" and len(files(shelf)) == 2, (got, VOIDS))
    WRITES[:] = [{"status": 409, "message": "That record changed a moment ago — reload it and try again."}]
    CALLS.clear()
    got = await send("clients", key, "master", b64(PNG))
    check("its refusal is the answer, asked once", got.get("status") == 409 and len(
        [c for c in CALLS if c["action"] == "clientProfilePhoto"]) == 1, got)

    async def peek(folder: str, k: str, name: str, token: str):
        return await psee(folder, k, name, authorization=bearer(token))

    r = await peek("clients", key, on_disk[0] if on_disk else "x", "master")
    check("the master reads a person's photo whole", r.status_code == 200 and r.body == JPEG
          and r.media_type == "image/jpeg" and r.headers.get("Cache-Control") == "private, max-age=86400, immutable")
    check("a session no app showing that person opens to is told no such photo",
          answer_of(await peek("clients", key, on_disk[0], "ghost")) == none
          and answer_of(await peek("clients", key, on_disk[0], "")) == none
          and answer_of(await peek("staff", key, on_disk[0], "master")) == none
          and answer_of(await peek("clients", key, "x.jpg", "master")) == none)
    if staff:
        facts["the employee sees a client's photo"] = (await peek("clients", key, on_disk[0], "staff")).status_code
    access_was = LG.app_access
    LG.app_access = lambda *a, **k: {"open": False, "reason": "unreadable", "why": "held back by the test"}
    try:
        r = await peek("ssa", key, on_disk[0], "ghost")
    finally:
        LG.app_access = access_was
    check("an access record that cannot be read is unsure, not a refusal",
          answer_of(r) == (503, {"status": 503, "message": "Who may see the photo could not be checked just now. "
                                                           "Try again."}) and ("ghost", "ssa") not in PD._person_seen)

    # ---- where ----
    resp = Resp()
    got = await where(resp, authorization=bearer("master"))
    d = got.get("data") or {}
    by = {a["label"]: a for a in d.get("apps") or []}
    check("where, for the master: the folder and what each app keeps", got.get("status") == 200
          and d.get("root") == "/host/asa-hub/images" and d.get("mounted") is True
          and by.get("Clients", {}).get("photos") == len(files(shelf)) == 3
          and by.get("Locations", {}).get("photos", 0) >= 1
          and resp.headers.get("Cache-Control") == "no-store", got)
    hidden = {"status": 404, "reason": "missing", "message": "Not found."}
    check("for anyone else, not found", await where(Resp(), authorization=bearer("ghost")) == hidden
          and await where(Resp(), authorization="") == hidden
          and (not staff or await where(Resp(), authorization=bearer("staff")) == hidden))
    PD._forget()
    check("a forgotten session's holds go with it", not PD._house_scopes and not PD._person_seen)


try:
    asyncio.run(main())
finally:
    shutil.rmtree(_WORK, ignore_errors=True)
check("the temporary folder is gone", not os.path.exists(_WORK))

print(json.dumps({"facts": facts, "results": results,
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
