import {createDocumentUpdate} from '../../frontend/apps/cli/src/test/account-helpers.ts'
import {FIXTURE_ACCOUNT} from '../../frontend/apps/cli/src/test/fixture-seed.ts'

async function setStyle(
  serverUrl: string,
  path: string,
  style: string,
  includes: Array<{space: string; path: string; mode: string}>,
) {
  const ops = [
    {
      type: 'ReplaceBlock' as const,
      block: {
        id: 'q1',
        type: 'Query',
        text: '',
        annotations: [],
        link: '',
        query: {
          includes,
          sort: [{term: 'UpdateTime', reverse: false}],
        },
        style,
        columnCount: 3,
        banner: false,
      },
    },
    {type: 'MoveBlocks' as const, blocks: ['q1'], parent: ''},
  ]
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, path, ops)
  console.log(`Set ${path} style to ${style}`)
}

async function main() {
  const serverUrl = 'http://localhost:3399'
  const accountId = (FIXTURE_ACCOUNT as any).accountId ?? FIXTURE_ACCOUNT
  await setStyle(serverUrl, '/collection', 'Table', [{space: '', path: '', mode: 'Children'}])
  console.log('Done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
