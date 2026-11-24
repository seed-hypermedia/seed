import {mkdirSync, writeFileSync} from 'fs'
import {join} from 'path'
import {
  FIXTURE_ACCOUNT_ID,
  FIXTURE_ACCOUNT_MNEMONIC,
  FIXTURE_ACCOUNT_NAME,
  FIXTURE_HIERARCHY_MARKDOWN,
  FIXTURE_HIERARCHY_PATH,
  FIXTURE_HIERARCHY_TITLE,
  FIXTURE_HOME_CONTENT,
  FIXTURE_REGISTRATION_SECRET,
} from '../../../../../test-fixtures/minimal-fixtures'
import {deriveKeyPairFromMnemonic} from '../utils/key-derivation'
import {flattenToOperations, parseMarkdown} from '../utils/markdown'
import {createDocumentUpdate, registerAccount, type TestAccount} from './account-helpers'

const fixtureKeyPair = deriveKeyPairFromMnemonic(FIXTURE_ACCOUNT_MNEMONIC, '')

if (fixtureKeyPair.accountId !== FIXTURE_ACCOUNT_ID) {
  throw new Error('Fixture account ID does not match the configured mnemonic')
}

export const FIXTURE_ACCOUNT: TestAccount = {
  keyPair: fixtureKeyPair,
  mnemonic: FIXTURE_ACCOUNT_MNEMONIC,
  accountId: FIXTURE_ACCOUNT_ID,
}

export {FIXTURE_ACCOUNT_ID}

export const FIXTURE_HIERARCHY_HM_ID = `hm://${FIXTURE_ACCOUNT_ID}/${FIXTURE_HIERARCHY_PATH}`

export async function seedTestFixtures(serverUrl: string): Promise<void> {
  await registerAccount(serverUrl, FIXTURE_ACCOUNT, FIXTURE_ACCOUNT_NAME, {
    homeBody: FIXTURE_HOME_CONTENT,
  })

  const {tree} = parseMarkdown(FIXTURE_HIERARCHY_MARKDOWN)
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, FIXTURE_HIERARCHY_PATH, [
    {
      type: 'SetAttributes',
      attrs: [{key: ['name'], value: FIXTURE_HIERARCHY_TITLE}],
    },
    ...flattenToOperations(tree),
  ])

  // Link the page from Home as a Card, as the app does when it publishes a child,
  // so it appears in the sidebar, which follows Cards only.
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, '', [
    {
      type: 'ReplaceBlock',
      block: {id: 'hierarchy-card', type: 'Embed', link: FIXTURE_HIERARCHY_HM_ID, attributes: {view: 'Card'}},
    },
    {type: 'MoveBlocks', blocks: ['hierarchy-card'], parent: ''},
  ])
}

export function writeFixtureWebConfig(webDataDir: string): void {
  mkdirSync(webDataDir, {recursive: true})
  writeFileSync(
    join(webDataDir, 'config.json'),
    JSON.stringify(
      {
        registeredAccountUid: FIXTURE_ACCOUNT_ID,
        availableRegistrationSecret: FIXTURE_REGISTRATION_SECRET,
      },
      null,
      2,
    ),
  )
}
