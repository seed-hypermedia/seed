import {describe, expect, test} from 'vitest'
import {appToolContract} from '../agents/agent-tools'
import type {AgentToolInfo, AppMountInfo} from '../agents/client'

const mount = {
  slug: 'convert',
  scope: 'space',
  name: 'Datalab converter',
  version: 'bafyreicg5jlabcdef',
  tools: [{tool: 'convert', summary: 'Convert documents from memory.', runtime: 'ts'}],
  status: {state: 'ok'},
} as AppMountInfo

describe('an app tool’s info in the Tools tab', () => {
  test('is the contract the server projected into the agent’s tools, since the registry knows no app tool', () => {
    const document: AgentToolInfo = {
      name: 'convert',
      kind: 'lambda',
      app: {slug: 'convert', scope: 'space'},
      summary: 'Convert documents from memory.',
      description: 'Pass memory paths in `files`.',
      input: {type: 'object', properties: {files: {type: 'array'}}},
      output: {type: 'object'},
      cid: 'bafyreidoc',
      enabled: true,
      granted: true,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(appToolContract(mount, mount.tools[0]!, document)).toEqual({
      label: 'convert',
      name: 'Datalab converter · ts · version bafyreicg5jl',
      description: 'Pass memory paths in `files`.',
      inputSchema: document.input,
      outputSchema: document.output,
    })
  })

  test('says why there is no contract while the mount offers no tool', () => {
    const broken = {...mount, status: {state: 'error', error: 'missing secret apiKey'}} as AppMountInfo
    const view = appToolContract(broken, mount.tools[0]!, undefined)
    expect(view.description).toBe('Convert documents from memory.')
    expect(view.inputSchema).toBeUndefined()
    expect(view.note).toContain('missing secret apiKey')
    // A working mount the server has not projected for this agent yet is a different wait.
    expect(appToolContract(mount, mount.tools[0]!, undefined).note).toContain('Refresh')
  })
})
