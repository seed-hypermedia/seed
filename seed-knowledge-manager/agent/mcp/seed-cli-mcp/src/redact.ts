/**
 * Redacts secret values from arbitrary strings. Built once at startup from
 * env-var values that look like secrets (tokens, API keys, mnemonics).
 *
 * Anything ≥ 8 characters that matches a known secret env var is replaced
 * with `***REDACTED***`. JSON / log output is post-processed through this
 * before being persisted, so the run dir never contains raw secrets.
 */

export type Redactor = (input: string) => string

const SECRET_ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TELEGRAM_TOKEN',
  'KM_MNEMONIC',
]

export function buildRedactor(env: NodeJS.ProcessEnv = process.env): Redactor {
  const needles: string[] = []
  for (const key of SECRET_ENV_KEYS) {
    const v = env[key]
    if (typeof v === 'string' && v.length >= 8) needles.push(v)
  }
  // Deduplicate and sort longest-first so substring matches don't break
  // longer secrets.
  const unique = Array.from(new Set(needles)).sort((a, b) => b.length - a.length)
  if (unique.length === 0) return (s) => s
  return (input) => {
    let out = input
    for (const n of unique) {
      if (n && out.includes(n)) {
        out = out.split(n).join('***REDACTED***')
      }
    }
    return out
  }
}
