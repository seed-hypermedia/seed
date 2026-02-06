import {Node} from '@tiptap/core'
export {BlockContainer} from './nodes/BlockContainer'
export {BlockGroup} from './nodes/BlockGroup'
export {ListContainer} from './nodes/ListContainer'
export {ListGroup} from './nodes/ListGroup'
export const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'blockGroup',
})
