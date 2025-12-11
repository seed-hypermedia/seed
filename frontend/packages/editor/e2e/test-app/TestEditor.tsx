import '@/blocknote/core/style.css'
import '@/editor.css'
import { writeableStateStream } from '@shm/shared'
import { TooltipProvider } from '@shm/ui/tooltip'
import { useEffect, useState } from 'react'
import {
  BlockNoteView,
  SlashMenuPositioner,
  useBlockNote,
} from '../../src/blocknote'
import type { Block } from '../../src/blocknote/core/extensions/Blocks/api/blockTypes'
import type { HMBlockSchema } from '../../src/schema'
import { hmBlockSchema } from '../../src/schema'
import { getSlashMenuItems } from '../../src/slash-menu-items'

// Create a dummy gateway URL stream for testing
const [, gwUrl] = writeableStateStream<string | null>('https://hyper.media')

// Expose editor state for test assertions
declare global {
  interface Window {
    TEST_EDITOR: {
      editor: ReturnType<typeof useBlockNote<HMBlockSchema>> | null
      getBlocks: () => Block<HMBlockSchema>[]
      getSelection: () => ReturnType<
        ReturnType<typeof useBlockNote<HMBlockSchema>>['getSelection']
      >
      getSelectedText: () => string
      isEditable: () => boolean
      focus: () => void
    }
  }
}

export function TestEditor() {
  const [editorContent, setEditorContent] = useState<Block<HMBlockSchema>[]>([])

  const editor = useBlockNote<HMBlockSchema>({
    blockSchema: hmBlockSchema,
    getSlashMenuItems: getSlashMenuItems,
    onEditorContentChange: (e) => {
      setEditorContent(e.topLevelBlocks)
    },
    // Link extension options required for paste handler
    linkExtensionOptions: {
      gwUrl,
    } as any,
    initialContent: [
      {
        type: 'paragraph',
        content: [],
      },
    ],
  })

  // Expose editor instance globally for tests
  useEffect(() => {
    window.TEST_EDITOR = {
      editor,
      getBlocks: () => editor.topLevelBlocks,
      getSelection: () => editor.getSelection(),
      getSelectedText: () => editor.getSelectedText(),
      isEditable: () => editor.isEditable,
      focus: () => editor.focus(),
    }

    return () => {
      // @ts-expect-error - cleanup
      window.TEST_EDITOR = null
    }
  }, [editor])

  return (
    <TooltipProvider>
      <div className="test-harness" data-testid="editor-harness">
        <div className="test-info" data-testid="editor-info">
          <strong>Block count:</strong> {editorContent.length} |{' '}
          <strong>Editor ready:</strong> {editor.ready ? 'Yes' : 'No'}
        </div>
        <div data-testid="editor-container">
          <BlockNoteView editor={editor} theme="light">
            <SlashMenuPositioner editor={editor} />
          </BlockNoteView>
        </div>
      </div>
    </TooltipProvider>
  )
}
