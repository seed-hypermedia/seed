export function getenv(key: string): string | undefined {
  return process.env[key]
}
