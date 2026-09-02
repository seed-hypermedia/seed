import {createDocumentUpdate} from '../../frontend/apps/cli/src/test/account-helpers.ts'
import {FIXTURE_ACCOUNT} from '../../frontend/apps/cli/src/test/fixture-seed.ts'
import {setupTestEnv} from './test-env.ts'

async function seedCollectionDocs(serverUrl: string) {
  // Collection document at /collection
  const collectionOps = [
    {type: 'SetAttributes' as const, attrs: [{key: ['name'] as string[], value: 'Collection Test'}]},
    {
      type: 'ReplaceBlock' as const,
      block: {
        id: 'q1',
        type: 'Query',
        text: '',
        annotations: [],
        link: '',
        query: {
          includes: [{space: '', path: '', mode: 'Children'}],
          sort: [{term: 'UpdateTime', reverse: false}],
        },
        style: 'Table',
        columnCount: 3,
        banner: false,
      },
    },
    {type: 'MoveBlocks' as const, blocks: ['q1'], parent: ''},
  ]
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, '/collection', collectionOps)
  console.log('Created collection')

  // Child documents
  const alphaOps = [
    {
      type: 'SetAttributes' as const,
      attrs: [
        {key: ['name'] as string[], value: 'Alpha Doc'},
        {key: ['tags'] as string[], value: 'tagA'},
      ],
    },
    {
      type: 'ReplaceBlock' as const,
      block: {id: 'p1', type: 'Paragraph', text: 'Alpha content', annotations: [], link: ''},
    },
    {type: 'MoveBlocks' as const, blocks: ['p1'], parent: ''},
  ]
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, '/collection/alpha', alphaOps)
  console.log('Created alpha')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  const betaOps = [
    {
      type: 'SetAttributes' as const,
      attrs: [
        {key: ['name'] as string[], value: 'Beta Doc'},
        {key: ['tags'] as string[], value: 'tagB'},
      ],
    },
    {
      type: 'ReplaceBlock' as const,
      block: {id: 'p1', type: 'Paragraph', text: 'Beta content', annotations: [], link: ''},
    },
    {type: 'MoveBlocks' as const, blocks: ['p1'], parent: ''},
  ]
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, '/collection/beta', betaOps)
  console.log('Created beta')

  // Regular document with embedded query block
  const queryDemoOps = [
    {type: 'SetAttributes' as const, attrs: [{key: ['name'] as string[], value: 'Query Block Demo'}]},
    {
      type: 'ReplaceBlock' as const,
      block: {id: 'p1', type: 'Paragraph', text: 'This document embeds a query block.', annotations: [], link: ''},
    },
    {
      type: 'ReplaceBlock' as const,
      block: {
        id: 'q1',
        type: 'Query',
        text: '',
        annotations: [],
        link: '',
        query: {
          includes: [{space: FIXTURE_ACCOUNT.accountId, path: 'collection', mode: 'Children'}],
          sort: [{term: 'UpdateTime', reverse: false}],
        },
        style: 'Table',
        columnCount: 3,
        banner: false,
      },
    },
    {type: 'MoveBlocks' as const, blocks: ['p1', 'q1'], parent: ''},
  ]
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, '/query-demo', queryDemoOps)
  console.log('Created query-demo')
}

async function main() {
  const env = await setupTestEnv({skipBuild: true})
  try {
    await seedCollectionDocs(env.web.baseUrl)
    console.log('=== Environment ready ===')
    console.log('Web server:', env.web.baseUrl)
    console.log('Press Ctrl+C to stop')
    await new Promise(() => {})
  } catch (e) {
    console.error(e)
    await env.cleanup()
    process.exit(1)
  }
}

main()
