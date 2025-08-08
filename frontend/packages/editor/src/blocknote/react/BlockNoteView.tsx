import {BlockNoteEditor, BlockSchema, mergeCSSClasses} from '@/blocknote/core'
import {MantineProvider, createStyles} from '@mantine/core'
import {EditorContent} from '@tiptap/react'
import {HTMLAttributes, ReactNode, useEffect, useMemo, useState} from 'react'
import {Theme, blockNoteToMantineTheme} from './BlockNoteTheme'
import {darkDefaultTheme, lightDefaultTheme} from './defaultThemes'
import {FormattingToolbarPositioner} from './FormattingToolbar/components/FormattingToolbarPositioner'
import {HyperlinkToolbarPositioner} from './HyperlinkToolbar/components/HyperlinkToolbarPositioner'
import {LinkMenuPositioner} from './LinkMenu/components/LinkMenuPositioner'
import {SideMenuPositioner} from './SideMenu/components/SideMenuPositioner'
import {SlashMenuPositioner} from './SlashMenu/components/SlashMenuPositioner'

// Renders the editor as well as all menus & toolbars using default styles.
function BaseBlockNoteView<BSchema extends BlockSchema>(
  props: {
    editor: BlockNoteEditor<BSchema>
    children?: ReactNode
  } & HTMLAttributes<HTMLDivElement>,
) {
  const {classes} = createStyles({root: {}})(undefined, {
    name: 'Editor',
  })

  const {editor, children, className, ...rest} = props

  return (
    <EditorContent
      editor={props.editor?._tiptapEditor || null}
      className={mergeCSSClasses(classes.root, props.className || '')}
      {...rest}
    >
      {props.children || (
        <>
          <FormattingToolbarPositioner editor={props.editor} />
          // @ts-expect-error
          <HyperlinkToolbarPositioner
            editor={props.editor}
            openUrl={(url?: string, newWindow?: boolean) => {
              if (url) {
                if (newWindow) {
                  window.open(url, '_blank')
                } else {
                  window.location.href = url
                }
              }
            }}
          />
          <SlashMenuPositioner editor={props.editor} />
          <SideMenuPositioner editor={props.editor} />
          <LinkMenuPositioner editor={props.editor} />
        </>
      )}
    </EditorContent>
  )
}

export function BlockNoteView<BSchema extends BlockSchema>(
  props: {
    editor: BlockNoteEditor<BSchema>
    theme?:
      | 'light'
      | 'dark'
      | Theme
      | {
          light: Theme
          dark: Theme
        }
    children?: ReactNode
  } & HTMLAttributes<HTMLDivElement>,
) {
  const {theme = {light: lightDefaultTheme, dark: darkDefaultTheme}, ...rest} =
    props

  // Use state to track the current system theme
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
    // Initialize with the current system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })

  // Set up an effect to listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    // Update the theme when the system preference changes
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light')
    }

    // Add the event listener
    mediaQuery.addEventListener('change', handleChange)

    // Clean up the listener on component unmount
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  const mantineTheme = useMemo(() => {
    if (theme === 'light') {
      return blockNoteToMantineTheme(lightDefaultTheme)
    }

    if (theme === 'dark') {
      return blockNoteToMantineTheme(darkDefaultTheme)
    }

    if ('light' in theme && 'dark' in theme) {
      return blockNoteToMantineTheme(
        theme[systemTheme === 'dark' ? 'dark' : 'light'],
      )
    }

    return blockNoteToMantineTheme(theme)
  }, [systemTheme, theme])

  return (
    <MantineProvider theme={mantineTheme}>
      <BaseBlockNoteView {...rest} />
    </MantineProvider>
  )
}
