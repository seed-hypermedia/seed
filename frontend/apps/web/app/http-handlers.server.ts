import {loader as apiLoader, action as apiAction} from './routes/api.$'
import {action as authAction} from './routes/hm.api.auth'
import {loader as configLoader} from './routes/hm.api.config'

/** Handles framework-neutral HTTP API routes used by the TanStack Router web app. */
export async function handleWebApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url)

  if (url.pathname === '/hm/api/config') {
    return configLoader({request} as any) as Promise<Response>
  }

  if (url.pathname === '/hm/api/auth') {
    return authAction({request} as any) as Promise<Response>
  }

  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return apiLoader({request} as any) as Promise<Response>
    }
    return apiAction({request, params: {'*': url.pathname.slice('/api/'.length)}} as any) as Promise<Response>
  }

  return null
}
