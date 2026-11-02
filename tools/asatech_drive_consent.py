#!/usr/bin/env python3
"""One fixed credential for Python to file a platform paper as asatech: a refresh token of asatech@asalifecare.com
for the Drive scope alone, on the asatech OAuth client the platform already holds (GS_GOOGLE_CLIENT_ID / _SECRET in
the old platform/.env). The Apps Script web app files as asatech too, under its project's own grant of auth/drive,
which Google lets no one copy.

    python3 tools/asatech_drive_consent.py

It prints one link. Open it signed in as asatech@asalifecare.com and click Allow. Google lands on the OAuth
Playground, the only redirect this client accepts. Paste the address you land on (it carries ?code=…), or the Refresh
token the Playground shows if it already exchanged it. Nothing secret is printed. The token is kept only once it is
proved to be asatech's, to hold Drive and to add files to the platform folder. It goes to server/.asatech-drive.json
(0600, git-ignored), which the relay reads where it mounts server/. the old platform/.env is not touched.
"""
from __future__ import annotations

import getpass
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENV = os.getenv("ASATECH_ENV", "/opt/docker/asa-hub/server/.tools.env")
OUT = os.getenv("ASATECH_DRIVE_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server",
                                                  ".asatech-drive.json"))
OWNER = "asatech@asalifecare.com"
PLATFORM_ROOT = "1fNb2-pqSGS-DZcyXAoxPY7Sp9CaPC8-b"
REDIRECT = "https://developers.google.com/oauthplayground"
SCOPE = "https://www.googleapis.com/auth/drive"


def env_value(text: str, key: str) -> str:
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    return m.group(1).strip().strip('"').strip("'") if m else ""


def post(url: str, fields: dict[str, str]) -> dict:
    req = urllib.request.Request(url, urllib.parse.urlencode(fields).encode(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            said = json.loads(e.read())
        except ValueError:
            said = {}
        raise SystemExit(f"Google refused: {said.get('error', e.code)} — {said.get('error_description', '')}")


def get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main() -> int:
    text = open(ENV, encoding="utf-8").read()
    cid, secret = env_value(text, "GS_GOOGLE_CLIENT_ID"), env_value(text, "GS_GOOGLE_CLIENT_SECRET")
    if not cid or not secret:
        print(f"{ENV} carries no GS_GOOGLE_CLIENT_ID / _SECRET; nothing done.")
        return 2
    link = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": REDIRECT, "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent", "login_hint": OWNER})
    print("\n1) Abra este link com a conta asatech@asalifecare.com e clique em Permitir (só o Google Drive):\n")
    print(link)
    print("\n2) Cole aqui o endereço completo em que cair (com ?code=…) ou o Refresh token que o Playground mostrar.")
    # --show: what is pasted is drawn on the screen, so the person sees it landed
    said = (input("   cole e carregue Enter > ") if "--show" in sys.argv[1:]
            else getpass.getpass("   (o que colar não aparece no ecrã) > ")).strip()
    if not said:
        print("Nada colado; nada foi mudado.")
        return 1
    code = urllib.parse.parse_qs(urllib.parse.urlparse(said).query).get("code", [""])[0] if "code=" in said else ""
    if not code and said.startswith("4/"):
        code = said
    if code:
        got = post("https://oauth2.googleapis.com/token", {"code": code, "client_id": cid, "client_secret": secret,
                                                             "redirect_uri": REDIRECT, "grant_type": "authorization_code"})
        refresh = got.get("refresh_token", "")
        if not refresh:
            print("Google devolveu um acesso sem refresh token; abra o link de novo (o prompt=consent força um).")
            return 1
    else:
        refresh = said
    access = post("https://oauth2.googleapis.com/token", {"refresh_token": refresh, "client_id": cid,
                                                          "client_secret": secret, "grant_type": "refresh_token"})
    token = access.get("access_token", "")
    info = get(f"https://oauth2.googleapis.com/tokeninfo?access_token={urllib.parse.quote(token)}", token)
    who = get("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", token)["user"]["emailAddress"]
    root = get(f"https://www.googleapis.com/drive/v3/files/{PLATFORM_ROOT}?fields=name,capabilities(canAddChildren)"
               "&supportsAllDrives=true", token)
    writes = bool(root.get("capabilities", {}).get("canAddChildren"))
    print(f"\n   conta: {who} · Drive: {SCOPE in info.get('scope', '').split()} · pasta da plataforma "
          f"\"{root.get('name')}\" aceita ficheiros: {writes}")
    if who.lower() != OWNER or SCOPE not in info.get("scope", "").split() or not writes:
        print("Não é o token certo (outra conta, sem Drive ou sem escrita na pasta); nada foi guardado.")
        return 1
    out = os.path.abspath(OUT)
    fd = os.open(out + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"account": OWNER, "scope": SCOPE, "client_id": cid, "client_secret": secret,
                   "refresh_token": refresh, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    os.replace(out + ".tmp", out)
    print(f"\n3) Guardado em {out} (0600). O relay usa-o para arquivar como asatech; nada mais foi mudado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
