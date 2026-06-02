import {describe, expect, test} from 'bun:test'
import * as triggers from '@/activity-triggers'

describe('activity trigger matching', () => {
  test('matches document comments by resource and optional author', () => {
    const event = {
      account: 'z6Mkauthor',
      newBlob: {
        cid: 'bafycomment',
        blobType: 'Comment',
        author: 'z6Mkauthor',
        resource: 'hm://z6Mkdoc/spec',
      },
    }
    const protobufJsonEvent = {
      data: {
        case: 'newBlob',
        value: {
          cid: 'bafycomment',
          blobType: 'comment',
          author: 'z6Mkauthor',
          resource: 'hm://z6Mkdoc/spec',
        },
      },
    }

    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'document-comment', resource: 'hm://z6Mkdoc/spec', author: 'z6Mkauthor'},
        event,
      ),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'document-comment', resource: 'hm://z6Mkdoc/spec', author: 'z6Mkother'},
        event,
      ),
    ).toBe(false)
    expect(
      triggers.activityMatchesTriggerSource({type: 'document-comment', resource: 'hm://z6Mkother/spec'}, event),
    ).toBe(false)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'document-comment', resource: 'hm://z6Mkdoc/spec', author: 'z6Mkauthor'},
        protobufJsonEvent,
      ),
    ).toBe(true)
  })

  test('matches user mentions by target account and optional resource prefix', () => {
    const event = {
      newMention: {
        source: 'hm://z6Mksite/docs/spec',
        sourceType: 'doc/Link',
        sourceBlob: {cid: 'bafymention', author: 'z6Mkauthor'},
        target: 'hm://z6Mkmentioned',
      },
    }

    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccount: 'z6Mkmentioned', resourcePrefix: 'hm://z6Mksite'},
        event,
      ),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccount: 'z6Mkmentioned', resourcePrefix: 'hm://z6Mkelse'},
        event,
      ),
    ).toBe(false)
    expect(
      triggers.activityMatchesTriggerSource({type: 'user-mention', mentionedAccount: 'z6Mkmentioned'}, event),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccount: 'z6Mkmentioned', resourcePrefix: 'hm://z6Mksite'},
        {...event, newMention: {...event.newMention, target: 'hm://z6Mkmentioned/profile'}},
      ),
    ).toBe(true)
    expect(triggers.activityMatchesTriggerSource({type: 'user-mention', mentionedAccount: 'z6Mkother'}, event)).toBe(
      false,
    )
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccount: 'z6Mkmentioned', resourcePrefix: 'hm://z6Mksite'},
        {data: {case: 'newMention', value: event.newMention}},
      ),
    ).toBe(true)

    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccount: 'z6Mkmentioned'},
        {type: 'doc-update', targetAuthorUids: ['z6Mkmentioned'], id: 'update-1'},
      ),
    ).toBe(false)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccount: 'z6Mkmentioned'},
        {type: 'comment', comment: {content: [{block: {annotations: [{link: 'hm://z6Mkmentioned/:profile'}]}}]}},
      ),
    ).toBe(true)
  })

  test('matches site updates by resource prefix and event type', () => {
    const event = {
      new_blob: {
        cid: 'bafyref',
        blob_type: 'Ref',
        resource: 'hm://z6Mksite/docs/spec',
      },
    }

    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'site-update', resourcePrefix: 'hm://z6Mksite', eventTypes: ['Ref', 'Comment']},
        event,
      ),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'site-update', resourcePrefix: 'hm://z6Mksite', eventTypes: ['Comment']},
        event,
      ),
    ).toBe(false)
    expect(triggers.activityMatchesTriggerSource({type: 'site-update', resourcePrefix: 'hm://z6Mkelse'}, event)).toBe(
      false,
    )
  })

  test('matches modern document update feed events for site-update triggers', () => {
    const event = {
      id: 'bafyupdate',
      type: 'doc-update',
      docId: {id: 'hm://z6Mksite/docs/spec'},
      document: {account: 'z6Mksite', path: 'docs/spec'},
    }

    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'site-update', resourcePrefix: 'hm://z6Mksite', eventTypes: ['doc-update', 'comment']},
        event,
      ),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'site-update', resourcePrefix: 'hm://z6Mksite', eventTypes: ['Change']},
        event,
      ),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'site-update', resourcePrefix: 'hm://z6Mkelse', eventTypes: ['doc-update']},
        event,
      ),
    ).toBe(false)
  })

  test('derives stable activity keys and summaries', () => {
    expect(triggers.activityEventKey({newBlob: {cid: 'bafyblob', blobType: 'Comment'}})).toBe('blob-bafyblob')
    expect(triggers.activityEventKey({newMention: {sourceBlob: {cid: 'bafymention'}, target: 'hm://z6Mktarget'}})).toBe(
      'mention-bafymention--hm://z6Mktarget',
    )
    expect(triggers.activityEventKey({newBlob: {cid: 'undefined'}})).toBeNull()
    expect(triggers.activitySummary({newBlob: {blobType: 'Comment', resource: 'hm://z6Mkdoc'}})).toBe(
      'Comment on hm://z6Mkdoc',
    )
    expect(triggers.activityEventTimeMs({eventTime: {seconds: 2}, observeTime: {seconds: 1}})).toBe(2000)
  })
})
