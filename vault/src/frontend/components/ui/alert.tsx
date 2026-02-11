import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/frontend/utils"

const alertVariants = cva(
	"relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
	{
		variants: {
			variant: {
				default: "bg-card text-card-foreground",
				destructive:
					"text-destructive bg-card [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90",
				info: "text-blue-600 border-blue-600/50 dark:text-blue-400 dark:border-blue-400/50 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400",
				success:
					"text-green-600 border-green-600/50 dark:text-green-400 dark:border-green-400/50 [&>svg]:text-green-600 dark:[&>svg]:text-green-400",
				warning:
					"text-yellow-600 border-yellow-600/50 dark:text-yellow-400 dark:border-yellow-400/50 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-400",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
)

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-title"
			className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
			{...props}
		/>
	)
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
				className,
			)}
			{...props}
		/>
	)
}

export { Alert, AlertTitle, AlertDescription }
