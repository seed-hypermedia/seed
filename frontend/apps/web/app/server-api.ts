import {ActionFunction, LoaderFunction} from 'react-router'
import {json} from '@/utils/json'
import type {Params} from 'react-router'
import {WEB_API_DISABLED, WEB_IS_GATEWAY} from '@shm/shared/constants'
import {cborDecode} from './api'
import {ParsedRequest, parseRequest} from './request'
import {withCors} from './utils/cors'

export class APIError extends Error {
  constructor(
    message: string,
    public status: number = 500,
  ) {
    super(message)
  }
}

export class NotFoundError extends APIError {
  constructor(message?: string) {
    super(message ?? 'Not found', 404)
  }
}

export class BadRequestError extends APIError {
  constructor(message?: string) {
    super(message ?? 'Bad request', 400)
  }
}

export function apiGetter<ResultType>(
  handler: (req: ParsedRequest) => ResultType,
) {
  const apiGet: LoaderFunction = async ({request}) => {
    const parsedRequest = parseRequest(request)
    try {
      if (WEB_API_DISABLED) {
        throw new APIError('API is disabled with SEED_API_ENABLED=false', 500)
      }
      if (!WEB_IS_GATEWAY) {
        throw new APIError('API only enabled when SEED_IS_GATEWAY=true', 500)
      }
      const result = await handler(parsedRequest)
      return withCors(json(result))
    } catch (e: unknown) {
      if (e instanceof APIError) {
        return withCors(json({error: e.message}, {status: e.status}))
      }
      return withCors(
        json(
          {error: e instanceof Error ? e.message : 'Unknown error'},
          {status: 500},
        ),
      )
    }
  }
  return apiGet
}

export function apiGetterWithParams<ResultType>(
  handler: (req: ParsedRequest, params: Params) => ResultType,
) {
  const apiGet: LoaderFunction = async ({request, params}) => {
    const parsedRequest = parseRequest(request)
    try {
      const result = await handler(parsedRequest, params)
      return withCors(json(result))
    } catch (e: unknown) {
      if (e instanceof APIError) {
        return withCors(json({error: e.message}, {status: e.status}))
      }
      return withCors(
        json(
          {error: e instanceof Error ? e.message : 'Unknown error'},
          {status: 500},
        ),
      )
    }
  }
  return apiGet
}

export function cborApiAction<RequestType, ResultType>(
  handler: (
    data: RequestType,
    other: ParsedRequest & {rawData: ArrayBuffer},
  ) => ResultType,
) {
  const apiAction: ActionFunction = async ({request}) => {
    const parsedRequest = parseRequest(request)
    try {
      if (WEB_API_DISABLED) {
        throw new APIError('API is disabled with SEED_API_ENABLED=false', 500)
      }
      if (!WEB_IS_GATEWAY) {
        throw new APIError('API only enabled when SEED_IS_GATEWAY=true', 500)
      }
      const cborData = await request.arrayBuffer()
      const data: RequestType = cborDecode(new Uint8Array(cborData))
      const result = await handler(data, {
        ...parsedRequest,
        rawData: cborData,
      })
      return withCors(json(result))
    } catch (e: unknown) {
      if (e instanceof APIError) {
        return withCors(json({error: e.message}, {status: e.status}))
      }
      return withCors(
        json(
          {error: e instanceof Error ? e.message : 'Unknown error'},
          {status: 500},
        ),
      )
    }
  }
  return apiAction
}
