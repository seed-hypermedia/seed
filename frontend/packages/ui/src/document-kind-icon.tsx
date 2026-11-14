import type {HMResourceVisibility} from '@seed-hypermedia/client/hm-types'
import {HM_APP_TYPE, HM_TOOL_TYPE, HM_TRIGGER_TYPE} from '@seed-hypermedia/client/apps'
import {Blocks, Bot, FileText, Grid3X3, Lock, Wrench, Zap, type LucideProps} from 'lucide-react'
import {AGENT_DOCUMENT_TYPE} from './site-agents'

/**
 * What a document is, as far as a list row's icon is concerned. Every place that lists documents
 * (file browser, query lists, tables and cards) picks its icon through {@link getDocumentKind} so a
 * kind added here shows up everywhere at once.
 */
export type DocumentKind = 'agent' | 'app' | 'tool' | 'trigger' | 'collection' | 'private' | 'document'

/** The fields of a listed document that decide its kind. */
export type DocumentKindSource = {
  metadata?: {type?: unknown} | null
  isCollection?: boolean
  visibility?: HMResourceVisibility
}

/** Picks the kind of a listed document. A typed resource (agent, app, tool) wins over collection, which wins over private. */
export function getDocumentKind(doc: DocumentKindSource): DocumentKind {
  if (doc.metadata?.type === AGENT_DOCUMENT_TYPE) return 'agent'
  if (doc.metadata?.type === HM_APP_TYPE) return 'app'
  if (doc.metadata?.type === HM_TOOL_TYPE) return 'tool'
  if (doc.metadata?.type === HM_TRIGGER_TYPE) return 'trigger'
  if (doc.isCollection) return 'collection'
  if (doc.visibility === 'PRIVATE') return 'private'
  return 'document'
}

const documentKindIcons: Record<DocumentKind, {Icon: typeof FileText; label: string}> = {
  agent: {Icon: Bot, label: 'Agent'},
  app: {Icon: Blocks, label: 'App'},
  tool: {Icon: Wrench, label: 'Tool'},
  trigger: {Icon: Zap, label: 'Trigger'},
  collection: {Icon: Grid3X3, label: 'Collection'},
  private: {Icon: Lock, label: 'Private document'},
  document: {Icon: FileText, label: 'Document'},
}

/** The icon for a document kind, labelled for assistive tech. */
export function DocumentKindIcon({kind, ...props}: {kind: DocumentKind} & LucideProps) {
  const {Icon, label} = documentKindIcons[kind]
  return <Icon aria-label={label} {...props} />
}
