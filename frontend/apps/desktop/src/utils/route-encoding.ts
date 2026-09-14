import {NavRoute} from '@shm/shared/routes'
import {Buffer} from 'buffer'

export function encodeRouteToPath(route: NavRoute): string {
  return `/${Buffer.from(JSON.stringify(route))
    .toString('base64')
    // @ts-expect-error
    .replaceAll('=', '-')
    .replaceAll('+', '_')}`
}

export function decodeRouteFromPath(initRoute: string): NavRoute {
  return JSON.parse(
    Buffer.from(
      // @ts-expect-error
      initRoute.replaceAll('_', '+').replaceAll('-', '='),
      'base64',
    ).toString('utf8'),
  )
}
