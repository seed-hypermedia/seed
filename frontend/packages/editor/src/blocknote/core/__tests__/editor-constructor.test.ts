import {describe, expect, it} from 'vitest'
import {BlockNoteEditor} from '../BlockNoteEditor'

/**
 * Phase 1 regression tests — BlockNoteEditor constructor.
 *
 * Validates:
 *  1. renderType defaults to 'document'
 *  2. renderType can be set to 'embed' or 'comment'
 *  3. editable defaults to true
 *  4. editable: false produces a non-editable editor
 *  5. enableInputRules/enablePasteRules are disabled when editable: false
 */
describe('BlockNoteEditor constructor (Phase 1)', () => {
  it('defaults renderType to "document"', () => {
    const editor = new BlockNoteEditor({})
    expect(editor.renderType).toBe('document')
    editor._tiptapEditor.destroy()
  })

  it('accepts renderType "embed"', () => {
    const editor = new BlockNoteEditor({renderType: 'embed'})
    expect(editor.renderType).toBe('embed')
    editor._tiptapEditor.destroy()
  })

  it('accepts renderType "comment"', () => {
    const editor = new BlockNoteEditor({renderType: 'comment'})
    expect(editor.renderType).toBe('comment')
    editor._tiptapEditor.destroy()
  })

  it('defaults to editable: true', () => {
    const editor = new BlockNoteEditor({})
    expect(editor.isEditable).toBe(true)
    editor._tiptapEditor.destroy()
  })

  it('respects editable: false', () => {
    const editor = new BlockNoteEditor({editable: false})
    expect(editor.isEditable).toBe(false)
    editor._tiptapEditor.destroy()
  })

  it('allows toggling isEditable at runtime', () => {
    const editor = new BlockNoteEditor({editable: true})
    expect(editor.isEditable).toBe(true)

    editor.isEditable = false
    expect(editor.isEditable).toBe(false)

    editor.isEditable = true
    expect(editor.isEditable).toBe(true)

    editor._tiptapEditor.destroy()
  })

  it('disables input rules when editable: false', () => {
    const editor = new BlockNoteEditor({editable: false})
    // TipTap stores enableInputRules on the options object
    expect(editor._tiptapEditor.options.enableInputRules).toBe(false)
    editor._tiptapEditor.destroy()
  })

  it('disables paste rules when editable: false', () => {
    const editor = new BlockNoteEditor({editable: false})
    expect(editor._tiptapEditor.options.enablePasteRules).toBe(false)
    editor._tiptapEditor.destroy()
  })

  it('enables input rules when editable: true', () => {
    const editor = new BlockNoteEditor({editable: true})
    expect(editor._tiptapEditor.options.enableInputRules).toBe(true)
    editor._tiptapEditor.destroy()
  })

  it('enables paste rules when editable: true', () => {
    const editor = new BlockNoteEditor({editable: true})
    expect(editor._tiptapEditor.options.enablePasteRules).toBe(true)
    editor._tiptapEditor.destroy()
  })
})
