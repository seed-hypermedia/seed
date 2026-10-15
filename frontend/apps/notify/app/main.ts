// Seed notify: a headless Bun service. Serves the notification API under /hm/api/notify (plus the
// legacy /hm/api/<leaf> aliases) and runs the email notifier loops against the daemon.
// Bun loads `.env` from the working directory on its own.
import {captureException} from './sentry'

import {serve} from 'bun'
import {initDatabase} from './db'
import {initEmailNotifier} from './email-notifier'
import {createRoutes, notFound} from './routes'
import {corsJson} from './utils/cors'

await initDatabase()

const server = serve({
  port: Number(process.env.PORT) || 3000,
  routes: createRoutes(),
  fetch: notFound,
  error(error) {
    console.error('Unhandled request error', error)
    captureException(error)
    return corsJson({error: 'Internal server error'}, {status: 500})
  },
})

console.log(`Notify listening on ${server.url}`)

initEmailNotifier().catch((e) => {
  console.error('Error initializing email notifier', e)
  captureException(e)
})

function shutdown() {
  console.log('Shutting down notify')
  server.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
