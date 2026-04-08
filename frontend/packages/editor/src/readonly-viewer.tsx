import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useMemo} from 'react'
import {useBlockNote} from './blocknote'
import type {HMBlockSchema} from './schema'
import {hmBlockSchema} from './schema'
import {ReadOnlyBlockNoteView} from './readonly-blocknote-view'

export interface ReadOnlyViewerProps {
  blocks: HMBlockNode[]
  resourceId?: UnpackedHypermediaId
  textUnit?: number
  layoutUnit?: number
  className?: string
}

export function ReadOnlyViewer({blocks, textUnit, layoutUnit, className}: ReadOnlyViewerProps) {
  const initialContent = useMemo(() => {
    const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
    return editorBlocks.length > 0 ? editorBlocks : [{type: 'paragraph' as const, id: 'empty'}]
  }, [blocks])

  const editor = useBlockNote<HMBlockSchema>(
    {
      editable: false,
      renderType: 'viewer',
      blockSchema: hmBlockSchema,
      // @ts-expect-error - EditorBlock/PartialBlock type mismatch
      initialContent,
    },
    [initialContent],
  )

  return (
    <div
      style={
        {
          '--text-unit': `${textUnit ?? 18}px`,
          '--layout-unit': `${layoutUnit ?? 24}px`,
        } as React.CSSProperties
      }
      className={className}
    >
      <ReadOnlyBlockNoteView editor={editor}>
        <></>
      </ReadOnlyBlockNoteView>
    </div>
  )
}
