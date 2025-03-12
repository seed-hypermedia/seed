import {SITE_BASE_URL} from '@shm/shared'

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
  console.log('@parseRequest', {
    protocol,
    hostname,
    port: url.port,
    SITE_BASE_URL,
  })
  return {
    hostname,
    origin: `${protocol}//${hostname}`,
    url,
    pathParts,
    method: request.method,
    headers: request.headers,
  }
}

export type ParsedRequest = ReturnType<typeof parseRequest>
