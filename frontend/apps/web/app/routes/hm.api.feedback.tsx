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
import type {ActionFunctionArgs} from '@remix-run/node'
import {json} from '@remix-run/node'

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
      },
    )

    console.log('[feedback] published', {
      documentId: result.documentId.id,
      destinationAccountUid,
      signingAccountUid,
      capabilityCid,
      destinationLabel,
      submittedAt: result.submittedAt,
    })

    return json({
      destinationLabel,
      submittedAt: result.submittedAt,
      documentId: result.documentId.id,
    })
  } catch (error) {
    reportError(error, {feature: 'feedback', operation: 'server-publish-feedback'})
    return json({message: 'Failed to save feedback'}, {status: 500})
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
