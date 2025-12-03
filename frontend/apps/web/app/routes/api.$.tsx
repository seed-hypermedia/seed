import {grpcClient} from '@/client.server'
import {wrapJSON} from '@/wrapping.server'
import {LoaderFunctionArgs} from '@remix-run/node'
import {HMRequest, HMRequestSchema} from '@shm/shared'
import {APIParams, APIRouter} from '@shm/shared/api'
import {deserializeQueryString} from '@shm/shared/input-querystring'

export async function loader({request, params}: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const pathParts = params['*']?.split('/') || []
  const key = pathParts[0]

  if (!key) {
    return new Response('Missing API key', {status: 400})
  }

  // Get the API definition from the router
  const apiDefinition = APIRouter[key as HMRequest['key']]
  if (!apiDefinition) {
    return new Response(`Unknown API key: ${key}`, {status: 404})
  }

  // Find the matching request schema
  const requestSchema = HMRequestSchema.options.find(
    (schema) => schema.shape.key.value === key,
  )

  if (!requestSchema) {
    return new Response(`No schema found for key: ${key}`, {status: 500})
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
    const output = await apiDefinition.getData(grpcClient, input as any)

    // Validate output with schema
    const validatedOutput = requestSchema.shape.output.parse(output)

    return wrapJSON(validatedOutput)
  } catch (error) {
    console.error('API error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {status: 500, headers: {'Content-Type': 'application/json'}},
    )
  }
}
