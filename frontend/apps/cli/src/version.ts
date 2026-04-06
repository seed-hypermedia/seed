import {readFileSync} from 'node:fs'

type PackageJson = {
  version: string
}

const packageJsonPath = new URL('../package.json', import.meta.url)

/** Returns the CLI version from package metadata. */
export function getCliVersion(): string {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  return packageJson.version
}
