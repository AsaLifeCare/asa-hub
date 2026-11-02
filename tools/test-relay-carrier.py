#!/usr/bin/env python3
"""app/relay_carrier.py against a stand-in relay, both served by uvicorn on loopback inside asa-hub-snapshot (which
has httpx, fastapi and uvicorn; asa-hub-app is never exec'd into): a live stream carried as it arrives, never
buffered, and closed at the relay when the browser leaves; the request carried as it came (method, query, body,
X-Real-IP, the relay's own Host, no hop-by-hop headers); the answer back whole (status, type, twin Set-Cookie); and a
relay that does not answer said as nginx said it, 502.

    python3 tools/test-relay-carrier.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-snapshot"

DRIVER = r'''
import asyncio, json, os, socket, sys, threading, time, types
import httpx, uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

RELAY_PORT, APP_PORT, DEAD_PORT = 18381, 18382, 18383
os.environ["HUB_RELAY_URL"] = f"http://127.0.0.1:{RELAY_PORT}"
carrier = types.ModuleType("relay_carrier")
exec(compile(sys.stdin.read(), "relay_carrier.py", "exec"), carrier.__dict__)

results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))

relay = FastAPI()
closed = {"events": False}

@relay.get("/events")
async def events():
    async def gen():
        try:
            yield b"data: one\n\n"
            await asyncio.sleep(1.5)
            yield b"data: two\n\n"
            await asyncio.sleep(30)
        finally:
            closed["events"] = True
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})

@relay.post("/echo")
async def echo(request: Request):
    body = await request.body()
    resp = JSONResponse({"body": body.decode(), "query": request.url.query, "headers": dict(request.headers),
                         "method": request.method})
    resp.headers.append("set-cookie", "a=1; Path=/")
    resp.headers.append("set-cookie", "b=2; Path=/")
    return resp

@relay.get("/teapot")
async def teapot():
    return Response(b"short and stout", status_code=418, media_type="text/plain")

app = FastAPI()
carrier.install(app)

def serve(asgi, port):
    server = uvicorn.Server(uvicorn.Config(asgi, host="127.0.0.1", port=port, log_level="error", lifespan="off"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return server
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f"port {port} never opened")

serve(relay, RELAY_PORT)
serve(app, APP_PORT)
base = f"http://127.0.0.1:{APP_PORT}"

# a live stream arrives as it is written: the first event long before the second
t0 = time.monotonic()
with httpx.Client(timeout=10) as c:
    with c.stream("GET", base + "/events") as r:
        it = r.iter_raw()
        first = next(it)
        t_first = time.monotonic() - t0
        second = next(it)
        t_second = time.monotonic() - t0
        check("the stream keeps the relay's status and type", r.status_code == 200 and
              r.headers.get("content-type", "").startswith("text/event-stream") and
              r.headers.get("x-accel-buffering") == "no")
check("the first event is carried before the relay writes the second (never buffered)",
      first == b"data: one\n\n" and t_first < 1.0, (first, t_first))
check("the second event follows when the relay writes it", second == b"data: two\n\n" and t_second >= 1.4,
      (second, t_second))
for _ in range(40):
    if closed["events"]:
        break
    time.sleep(0.1)
check("the browser leaving ends the stream at the relay", closed["events"])

# a request carried as it came
r = httpx.post(base + "/echo?x=1&y=two", content=b'{"hello":"world"}',
               headers={"content-type": "application/json", "x-real-ip": "203.0.113.9", "connection": "keep-alive",
                        "te": "trailers", "x-hub-whatever": "kept"})
got = r.json()
seen = got["headers"]
check("method, query and body reach the relay unchanged",
      got["method"] == "POST" and got["query"] == "x=1&y=two" and got["body"] == '{"hello":"world"}')
check("the browser's X-Real-IP and the other headers reach the relay",
      seen.get("x-real-ip") == "203.0.113.9" and seen.get("x-hub-whatever") == "kept"
      and seen.get("content-type") == "application/json")
check("the relay is asked with its own Host, as nginx asked it", seen.get("host") == f"127.0.0.1:{RELAY_PORT}",
      seen.get("host"))
check("no hop-by-hop header is carried", "te" not in seen and seen.get("connection", "keep-alive") == "keep-alive")
check("twin Set-Cookie headers come back both", r.headers.get_list("set-cookie") == ["a=1; Path=/", "b=2; Path=/"],
      r.headers.get_list("set-cookie"))
r = httpx.get(base + "/teapot")
check("any status and type come back as the relay answered",
      r.status_code == 418 and r.text == "short and stout" and r.headers["content-type"].startswith("text/plain"))
r = httpx.get(base + "/nothing-here")
check("a path the relay does not hold is the relay's own 404", r.status_code == 404)

# a relay that does not answer
carrier._CLIENT["c"] = None
carrier.RELAY_URL = f"http://127.0.0.1:{DEAD_PORT}"
r = httpx.get(base + "/events")
check("a relay that does not answer is nginx's 502, said in JSON",
      r.status_code == 502 and r.json().get("status") == 502)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} ok, {len(failed)} failed")
sys.exit(1 if failed else 0)
'''


def main() -> int:
    src = (ROOT / "app" / "relay_carrier.py").read_text(encoding="utf-8")
    got = subprocess.run(["docker", "exec", "-i", RUNNER, "python", "-c", DRIVER], input=src.encode(),
                         capture_output=True, timeout=180)
    sys.stdout.write(got.stdout.decode())
    if got.returncode != 0:
        sys.stdout.write(got.stderr.decode()[-3000:])
    return got.returncode


if __name__ == "__main__":
    sys.exit(main())
