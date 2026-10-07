interface DividerProps {
  /** Text to display in the divider. */
  children?: React.ReactNode
}

/**
 * Horizontal divider with optional centered text.
 */
export function Divider({children}: DividerProps) {
  return (
    <div className="text-muted-foreground my-6 flex items-center text-sm">
      <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
      {children && <span className="px-4">{children}</span>}
      <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
    </div>
  )
}
