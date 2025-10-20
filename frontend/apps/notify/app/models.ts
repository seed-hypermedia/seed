import {unwrap} from './wrapping'

export async function queryAPI<ResponsePayloadType>(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  const fullData = await response.json()
  const data = unwrap<ResponsePayloadType>(fullData)
  return data
}
