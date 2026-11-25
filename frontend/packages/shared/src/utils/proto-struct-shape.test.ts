import {hmBlockToEditorBlock} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {describe, expect, it} from 'vitest'
import {Document} from '../client'
import {prepareHMDocument} from '../document-utils'
import {isProtoStructShape, repairProtoStructAttributes, repairProtoStructShape} from './proto-struct-shape'

// The attributes the daemon returned for the Query block OSGQ4553 on
// seedteamtalks.hyper.media/team/eric (change bafyreihno5…, 2026-11-03).
const structShapedQuery = {
  fields: {
    query: {
      kind: {
        case: 'structValue',
        value: {
          fields: {
            filters: {kind: {case: 'listValue', value: {values: []}}},
            includes: {
              kind: {
                case: 'listValue',
                value: {
                  values: [
                    {
                      kind: {
                        case: 'structValue',
                        value: {
                          fields: {
                            mode: {kind: {case: 'stringValue', value: 'Children'}},
                            path: {kind: {case: 'stringValue', value: 'tasks'}},
                            space: {
                              kind: {case: 'stringValue', value: 'z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno'},
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
            sort: {
              kind: {
                case: 'listValue',
                value: {
                  values: [
                    {
                      kind: {
                        case: 'structValue',
                        value: {
                          fields: {
                            reverse: {kind: {case: 'boolValue', value: true}},
                            term: {kind: {case: 'stringValue', value: 'updated'}},
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    style: {kind: {case: 'stringValue', value: 'List'}},
    banner: {kind: {case: 'boolValue', value: false}},
    columnCount: {kind: {case: 'numberValue', value: 3}},
    note: {kind: {case: 'nullValue', value: {}}},
  },
}

const plainQuery = {
  query: {
    filters: [],
    includes: [{mode: 'Children', path: 'tasks', space: 'z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno'}],
    sort: [{reverse: true, term: 'updated'}],
  },
  style: 'List',
  banner: false,
  columnCount: 3,
  note: null,
}

describe('repairProtoStructShape', () => {
  it('unwraps a Struct-shaped attributes object to the JSON it stood for', () => {
    expect(isProtoStructShape(structShapedQuery)).toBe(true)
    expect(repairProtoStructShape(structShapedQuery)).toEqual(plainQuery)
  })

  it('leaves plain attributes alone, including ones that merely mention fields', () => {
    for (const attributes of [
      plainQuery,
      {childrenType: 'Group'},
      {},
      {fields: {}},
      {fields: {name: 'x'}},
      {fields: {name: {kind: 'x'}}},
      {fields: {name: {kind: {case: 'stringValue', value: 'x'}}}, other: 1},
      null,
      undefined,
      'text',
      [],
    ]) {
      expect(isProtoStructShape(attributes)).toBe(false)
      expect(repairProtoStructShape(attributes)).toBe(attributes)
    }
  })
})

describe('repairProtoStructAttributes', () => {
  it('repairs block and annotation attributes throughout the tree in place', () => {
    const content = [
      {
        block: {
          id: 'h1',
          type: 'Heading',
          text: 'Projects',
          attributes: {fields: {childrenType: {kind: {case: 'stringValue', value: 'Group'}}}},
          annotations: [
            {
              type: 'Link',
              link: 'hm://x',
              starts: [0],
              ends: [1],
              attributes: {fields: {title: {kind: {case: 'stringValue', value: 't'}}}},
            },
          ],
        },
        children: [{block: {id: 'q1', type: 'Query', attributes: structShapedQuery}, children: []}],
      },
      {block: {id: 'p1', type: 'Paragraph', text: 'ok', attributes: {}}, children: []},
    ]
    repairProtoStructAttributes(content)
    expect(content[0]!.block.attributes).toEqual({childrenType: 'Group'})
    expect(content[0]!.block.annotations![0]!.attributes).toEqual({title: 't'})
    expect(content[0]!.children[0]!.block.attributes).toEqual(plainQuery)
    expect(content[1]!.block.attributes).toEqual({})
  })
})

describe('prepareHMDocument', () => {
  it('reads a query block whose attributes the daemon serves in the Struct shape', () => {
    // The daemon materialized the corrupted change's `fields` key as the
    // block's only attribute, so GetDocument serves attributes whose JSON is
    // {fields: {...}}. Build that exact protobuf Document and read it.
    const apiDoc = Document.fromJson({
      account: 'z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno',
      path: '/team/eric',
      version: 'bafyreihno5lhgcwhfvoq6d3rj3iktcamksgya4awvvudyuupwsj6jyfyhq',
      metadata: {name: 'Eric'},
      content: [
        {
          block: {
            id: 'hYIyhBaP',
            type: 'Heading',
            text: 'Issues',
            attributes: {fields: {childrenType: {kind: {case: 'stringValue', value: 'Group'}}}},
          },
          children: [{block: {id: 'OSGQ4553', type: 'Query', attributes: structShapedQuery}, children: []}],
        },
      ],
    })
    const document = prepareHMDocument(apiDoc)
    type WithAttributes = {attributes?: unknown}
    const heading = document.content[0]!.block as WithAttributes
    expect(heading.attributes).toEqual({childrenType: 'Group'})
    const query = document.content[0]!.children![0]!.block as WithAttributes
    // The document schema drops null attributes; the rest reads back as plain JSON.
    const {note: _note, ...expected} = plainQuery
    expect(query.attributes).toEqual(expected)
    const editorBlock = hmBlockToEditorBlock(query as Parameters<typeof hmBlockToEditorBlock>[0])
    expect(JSON.parse((editorBlock.props as {queryIncludes: string}).queryIncludes)).toEqual(plainQuery.query.includes)
  })
})
