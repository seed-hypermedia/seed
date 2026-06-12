import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {buildRestoreVersionChanges, getRestoreVersionGeneration} from './restore-document-version'

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
  it('deletes current content before inserting every selected-version block', () => {
    const changes = buildRestoreVersionChanges(
      doc({content: [node('a', 'latest a'), node('b', 'latest b')]}),
      doc({content: [node('a', 'old a'), node('c', 'old c')]}),
    )

    expect(changes.map((change) => change.op.case)).toEqual([
      'deleteBlock',
      'deleteBlock',
      'moveBlock',
      'replaceBlock',
      'moveBlock',
      'replaceBlock',
    ])
    expect(changes[0]?.op.case === 'deleteBlock' ? changes[0].op.value : null).toBe('a')
    expect(changes[1]?.op.case === 'deleteBlock' ? changes[1].op.value : null).toBe('b')
    expect(changes[2]?.op.case === 'moveBlock' ? changes[2].op.value.blockId : null).toBe('a')
    expect(changes[3]?.op.case === 'replaceBlock' ? changes[3].op.value.text : null).toBe('old a')
    expect(changes[4]?.op.case === 'moveBlock' ? changes[4].op.value.blockId : null).toBe('c')
    expect(changes[5]?.op.case === 'replaceBlock' ? changes[5].op.value.text : null).toBe('old c')
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

describe('getRestoreVersionGeneration', () => {
  it('uses the latest document generation instead of creating a new one', () => {
    expect(
      getRestoreVersionGeneration(
        doc({
          generationInfo: {
            genesis: 'g1',
            generation: 123n,
          },
        }),
      ),
    ).toBe(123n)
  })
})
