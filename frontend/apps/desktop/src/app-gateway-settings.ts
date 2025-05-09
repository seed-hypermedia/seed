import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const GATEWAY_URL_KEY = 'GatewayUrl'
let gatewayUrl: string =
  (appStore.get(GATEWAY_URL_KEY) as string) || DEFAULT_GATEWAY_URL
function writeGatewayUrl(url: string) {
  gatewayUrl = url
  appStore.set(GATEWAY_URL_KEY, url)
}

const DependsType = z
  .literal('always')
  .or(z.literal('never'))
  .or(z.literal('ask'))
type Depends = z.infer<typeof DependsType>

const PUSH_ON_COPY_KEY = 'GatewayPushOnCopy'
let pushOnCopy: Depends =
  (appStore.get(PUSH_ON_COPY_KEY) as Depends) || 'always'
function writePushOnCopy(value: Depends) {
  pushOnCopy = value
  appStore.set(PUSH_ON_COPY_KEY, value)
}

const PUSH_ON_PUBLISH_KEY = 'GatewayPushOnPublish'
let pushOnPublish: Depends =
  (appStore.get(PUSH_ON_PUBLISH_KEY) as Depends) || 'always'
function writePushOnPublish(value: Depends) {
  pushOnPublish = value
  appStore.set(PUSH_ON_PUBLISH_KEY, value)
}

export const gatewaySettingsApi = t.router({
  getGatewayUrl: t.procedure.query(async () => {
    return gatewayUrl
  }),
  setGatewayUrl: t.procedure
    .input(z.string())
    .mutation(async ({input = DEFAULT_GATEWAY_URL}) => {
      return writeGatewayUrl(input)
    }),

  getPushOnCopy: t.procedure.query(async () => {
    return pushOnCopy
  }),
  setPushOnCopy: t.procedure.input(DependsType).mutation(async ({input}) => {
    return writePushOnCopy(input)
  }),

  getPushOnPublish: t.procedure.query(async () => {
    return pushOnPublish
  }),
  setPushOnPublish: t.procedure.input(DependsType).mutation(async ({input}) => {
    return writePushOnPublish(input)
  }),
})
