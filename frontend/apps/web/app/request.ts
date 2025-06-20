export function parseRequest(request: Request) {
  const url = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const hostname = forwardedHost || url.hostname
  const protocol = forwardedProto
    ? `${forwardedProto}:`
    : url.protocol || 'http:'
  let pathParts = url.pathname.split('/').slice(1)
  if (pathParts.at(-1) === '') {
    pathParts = pathParts.slice(0, -1)
  }
  const acceptLangHeader = request.headers.get('Accept-Language')
  const acceptLangsFirstTerm = acceptLangHeader?.split(';')[0]
  const prefersLanguages = acceptLangsFirstTerm?.split(',') || []

  return {
    hostname,
    origin: `${protocol}//${hostname}${url.port ? `:${url.port}` : ''}`,
    url,
    pathParts,
    method: request.method,
    headers: request.headers,
    searchParams: url.searchParams,
    prefersLanguages,
  }
}

export type ParsedRequest = ReturnType<typeof parseRequest>
