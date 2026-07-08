/**
 * Registry connecting the embed node view to the server renderer without an
 * import cycle (ssr-render imports the schema, which imports the embed block,
 * which renders EmbedEditorView). During a server render, ssr-render
 * registers a recursive renderer here; EmbedEditorView uses it in place of
 * the nested BlockNoteEditor it mounts on the client.
 */
import type {HMBlockChildrenType, HMBlockNode} from '@seed-hypermedia/client/hm-types'

export type SSREmbedRenderer = (blocks: HMBlockNode[], rootChildrenType?: HMBlockChildrenType) => string | null

let current: SSREmbedRenderer | null = null

export function setSSREmbedRenderer(renderer: SSREmbedRenderer | null) {
  current = renderer
}

export function getSSREmbedRenderer(): SSREmbedRenderer | null {
  return current
}
