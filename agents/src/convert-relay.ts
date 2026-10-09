/**
 * Relay client for the `convert` tool on servers without a Datalab key.
 *
 * The local server inside the desktop app, and any self-hosted server without a key, asks a hosted
 * agents server to convert on its behalf: `ConvertDocument` uploads the document, `GetConversion`
 * polls until the result is ready. Both are ordinary signed actions, signed with the agent's own
 * identity key, so the hosted server bills that identity's account. Nothing here touches memory;
 * the result has the same shape as a direct Datalab conversion so the tool writes it the same way.
 */

import type * as api from '@/api'
import * as cbor from '@/cbor'
import type {ConvertDocumentResult, DatalabMode} from '@/datalab'
import {createSignedEnvelope} from '@/envelope'
import type * as blobs from '@shm/shared/blobs'

/** How often the relay asks whether a job finished. */
export const CONVERT_RELAY_POLL_INTERVAL_MS = 2_000
/** How long one relayed conversion may take, upload to result. */
export const CONVERT_RELAY_DEADLINE_MS = 15 * 60_000
/** Upload budget: 100 MiB over a home uplink is minutes, not seconds. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000
const POLL_TIMEOUT_MS = 20_000

/** A relay failure carrying the hosted server's HTTP status so the tool can map it faithfully. */
export class ConvertRelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ConvertRelayError'
  }
}

/** One relayed conversion. */
export type ConvertRelayInput = {
  relayUrl: string
  /** The agent's identity key pair; the hosted server charges its account. */
  signer: blobs.Signer
  bytes: Uint8Array
  fileName: string
  mode?: DatalabMode
  maxPages?: number
  pageRange?: string
  onProgress?: (detail: string) => void
  pollIntervalMs?: number
  deadlineMs?: number
  fetch?: typeof fetch
}

/** A relayed result: a direct conversion's shape plus the images the hosted server had to leave out. */
export type ConvertRelayResult = ConvertDocumentResult & {droppedImages: string[]}

async function sendRelayAction<T extends api.AgentResponse['_']>(
  input: ConvertRelayInput,
  action: api.UnsignedAgentAction,
  timeoutMs: number,
): Promise<Extract<api.AgentResponse, {_: T}>> {
  const envelope = await createSignedEnvelope(input.signer, {action})
  const res = await (input.fetch ?? globalThis.fetch)(`${input.relayUrl.replace(/\/+$/, '')}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor', Accept: 'application/cbor'},
    body: cbor.encode(envelope) as BodyInit,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const decoded = cbor.decode<api.AgentResponse>(new Uint8Array(await res.arrayBuffer()))
  if (!res.ok || decoded._ === 'Error') {
    throw new ConvertRelayError(
      res.status,
      decoded._ === 'Error' ? decoded.message : `The conversion service answered HTTP ${res.status}`,
    )
  }
  return decoded as Extract<api.AgentResponse, {_: T}>
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** Uploads one document to the hosted server and polls until its conversion is done. */
export async function convertDocumentViaRelay(input: ConvertRelayInput): Promise<ConvertRelayResult> {
  input.onProgress?.(`Uploading ${input.fileName} to the conversion service`)
  let started: api.ConvertDocumentResponse
  try {
    started = await sendRelayAction<'ConvertDocumentResponse'>(
      input,
      {
        _: 'ConvertDocument',
        content: input.bytes,
        fileName: input.fileName,
        ...(input.mode ? {mode: input.mode} : {}),
        ...(input.maxPages !== undefined ? {maxPages: input.maxPages} : {}),
        ...(input.pageRange ? {pageRange: input.pageRange} : {}),
        // One id per call: a retried upload must not reserve pages twice.
        clientRequestId: crypto.randomUUID(),
      },
      UPLOAD_TIMEOUT_MS,
    )
  } catch (error) {
    if (error instanceof ConvertRelayError) throw error
    throw new ConvertRelayError(
      isAbortError(error) ? 504 : 502,
      isAbortError(error)
        ? `Uploading ${input.fileName} to the conversion service timed out`
        : `Could not reach the conversion service: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const startedAt = Date.now()
  const deadline = startedAt + (input.deadlineMs ?? CONVERT_RELAY_DEADLINE_MS)
  for (;;) {
    await Bun.sleep(input.pollIntervalMs ?? CONVERT_RELAY_POLL_INTERVAL_MS)
    if (Date.now() > deadline) {
      throw new ConvertRelayError(
        504,
        `Conversion of ${input.fileName} timed out after ${Math.round((Date.now() - startedAt) / 1000)}s`,
      )
    }
    let status: api.GetConversionResponse
    try {
      status = await sendRelayAction<'GetConversionResponse'>(
        input,
        {_: 'GetConversion', jobId: started.jobId},
        POLL_TIMEOUT_MS,
      )
    } catch (error) {
      // A dropped poll is not a failed conversion: the job is still there until the deadline.
      if ((error instanceof ConvertRelayError && error.status >= 500) || isAbortError(error)) continue
      throw error
    }
    if (status.status === 'processing') {
      input.onProgress?.(`Converting ${input.fileName} (${Math.round((Date.now() - startedAt) / 1000)}s)`)
      continue
    }
    if (status.status === 'failed') throw new ConvertRelayError(502, status.error ?? 'The conversion failed')
    return {
      markdown: status.markdown ?? '',
      images: new Map((status.images ?? []).map((image) => [image.name, image.content])),
      pageCount: status.pageCount ?? 0,
      parseQualityScore: status.parseQualityScore ?? null,
      costCents: status.costCents ?? null,
      requestId: started.jobId,
      droppedImages: status.droppedImages ?? [],
    }
  }
}
