import type {LoaderFunctionArgs} from '@remix-run/node'

export async function loader({}: LoaderFunctionArgs) {
  const body = ['User-agent: *', 'Allow: /', ''].join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
