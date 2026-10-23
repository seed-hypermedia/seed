# Desktop runtime and packaging

Electron 44.5.1 bundles Chromium 152.0.7977.130 and Node 24.21.0 (released 2026-09-29). It requires macOS 13 or newer.
Update `electron-release.json` alongside the desktop Electron pin and root pnpm override; rebuilding alone must not
reset the browser's age. Source: https://releases.electronjs.org/release/v44.5.1.

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

The frontend has no getUserMedia, geolocation, Web Bluetooth, Web USB or print calls. Camera icons open file pickers;
they do not capture camera images. Camera, microphone, Bluetooth, USB, location and print grants have been removed.

V8/Bun retain JIT and unsigned executable memory, and microsandbox's `msb` retains the hypervisor entitlement. Library
validation remains enabled: the agents server, `msb`, `libkrunfw.5.dylib`, and both copies of
`microsandbox.darwin-arm64.node` are signed with Seed's identity before the containing app is signed. The copied binding
under `microsandbox/native` is used by the compiled Bun server and must be signed as well as the binding in the platform
package. `optionsForFile` continues to supply the entitlements to osx-sign. Verify `execute_code` and notarization in
the signed macOS release pipeline; an unsigned local build cannot validate Team ID enforcement.
