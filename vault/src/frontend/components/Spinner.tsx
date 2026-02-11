interface SpinnerProps {
	/** Size of the spinner. Defaults to "md". */
	size?: "sm" | "md" | "lg"
	/** Additional CSS classes. */
	className?: string
}

const sizeClasses = {
	sm: "size-5 border-2",
	md: "size-8 border-3",
	lg: "size-10 border-4",
}

/**
 * Animated loading spinner component.
 */
export function Spinner({ size = "md", className = "" }: SpinnerProps) {
	return (
		<output aria-label="Loading">
			<div
				className={`animate-spin rounded-full border-transparent border-t-primary ${sizeClasses[size]} ${className}`}
			/>
		</output>
	)
}
