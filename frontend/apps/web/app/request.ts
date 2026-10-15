import {getRequestPrefersLanguages} from './request-language'

/** Resolve the public target authority before reading site configuration or building URLs. */
export function parseRequest(request: Request) {
  const url = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol || 'http:'
  // The Remix development adapter can construct request.url from the caller's
  // Origin header. Host still identifies the requested site; proxies take precedence.
  const authority = forwardedHost || request.headers.get('host') || url.host
  const target = new URL(`${protocol}//${authority}`)
  url.protocol = target.protocol
  url.hostname = target.hostname
  // Assign the port explicitly: setting URL.host alone can retain an internal port.
  url.port = target.port
  const hostname = url.hostname
  let pathParts = url.pathname.split('/').slice(1)
  if (pathParts.at(-1) === '') {
    pathParts = pathParts.slice(0, -1)
  }
  const prefersLanguages = getRequestPrefersLanguages(request.headers)
  return {
    hostname,
    origin: url.origin,
    url,
    pathParts,
    method: request.method,
    headers: request.headers,
    searchParams: url.searchParams,
    prefersLanguages,
  }
}

/** Public site URL and request metadata shared by web loaders and API handlers. */
export type ParsedRequest = ReturnType<typeof parseRequest>
