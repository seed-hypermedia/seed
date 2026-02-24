import {Node} from '@tiptap/core'
export {BlockNode} from './nodes/BlockNode'
export {BlockChildren} from './nodes/BlockChildren'
export const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'blockChildren',
})
