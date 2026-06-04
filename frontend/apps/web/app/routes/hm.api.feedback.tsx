import {
  buildFeedbackDocumentPublishPayload,
  hasMeaningfulFeedback,
  type FeedbackFormValues,
  normalizeFeedbackFormValues,
} from '@/feedback'
import {parseRequest} from '@/request'
import {reportError} from '@/report-error'
import {getServerSigningKey} from '@/server-signing'
import {serverUniversalClient} from '@/server-universal-client'
import {getConfig} from '@/site-config.server'
import {grpcClient} from '@/client.server'
import type {ActionFunctionArgs} from '@remix-run/node'
import {json} from '@remix-run/node'
import {createChange, createChangeOps, createVersionRef} from '@seed-hypermedia/client'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {AnnounceBlobsProgress} from '@shm/shared/client/.generated/p2p/v1alpha/syncing_pb'
import {hmId} from '@shm/shared/utils/entity-id-url'

const FEEDBACK_KEYS: Array<keyof FeedbackFormValues> = [
  'name',
  'email',
  'firstImpression',
  'possibleActions',
  'howToComment',
  'howToShare',
  'clarity',
  'foundCommentButton',
  'oneChange',
]

const DEFAULT_FEEDBACK_DESTINATION_PEER_ADDRS: Record<string, string[]> = {
  z6MkkeXDXo4p5y483NqxnMjZKbE4VAv8GPXp3kQ5JGYbTTsR: [
    '/dns4/hyper.media/tcp/56001/p2p/12D3KooWEDdEeuY3oHCSKtn1eC7tU9qNWjF9bb8sCtHzpuCjvomQ',
    '/dns4/hyper.media/udp/56001/quic-v1/p2p/12D3KooWEDdEeuY3oHCSKtn1eC7tU9qNWjF9bb8sCtHzpuCjvomQ',
  ],
}

const DEFAULT_FEEDBACK_DESTINATION_BLOB_ORIGINS: Record<string, string> = {
  z6MkkeXDXo4p5y483NqxnMjZKbE4VAv8GPXp3kQ5JGYbTTsR: 'https://seed-surveys.hyper.media',
}

/** Accept feedback form submissions and publish them server-side into the configured destination account. */
export async function action({request}: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }

  try {
    const parsedRequest = parseRequest(request)
    const config = await getConfig(parsedRequest.hostname)
    if (!config?.feedbackDestinationAccountUid) {
      return json({message: 'Feedback destination is not configured'}, {status: 500})
    }

    const values = normalizeFeedbackFormValues(readFeedbackValues(await request.json()))
    if (!hasMeaningfulFeedback(values)) {
      return json({message: 'Feedback must include at least one answer'}, {status: 400})
    }

    const destinationAccountUid = config.feedbackDestinationAccountUid
    const signingAccountUid = config.feedbackSignerAccountUid || destinationAccountUid
    const capabilityCid = config.feedbackDestinationCapabilityCid || ''

    if (signingAccountUid !== destinationAccountUid && !capabilityCid) {
      return json({message: 'Feedback destination capability is not configured'}, {status: 500})
    }

    const signingKey = await getServerSigningKey(signingAccountUid)
    const destinationLabel = config.feedbackDestinationLabel?.trim() || destinationAccountUid
    const reviewedSiteLabel = new URL(parsedRequest.origin).host
    const isPublic = config.feedbackDocumentVisibility === 'public'
    const visibility = isPublic ? ResourceVisibility.PUBLIC : ResourceVisibility.PRIVATE
    const visibilityLabel = isPublic ? 'Público' : 'Privado'
    const payload = buildFeedbackDocumentPublishPayload(values, {
      publishedUnderLabel: destinationLabel,
      publishedUnderAccountUid: destinationAccountUid,
      testedPageLabel: reviewedSiteLabel,
      testedPageUrl: parsedRequest.origin,
      visibility,
      visibilityLabel,
    })
    const {unsignedBytes, ts} = createChangeOps({
      ops: payload.operations,
      ts: BigInt(payload.submittedAtDate.getTime()),
    })
    const changeBlock = await createChange(unsignedBytes, signingKey.signer)
    const changeCid = changeBlock.cid.toString()
    const refInput = await createVersionRef(
      {
        space: destinationAccountUid,
        path: payload.path,
        genesis: changeCid,
        version: changeCid,
        generation: Number(ts),
        capability: capabilityCid || undefined,
        visibility: payload.visibility === ResourceVisibility.PRIVATE ? 'Private' : undefined,
      },
      signingKey.signer,
    )
    const capabilityBlob = capabilityCid
      ? await fetchFeedbackCapabilityBlob(destinationAccountUid, destinationLabel, capabilityCid)
      : null

    await serverUniversalClient.publish({
      blobs: [
        ...(capabilityBlob ? [capabilityBlob] : []),
        {data: new Uint8Array(changeBlock.bytes), cid: changeCid},
        ...refInput.blobs,
      ],
    })

    const documentId = hmId(destinationAccountUid, {
      path: [payload.pathSegment],
      version: changeCid,
    })
    const pushPeerAddrs =
      config.feedbackDestinationPeerAddrs || DEFAULT_FEEDBACK_DESTINATION_PEER_ADDRS[destinationAccountUid] || []
    if (!pushPeerAddrs.length) {
      throw new Error('Feedback destination peer addrs are not configured')
    }
    const pushProgress = await pushFeedbackDocumentToPeer(documentId.id, pushPeerAddrs)

    console.log('[feedback] published', {
      documentId: documentId.id,
      documentVersion: documentId.version,
      documentPath: documentId.path,
      destinationAccountUid,
      signingAccountUid,
      capabilityCid,
      destinationLabel,
      visibility: config.feedbackDocumentVisibility || 'private',
      publishedBlobs: 1 + refInput.blobs.length + (capabilityBlob ? 1 : 0),
      pushProgress,
      submittedAt: payload.submittedAt,
    })

    return json({
      destinationLabel,
      submittedAt: payload.submittedAt,
      documentId: documentId.id,
      documentVersion: documentId.version,
      documentPath: documentId.path,
      visibility: config.feedbackDocumentVisibility || 'private',
    })
  } catch (error) {
    reportError(error, {feature: 'feedback', operation: 'server-publish-feedback'})
    return json({message: 'Failed to save feedback'}, {status: 500})
  }
}

