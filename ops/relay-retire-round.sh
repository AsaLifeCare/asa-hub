#!/usr/bin/env bash
# Step 5 to 7 of the relay's retirement in one round. These clocks move into asa-hub-app:
#   - PSI attendance (time clock, shift pool, posts, full punch sheet);
#   - notices (catch-up, frames, pushes, strip);
#   - the reply ear and the shift rehearsal;
#   - the staff sweep's hotline inbox and feeds;
#   - the hotline desk and its calls index;
#   - the pharmacy sweep.
# The six keepers and the Decoder lab's Try move into asa-hub-worker.
# The app also gains the mounts its doors were waiting on:
#   - the seal folder (PsiAnywhere's accounts, the Quo keys, the seal's public certificate);
#   - the served SPA;
#   - the mail config, writable;
#   - the call-reading module.
#
# Order of the round:
#   1. the branch checked and fast-forwarded onto asa_dev (the live tree);
#   2. mount sources checked and LLM_API_KEY carried into app/.env;
#   3. the worker brought up and held, with its env proved to be the relay's;
#   4. the relay restarted, then the app recreated at once, both under the hub's lock. The relay goes first so no
#      clock ever runs in both processes, and nothing is sent twice;
#   5. each piece proved from the logs.
#
# Never prints a secret value. It stops before touching anything when a check fails; after step 4 it only reads.
set -euo pipefail
# HISTORY (2026-10-27): this round ran once, while the relay and the old platform (the old platform) still ran; both are gone,
# and its reads of the old platform's .env and tree with them. It is kept as the record of what was done and runs no more. The
# worker today: docker compose -p asa-hub-app -f /opt/docker/asa-hub/app/compose.yaml --profile worker up -d asa-hub-worker
echo "historical round: nothing to do (see the comment at its top)"; exit 0
