import { useState } from "react"
import { Button } from "@/frontend/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/frontend/components/ui/dialog"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { useActions, useAppState } from "@/frontend/store"

/** Dialog for creating a new Hypermedia account. */
export function CreateAccountDialog() {
	const { creatingAccount, loading } = useAppState()
	const actions = useActions()
	const [name, setName] = useState("")
	const [description, setDescription] = useState("")
	const [nameError, setNameError] = useState("")

	function handleOpenChange(open: boolean) {
		actions.setCreatingAccount(open)
		if (!open) {
			setName("")
			setDescription("")
			setNameError("")
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		const trimmed = name.trim()
		if (!trimmed) {
			setNameError("Name is required")
			return
		}
		setNameError("")
		await actions.createAccount(trimmed, description.trim() || undefined)
	}

	return (
		<Dialog open={creatingAccount} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Create Account</DialogTitle>
						<DialogDescription>Create a new Hypermedia identity account.</DialogDescription>
					</DialogHeader>

					<div className="mt-4 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="account-name">Name</Label>
							<Input
								id="account-name"
								value={name}
								onChange={(e) => {
									setName(e.target.value)
									if (nameError) setNameError("")
								}}
								placeholder="Display name"
								autoFocus
								disabled={loading}
							/>
							{nameError && <p className="text-sm text-destructive">{nameError}</p>}
						</div>

						<div className="space-y-2">
							<Label htmlFor="account-description">Description (optional)</Label>
							<Textarea
								id="account-description"
								value={description}
								onChange={(e) => setDescription(e.target.value.slice(0, 512))}
								placeholder="A short bio or description"
								className="min-h-[80px] resize-none"
								disabled={loading}
							/>
							<p className="text-xs text-muted-foreground text-right">{description.length}/512</p>
						</div>
					</div>

					<DialogFooter className="mt-6">
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
							Cancel
						</Button>
						<Button type="submit" loading={loading}>
							Create Account
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
