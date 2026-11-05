import type {HMResourceVisibility} from '@seed-hypermedia/client/hm-types'
import {Bot, FileText, Grid3X3, Lock, type LucideProps} from 'lucide-react'
import {AGENT_DOCUMENT_TYPE} from './site-agents'

/**
 * What a document is, as far as a list row's icon is concerned. Every place that lists documents
 * (file browser, query lists, tables and cards) picks its icon through {@link getDocumentKind} so a
 * kind added here shows up everywhere at once.
 */
export type DocumentKind = 'agent' | 'collection' | 'private' | 'document'

/** The fields of a listed document that decide its kind. */
export type DocumentKindSource = {
  metadata?: {type?: unknown} | null
  isCollection?: boolean
  visibility?: HMResourceVisibility
}

/** Picks the kind of a listed document. An agent mount wins over collection, which wins over private. */
export function getDocumentKind(doc: DocumentKindSource): DocumentKind {
  if (doc.metadata?.type === AGENT_DOCUMENT_TYPE) return 'agent'
  if (doc.isCollection) return 'collection'
  if (doc.visibility === 'PRIVATE') return 'private'
  return 'document'
}

const documentKindIcons: Record<DocumentKind, {Icon: typeof FileText; label: string}> = {
  agent: {Icon: Bot, label: 'Agent'},
  collection: {Icon: Grid3X3, label: 'Collection'},
  private: {Icon: Lock, label: 'Private document'},
  document: {Icon: FileText, label: 'Document'},
}

/** The icon for a document kind, labelled for assistive tech. */
export function DocumentKindIcon({kind, ...props}: {kind: DocumentKind} & LucideProps) {
  const {Icon, label} = documentKindIcons[kind]
  return <Icon aria-label={label} {...props} />
}
