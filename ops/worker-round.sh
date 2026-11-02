#!/usr/bin/env bash
# Steps 6 and 7 of the relay's retirement: the six keepers (hub_sheet_sync, form_digest, mar_papers, call_prefs,
# resume_texts, cert_reads) and the Decoder lab's Try move to asa-hub-worker (server/hub_worker.py).
# The operator's round: the served tree and the mount sources checked, the worker brought up (it holds its keepers
# while the relay still runs them), its env proved to be the relay's, then the relay and the app restarted under the
# hub's lock (the relay starts none from then on, and its /health lets the worker's go), and the keepers' first passes
# proved in the worker's log. Never prints a secret value. Safe to run again.
set -euo pipefail
# HISTORY (2026-10-27): this round ran once, while the relay and the old platform (the old platform) still ran; both are gone,
# and its reads of the old platform's .env and tree with them. It is kept as the record of what was done and runs no more. The
# worker today: docker compose -p asa-hub-app -f /opt/docker/asa-hub/app/compose.yaml --profile worker up -d asa-hub-worker
echo "historical round: nothing to do (see the comment at its top)"; exit 0
