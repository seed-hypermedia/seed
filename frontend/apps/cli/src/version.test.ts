import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {getCliVersion} from './version'

type PackageJson = {
  version: string
}

const packageJsonPath = new URL('../package.json', import.meta.url)

describe('getCliVersion', () => {
  test('returns the package version', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
    expect(getCliVersion()).toBe(packageJson.version)
  })
})
