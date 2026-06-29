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
        {type: 'user-mention', mentionedAccounts: ['z6Mkmentioned'], resourcePrefix: 'hm://z6Mksite'},
        event,
      ),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccounts: ['z6Mkmentioned'], resourcePrefix: 'hm://z6Mkelse'},
        event,
      ),
    ).toBe(false)
    expect(
      triggers.activityMatchesTriggerSource({type: 'user-mention', mentionedAccounts: ['z6Mkmentioned']}, event),
    ).toBe(true)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccounts: ['z6Mkmentioned'], resourcePrefix: 'hm://z6Mksite'},
        {...event, newMention: {...event.newMention, target: 'hm://z6Mkmentioned/profile'}},
      ),
    ).toBe(true)
    expect(triggers.activityMatchesTriggerSource({type: 'user-mention', mentionedAccounts: ['z6Mkother']}, event)).toBe(
      false,
    )
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccounts: ['z6Mkmentioned'], resourcePrefix: 'hm://z6Mksite'},
        {data: {case: 'newMention', value: event.newMention}},
      ),
    ).toBe(true)

    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccounts: ['z6Mkmentioned']},
        {type: 'doc-update', targetAuthorUids: ['z6Mkmentioned'], id: 'update-1'},
      ),
    ).toBe(false)
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccounts: ['z6Mkmentioned']},
        {
          type: 'comment',
          comment: {content: [{block: {annotations: [{type: 'Embed', link: 'hm://z6Mkmentioned/:profile'}]}}]},
        },
      ),
    ).toBe(true)

    // Matches when any account in the list is mentioned.
    expect(
      triggers.activityMatchesTriggerSource(
        {type: 'user-mention', mentionedAccounts: ['z6Mkother', 'z6Mkmentioned']},
        event,
      ),
    ).toBe(true)

    // Legacy triggers that stored a single `mentionedAccount` still match.
    expect(
      triggers.activityMatchesTriggerSource({type: 'user-mention', mentionedAccount: 'z6Mkmentioned'} as any, event),
    ).toBe(true)
  })

  test('matches resolved LoadedEvents precisely without firing on incidental account references', () => {
    const source = {type: 'user-mention' as const, mentionedAccounts: ['z6Mkmentioned']}

    // Comment that embeds a mention of the account (the shape /api/ListEvents returns).
    const commentMention = {
      type: 'comment',
      author: {id: {uid: 'z6Mkauthor', id: 'hm://z6Mkauthor', path: []}},
      comment: {
        content: [
          {block: {annotations: [{type: 'Embed', link: 'hm://z6Mkmentioned/:profile?v=bafyabc&l'}]}, children: []},
        ],
      },
    }
    expect(triggers.activityMatchesTriggerSource(source, commentMention)).toBe(true)

    // Comment authored BY the account, mentioning someone else, must not match.
    const commentByAccount = {
      type: 'comment',
      author: {id: {uid: 'z6Mkmentioned', id: 'hm://z6Mkmentioned', path: []}},
      comment: {content: [{block: {annotations: [{type: 'Embed', link: 'hm://z6Mkother/:profile'}]}, children: []}]},
    }
    expect(triggers.activityMatchesTriggerSource(source, commentByAccount)).toBe(false)

    // A document citation that targets the account profile is a genuine mention.
    const documentMention = {
      type: 'citation',
      citationType: 'd',
      source: {id: {uid: 'z6Mksite', id: 'hm://z6Mksite/notes', path: ['notes']}},
      target: {id: {uid: 'z6Mkmentioned', id: 'hm://z6Mkmentioned/:profile', path: [':profile']}},
    }
    expect(triggers.activityMatchesTriggerSource(source, documentMention)).toBe(true)

    // A comment-sourced citation (citationType 'c') is now ALSO a match. It is no longer suppressed:
    // the comment event and this citation twin are separate feed events that can arrive in different
    // polls (and the comment event is sometimes dropped by the staleness watermark), so either must be
    // able to fire. Duplicate firings are prevented downstream by activityFiringKey, not here.
    expect(triggers.activityMatchesTriggerSource(source, {...documentMention, citationType: 'c'})).toBe(true)

    // A citation that merely *cites a document owned by* the account is not an account mention.
    const documentCitation = {
      type: 'citation',
      citationType: 'd',
      source: {id: {uid: 'z6Mksite', id: 'hm://z6Mksite/notes', path: ['notes']}},
      target: {
        id: {uid: 'z6Mkmentioned', id: 'hm://z6Mkmentioned/weekly-review', path: ['weekly-review']},
      },
      targetAuthorUids: ['z6Mkmentioned'],
    }
    expect(triggers.activityMatchesTriggerSource(source, documentCitation)).toBe(false)

    // A doc-update authored by the account is not a mention.
    expect(
      triggers.activityMatchesTriggerSource(source, {
        type: 'doc-update',
        author: {id: {uid: 'z6Mkmentioned', id: 'hm://z6Mkmentioned', path: []}},
        docId: {uid: 'z6Mkmentioned', id: 'hm://z6Mkmentioned/post', path: ['post']},
      }),
    ).toBe(false)

    // resourcePrefix still filters resolved mentions by where the mention occurred.
    expect(triggers.activityMatchesTriggerSource({...source, resourcePrefix: 'hm://z6Mksite'}, documentMention)).toBe(
      true,
    )
    expect(
      triggers.activityMatchesTriggerSource({...source, resourcePrefix: 'hm://z6Mkelsewhere'}, documentMention),
    ).toBe(false)
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

  test('collapses a comment event and its citation twin to one firing key', () => {
    // The two feed events HM emits for one @mention: a comment event and a citation event. Both carry
    // the same comment-version CID, so activityFiringKey maps them to the same `blob-<cid>` identity.
    const commentCid = 'bafy2bzaceca7qqno4qw7rxa3mblizsb266i2ryt6lojpxnocrfqn7yfy7m6ww'
    const commentEvent = {type: 'comment', feedEventId: `blob-${commentCid}`}
    const citationEvent = {
      type: 'citation',
      citationType: 'c',
      feedEventId: `mention-${commentCid}--hm://z6MknRGBsPMcrn5nAXWHmR4RjNuVTRK5a2rthFy188et7LKs/:profile`,
    }

    expect(triggers.activityFiringKey(commentEvent)).toBe(`blob-${commentCid}`)
    expect(triggers.activityFiringKey(citationEvent)).toBe(`blob-${commentCid}`)
    // Same identity => one row under UNIQUE(account_id, trigger_id, activity_key) => fires once.
    expect(triggers.activityFiringKey(citationEvent)).toBe(triggers.activityFiringKey(commentEvent))
  })

  test('keeps distinct comments and non-mention events on distinct firing keys', () => {
    // Different comments must not collapse.
    const a = {type: 'comment', feedEventId: 'blob-bafyCommentA'}
    const bCitation = {type: 'citation', feedEventId: 'mention-bafyCommentB--hm://z6Mkmentioned/:profile'}
    expect(triggers.activityFiringKey(a)).not.toBe(triggers.activityFiringKey(bCitation))

    // A plain comment/blob event keeps its natural key (unchanged behavior for document-comment triggers).
    expect(triggers.activityFiringKey({newBlob: {cid: 'bafyblob', blobType: 'Comment'}})).toBe('blob-bafyblob')

    // Events without a stable key have no firing key.
    expect(triggers.activityFiringKey({newBlob: {cid: 'undefined'}})).toBeNull()
  })
})
