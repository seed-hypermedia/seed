import {NavRoute} from '@shm/shared/routes'

export type WindowTypeInfo = {
  key: 'settings' | 'comment' | 'main' | 'deleted-content'
  minWidth: number
  minHeight: number
  maxWidth: number | undefined
  maxHeight: number | undefined
  initWidth?: number | undefined
  initHeight?: number | undefined
  trafficLightPosition?: {
    x: number
    y: number
  }
}

export function getRouteWindowType(route: NavRoute): WindowTypeInfo {
  if (route.key === 'deleted-content')
    return {
      key: 'deleted-content',
      minWidth: 960,
      minHeight: 720,
      maxWidth: undefined,
      maxHeight: undefined,
      trafficLightPosition: {
        x: 12,
        y: 12,
      },
    } as const
  if (route.key === 'settings')
    return {
      key: 'settings',
      minWidth: 960,
      minHeight: 720,
      maxWidth: undefined,
      maxHeight: undefined,
    } as const
  return {
    key: 'main',
    initWidth: 1280,
    initHeight: 960,
    minWidth: 600,
    minHeight: 400,
    maxWidth: undefined,
    maxHeight: undefined,
    trafficLightPosition: {
      x: 12,
      y: 12,
    },
  } as const
}

export type WindowType = ReturnType<typeof getRouteWindowType>['key']

export function getWindowType() {
  if (window.windowType) return window.windowType.key as WindowType
  return 'main'
}
