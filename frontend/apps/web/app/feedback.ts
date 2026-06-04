import {signDocumentChange} from '@seed-hypermedia/client'
import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMMetadata, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client/markdown-to-blocks'
import {DocumentChange, ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {compareBlocksWithMap, getDocAttributeChanges} from '@shm/shared/utils/document-changes'
import type {UniversalClient} from '@shm/shared/universal-client'
import {nanoid} from 'nanoid'

/** Route path for the web feedback form. */
export const FEEDBACK_ROUTE_PATH = '/feedback'

/** Static configuration for the feedback route shell. */
export const FEEDBACK_CONFIG = {
  pageTitle: 'Feedback',
} as const

/** Structured values captured by the `/feedback` form. */
export type FeedbackFormValues = {
  name: string
  email: string
  firstImpression: string
  possibleActions: string
  howToComment: string
  howToShare: string
  clarity: string
  foundCommentButton: string
  oneChange: string
}

type FeedbackDocumentContext = {
  submittedAt: string
  publishedUnderLabel: string
  publishedUnderAccountUid: string
  testedPageLabel: string
  testedPageUrl: string
  visibilityLabel: string
}

type FeedbackPublishContext = {
  publishAccountUid: string
  signingAccountUid: string
  publishedUnderLabel: string
  publishedUnderAccountUid: string
  testedPageLabel: string
  testedPageUrl: string
  visibility?: ResourceVisibility
  visibilityLabel?: string
  capabilityCid?: string
}

type FeedbackPublishDeps = Pick<UniversalClient, 'publish' | 'request'> & {
  getSigner?: (accountUid: string) => HMSigner
  generatePath?: () => string
  now?: () => Date
}

/** Payload needed to publish a feedback document through either JS signing or the daemon. */
export type FeedbackDocumentPublishPayload = {
  pathSegment: string
  path: string
  changes: DocumentChange[]
  title: string
  submittedAt: string
  submittedAtDate: Date
  visibility: ResourceVisibility
}

/** Result of publishing a feedback document. */
export type PublishedFeedbackDocument = {
  documentId: UnpackedHypermediaId
  title: string
  submittedAt: string
}

const FEEDBACK_PROMPTS: Array<{key: keyof FeedbackFormValues; title: string}> = [
  {key: 'firstImpression', title: 'Primera impresión'},
  {key: 'possibleActions', title: 'Qué pensó que podía hacer'},
  {key: 'howToComment', title: 'Cómo comentaría'},
  {key: 'howToShare', title: 'Cómo compartiría un párrafo'},
  {key: 'clarity', title: 'Qué tan claro quedó para qué sirve'},
  {key: 'foundCommentButton', title: 'Encontró el botón de comentar'},
  {key: 'oneChange', title: 'Una cosa que cambiaría'},
]

/** Trim and normalize form values at submit time. */
export function normalizeFeedbackFormValues(values: FeedbackFormValues): FeedbackFormValues {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    firstImpression: values.firstImpression.trim(),
    possibleActions: values.possibleActions.trim(),
    howToComment: values.howToComment.trim(),
    howToShare: values.howToShare.trim(),
    clarity: values.clarity.trim(),
    foundCommentButton: values.foundCommentButton.trim(),
    oneChange: values.oneChange.trim(),
  }
}

/** Return true when at least one real feedback field (not name/email) is present. */
export function hasMeaningfulFeedback(values: FeedbackFormValues): boolean {
  return FEEDBACK_PROMPTS.some(({key}) => values[key].trim().length > 0)
}

/** Format a submission timestamp as `YYYY-MM-DD HH:mm` in the user's local time. */
export function formatFeedbackTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

/** Build the generic private feedback document title. */
export function buildFeedbackDocumentTitle(submittedAt: string, testedPageLabel: string): string {
  return `Feedback on ${testedPageLabel} — ${submittedAt}`
}

