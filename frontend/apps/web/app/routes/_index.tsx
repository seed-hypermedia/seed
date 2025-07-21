import {Params} from '@remix-run/react'
import {loader as loaderFn} from './$'

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
