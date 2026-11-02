# asa-hub-chat: where it runs

The chat hub (this folder's parent, built as `asa/hub-chat:local`) runs from the Hub's own compose since 2026-10-27:

| What | Where |
|---|---|
| the container, its build and its env | `web/compose.yaml`, service `asa-hub-chat` (project `asa-hub-web`) |
| its key, `HUB_CHAT_KEY` (the same value asa-hub-app holds) | `web/.env`, beside the compose, never committed |
| the two public paths, `/chat-hub/live` and `/chat-hub/live/negotiate` | `web/nginx/default.conf` (the snippets that were in this folder, applied) |

The hub is reached on exactly those two paths, matched on nginx's normalised `$uri` and forwarded as a path the
location writes itself (never the raw request line, nor `$uri`), so dot segments or an encoded `/` cannot steer a
request to the hub's `/internal/*` or `/health`. The match ends with `\z`, not `$`, so an encoded CR or LF makes a path
not one of the two. Everything the hub asks of the platform (`/chat/exec`, `/chat/ticket/redeem`, `/chat/refs`,
`/chat/gate`) goes to asa-hub-app on the proxy network, never through nginx.

Rebuild and restart (announce it first; open chats reconnect within seconds):

```bash
cd /opt/docker/asa-hub/web && docker compose -p asa-hub-web -f compose.yaml up -d --build asa-hub-chat
```

Then prove it from the domain: `POST /chat-hub/live/negotiate` without a ticket answers 401.

`hub-nginx.chat.http.conf` and `hub-nginx.chat.locations.conf` beside this file are the two snippets as they were
first written; `web/nginx/default.conf` holds them now.
