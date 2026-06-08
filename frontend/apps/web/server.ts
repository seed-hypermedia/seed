import {handleWebApiRequest} from './app/http-handlers.server'

const dist = new URL('./dist/', import.meta.url)
const indexFile = Bun.file(new URL('index.html', dist))
const port = Number(process.env.PORT || 3000)

function contentType(pathname: string) {
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8'
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.ico')) return 'image/x-icon'
  if (pathname.endsWith('.woff2')) return 'font/woff2'
  if (pathname.endsWith('.woff')) return 'font/woff'
  if (pathname.endsWith('.ttf')) return 'font/ttf'
  return 'application/octet-stream'
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/healthz') {
      return new Response('ok', {headers: {'Content-Type': 'text/plain; charset=utf-8'}})
    }

    const apiResponse = await handleWebApiRequest(request)
    if (apiResponse) return apiResponse

    const assetPath = url.pathname === '/' ? null : url.pathname.slice(1)
    if (assetPath && !assetPath.includes('..')) {
      const file = Bun.file(new URL(assetPath, dist))
      if (await file.exists()) {
        return new Response(file, {headers: {'Content-Type': contentType(url.pathname)}})
      }
    }

    return new Response(indexFile, {headers: {'Content-Type': 'text/html; charset=utf-8'}})
  },
})

console.log(`Seed web TanStack Router app running on Bun at http://localhost:${port}`)
