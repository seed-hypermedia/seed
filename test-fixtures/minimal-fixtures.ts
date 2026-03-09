import {readFileSync} from 'node:fs'

type FixtureAccount = {
  mnemonic: string
  accountId: string
  accountName: string
  registrationSecret: string
}

type MarkdownFixture = {
  path: string
  title: string
  body: string
}

function readTextFixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8').trimEnd()
}

function parseFrontmatter(raw: string, name: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex === -1) {
          throw new Error(`Invalid frontmatter line "${line}" in ${name}`)
        }

        return [
          line.slice(0, separatorIndex).trim(),
          line.slice(separatorIndex + 1).trim(),
        ] as const
      }),
  )
}

function loadMarkdownFixture(name: string): MarkdownFixture {
  const raw = readTextFixture(name)
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)

  if (!match) {
    throw new Error(`Fixture ${name} is missing markdown frontmatter`)
  }

  const metadata = parseFrontmatter(match[1], name)
  const path = metadata.path
  const title = metadata.title

  if (!path || !title) {
    throw new Error(`Fixture ${name} must define both "path" and "title"`)
  }

  return {
    path,
    title,
    body: match[2].trim(),
  }
}

const accountFixture = JSON.parse(readTextFixture('account.json')) as FixtureAccount
const hierarchyFixture = loadMarkdownFixture('hierarchy-test.md')

export const FIXTURE_ACCOUNT_MNEMONIC = accountFixture.mnemonic
export const FIXTURE_ACCOUNT_ID = accountFixture.accountId
export const FIXTURE_ACCOUNT_NAME = accountFixture.accountName
export const FIXTURE_HOME_CONTENT = readTextFixture('home.md')
export const FIXTURE_REGISTRATION_SECRET = accountFixture.registrationSecret

export const FIXTURE_HIERARCHY_PATH = hierarchyFixture.path
export const FIXTURE_HIERARCHY_TITLE = hierarchyFixture.title
export const FIXTURE_HIERARCHY_MARKDOWN = hierarchyFixture.body
