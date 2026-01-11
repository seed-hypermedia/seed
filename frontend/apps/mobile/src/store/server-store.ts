import {StorageKeys, getStorageItem, setStorageItem} from './storage'

export type ServerInfo = {
  url: string
  name: string
  addedAt: number
}

const DEFAULT_SERVER: ServerInfo = {
  url: 'https://dev.hyper.media',
  name: 'dev.hyper.media',
  addedAt: 0,
}

// Get all known servers, always includes default
export function getKnownServers(): ServerInfo[] {
  const stored = getStorageItem<ServerInfo[]>(StorageKeys.KNOWN_SERVERS)
  if (!stored || stored.length === 0) {
    return [DEFAULT_SERVER]
  }
  // Ensure default server is always in the list
  const hasDefault = stored.some((s) => s.url === DEFAULT_SERVER.url)
  if (!hasDefault) {
    return [DEFAULT_SERVER, ...stored]
  }
  return stored
}

// Add a new server to known servers
export function addKnownServer(server: Omit<ServerInfo, 'addedAt'>): void {
  const servers = getKnownServers()
  const exists = servers.some((s) => s.url === server.url)
  if (exists) return
  const newServer: ServerInfo = {
    ...server,
    addedAt: Date.now(),
  }
  setStorageItem(StorageKeys.KNOWN_SERVERS, [...servers, newServer])
}

// Remove a server from known servers (cannot remove default)
export function removeKnownServer(url: string): void {
  if (url === DEFAULT_SERVER.url) return
  const servers = getKnownServers()
  setStorageItem(
    StorageKeys.KNOWN_SERVERS,
    servers.filter((s) => s.url !== url),
  )
}

// Get current active server
export function getCurrentServer(): ServerInfo {
  const stored = getStorageItem<ServerInfo>(StorageKeys.CURRENT_SERVER)
  return stored || DEFAULT_SERVER
}

// Set current active server
export function setCurrentServer(server: ServerInfo): void {
  setStorageItem(StorageKeys.CURRENT_SERVER, server)
  // Also add to known servers if not already there
  addKnownServer(server)
}

// Parse a URL string into a ServerInfo
export function parseServerUrl(input: string): ServerInfo | null {
  let url = input.trim()
  if (!url) return null

  // Add https:// if no protocol specified
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }

  try {
    const parsed = new URL(url)
    // Normalize: remove trailing slash, use origin
    const normalizedUrl = parsed.origin
    const name = parsed.hostname

    return {
      url: normalizedUrl,
      name,
      addedAt: Date.now(),
    }
  } catch {
    return null
  }
}