/** Build the markdown body that will be published into the private feedback document. */
export function buildFeedbackDocumentMarkdown(values: FeedbackFormValues, context: FeedbackDocumentContext): string {
  const sections: string[] = [
    'Feedback enviado mediante formulario web.',
    '',
    '## Contexto',
    '- Tipo: Feedback',
    `- Formulario: ${FEEDBACK_ROUTE_PATH}`,
    '- Origen: Formulario web',
    `- Página evaluada: ${context.testedPageLabel}`,
    `- URL: ${context.testedPageUrl}`,
    `- Fecha de envío: ${context.submittedAt}`,
    `- Sitio participante: ${context.publishedUnderLabel}`,
    `- Cuenta de destino: ${context.publishedUnderAccountUid}`,
    `- Visibilidad: ${context.visibilityLabel}`,
  ]

  if (values.name) {
    sections.push('', '## Nombre', values.name)
  }
  if (values.email) {
    sections.push('', '## Email', values.email)
  }

  FEEDBACK_PROMPTS.forEach(({key, title}) => {
    const value = values[key]
    if (!value) return
    sections.push('', `## ${title}`, value)
  })

  return sections.join('\n')
}

/** Convert feedback markdown into editor blocks suitable for document diffing/publish. */
export function feedbackMarkdownToEditorBlocks(markdown: string): EditorBlock[] {
  const {tree} = parseMarkdown(markdown)
  const content = markdownBlockNodesToHMBlockNodes(tree)
  return hmBlocksToEditorContent(content, {childrenType: 'Group'}) as EditorBlock[]
}

/** Build the change payload for a new feedback document. */
export function buildFeedbackDocumentPublishPayload(
  values: FeedbackFormValues,
  context: Omit<FeedbackPublishContext, 'publishAccountUid' | 'signingAccountUid' | 'capabilityCid'>,
  options: Pick<FeedbackPublishDeps, 'generatePath' | 'now'> = {},
): FeedbackDocumentPublishPayload {
  const submittedAtDate = options.now?.() ?? new Date()
  const submittedAt = formatFeedbackTimestamp(submittedAtDate)
  const visibility = context.visibility ?? ResourceVisibility.PRIVATE
  const visibilityLabel = context.visibilityLabel ?? 'Privado'
  const title = buildFeedbackDocumentTitle(submittedAt, context.testedPageLabel)
  const markdown = buildFeedbackDocumentMarkdown(values, {
    submittedAt,
    publishedUnderLabel: context.publishedUnderLabel,
    publishedUnderAccountUid: context.publishedUnderAccountUid,
    testedPageLabel: context.testedPageLabel,
    testedPageUrl: context.testedPageUrl,
    visibilityLabel,
  })
  const editorBlocks = feedbackMarkdownToEditorBlocks(markdown)
  const {changes} = compareBlocksWithMap({}, editorBlocks, '')
  const metadataChanges = getDocAttributeChanges({name: title} as HMMetadata)
  const pathSegment = options.generatePath?.() ?? nanoid(21)

  return {
    pathSegment,
    path: hmIdPathToEntityQueryPath([pathSegment]),
    changes: [...metadataChanges, ...changes],
    title,
    submittedAt,
    submittedAtDate,
    visibility,
  }
}

/** Publish a new feedback document with the JS signing path and return its concrete document id. */
export async function publishFeedbackDocument(
  deps: FeedbackPublishDeps,
  values: FeedbackFormValues,
  context: FeedbackPublishContext,
): Promise<PublishedFeedbackDocument> {
  if (!deps.getSigner) {
    throw new Error('Feedback publish requires a browser signer')
  }

  const payload = buildFeedbackDocumentPublishPayload(
    values,
    {
      publishedUnderLabel: context.publishedUnderLabel,
      publishedUnderAccountUid: context.publishedUnderAccountUid,
      testedPageLabel: context.testedPageLabel,
      testedPageUrl: context.testedPageUrl,
      visibility: context.visibility,
      visibilityLabel: context.visibilityLabel,
    },
    deps,
  )
  const signer = deps.getSigner(context.signingAccountUid)

  const prepareResult = (await deps.request('PrepareDocumentChange', {
    account: context.publishAccountUid,
    path: payload.path,
    baseVersion: '',
    changes: payload.changes as any,
    capability: context.capabilityCid ?? '',
    visibility: payload.visibility,
  })) as {unsignedChange: Uint8Array}

  const {changeCid, publishInput} = await signDocumentChange(
    {
      account: context.publishAccountUid,
      path: payload.path,
      unsignedChange: prepareResult.unsignedChange,
      generation: payload.submittedAtDate.getTime(),
      capability: context.capabilityCid ?? '',
      visibility: payload.visibility,
    },
    signer,
  )

  await deps.publish(publishInput)

  return {
    documentId: hmId(context.publishAccountUid, {path: [payload.pathSegment], version: changeCid.toString()}),
    title: payload.title,
    submittedAt: payload.submittedAt,
  }
}
