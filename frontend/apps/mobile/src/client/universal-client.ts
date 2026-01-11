import {createWebUniversalClient, UniversalClient, UnpackedHypermediaId} from '@shm/shared'
import React from 'react'
import {View} from 'react-native'
import {createQueryAPI} from './query-api'
import {getCurrentServer, ServerInfo} from '../store/server-store'

let currentClient: UniversalClient | null = null
let currentServerUrl: string | null = null

// Placeholder CommentEditor for mobile (will be implemented later)
function MobileCommentEditor(_props: {docId: UnpackedHypermediaId}): JSX.Element {
  return React.createElement(View)
}

// Create or get the universal client for the current server
export function getUniversalClient(): UniversalClient {
  const server = getCurrentServer()

  // Return cached client if server hasn't changed
  if (currentClient && currentServerUrl === server.url) {
    return currentClient
  }

  // Create new client for current server
  currentClient = createUniversalClientForServer(server)
  currentServerUrl = server.url
  return currentClient
}

// Create a universal client for a specific server
export function createUniversalClientForServer(
  server: ServerInfo,
): UniversalClient {
  const queryAPI = createQueryAPI(server.url)

  return createWebUniversalClient({
    queryAPI,
    CommentEditor: MobileCommentEditor,
    // Recents not implemented for mobile yet
    fetchRecents: undefined,
    deleteRecent: undefined,
  })
}

// Reset the client (call when server changes)
export function resetUniversalClient(): void {
  currentClient = null
  currentServerUrl = null
}
