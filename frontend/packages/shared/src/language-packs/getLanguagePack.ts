export async function getLanguagePack(language: string) {
  if (language === 'es') {
    return import('./es').then((m) => m.default)
  }
}
