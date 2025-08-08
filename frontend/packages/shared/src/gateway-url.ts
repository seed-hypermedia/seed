import {DEFAULT_GATEWAY_URL} from './constants'
import {writeableStateStream} from './utils'

// @ts-expect-error
const [setGatewayUrl, gatewayUrl] = writeableStateStream(DEFAULT_GATEWAY_URL)

export function useGatewayUrlStream() {
  return gatewayUrl
}
