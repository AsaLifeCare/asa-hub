#!/bin/bash
# The ASA Hub's database backup: asa-hub-db is the Hub's only record, so every day a full dump of its database and its
# roles is kept DAILY_KEEP days; on Sunday (or FORCE_WEEKLY=1) the day's dump is also kept as a weekly, WEEKLY_KEEP of
# them. Run by root's crontab; a dump pg_restore cannot list is never kept.
set -euo pipefail
umask 077

BACKUP_ROOT="${HUB_BACKUP_ROOT:-/opt/docker/backups/asa-hub-db}"
DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
LOG_FILE="$BACKUP_ROOT/backup.log"
CONTAINER="asa-hub-db"
DAILY_KEEP="${DAILY_KEEP:-7}"
WEEKLY_KEEP="${WEEKLY_KEEP:-4}"
FORCE_WEEKLY="${FORCE_WEEKLY:-0}"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"
TS=$(date +%Y%m%d_%H%M%S)
DOW=$(date +%u)   # 1=Mon .. 7=Sun

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || { log "ERROR: $CONTAINER is not running"; exit 1; }
PGUSER=$(docker exec "$CONTAINER" printenv POSTGRES_USER)
PGDB=$(docker exec "$CONTAINER" printenv POSTGRES_DB)

DUMP="$DAILY_DIR/${PGDB}_${TS}.dump"
ROLES="$DAILY_DIR/roles_${TS}.sql.gz"
log "=== daily backup start ($PGDB) ==="
# the roles first (the app's read and write roles): a restore needs them before the grants
docker exec "$CONTAINER" pg_dumpall -U "$PGUSER" --roles-only | gzip > "$ROLES"
# custom format straight out of the container: one consistent snapshot, compressed
docker exec "$CONTAINER" pg_dump -U "$PGUSER" -Fc -d "$PGDB" > "$DUMP.part"
if ! docker exec -i "$CONTAINER" pg_restore --list < "$DUMP.part" > /dev/null; then
    rm -f "$DUMP.part"
    log "ERROR: the dump could not be listed by pg_restore — not kept"
    exit 1
fi
mv "$DUMP.part" "$DUMP"
log "daily OK -> $(basename "$DUMP") $(du -h "$DUMP" | cut -f1)"

if [ "$DOW" = "7" ] || [ "$FORCE_WEEKLY" = "1" ]; then
    cp "$DUMP" "$ROLES" "$WEEKLY_DIR/"
    log "weekly kept -> $(basename "$DUMP")"
fi

# keep the newest $2 dumps in $1, each with its roles file
prune() {
    local old n f stamp
    mapfile -t old < <(find "$1" -maxdepth 1 -type f -name "${PGDB}_*.dump" | sort)
    n=$(( ${#old[@]} - $2 ))
    [ "$n" -gt 0 ] || return 0
    for f in "${old[@]:0:$n}"; do
        stamp=$(basename "$f" | sed -E "s/^${PGDB}_(.*)\\.dump\$/\\1/")
        rm -f "$1/${PGDB}_${stamp}.dump" "$1/roles_${stamp}.sql.gz"
        log "pruned $(basename "$1") -> $stamp"
    done
}
prune "$DAILY_DIR" "$DAILY_KEEP"
prune "$WEEKLY_DIR" "$WEEKLY_KEEP"
log "=== done, total size: $(du -sh "$BACKUP_ROOT" | cut -f1) ==="
