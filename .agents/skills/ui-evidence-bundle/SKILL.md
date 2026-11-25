# UI evidence bundle

Use this skill after a deterministic UI acceptance run to preserve a small, inspectable record after large CI artifacts expire.

## Contract

1. Stage only the evidence files safe to preserve publicly.
2. Write a JSON spec with exact repository, issue, 40-character source SHA, surface, scenario, verdict, checks, files, and optional exact-desktop `build` provenance.
3. Run `python .agents/skills/ui-evidence-bundle/scripts/ui-evidence-bundle.py create SPEC OUTPUT.zip`.
4. Publish selected files or the bundle to content-addressed storage separately, then record their `ipfs://` or HTTPS URLs in the spec. This tool never handles credentials or publishes content.
5. Before citing a bundle, run `... verify OUTPUT.zip` and preserve the printed bundle SHA-256.

The byte-stable ZIP uses fixed metadata and stored members; verify with `--expected-source-sha SHA` when consuming evidence from another party. It contains canonical `manifest.json`, derived `summary.md`, and only explicitly staged evidence. Verification rejects source mismatches, dangling references, unsafe paths, undeclared members, and changed bytes. A valid bundle proves integrity and internal source consistency; it does not prove the acceptance assertion was well designed.

See `references/ui-evidence-bundle.schema.json` for the input shape. For packaged Electron, copy the provenance fields from an `exact-desktop-artifact acquire` result and set `build.sourceSha` to the same exact source SHA.
