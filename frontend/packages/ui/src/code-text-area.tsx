import * as React from 'react'
import {Textarea} from './components/textarea'
import {cn} from './utils'

/**
 * Source code in a plain monospace text area: agent memory files, trigger scripts and app tools
 * all edit code this way. `bare` drops the field chrome for a full-height editor pane.
 */
export const CodeTextArea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'> & {bare?: boolean}>(
  function CodeTextArea({className, bare, ...props}, ref) {
    const shared = {
      ref,
      spellCheck: false,
      autoCapitalize: 'off',
      autoCorrect: 'off',
      ...props,
    }
    if (bare)
      return (
        <textarea
          {...shared}
          className={cn(
            'focus:ring-primary/25 min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm outline-none focus:ring-2',
            className,
          )}
        />
      )
    return <Textarea {...shared} className={cn('font-mono text-xs', className)} />
  },
)
