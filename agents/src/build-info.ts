/**
 * Build/version metadata baked into the deployment image.
 *
 * Values are injected as environment variables by `agents/Dockerfile` from Docker
 * build args (set by the CI docker jobs and by `agents/scripts/build-and-push.sh`).
 * They are read at runtime so the same bundle works for local `bun dev` (where they
 * fall back to `dev`/`unknown`) and for built images, and are surfaced at
 * `/api/version` and inside `/api/health`.
 *
 * `commit`/`branch`/`date` mirror the daemon `/debug/version` and web `/hm/api/version`
 * shape; `version` (the image tag) is an agents-specific addition.
 */
export type BuildInfo = {
  /** Image tag / release version, e.g. `2026.6.10` or `dev`. */
  version: string
  /** Full git commit SHA the image was built from. */
  commit: string
  /** Git ref the image was built from. */
  branch: string
  /** Commit/build date. */
  date: string
}

export function getBuildInfo(): BuildInfo {
  return {
    version: process.env.SEED_AGENTS_VERSION || 'dev',
    commit: process.env.SEED_AGENTS_COMMIT || 'unknown',
    branch: process.env.SEED_AGENTS_BRANCH || 'unknown',
    date: process.env.SEED_AGENTS_DATE || 'unknown',
  }
}
