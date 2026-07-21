import {describe, expect, test} from 'vitest'
import {
  getWindowsSigningPlan,
  signWindowsMakeResults,
  signWindowsPackagePaths,
  type WindowsSigningCommand,
} from '../../scripts/windows-signing'

describe('windows signing plan', () => {
  test('is disabled outside Windows', () => {
    expect(
      getWindowsSigningPlan({
        platform: 'darwin',
        env: {CI: 'true', WINDOWS_CODE_SIGNING: 'true', SM_KEYPAIR_ALIAS: 'seed'},
      }),
    ).toEqual({enabled: false, reason: 'not-windows'})
  })

  test('is disabled unless CI explicitly enables Windows code signing', () => {
    expect(
      getWindowsSigningPlan({
        platform: 'win32',
        env: {CI: 'true', SM_KEYPAIR_ALIAS: 'seed'},
      }),
    ).toEqual({enabled: false, reason: 'not-enabled'})
  })

  test('requires a KeyLocker keypair alias when enabled', () => {
    expect(() =>
      getWindowsSigningPlan({
        platform: 'win32',
        env: {CI: 'true', WINDOWS_CODE_SIGNING: 'true'},
      }),
    ).toThrow('SM_KEYPAIR_ALIAS')
  })

  test('enables signing on Windows CI when KeyLocker is configured', () => {
    expect(
      getWindowsSigningPlan({
        platform: 'win32',
        env: {CI: 'true', WINDOWS_CODE_SIGNING: 'true', SM_KEYPAIR_ALIAS: 'seed-prod'},
      }),
    ).toEqual({enabled: true, keypairAlias: 'seed-prod'})
  })
})

describe('windows signing commands', () => {
  test('signs and verifies only the packaged app and daemon executables', async () => {
    const commands: WindowsSigningCommand[] = []

    await signWindowsPackagePaths(['C:/work/out/Seed-win32-x64'], {
      platform: 'win32',
      env: {CI: 'true', WINDOWS_CODE_SIGNING: 'true', SM_KEYPAIR_ALIAS: 'seed-prod'},
      packageExecutableName: 'Seed.exe',
      packageResourceExecutableNames: ['seed-daemon-x86_64-pc-windows-gnu.exe'],
      runCommand: (command) => {
        commands.push(command)
      },
    })

    expect(commands).toEqual([
      {
        command: 'smctl',
        args: [
          'sign',
          '--keypair-alias=seed-prod',
          '--input=C:/work/out/Seed-win32-x64/Seed.exe',
          '--simple',
          '--unsigned',
          '--sigalg=SHA256',
          '--digalg=SHA256',
          '--verbose',
        ],
      },
      {
        command: 'smctl',
        args: ['sign', 'verify', '--input=C:/work/out/Seed-win32-x64/Seed.exe'],
      },
      {
        command: 'smctl',
        args: [
          'sign',
          '--keypair-alias=seed-prod',
          '--input=C:/work/out/Seed-win32-x64/resources/seed-daemon-x86_64-pc-windows-gnu.exe',
          '--simple',
          '--unsigned',
          '--sigalg=SHA256',
          '--digalg=SHA256',
          '--verbose',
        ],
      },
      {
        command: 'smctl',
        args: ['sign', 'verify', '--input=C:/work/out/Seed-win32-x64/resources/seed-daemon-x86_64-pc-windows-gnu.exe'],
      },
    ])
    expect(commands.flatMap((command) => command.args)).not.toContain('C:/work/out/Seed-win32-x64')
    expect(commands.flatMap((command) => command.args)).not.toContain(
      '--input=C:/work/out/Seed-win32-x64/resources/libwinpthread-1.dll',
    )
  })

  test('signs only Windows setup executables from make results and preserves the result object', async () => {
    const commands: WindowsSigningCommand[] = []
    const makeResults = [
      {
        platform: 'win32',
        artifacts: [
          'C:/work/out/make/squirrel.windows/x64/seed-1.2.3-win32-x64-setup.exe',
          'C:/work/out/make/squirrel.windows/x64/seed-1.2.3-full.nupkg',
          'C:/work/out/make/squirrel.windows/x64/RELEASES',
        ],
      },
      {
        platform: 'linux',
        artifacts: ['C:/work/out/make/deb/x64/seed.deb'],
      },
    ]

    const returnedResults = await signWindowsMakeResults(makeResults, {
      platform: 'win32',
      env: {CI: 'true', WINDOWS_CODE_SIGNING: 'true', SM_KEYPAIR_ALIAS: 'seed-prod'},
      runCommand: (command) => {
        commands.push(command)
      },
    })

    expect(returnedResults).toBe(makeResults)
    expect(commands).toEqual([
      {
        command: 'smctl',
        args: [
          'sign',
          '--keypair-alias=seed-prod',
          '--input=C:/work/out/make/squirrel.windows/x64/seed-1.2.3-win32-x64-setup.exe',
          '--simple',
          '--unsigned',
          '--sigalg=SHA256',
          '--digalg=SHA256',
          '--verbose',
        ],
      },
      {
        command: 'smctl',
        args: ['sign', 'verify', '--input=C:/work/out/make/squirrel.windows/x64/seed-1.2.3-win32-x64-setup.exe'],
      },
    ])
  })
})
