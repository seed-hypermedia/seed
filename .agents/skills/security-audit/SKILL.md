---
name: security-audit
description: >-
  Audits Seed security through scoped code review, reproducible findings, regression tests, and durable records. Use
  ONLY when explicitly requested by the user to run this skill or conduct a security audit. Never load automatically for
  routine reviews or fixes.
---

# Security Audit

Audit the requested Seed surface, reproduce findings, and preserve evidence for later audit sessions.

## Scope and resources

This workflow is opt-in. A security-related bug, test, or code comment does not activate it. Follow the user's requested
audit scope; do not expand a routine fix into an audit.

Before auditing, read:

- [Audit log](resources/audit-log.md): prior coverage, ruled-out hypotheses, and historical findings.
- [Audit protocol](resources/protocol.md): safety rules, review passes, reproduction requirements, severity rubric, and
  reporting format. Read the relevant phase before carrying it out.
- [Electron checklist](resources/electron-checklist.md): the desktop app against Electron's security checklist, for
  audits that touch the desktop.
- Applicable repository guidance, including `AGENTS.local.md` when present.

Paths in protocol commands are relative to the repository root. The log contains historical observations, not proof of
current behavior; verify relevant claims against the current checkout.

## Workflow

1. State the audit scope and planned passes. Read prior records before investigating candidates.
2. Trace reachable entry points, guards, and attacker-satisfiable preconditions. Separate static hypotheses from
   reproduced findings.
3. Reproduce each candidate with an asserting regression test or the protocol's controlled live-probe procedure. Record
   both failing-before and passing-after results; inability to run a check is a limitation, not a pass.
4. Obtain approval for the fix plan before changing product code unless the requested scope and fix are already
   explicitly authorized. Keep tests and changes within that scope.
5. Update the audit log with public-safe coverage and ruled-out results. Keep unfixed exploit details and probe output
   in the gitignored `.ai/security/` records described in the protocol.
6. Report results, limitations, and the actual delivery state. Commit, push, disclosure, and external workflow actions
   each require the applicable authorization; loading this skill grants none of those permissions.

## Verification and probe safety

Backend compilation and tests follow the repository's normal guidance and the current environment's actual limits. There
is no shared prohibition on local backend compilation. Check local instructions and available resources; document any
concrete constraint and use an approved alternative environment when necessary. Do not infer a local restriction from an
earlier audit machine or from historical records.

For live probes, use loopback devnet targets and throwaway data for writes. Before any probe or measurement, run
`direnv exec . bash .agents/skills/security-audit/scripts/probes/lib/preflight.sh 58001 58002` and verify the target and
network as required by the protocol. The [preflight script](scripts/probes/lib/preflight.sh) is executable support for
an explicitly requested audit, not a prerequisite for ordinary unit tests. Do not run probes merely to validate changes
to this skill.
