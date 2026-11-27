import {describe, expect, it} from 'vitest'
import {
  addAppChildOps,
  HM_TRIGGER_TYPE,
  triggerDocumentOps,
  triggerDocumentFields,
  triggerSourceFromMetadata,
  triggerSourceToMetadata,
  appChildKind,
  appEmbeddedChildren,
  hostListsChild,
  hostToolReference,
  hostToolReferences,
  isAppChildId,
  isRunnableType,
  parentDocumentId,
  removeAppChildOps,
  removeToolReferenceOps,
  setToolReferenceOps,
  toolReferenceLink,
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

describe('a tool and its host', () => {
  const lists = (type: string | undefined, content: HMBlockNode[]) =>
    hostListsChild(app, {metadata: {type}, content}, forecast)

  it('is hosted by the app or agent that lists it', () => {
    const listed = [embed('b1', 'hm://z6MkApp/apps/weather/forecast?v=bafy')]
    expect(lists('hm://hyper.media/app', listed)).toBe(true)
    expect(lists('hm://hyper.media/agent', listed)).toBe(true)
  })

  it('stands on its own under anything else, or under a host that does not list it', () => {
    const listed = [embed('b1', 'hm://z6MkApp/apps/weather/forecast')]
    expect(lists(undefined, listed)).toBe(false)
    expect(lists('hm://hyper.media/tool', listed)).toBe(false)
    expect(lists('hm://hyper.media/app', [embed('b1', 'hm://z6MkApp/apps/weather/radar')])).toBe(false)
    expect(hostListsChild(app, null, forecast)).toBe(false)
  })

  it('can be run by a server, like an app or an agent, and unlike any other document', () => {
    expect(['hm://hyper.media/app', 'hm://hyper.media/agent', 'hm://hyper.media/tool'].map(isRunnableType)).toEqual([
      true,
      true,
      true,
    ])
    expect([HM_TRIGGER_TYPE, 'hm://hyper.media/page', undefined].map(isRunnableType)).toEqual([false, false, false])
  })
})

describe('a tool a host references', () => {
  const convert = unpackHmId('hm://z6MkBob/tools/convert')!
  const content = [
    embed('own', 'hm://z6MkApp/apps/weather/forecast'),
    embed('pinned', 'hm://z6MkBob/tools/convert?v=bafyv1'),
    embed('latest', 'hm://z6MkApp/shared/geocode'),
    embed('floating', 'hm://z6MkBob/tools/units?v=bafyold&l'),
    // Content, not a listing: an embed shown inline, a card of one block, a card of the host itself.
    {
      block: {type: 'Embed', id: 'guide', link: 'hm://z6MkDocs/agent/guide', attributes: {view: 'Content'}},
      children: [],
    },
    embed('block', 'hm://z6MkBob/tools/convert#Zr1kAbQ2'),
    embed('self', 'hm://z6MkApp/apps/weather'),
    paragraph('p1', 'Notes'),
  ] as HMBlockNode[]

  it('is a card of a document that lives outside the host, pinned to a version or following the latest', () => {
    expect(hostToolReferences(app, content).map((r) => [r.blockId, r.id.id, r.version])).toEqual([
      ['pinned', 'hm://z6MkBob/tools/convert', 'bafyv1'],
      ['latest', 'hm://z6MkApp/shared/geocode', null],
      // `?v=…&l` asks for the latest version, so it pins nothing.
      ['floating', 'hm://z6MkBob/tools/units', null],
    ])
    // The host's own children are not references, and the listing of children is unchanged.
    expect(appEmbeddedChildren(app, content).map((child) => child.id.id)).toEqual([
      'hm://z6MkApp/apps/weather/forecast',
    ])
  })

  it('is found for one tool, under an app or an agent only', () => {
    const host = (type: string | undefined) => hostToolReference(app, {metadata: {type}, content}, convert)
    expect(host('hm://hyper.media/app')).toMatchObject({blockId: 'pinned', version: 'bafyv1'})
    expect(host('hm://hyper.media/agent')).toMatchObject({blockId: 'pinned'})
    expect(host(undefined)).toBeNull()
    expect(hostToolReference(app, {metadata: {type: 'hm://hyper.media/app'}, content}, forecast)).toBeNull()
  })

  it('links the exact version when pinned and the latest otherwise', () => {
    expect(toolReferenceLink(convert, 'bafyv2')).toBe('hm://z6MkBob/tools/convert?v=bafyv2')
    expect(unpackHmId(toolReferenceLink(convert, null))).toMatchObject({version: null})
  })

  it('is added after the rest, moved to another version in place, and removed', () => {
    const fresh = [embed('own', 'hm://z6MkApp/apps/weather/forecast'), paragraph('p1', 'Notes')]
    const added = setToolReferenceOps(app, fresh, convert, 'bafyv1')
    expect(JSON.stringify(added)).toContain('hm://z6MkBob/tools/convert?v=bafyv1')
    // Nothing else in the document is touched.
    expect(JSON.stringify(added)).not.toContain('forecast')

    const repinned = JSON.stringify(setToolReferenceOps(app, content, convert, 'bafyv2'))
    expect(repinned).toContain('hm://z6MkBob/tools/convert?v=bafyv2')
    expect(repinned).toContain('"pinned"')
    expect(repinned).not.toContain('geocode')

    const removed = JSON.stringify(removeToolReferenceOps(app, content, convert))
    expect(removed).toContain('"pinned"')
    expect(removeToolReferenceOps(app, fresh, convert)).toEqual([])
    // Adding or removing one of the host's own tools leaves its references alone.
    const deleted = removeAppChildOps(app, content, forecast).flatMap((op) =>
      op.type === 'DeleteBlocks' ? op.blocks : [],
    )
    expect(deleted).toEqual(['own'])
  })
})

describe('trigger documents', () => {
  it('are app children', () => {
    expect(appChildKind(HM_TRIGGER_TYPE)).toBe('trigger')
  })
  it('keep their source in the document, with sets as maps so each entry is its own key', async () => {
    const source = {
      type: 'activity',
      conditions: [
        {id: 'mention', source: {type: 'user-mention', mentionedAccounts: ['self', 'z6Mkother']}},
        {id: 'site', source: {type: 'site-update', resourcePrefix: 'hm://z6Mkspace/notes', eventTypes: ['comment']}},
      ],
    }
    expect(triggerSourceToMetadata(source)).toEqual({
      type: 'activity',
      conditions: {
        mention: {type: 'user-mention', mentionedAccounts: {self: true, z6Mkother: true}},
        site: {type: 'site-update', resourcePrefix: 'hm://z6Mkspace/notes', eventTypes: {comment: true}},
      },
    })
    expect(triggerSourceFromMetadata(triggerSourceToMetadata(source))).toEqual(source)
    const weekly = {
      type: 'schedule',
      schedule: {
        kind: 'weekly',
        daysOfWeek: [1, 3, 5],
        timeOfDay: '08:00',
        timesOfDay: ['08:00', '17:00'],
        timezone: 'UTC',
      },
    }
    expect(triggerSourceToMetadata(weekly)).toEqual({
      type: 'schedule',
      schedule: {
        kind: 'weekly',
        daysOfWeek: {mon: true, wed: true, fri: true},
        timeOfDay: '08:00',
        timesOfDay: {'08:00': true, '17:00': true},
        timezone: 'UTC',
      },
    })
    expect(triggerSourceFromMetadata(triggerSourceToMetadata(weekly))).toEqual(weekly)
    // An entry switched off (or removed) is not a member.
    expect(
      triggerSourceFromMetadata({type: 'schedule', schedule: {kind: 'weekly', daysOfWeek: {mon: true, tue: false}}}),
    ).toEqual({type: 'schedule', schedule: {kind: 'weekly', daysOfWeek: [1]}})
  })
  it('write a field by clearing it, then setting each entry', async () => {
    const {ops, blobs} = await triggerDocumentOps({
      source: {type: 'schedule', schedule: {kind: 'weekly', daysOfWeek: [1], timeOfDay: '09:00', timezone: 'UTC'}},
      tool: 'hm://z6Mkspace/app/send',
      input: {text: '$event.payload', to: {channel: 'general'}},
      enabled: false,
    })
    expect(blobs).toEqual([])
    const op = ops[0] as {type: 'SetAttributes'; attrs: {key: string[]; value: unknown}[]}
    expect(op.attrs).toEqual([
      {key: ['source'], value: null},
      {key: ['source', 'type'], value: 'schedule'},
      {key: ['source', 'schedule', 'kind'], value: 'weekly'},
      {key: ['source', 'schedule', 'daysOfWeek', 'mon'], value: true},
      {key: ['source', 'schedule', 'timeOfDay'], value: '09:00'},
      {key: ['source', 'schedule', 'timezone'], value: 'UTC'},
      {key: ['tool'], value: 'hm://z6Mkspace/app/send'},
      {key: ['input'], value: null},
      {key: ['input', 'text'], value: '$event.payload'},
      {key: ['input', 'to', 'channel'], value: 'general'},
      {key: ['enabled'], value: false},
    ])
    // Read back from the document's metadata.
    expect(
      triggerDocumentFields({
        source: {
          type: 'schedule',
          schedule: {kind: 'weekly', daysOfWeek: {mon: true}, timeOfDay: '09:00', timezone: 'UTC'},
        },
        tool: 'hm://z6Mkspace/app/send',
        input: {text: '$event.payload'},
        enabled: false,
      }),
    ).toEqual({
      source: {type: 'schedule', schedule: {kind: 'weekly', daysOfWeek: [1], timeOfDay: '09:00', timezone: 'UTC'}},
      tool: 'hm://z6Mkspace/app/send',
      input: {text: '$event.payload'},
      enabled: false,
    })
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
    expect(triggerDocumentFields({}).enabled).toBe(true)
  })
})
