# Desktop runtime and packaging

Electron 44.9.3 bundles Chromium 152.0.7977.167 and Node 24.22.0 (released 2026-10-21). It requires macOS 13 or newer.
Update `electron-release.json` alongside the desktop Electron pin and root pnpm override; rebuilding alone must not
reset the browser's age. Source: https://releases.electronjs.org/release/v44.9.3.

Every package disables RunAsNode, NODE_OPTIONS and Node CLI inspection, and enables cookie encryption, embedded ASAR
integrity and loading only from ASAR. Forge flips fuses before signing, then reads them back in `postPackage`. To check
a shipped app:

```sh
pnpm exec ts-node scripts/electron-fuses.ts out/Seed-darwin-arm64/Seed.app
npx @electron/fuses read --app out/Seed-darwin-arm64/Seed.app
```

The desktop and agents sources do not use ELECTRON_RUN_AS_NODE or child_process.fork. The agents server is a compiled
Bun executable, and microsandbox runs its own `msb` helper. Playwright tests copy the verified package into an OS
temporary directory, enable the inspector only in that disposable copy, and remove it on exit. Packaged release
artifacts always retain the hardened fuses.

## macOS entitlements

Live agent voice requests microphone access when the user starts a call. The app declares its microphone usage
description and the audio-input entitlement. Ending a call or leaving the session releases the microphone. Camera icons
open file pickers; camera, Bluetooth, USB, location and print grants remain absent.

V8/Bun retain JIT and unsigned executable memory, and microsandbox's `msb` retains the hypervisor entitlement. Library
validation remains enabled: the agents server, `msb`, `libkrunfw.5.dylib`, and both copies of
`microsandbox.darwin-arm64.node` are signed with Seed's identity before the containing app is signed. The copied binding
under `microsandbox/native` is used by the compiled Bun server and must be signed as well as the binding in the platform
package. `optionsForFile` continues to supply the entitlements to osx-sign. Verify `execute_code` and notarization in
the signed macOS release pipeline; an unsigned local build cannot validate Team ID enforcement.