async function pushFeedbackDocumentToPeer(documentId: string, addrs: string[]): Promise<FeedbackPushProgress | null> {
  let latestProgress: FeedbackPushProgress | null = null
  for await (const progress of grpcClient.resources.pushResourcesToPeer({
    resources: [documentId],
    addrs,
    recursive: false,
  })) {
    latestProgress = formatPushProgress(progress)
  }

  if (!latestProgress || latestProgress.blobsAnnounced === 0) {
    throw new Error('Feedback push did not find any blobs to announce')
  }

  if (latestProgress?.blobsFailed) {
    throw new Error(`Failed to push ${latestProgress.blobsFailed} feedback blob(s) to destination peer`)
  }

  return latestProgress
}

type FeedbackPushProgress = {
  blobsAnnounced: number
  blobsKnown: number
  blobsWanted: number
  blobsProcessed: number
  blobsFailed: number
}

function formatPushProgress(progress: AnnounceBlobsProgress): FeedbackPushProgress {
  return {
    blobsAnnounced: progress.blobsAnnounced,
    blobsKnown: progress.blobsKnown,
    blobsWanted: progress.blobsWanted,
    blobsProcessed: progress.blobsProcessed,
    blobsFailed: progress.blobsFailed,
  }
}

async function fetchFeedbackCapabilityBlob(
  destinationAccountUid: string,
  destinationLabel: string,
  capabilityCid: string,
): Promise<{cid: string; data: Uint8Array}> {
  const origin = resolveFeedbackDestinationBlobOrigin(destinationAccountUid, destinationLabel)
  if (!origin) {
    throw new Error('Feedback destination capability source is not configured')
  }

  const response = await fetch(`${origin}/ipfs/${capabilityCid}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch feedback destination capability ${capabilityCid}: ${response.status}`)
  }

  return {
    cid: capabilityCid,
    data: new Uint8Array(await response.arrayBuffer()),
  }
}

function resolveFeedbackDestinationBlobOrigin(destinationAccountUid: string, destinationLabel: string): string | null {
  const defaultOrigin = DEFAULT_FEEDBACK_DESTINATION_BLOB_ORIGINS[destinationAccountUid]
  if (defaultOrigin) return defaultOrigin

  const label = destinationLabel.trim()
  if (label.startsWith('http://') || label.startsWith('https://')) {
    return label.replace(/\/+$/, '')
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(label)) {
    return `https://${label}`
  }
  return null
}

function readFeedbackValues(input: unknown): FeedbackFormValues {
  if (!input || typeof input !== 'object') {
    throw new Error('Feedback payload must be an object')
  }

  const record = input as Record<string, unknown>
  return Object.fromEntries(FEEDBACK_KEYS.map((key) => [key, readString(record[key])])) as FeedbackFormValues
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
