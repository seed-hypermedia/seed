/**
 * URL-aware ID resolution for CLI commands.
 *
 * Accepts hm:// IDs, gateway URLs, or plain site web URLs and returns
 * a resolved UnpackedHypermediaId together with an appropriately configured
 * API client.
 */

import {resolveIdWithClient as resolveIdWithClientFromSDK} from '@seed-hypermedia/client'
import {getClient} from '../index'

export async function resolveIdWithClient(rawId: string, globalOpts: Record<string, unknown>) {
  return resolveIdWithClientFromSDK(rawId, {client: getClient(globalOpts)})
}
