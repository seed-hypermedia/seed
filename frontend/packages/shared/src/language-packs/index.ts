import es from './es'

export const languagePacks = {
  es,
}

export type SupportedLanguage = keyof typeof languagePacks

export function supportedLanguages(
  prefersLanguages?: string[],
): (keyof typeof languagePacks)[] {
  return (prefersLanguages?.filter((language) => language in languagePacks) ??
    []) as (keyof typeof languagePacks)[]
}
