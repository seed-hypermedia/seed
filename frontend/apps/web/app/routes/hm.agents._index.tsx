import {redirect} from '@remix-run/node'

/**
 * There is no agents index: agents are documents, found in the file browser of the space that
 * holds them. Old links to the list land on the site home. This is an index route, not a layout:
 * a `hm.agents.tsx` layout would run this redirect for every agent, session and run page under
 * `hm.agents.$.tsx` too.
 */
export const loader = () => redirect('/')
