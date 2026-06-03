import {
  hasMeaningfulFeedback,
  publishFeedbackDocument,
  type FeedbackFormValues,
  normalizeFeedbackFormValues,
} from '@/feedback'
import {parseRequest} from '@/request'
import {reportError} from '@/report-error'
import {getServerSigner} from '@/server-signing'
import {serverUniversalClient} from '@/server-universal-client'
import {getConfig} from '@/site-config.server'
import {grpcClient} from '@/client.server'
import type {ActionFunctionArgs} from '@remix-run/node'
import {json} from '@remix-run/node'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {AnnounceBlobsProgress} from '@shm/shared/client/.generated/p2p/v1alpha/syncing_pb'

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

    const signer = await getServerSigner(signingAccountUid)
    const destinationLabel = config.feedbackDestinationLabel?.trim() || destinationAccountUid
    const reviewedSiteLabel = new URL(parsedRequest.origin).host
    const isPublic = config.feedbackDocumentVisibility === 'public'
    const visibility = isPublic ? ResourceVisibility.UNSPECIFIED : ResourceVisibility.PRIVATE
    const visibilityLabel = isPublic ? 'Público' : 'Privado'

    const result = await publishFeedbackDocument(
      {
        request: serverUniversalClient.request,
        publish: serverUniversalClient.publish,
        getSigner: () => signer,
      },
      values,
      {
        publishAccountUid: destinationAccountUid,
        signingAccountUid,
        capabilityCid,
        publishedUnderLabel: destinationLabel,
        publishedUnderAccountUid: destinationAccountUid,
        testedPageLabel: reviewedSiteLabel,
        testedPageUrl: parsedRequest.origin,
        visibility,
        visibilityLabel,
      },
    )
    const pushPeerAddrs =
      config.feedbackDestinationPeerAddrs || DEFAULT_FEEDBACK_DESTINATION_PEER_ADDRS[destinationAccountUid] || []
    if (!pushPeerAddrs.length) {
      throw new Error('Feedback destination peer addrs are not configured')
    }
    const pushProgress = await pushFeedbackDocumentToPeer(result.documentId.id, pushPeerAddrs)

    console.log('[feedback] published', {
      documentId: result.documentId.id,
      documentVersion: result.documentId.version,
      documentPath: result.documentId.path,
      destinationAccountUid,
      signingAccountUid,
      capabilityCid,
      destinationLabel,
      visibility: config.feedbackDocumentVisibility || 'private',
      pushProgress,
      submittedAt: result.submittedAt,
    })

    return json({
      destinationLabel,
      submittedAt: result.submittedAt,
      documentId: result.documentId.id,
      documentVersion: result.documentId.version,
      documentPath: result.documentId.path,
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
