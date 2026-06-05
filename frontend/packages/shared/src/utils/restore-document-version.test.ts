import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {buildRestoreVersionChanges} from './restore-document-version'

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

  it('restores arbitrary metadata values and removes fields missing from selected version', () => {
    const changes = buildRestoreVersionChanges(
      doc({
        metadata: {
          name: 'Latest',
          summary: 'remove me',
          showOutline: true,
          theme: {headerLayout: 'Center'},
          custom: {count: 2, stale: 'yes'},
        } as any,
      }),
      doc({
        metadata: {
          name: 'Old',
          showOutline: false,
          custom: {count: 3, label: 'restored'},
        } as any,
      }),
    )

    const attrs = changes.map((change) => (change.op.case === 'setAttribute' ? change.op.value : null))
    expect(attrs.map((attr) => attr?.key.join('.'))).toEqual([
      'name',
      'summary',
      'showOutline',
      'theme.headerLayout',
      'custom.count',
      'custom.stale',
      'custom.label',
    ])
    expect(attrs.map((attr) => attr?.value.case)).toEqual([
      'stringValue',
      'nullValue',
      'boolValue',
      'nullValue',
      'intValue',
      'nullValue',
      'stringValue',
    ])
  })
})
