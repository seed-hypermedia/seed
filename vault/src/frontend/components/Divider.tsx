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
      <div className="bg-border h-px flex-1" />
      {children && <span className="px-4">{children}</span>}
      <div className="bg-border h-px flex-1" />
    </div>
  )
}
