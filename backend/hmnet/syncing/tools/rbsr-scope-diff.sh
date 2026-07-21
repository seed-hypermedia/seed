#!/bin/bash
# rbsr-scope-diff.sh — offline drift differ for the maintained RBSR index.
#
# Replicates the legacy collectBlobs set for one rbsr_scope row in read-only
# SQL (TEMP tables only — safe against a live daemon database) and diffs it
# against the scope's persisted rbsr_item rows. Any MISSING_FROM_INDEX row is
# a blob the daemon owns but does not advertise to reconciling peers; any
# EXTRA_IN_INDEX row is over-advertised.
#
# Usage:
#   rbsr-scope-diff.sh <db-path> <scope-id>
#   rbsr-scope-diff.sh <db-path> --list    # scopes to try, biggest first
#
# Caveats (differ artifacts, not real drift):
#   - For kind-2 scopes at an account ROOT (no path), the inbound
#     Contact-by-subject step is skipped here (it needs the account's
#     principal bytes), so genuine Contacts — and capabilities their authors
#     pull in — show up as EXTRA_IN_INDEX. Prefer path-carrying scopes for a
#     clean signal, or use the Go equivalent:
#     SEED_SLIM_DB=... go test ./backend/hmnet/syncing/ -run OfflineSweep -v
#   - Scope kinds: 0 exact, 1 depth-one, 2 recursive, 3 dir-structure
#     (Ref+Change only).
set -eu
DBFILE="$1"
SID="$2"
DB="file:$DBFILE?mode=ro"

if [ "$SID" = "--list" ]; then
  sqlite3 "$DB" "SELECT s.id, s.kind, s.materialized, x.cnt, s.iri FROM rbsr_scope s JOIN (SELECT scope, COUNT(*) cnt FROM rbsr_item GROUP BY scope) x ON x.scope=s.id ORDER BY x.cnt DESC LIMIT 25;"
  exit 0
fi

read -r IRI KIND <<EOF
$(sqlite3 "$DB" "SELECT iri || ' ' || kind FROM rbsr_scope WHERE id=$SID;")
EOF
echo "scope=$SID kind=$KIND iri=$IRI"

case "$KIND" in
  3) RES_TYPES="'Ref'"; HAS_CAP=0;;
  *) RES_TYPES="'Ref','Capability','Comment','Profile','Contact'"; HAS_CAP=1;;
esac

case "$KIND" in
  0) IRIS="INSERT OR IGNORE INTO it SELECT id FROM resources WHERE iri = '$IRI';";;
  2) IRIS="INSERT OR IGNORE INTO it SELECT id FROM resources WHERE iri = '$IRI';
      INSERT OR IGNORE INTO it SELECT id FROM resources WHERE iri GLOB '$IRI/*';";;
  *) IRIS="INSERT OR IGNORE INTO it SELECT id FROM resources WHERE iri = '$IRI';
      INSERT OR IGNORE INTO it SELECT id FROM resources WHERE iri GLOB '$IRI/*' AND iri NOT GLOB '$IRI/*/*';";;
esac

# TSID workaround: when the scope path is itself a state-based resource id
# (hm://author/tsid), fillTables seeds every blob carrying that tsid by that
# author. The author check needs principal bytes we can't derive in shell, so
# the seed matches by tsid alone — unique enough for a diagnostic.
TSID_SEED=""
SPACE="${IRI#hm://}"; SPACE="${SPACE%%/*}"
TAIL="${IRI#hm://$SPACE}"; TAIL="${TAIL#/}"
if [ -n "$TAIL" ] && [ "${TAIL#*/}" = "$TAIL" ] && [ ${#TAIL} -ge 14 ] && [ ${#TAIL} -le 15 ]; then
  TSID_SEED="INSERT OR IGNORE INTO ib SELECT sb.id FROM structural_blobs sb WHERE sb.extra_attrs->>'tsid' = '$TAIL';"
fi

CAP_LOOP=""
if [ "$HAS_CAP" = "1" ]; then
  CAP_STEP="INSERT OR IGNORE INTO ib SELECT id FROM structural_blobs sb WHERE sb.type='Capability' AND sb.extra_attrs->>'del' IN (SELECT DISTINCT author FROM structural_blobs WHERE id IN ib) AND sb.extra_attrs->>'role'='AGENT';"
  CAP_LOOP="$CAP_STEP $CAP_STEP $CAP_STEP $CAP_STEP $CAP_STEP"
fi

sqlite3 "$DB" <<SQL
CREATE TEMP TABLE it(id INTEGER PRIMARY KEY);
CREATE TEMP TABLE ib(id INTEGER PRIMARY KEY);
$IRIS
$TSID_SEED
INSERT OR IGNORE INTO ib SELECT sb.id FROM structural_blobs sb WHERE resource IN it AND sb.type IN ($RES_TYPES);
WITH RECURSIVE changes(id) AS (
  SELECT bl.target FROM ib rb CROSS JOIN blob_links bl ON bl.source=rb.id AND bl.type='ref/head'
  UNION
  SELECT bl.target FROM blob_links bl JOIN changes c ON c.id=bl.source AND bl.type='change/dep'
) INSERT OR IGNORE INTO ib SELECT id FROM changes;
WITH RECURSIVE media(id) AS (
  SELECT bl.target FROM ib rb CROSS JOIN blob_links bl ON bl.source=rb.id
  UNION
  SELECT bl.target FROM blob_links bl JOIN media m ON m.id=bl.source
) INSERT OR IGNORE INTO ib SELECT m.id FROM media m LEFT JOIN stashed_blobs s ON s.id=m.id WHERE s.id IS NULL;
$CAP_LOOP
SELECT 'fresh_count', COUNT(*) FROM (SELECT rb.id FROM ib rb JOIN blobs b ON b.id=rb.id WHERE b.size>=0);
SELECT 'maintained_count', COUNT(*) FROM rbsr_item WHERE scope=$SID;
SELECT 'MISSING_FROM_INDEX(under-advertised)', COALESCE(sb2.type,'(non-structural)'), COUNT(*)
FROM (SELECT rb.id AS id FROM ib rb JOIN blobs b ON b.id=rb.id WHERE b.size>=0
      AND rb.id NOT IN (SELECT blob FROM rbsr_item WHERE scope=$SID)) x
LEFT JOIN structural_blobs sb2 ON sb2.id=x.id GROUP BY sb2.type;
SELECT 'EXTRA_IN_INDEX(over-advertised)', COALESCE(sb2.type,'(non-structural)'), COUNT(*)
FROM (SELECT blob AS id FROM rbsr_item WHERE scope=$SID
      AND blob NOT IN (SELECT rb.id FROM ib rb JOIN blobs b ON b.id=rb.id WHERE b.size>=0)) x
LEFT JOIN structural_blobs sb2 ON sb2.id=x.id GROUP BY sb2.type;
SQL
