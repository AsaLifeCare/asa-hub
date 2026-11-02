#!/bin/sh
# run.sh <app dir> <code file> [env json | @env file]: runs the code with the app modules inside asa-hub-db-sync
S=$(dirname "$0")
python3 -I - "$1" "$2" "${3:-{\}}" <<'EOF' | timeout 600 docker exec -i asa-hub-db-sync python -c 'import json,sys,io; b=sys.stdin.read(); d=json.loads(b); sys.stdin=io.StringIO(b); exec(compile(d["driver"], "drv", "exec"))'
import base64, glob, json, os, sys
app_dir, code_file, raw = sys.argv[1], sys.argv[2], sys.argv[3]
env = json.loads(open(raw[1:]).read() if raw.startswith("@") else raw)
app = {os.path.basename(p)[:-3]: base64.b64encode(open(p, "rb").read()).decode()
       for p in glob.glob(os.path.join(app_dir, "*.py"))}
c = json.load(open("/opt/docker/asa-hub/server/.asatech-drive.json"))
here = os.path.dirname(code_file)
json.dump({"app": app, "code": open(code_file).read(), "env": env,
           "creds": {k: c[k] for k in ("client_id", "client_secret", "refresh_token")},
           "driver": open(os.path.join(here, "drv.py")).read()}, sys.stdout)
EOF
