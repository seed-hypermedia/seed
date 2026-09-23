/**
 * One isolated desktop app for the whole story run (a worker fixture: launched once, closed at
 * the end), with the "Before you start" setup done on first use: a signing key registered in the
 * app's own daemon, the Hypermedia Schemas switch on, and the tester's space created through
 * the app's own "Create my Space" flow. The state persists in the e2e appdata directory, so the
 * stories chain across files (the type published in story 5 is what story 6 instantiates).
 */
import {createPromiseClient} from '@connectrpc/connect'
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {test as base, expect} from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import {Daemon} from '../../../../packages/shared/src/client/.generated/daemon/v1alpha/daemon_connect'
import {APPDATA, DAEMON_URL, launchStoryApp, type StoryApp} from './harness'

export {expect}

/** A throwaway key for the isolated app (its daemon keeps keys in files under the e2e appdata). */
const MNEMONIC = 'parrot midnight lion defense ski senior trouble slice chase spot history awkward'
const STATE_FILE = path.join(APPDATA, 'story-state.json')

export type StoryState = {
  account: string
  spaceName: string
  /** Things later stories build on: the Person type's URL, the Vote type's URL, published CIDs. */
  [key: string]: string
}

export function readState(): StoryState | null {
  return fs.existsSync(STATE_FILE) ? (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as StoryState) : null
}
export function writeState(patch: Partial<StoryState>) {
  const next = {...(readState() ?? {}), ...patch}
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2))
  return next as StoryState
}

export type Story = StoryApp & {state: StoryState; url: (p: string) => string}

export const test = base.extend<{}, {story: Story}>({
  story: [
    async ({}, use) => {
      const fresh = process.env.STORY_FRESH === '1' || !readState()
      let app = await launchStoryApp({fresh})
      const daemon = createPromiseClient(Daemon, createGrpcWebTransport({baseUrl: DAEMON_URL}))
      let state = readState()
      if (fresh || !state) {
        const key = await daemon.registerKey({mnemonic: MNEMONIC.split(' '), passphrase: '', name: 'story-author'})
        state = writeState({account: key.accountId, spaceName: 'Story Space'})
        // The app picks the key up as its identity on the next launch.
        await app.app.close()
        app = await launchStoryApp({})
      }
      const {win} = app
      await win.waitForTimeout(2000)
      // First launch with an identity but no space yet: the welcome page. Create the space the
      // way a person does — name it, skip the identity elements — and land on its home document.
      const create = win.getByRole('button', {name: 'Create my Space'}).first()
      if (await create.isVisible().catch(() => false)) {
        // The app selects the registered key as its identity once the daemon answers; until
        // then "Create my Space" would ask for an identity instead of creating the space.
        await expect(win.getByRole('button', {name: /Sign in to Hypermedia/})).toBeHidden({timeout: 30_000})
        await app.dump('fixture-before-create')
        await create.click()
        const dialog = win.getByRole('heading', {name: 'Create a space'})
        if (!(await dialog.isVisible({timeout: 5000}).catch(() => false))) {
          await app.dump('fixture-create-space-failed')
          throw new Error('Create my Space did not open the "Create a space" dialog')
        }
        // Step 1: name the space.
        await win.locator('input:visible').first().fill(state.spaceName)
        await win.getByRole('button', {name: 'Continue'}).click()
        // Step 2: identity elements (icon/description) — skip.
        await win.getByRole('button', {name: 'Skip for now'}).click()
        // Step 3: navigation & appearance — accept the defaults and create.
        await win.getByRole('button', {name: 'Create space'}).click()
        // Land on the new space's home document.
        await expect(win.getByRole('button', {name: 'Create my Space'})).toBeHidden({timeout: 30_000})
        await win.waitForTimeout(3000)
      }
      const url = (p: string) => `hm://${state!.account}${p ? '/' + p : ''}`
      await use({...app, state, url})
      await app.app.close()
    },
    {scope: 'worker', timeout: 300_000},
  ],
})
