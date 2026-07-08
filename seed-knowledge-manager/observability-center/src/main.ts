import {mkdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {importKmArtifacts} from './importer.js'
import {serve} from './server.js'
import {openStore} from './store.js'

const command = process.argv[2] ?? 'serve'
const dbPath = resolve(process.env.OC_DB_PATH ?? './data/oc.sqlite')
mkdirSync(dirname(dbPath), {recursive: true})
const store = openStore(dbPath)

if (command === 'import') {
  const result = importKmArtifacts(store, {
    logsDir: process.env.OC_IMPORT_KM_LOGS_DIR,
    stateDir: process.env.OC_IMPORT_KM_STATE_DIR,
    fullPayload: enabled(process.env.OC_IMPORT_FULL_PAYLOAD),
  })
  console.log(JSON.stringify(result, null, 2))
} else if (command === 'serve') {
  const server = serve(store, {
    hostname: process.env.OC_HTTP_HOSTNAME ?? '0.0.0.0',
    port: parsePort(process.env.OC_HTTP_PORT, 4317),
    ingestToken: process.env.OC_INGEST_TOKEN,
    importLogsDir: process.env.OC_IMPORT_KM_LOGS_DIR,
    importStateDir: process.env.OC_IMPORT_KM_STATE_DIR,
    importFullPayload: enabled(process.env.OC_IMPORT_FULL_PAYLOAD),
    importIntervalMs: parsePort(process.env.OC_IMPORT_INTERVAL_MS, 10_000),
  })
  console.log(`km observability center listening on http://${server.hostname}:${server.port} db=${dbPath}`)
} else {
  console.error(`unknown command: ${command}`)
  process.exit(2)
}

function parsePort(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function enabled(raw: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(raw ?? '')
}
