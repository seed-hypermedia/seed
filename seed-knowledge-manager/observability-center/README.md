# KM Observability Center

Bun app for `oc.hyper.media`. It ingests Knowledge Manager telemetry, imports historical JSONL audit/state files, and provides a dashboard for answering:

- why KM did or did not answer a comment;
- how many mention actors are alive;
- what KM is currently doing;
- how sync/preflight checks have behaved.

## Run locally

```bash
cd seed-knowledge-manager/observability-center
bun install
OC_INGEST_TOKEN=dev OC_DB_PATH=./data/oc.sqlite bun dev
```

Open `http://localhost:4317`.

## Import existing KM logs

```bash
OC_DB_PATH=./data/oc.sqlite \
OC_IMPORT_KM_LOGS_DIR=/home/km/km-logs \
OC_IMPORT_KM_STATE_DIR=/home/km/km-state \
bun run import
```

The server also runs this import periodically when the import env vars are set.
Historical imports compact payloads by default; set `OC_IMPORT_FULL_PAYLOAD=1` only for short debugging sessions where full imported audit payloads must be copied into SQLite.

## Ingest from KM

Set these on the KM poll service:

```bash
KM_OBS_URL=https://oc.hyper.media/api/ingest
KM_OBS_TOKEN=<shared secret>
# Optional. Default stores metadata + previews only.
KM_OBS_FULL_PAYLOAD=0
```

The OC server validates `Authorization: Bearer <token>` when `OC_INGEST_TOKEN` is configured.
