import {createSeedClient, type SeedClient} from '@seed-hypermedia/client/client'
import {getCurrentServer} from '../store/server-store'

let currentClient: SeedClient | null = null
let currentServerUrl: string | null = null

// Create or get the seed client for the current server
export function getSeedClient(): SeedClient {
  const server = getCurrentServer()

  // Return cached client if server hasn't changed
  if (currentClient && currentServerUrl === server.url) {
    return currentClient
  }

  currentClient = createSeedClient(server.url)
  currentServerUrl = server.url
  return currentClient
}

// Reset the client (call when server changes)
export function resetSeedClient(): void {
  currentClient = null
  currentServerUrl = null
}
