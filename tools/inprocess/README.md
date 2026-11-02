# In-process test runner

Runs a test with the app's own modules inside `asa-hub-db-sync`. Never run them inside asa-hub-app: it is out of
memory headroom.

- `run.sh <app dir> <test file> [env json | @env file]` streams every `app/*.py` and the test as base64 JSON into
  `docker exec -i asa-hub-db-sync python`. An environment past 128 KiB does not fit in one argument: write it to a
  file and pass `@<path>`.
- `drv.py` installs a meta-path loader for those sources and then runs the test.
- Drive credentials are read at run time from `/opt/docker/asa-hub/server/.asatech-drive.json`. None is stored
  here.
- The runner has no httpx and only a stub fastapi. A module the test imports must import those inside its
  functions.
- Every test writes only stand-ins (pg_temp tables) or a transaction it rolls back.

The test docstrings call this folder `$RUNNER`. Copy it to a scratch folder first, because the tests copy
themselves beside `drv.py`:

    RUNNER=$(mktemp -d) && cp tools/inprocess/run.sh tools/inprocess/drv.py "$RUNNER"/
    cp tools/test-generic-rows.py "$RUNNER/test_generic_rows.py"
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_generic_rows.py" '{"FD_ROUTES": "..."}'

Tests that need a real web stack (uvicorn, httpx) run inside asa-hub-snapshot instead, as
`tools/test-relay-carrier.py` does. Once the relay is retired, move them to a test container on the same image.
