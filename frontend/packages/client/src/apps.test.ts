import {describe, expect, it} from 'vitest'
import {
  addAppChildOps,
  HM_TRIGGER_TYPE,
  triggerDocumentOps,
  triggerDocumentRefs,
  appChildKind,
  appEmbeddedChildren,
  isAppChildId,
  parentDocumentId,
  removeAppChildOps,
} from './apps'
import {unpackHmId, type HMBlockNode} from './hm-types'

const app = unpackHmId('hm://z6MkApp/apps/weather')!
const forecast = unpackHmId('hm://z6MkApp/apps/weather/forecast')!
const radar = unpackHmId('hm://z6MkApp/apps/weather/radar')!

function embed(id: string, link: string): HMBlockNode {
  return {block: {type: 'Embed', id, link, attributes: {view: 'Card'}}, children: []} as HMBlockNode
}
function paragraph(id: string, text: string): HMBlockNode {
  return {block: {type: 'Paragraph', id, text, annotations: [], attributes: {}}, children: []} as HMBlockNode
}

describe('app children', () => {
  it('lists embeds of direct children in order, once, without versions', () => {
    const content = [
      embed('b1', 'hm://z6MkApp/apps/weather/radar?v=bafyold'),
      paragraph('p1', 'notes'),
      embed('b2', 'hm://z6MkApp/apps/weather/forecast'),
      embed('b3', 'hm://z6MkApp/apps/weather/radar'),
      embed('b4', 'hm://z6MkApp/apps/other/tool'),
      embed('b5', 'hm://z6MkOther/apps/weather/forecast'),
    ]
    const children = appEmbeddedChildren(app, content)
    expect(children.map((child) => [child.blockId, child.id.id])).toEqual([
      ['b1', 'hm://z6MkApp/apps/weather/radar'],
      ['b2', 'hm://z6MkApp/apps/weather/forecast'],
    ])
  })

  it('adds a card embed at the end of the listed children, before other content', () => {
    const content = [embed('b1', forecast.id), paragraph('p1', 'notes')]
    const ops = addAppChildOps(app, content, radar)
    const replaced = ops.filter((op) => op.type === 'ReplaceBlock') as {block: Record<string, unknown>}[]
    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.block).toMatchObject({type: 'Embed', link: radar.id, view: 'Card'})
    const move = ops.find((op) => op.type === 'MoveBlocks') as {blocks: string[]}
    expect(move.blocks).toEqual(['b1', replaced[0]!.block.id, 'p1'])
    expect(ops.some((op) => op.type === 'DeleteBlocks')).toBe(false)
  })

  it('adds nothing for a child that is already listed', () => {
    expect(addAppChildOps(app, [embed('b1', forecast.id)], forecast)).toEqual([])
  })

  it('removes only the embed of the removed child', () => {
    const content = [embed('b1', forecast.id), embed('b2', radar.id), paragraph('p1', 'notes')]
    const ops = removeAppChildOps(app, content, forecast)
    expect(ops).toContainEqual({type: 'DeleteBlocks', blocks: ['b1']})
    expect(ops.some((op) => op.type === 'ReplaceBlock')).toBe(false)
    expect(removeAppChildOps(app, content, unpackHmId('hm://z6MkApp/apps/weather/none')!)).toEqual([])
  })

  it('knows child kinds, child ids and parents', () => {
    expect(appChildKind('hm://hyper.media/tool')).toBe('tool')
    expect(appChildKind('hm://hyper.media/page')).toBe('page')
    expect(appChildKind('hm://hyper.media/app')).toBeNull()
    expect(isAppChildId(app, forecast)).toBe(true)
    expect(isAppChildId(app, app)).toBe(false)
    expect(parentDocumentId(forecast)?.id).toBe(app.id)
    expect(parentDocumentId(unpackHmId('hm://z6MkApp/top')!)?.id).toBe('hm://z6MkApp')
    expect(parentDocumentId(unpackHmId('hm://z6MkApp')!)).toBeNull()
  })
})

describe('trigger documents', () => {
  it('are app children', () => {
    expect(appChildKind(HM_TRIGGER_TYPE)).toBe('trigger')
  })
  it('write their source and input as DAG-CBOR blobs and read them back as references', async () => {
    const {ops, blobs} = await triggerDocumentOps({
      source: {type: 'schedule', schedule: {cron: '0 9 * * *'}},
      tool: 'hm://z6Mkspace/app/send',
      input: {text: '$event.payload'},
      enabled: false,
    })
    expect(blobs).toHaveLength(2)
    const op = ops[0] as {type: 'SetAttributes'; attrs: {key: string[]; value: unknown}[]}
    const metadata = Object.fromEntries(op.attrs.map((attr) => [attr.key[0], attr.value]))
    expect(triggerDocumentRefs(metadata)).toEqual({
      sourceCid: blobs[0]!.cid,
      tool: 'hm://z6Mkspace/app/send',
      inputCid: blobs[1]!.cid,
      agent: null,
      enabled: false,
    })
  })
  it('names the agent that runs an app trigger', async () => {
    const {ops} = await triggerDocumentOps({agent: 'hm://z6Mkspace/maple'})
    const op = ops[0] as {type: 'SetAttributes'; attrs: {key: string[]; value: unknown}[]}
    expect(op.attrs).toEqual([{key: ['agent'], value: 'hm://z6Mkspace/maple'}])
    expect(triggerDocumentRefs({agent: 'hm://z6Mkspace/maple'}).agent).toBe('hm://z6Mkspace/maple')
  })
  it('clears the tool and input', async () => {
    const {ops, blobs} = await triggerDocumentOps({tool: null, input: null})
    expect(blobs).toEqual([])
    expect(ops).toEqual([
      {
        type: 'SetAttributes',
        attrs: [
          {key: ['tool'], value: null},
          {key: ['input'], value: null},
        ],
      },
    ])
    expect(triggerDocumentRefs({}).enabled).toBe(true)
  })
})
