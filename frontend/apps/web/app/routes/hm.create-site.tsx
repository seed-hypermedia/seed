import {redirect, type LoaderFunctionArgs} from '@remix-run/node'

/** Pre-rename alias for `/hm/create-space`, kept so existing links still land. */
export function loader({request}: LoaderFunctionArgs) {
  const url = new URL(request.url)
  return redirect(`/hm/create-space${url.search}`, 301)
}
