import {execFileSync} from 'node:child_process'
import path from 'node:path'

/** Environment values used to decide whether Windows signing should run. */
export type WindowsSigningEnv = Partial<Record<'CI' | 'WINDOWS_CODE_SIGNING' | 'SM_KEYPAIR_ALIAS', string>>

/** A command invocation issued by the Windows signing helper. */
export type WindowsSigningCommand = {
  command: string
  args: string[]
}

/** Function used to run signing commands, injectable for tests. */
export type WindowsSigningCommandRunner = (command: WindowsSigningCommand) => void | Promise<void>

/** Options accepted by the Windows signing helper. */
export type WindowsSigningOptions = {
  platform?: NodeJS.Platform | string
  env?: WindowsSigningEnv
  runCommand?: WindowsSigningCommandRunner
  packageExecutableName?: string
  packageResourceExecutableNames?: string[]
}

/** Minimal shape of Electron Forge make results used by the signing hook. */
export type WindowsSigningMakeResult = {
  platform: string
  artifacts: string[]
}

/** Decision returned when evaluating whether Windows signing should run. */
export type WindowsSigningPlan =
  | {enabled: true; keypairAlias: string}
  | {enabled: false; reason: 'not-windows' | 'not-enabled'}

const SIGNABLE_WINDOWS_ARTIFACT_EXTENSIONS = new Set(['.exe'])

/**
 * Returns whether DigiCert KeyLocker signing is enabled for the current build.
 *
 * Signing is intentionally opt-in so local Windows builds do not require DigiCert credentials.
 */
export function getWindowsSigningPlan(options: WindowsSigningOptions = {}): WindowsSigningPlan {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env

  if (platform !== 'win32') {
    return {enabled: false, reason: 'not-windows'}
  }

  if (env.CI !== 'true' || env.WINDOWS_CODE_SIGNING !== 'true') {
    return {enabled: false, reason: 'not-enabled'}
  }

  const keypairAlias = env.SM_KEYPAIR_ALIAS?.trim()
  if (!keypairAlias) {
    throw new Error('WINDOWS_CODE_SIGNING is enabled, but SM_KEYPAIR_ALIAS is not set')
  }

  return {enabled: true, keypairAlias}
}

/** Signs and verifies packaged Windows executables before Squirrel artifacts are created. */
export async function signWindowsPackagePaths(
  outputPaths: string[],
  options: WindowsSigningOptions = {},
): Promise<void> {
  const plan = getWindowsSigningPlan(options)
  if (!plan.enabled) {
    console.info(`[windows-signing] Skipping package signing: ${plan.reason}`)
    return
  }

  for (const outputPath of outputPaths) {
    for (const targetPath of getWindowsPackageSigningTargets(outputPath, options)) {
      await signAndVerifyPath(targetPath, plan.keypairAlias, options)
    }
  }
}

/** Signs and verifies generated Windows setup executables after Squirrel artifacts are created. */
export async function signWindowsMakeResults<T extends WindowsSigningMakeResult>(
  makeResults: T[],
  options: WindowsSigningOptions = {},
): Promise<T[]> {
  const plan = getWindowsSigningPlan(options)
  if (!plan.enabled) {
    console.info(`[windows-signing] Skipping make artifact signing: ${plan.reason}`)
    return makeResults
  }

  for (const result of makeResults) {
    if (result.platform !== 'win32') continue

    for (const artifact of result.artifacts) {
      if (!SIGNABLE_WINDOWS_ARTIFACT_EXTENSIONS.has(path.extname(artifact).toLowerCase())) continue

      await signAndVerifyPath(artifact, plan.keypairAlias, options)
    }
  }

  return makeResults
}

function getWindowsPackageSigningTargets(outputPath: string, options: WindowsSigningOptions): string[] {
  const packageExecutableName = options.packageExecutableName?.trim()
  if (!packageExecutableName) {
    throw new Error('Windows package signing requires packageExecutableName')
  }

  const packageResourceExecutableNames = options.packageResourceExecutableNames ?? []
  if (packageResourceExecutableNames.length === 0) {
    throw new Error('Windows package signing requires at least one packageResourceExecutableNames entry')
  }

  return [
    path.join(outputPath, packageExecutableName),
    ...packageResourceExecutableNames.map((fileName) => path.join(outputPath, 'resources', fileName)),
  ]
}

async function signAndVerifyPath(
  inputPath: string,
  keypairAlias: string,
  options: WindowsSigningOptions,
): Promise<void> {
  const runCommand = options.runCommand ?? runCommandWithInheritedStdio
  console.info(`[windows-signing] Signing ${inputPath}`)
  await runCommand({
    command: 'smctl',
    args: [
      'sign',
      `--keypair-alias=${keypairAlias}`,
      `--input=${inputPath}`,
      '--simple',
      '--unsigned',
      '--sigalg=SHA256',
      '--digalg=SHA256',
      '--verbose',
    ],
  })

  console.info(`[windows-signing] Verifying ${inputPath}`)
  await runCommand({
    command: 'smctl',
    args: ['sign', 'verify', `--input=${inputPath}`],
  })
}

function runCommandWithInheritedStdio({command, args}: WindowsSigningCommand): void {
  execFileSync(command, args, {stdio: 'inherit'})
}
