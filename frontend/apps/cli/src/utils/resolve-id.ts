/**
 * URL-aware ID resolution for CLI commands.
 *
 * Accepts hm:// IDs, gateway URLs, or plain site web URLs and returns
 * a resolved UnpackedHypermediaId together with an appropriately configured
 * API client.
 */

import {createSeedClient, resolveId, unpackHmId} from '@seed-hypermedia/client'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client'
import type {SeedClient} from '@seed-hypermedia/client'
import {getClient} from '../index'

export async function resolveIdWithClient(
  rawId: string,
  globalOpts: Record<string, unknown>,
): Promise<{id: UnpackedHypermediaId; client: SeedClient}> {
  // Fast path: if it parses synchronously, use the configured server
  const parsed = unpackHmId(rawId)
  if (parsed) {
    return {id: parsed, client: getClient(globalOpts)}
  }

  // Slow path: resolve via OPTIONS request, infer server from URL origin
  const id = await resolveId(rawId)
  const origin = new URL(rawId).origin
  return {id, client: createSeedClient(origin)}
}
