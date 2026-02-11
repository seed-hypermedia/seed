interface DividerProps {
	/** Text to display in the divider. */
	children?: React.ReactNode
}

/**
 * Horizontal divider with optional centered text.
 */
export function Divider({ children }: DividerProps) {
	return (
		<div className="flex items-center my-6 text-muted-foreground text-sm">
			<div className="flex-1 h-px bg-border" />
			{children && <span className="px-4">{children}</span>}
			<div className="flex-1 h-px bg-border" />
		</div>
	)
}
