import {redirect} from '@remix-run/node'

/**
 * There is no agents index: agents are documents, found in the file browser of the space that
 * holds them. Old links to the list land on the site home.
 */
export const loader = () => redirect('/')
