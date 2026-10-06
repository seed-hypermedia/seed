# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this
repository ("Security" tab, "Report a vulnerability"). You will get a first reply within five business days, and we will
tell you when the fix ships. If the report concerns a hosted service (hyper.media or a site we host), say so; those
fixes go out ahead of the next desktop release.

Please include the version (desktop: About screen; daemon: `/debug/version`), the steps, and what you observed. A proof
of concept against your own local daemon or your own account is welcome; please do not test against other people's data
or the hosted services.

## What is in scope

- The desktop app (`frontend/apps/desktop`), including the experimental web pane and the agent browser tool.
- The daemon (`backend`), its HTTP and gRPC APIs, and the Hypermedia protocol implementation.
- The web app, the notify service, the vault, and the agents server.

## How security work is recorded

- `docs/security/audit-log.md` is the durable, public record of audit coverage, ruled-out hypotheses and already public
  findings. Unfixed findings never go there.
- `docs/security/electron-checklist.md` tracks the desktop app against Electron's security checklist.
- `frontend/apps/desktop/SECURITY.md` documents the shipped Electron runtime, fuses and entitlements.
- Fixed vulnerabilities get a GitHub issue at fix time, closed by the fixing pull request. That issue is the disclosure.

## Continuous checks

- `desktop-security-e2e.yml` runs a hostile page, the web pane suite and the real-daemon authentication regression
  inside a real Electron build on pull requests.
- `security-audit.yml` runs dependency audits and an Electron static scan.
- `check-electron-support.yml` fails when the pinned Electron major leaves the supported line.
- Packaging flips and reads back the Electron fuses; update manifests can carry a signature that the app verifies.
