import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import * as crypto from "@/frontend/crypto"

interface PasswordInputProps {
	id: string
	label: string
	value: string
	onChange: (value: string) => void
	autoComplete: string
	autoFocus?: boolean
	showStrength?: boolean
}

const strengthConfig: Record<number, string> = {
	0: "w-1/3 bg-destructive",
	1: "w-2/3 bg-brand-3",
	2: "w-full bg-brand-6",
}

/**
 * Password input with visibility toggle and optional strength meter.
 */
export function PasswordInput({ id, label, value, onChange, autoComplete, showStrength }: PasswordInputProps) {
	const [showPassword, setShowPassword] = useState(false)
	const strength = showStrength ? crypto.checkPasswordStrength(value) : 0

	return (
		<div className="mb-4 space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<div className="relative">
				<Input
					id={id}
					name={autoComplete === "new-password" ? "new-password" : "password"}
					type={showPassword ? "text" : "password"}
					className="pr-10"
					placeholder="Enter password"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					required
					autoComplete={autoComplete}
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="absolute right-0 top-0 h-full w-10 hover:bg-transparent"
					onClick={() => setShowPassword(!showPassword)}
					aria-label={showPassword ? "Hide password" : "Show password"}
					title={showPassword ? "Hide password" : "Show password"}
				>
					{showPassword ? (
						<EyeOff className="size-4 text-muted-foreground" />
					) : (
						<Eye className="size-4 text-muted-foreground" />
					)}
				</Button>
			</div>
			{showStrength && (
				<div className="h-1 rounded-sm bg-muted mt-2 overflow-hidden">
					<div className={`h-full transition-all duration-300 ${strengthConfig[strength]}`} />
				</div>
			)}
		</div>
	)
}
