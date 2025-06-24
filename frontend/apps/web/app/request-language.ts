export function getRequestPrefersLanguages(headers: Headers) {
  const acceptLangHeader = headers.get('Accept-Language')
  const acceptLangsFirstTerm = acceptLangHeader?.split(';')[0]
  const prefersLanguages = acceptLangsFirstTerm?.split(',') || []
  return prefersLanguages
}
