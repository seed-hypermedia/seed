import type {Params} from 'react-router'
import {loader as loaderFn, meta as metaFn} from './$'

export const loader = async ({
  params,
  request,
}: {
  params: Params
  request: Request
}) => {
  return await loaderFn({
    params,
    request,
  })
}

export {default} from './$'

export const meta = metaFn
