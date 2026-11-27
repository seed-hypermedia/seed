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
      onFailure: null,
      session: null,
    })
  })
  it('write and read an agent trigger’s failure session and session options, the tool list as a set', async () => {
    const {ops} = await triggerDocumentOps({
      onFailure: 'session',
      session: {systemPrompt: 'Triage.', tools: ['read', 'search']},
    })
    const op = ops[0] as {type: 'SetAttributes'; attrs: {key: string[]; value: unknown}[]}
    expect(op.attrs).toEqual([
      {key: ['onFailure'], value: 'session'},
      {key: ['session'], value: null},
      {key: ['session', 'systemPrompt'], value: 'Triage.'},
      {key: ['session', 'tools', 'read'], value: true},
      {key: ['session', 'tools', 'search'], value: true},
    ])
    expect(
      triggerDocumentFields({
        onFailure: 'session',
        session: {systemPrompt: 'Triage.', tools: {read: true, search: false}},
      }),
    ).toMatchObject({onFailure: 'session', session: {systemPrompt: 'Triage.', tools: ['read']}})
    expect(triggerDocumentFields({session: {}})).toMatchObject({onFailure: null, session: null})
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
