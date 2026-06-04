import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {buildRestoreMetadataChanges, buildRestoreVersionChanges} from './restore-document-version'

function node(id: string, text: string): HMBlockNode {
  return {
    block: {
      id,
      type: 'Paragraph',
      text,
      attributes: {},
      annotations: [],
    } as HMBlockNode['block'],
    children: [],
  }
}

function doc(overrides: Partial<HMDocument>): HMDocument {
  return {
    account: 'z1',
    path: '/doc',
    version: 'v1',
    authors: [],
    content: [],
    metadata: {},
    visibility: 'PUBLIC',
    createTime: '',
    updateTime: '',
    genesis: 'g1',
    ...overrides,
  }
}

describe('buildRestoreVersionChanges', () => {
  it('builds replace and delete changes to make latest content match selected content', () => {
    const changes = buildRestoreVersionChanges(
      doc({content: [node('a', 'latest a'), node('b', 'latest b')]}),
      doc({content: [node('a', 'old a')]}),
    )

    expect(changes.map((change) => change.op.case)).toEqual(['replaceBlock', 'deleteBlock'])
    expect(changes[0]?.op.case === 'replaceBlock' ? changes[0].op.value.text : null).toBe('old a')
    expect(changes[1]?.op.case === 'deleteBlock' ? changes[1].op.value : null).toBe('b')
  })

  it('restores metadata values and removes fields missing from selected version', () => {
    const changes = buildRestoreMetadataChanges(
      {name: 'Latest', summary: 'remove me', showOutline: true, theme: {headerLayout: 'Center'}},
      {name: 'Old', showOutline: false},
    )

    const attrs = changes.map((change) => (change.op.case === 'setAttribute' ? change.op.value : null))
    expect(attrs.map((attr) => attr?.key.join('.'))).toEqual(['name', 'summary', 'showOutline', 'theme.headerLayout'])
    expect(attrs.map((attr) => attr?.value.case)).toEqual(['stringValue', 'nullValue', 'boolValue', 'nullValue'])
  })
})
