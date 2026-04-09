import type {ActionFunctionArgs, AppLoadContext, LoaderFunctionArgs} from '@remix-run/node'

/**
 * Builds minimal Remix loader args for route unit tests.
 */
export function createLoaderArgs(request: Request, params: LoaderFunctionArgs['params'] = {}): LoaderFunctionArgs {
  return {
    request,
    params,
    context: {} as AppLoadContext,
  }
}

/**
 * Builds minimal Remix action args for route unit tests.
 */
export function createActionArgs(request: Request, params: ActionFunctionArgs['params'] = {}): ActionFunctionArgs {
  return {
    request,
    params,
    context: {} as AppLoadContext,
  }
}

/**
 * Narrows a Remix data function result to a `Response` in route unit tests.
 */
export function asResponse(response: unknown): Response {
  return response as Response
}
