import {grpcClient} from '@/client.server'
import {withCors} from '@/utils/cors'
import {wrapJSON} from '@/wrapping.server'
import {LoaderFunctionArgs} from '@remix-run/node'
import {HMRequest, HMRequestSchema} from '@shm/shared'
import {APIParams, APIRouter} from '@shm/shared/api'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {deserializeQueryString} from '@shm/shared/input-querystring'

// queryDaemon for handlers that need direct HTTP access (e.g., GetCID)
async function queryDaemon<T>(pathAndQuery: string): Promise<T> {
  const daemonHost = DAEMON_HTTP_URL
  const response = await fetch(`${daemonHost}${pathAndQuery}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

export async function loader({request, params}: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const pathParts = params['*']?.split('/') || []
  const key = pathParts[0]

  if (!key) {
    return withCors(new Response('Missing API key', {status: 400}))
  }

  // Get the API definition from the router
  const apiDefinition = APIRouter[key as HMRequest['key']]
  if (!apiDefinition) {
    return withCors(new Response(`Unknown API key: ${key}`, {status: 404}))
  }

  // Find the matching request schema
  const requestSchema = HMRequestSchema.options.find(
    (schema) => schema.shape.key.value === key,
  )

  if (!requestSchema) {
    return withCors(new Response(`No schema found for key: ${key}`, {status: 500}))
  }

  try {
    // Deserialize input from query string
    const apiParams = APIParams[key as HMRequest['key']]
    let input: any
    if (apiParams?.paramsToInput) {
      // Use custom param deserializer if available
      const params: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        params[key] = value
      })
      input = apiParams.paramsToInput(params)
    } else {
      input = deserializeQueryString(
        url.search,
        requestSchema.shape.input as any,
      )
    }

    // Execute the API handler (type assertion needed due to discriminated union)
    const output = await apiDefinition.getData(
      grpcClient,
      input as any,
      queryDaemon,
    )

    // Validate output with schema
    const validatedOutput = requestSchema.shape.output.parse(output)

    return withCors(wrapJSON(validatedOutput))
  } catch (error) {
    console.error('API error:', error)
    return withCors(
      new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        {status: 500, headers: {'Content-Type': 'application/json'}},
      ),
    )
  }
}
