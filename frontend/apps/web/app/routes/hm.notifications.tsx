import {redirect} from '@remix-run/node'

/** Notifications now live in the site's Activity view. Keeps old links working by opening it on To you tab. */
export const loader = () => redirect('/:feed/to-you')
