---
name: exact-desktop-artifact
description: Build and verify an exact-source Linux desktop package on Ion's GitHub fork
---

# Exact desktop artifact

Use this when UI acceptance requires packaged Electron at an exact 40-character source SHA and local packaging is impractical.

```sh
python .agents/skills/exact-desktop-artifact/scripts/exact-desktop-artifact.py acquire \
  SOURCE_SHA ISSUE_NUMBER /safe/output/artifact.zip
```

The command creates or updates a dedicated workflow on `ion-lion/seed`, binds the run to the workflow commit, waits for success, downloads the uniquely named artifact, checks GitHub's digest when present, and verifies the embedded `ION-SOURCE-SHA.txt` plus a non-empty Linux installer. It prints a JSON evidence record with run URL, source SHA, artifact SHA-256, and local path.

The launcher reads `GITHUB_PAT` from `/workspace/ENV` and never prints it. Checkout credentials are not persisted into the source tree, and credentials are stripped before following GitHub's artifact redirect. `status`, `wait`, and `download` take `WORKFLOW_COMMIT SOURCE_SHA ISSUE_NUMBER` for resuming an interrupted acquisition.

Before changing the launcher, run:

```sh
python .agents/skills/exact-desktop-artifact/scripts/test_exact_desktop_artifact.py
```

Do not spend CI merely to test this harness. Exercise `acquire` on the next UI lane that actually needs an exact-source package.
