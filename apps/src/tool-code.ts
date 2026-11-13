import type {IpfsDirectoryFile} from '@seed-hypermedia/client'
import {TOOL_ENTRY_FILE} from '@seed-hypermedia/client/apps'
import {collectMemoryFolderFiles} from '@/document-pages'

/**
 * Collects a tool's code from agent memory: a folder with an `index.ts` at its root, or a single
 * TypeScript or JavaScript file, which becomes `index.ts`.
 */
export function collectToolCodeFiles(stateDir: string, rawPath: string): {files: IpfsDirectoryFile[]; bytes: number} {
  return collectMemoryFolderFiles(stateDir, rawPath, {
    kind: 'tool',
    entry: TOOL_ENTRY_FILE,
    singleFile: /\.[mc]?[tj]s$/i,
  })
}

/**
 * Checks that a tool's entry point parses and default-exports its function. Throws with a message
 * the agent can act on. Nothing runs the code here.
 */
export function validateToolCode(files: IpfsDirectoryFile[]): void {
  const entry = files.find((file) => file.path === TOOL_ENTRY_FILE)
  if (!entry) throw new Error(`A tool folder needs an ${TOOL_ENTRY_FILE} at its root`)
  const source = new TextDecoder().decode(entry.content)
  let exports: string[]
  try {
    exports = new Bun.Transpiler({loader: 'ts'}).scan(source).exports
  } catch (error) {
    throw new Error(`${TOOL_ENTRY_FILE} does not parse: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!exports.includes('default'))
    throw new Error(
      `${TOOL_ENTRY_FILE} must default-export the tool: export default async function (input) { return output }`,
    )
}
