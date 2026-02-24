import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core"
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import * as blobs from "@shm/shared/blobs"
import { Check, Copy, GripVertical, Link, Monitor, Plus, Settings, Smartphone, Tablet, User } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { CreateAccountDialog } from "@/frontend/components/CreateAccountDialog"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Button } from "@/frontend/components/ui/button"
import { Separator } from "@/frontend/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/frontend/components/ui/tooltip"
import { useActions, useAppState } from "@/frontend/store"
import type * as vault from "@/frontend/vault"

/**
 * Main vault view displaying an identity wallet with account management.
 * Uses a two-panel layout: sidebar with account list, main panel with account details.
 * Vault-level settings (credentials, email) live in a separate SettingsView.
 */
export function VaultView() {
	const { vaultData, selectedAccountIndex, error } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	const accounts = vaultData?.accounts ?? []
	const hasAccounts = accounts.length > 0
	const selectedAccount = actions.getSelectedAccount()

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 5,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (over && active.id !== over.id) {
			actions.reorderAccount(active.id as string, over.id as string)
		}
	}

	if (!hasAccounts) {
		return (
			<>
				<ErrorMessage message={error} />
				<EmptyState />
				<CreateAccountDialog />
			</>
		)
	}

	return (
		<>
			<ErrorMessage message={error} />
			<div className="flex min-h-[480px] rounded-xl border bg-card overflow-hidden">
				{/* Left sidebar */}
				<div className="w-[280px] shrink-0 border-r flex flex-col">
					<div className="p-4 border-b flex items-center justify-between">
						<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Accounts</h2>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="ghost" size="icon-xs" onClick={() => navigate("/settings")}>
										<Settings className="size-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Vault Settings</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</div>
					<div className="flex-1 overflow-y-auto">
						<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
							<SortableContext
								items={accounts.map((a) => blobs.principalToString(a.profile.decoded.signer))}
								strategy={verticalListSortingStrategy}
							>
								{accounts.map((account, index) => {
									const principal = blobs.principalToString(account.profile.decoded.signer)
									const isSelected = index === selectedAccountIndex
									return (
										<SortableAccountItem
											key={principal}
											id={principal}
											account={account as unknown as vault.Account}
											isSelected={isSelected}
											onSelect={() => actions.selectAccount(index)}
										/>
									)
								})}
							</SortableContext>
						</DndContext>
					</div>
					<div className="p-3 border-t">
						<Button variant="outline" className="w-full" size="sm" onClick={() => actions.setCreatingAccount(true)}>
							<Plus className="size-4" />
							Create Account
						</Button>
					</div>
				</div>

				{/* Right panel */}
				<div className="flex-1 overflow-y-auto">
					{selectedAccount ? (
						<AccountDetails account={selectedAccount as unknown as vault.Account} />
					) : (
						<div className="h-full flex items-center justify-center text-muted-foreground">
							<p>Select an account to view details</p>
						</div>
					)}
				</div>
			</div>
			<CreateAccountDialog />
		</>
	)
}

function EmptyState() {
	const actions = useActions()

	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
				<User className="size-8 text-primary" />
			</div>
			<h2 className="text-xl font-semibold mb-2">No accounts yet</h2>
			<p className="text-muted-foreground mb-6 max-w-sm">
				Create your first Hypermedia identity account to get started.
			</p>
			<Button size="lg" onClick={() => actions.setCreatingAccount(true)}>
				<Plus className="size-4" />
				Create your first Hypermedia Account
			</Button>
		</div>
	)
}

function SortableAccountItem({
	id,
	account,
	isSelected,
	onSelect,
}: {
	id: string
	account: vault.Account
	isSelected: boolean
	onSelect: () => void
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

	const name = account.profile.decoded.name || "Unnamed"
	const Component = account.profile.decoded.alias ? Link : User

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
		position: "relative" as const,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`w-full text-left px-2 py-3 flex items-center gap-2 transition-colors ${
				isSelected ? "bg-accent" : "hover:bg-muted/50"
			}`}
		>
			<div
				{...attributes}
				{...listeners}
				className="cursor-grab hover:bg-black/5 active:cursor-grabbing p-1.5 rounded text-muted-foreground shrink-0"
			>
				<GripVertical className="size-4" />
			</div>
			<button type="button" className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={onSelect}>
				<div className="size-6 shrink-0 bg-muted rounded-full flex items-center justify-center overflow-hidden">
					{account.profile.decoded.avatar ? (
						<img src={account.profile.decoded.avatar} className="size-full object-cover" alt="" />
					) : (
						<Component className="size-3 text-muted-foreground" />
					)}
				</div>
				<div className="min-w-0 flex-1 text-left">
					<div className="text-sm font-medium truncate">{name}</div>
					<div className="text-xs text-muted-foreground font-mono truncate">{id.slice(0, 16)}…</div>
				</div>
			</button>
		</div>
	)
}

/** Account profile detail panel. Only shows identity information, not vault credentials. */
function AccountDetails({ account }: { account: vault.Account }) {
	const principal = blobs.principalToString(account.profile.decoded.signer)
	const [copied, setCopied] = useState(false)

	async function copyPrincipal() {
		try {
			await navigator.clipboard.writeText(principal)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			// Clipboard API may not be available
		}
	}

	return (
		<div className="p-6 space-y-6">
			{/* Profile header */}
			<div className="flex items-start gap-4">
				<div className="size-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
					<User className="size-7 text-primary" />
				</div>
				<div className="min-w-0 flex-1">
					<h1 className="text-2xl font-semibold">{account.profile.decoded.name || "Unnamed"}</h1>
					<div className="mt-1 flex items-center gap-2">
						<code className="text-sm text-muted-foreground font-mono truncate">{principal}</code>
						<Button variant="ghost" size="icon-xs" onClick={copyPrincipal} title="Copy principal">
							{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
						</Button>
					</div>
				</div>
			</div>

			<Separator />

			{/* Profile details */}
			<div className="space-y-4">
				{account.profile.decoded.description && (
					<div>
						<h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
						<p className="text-sm">{account.profile.decoded.description}</p>
					</div>
				)}

				{account.profile.decoded.avatar && (
					<div>
						<h3 className="text-sm font-medium text-muted-foreground mb-1">Avatar</h3>
						<p className="text-sm font-mono break-all">{account.profile.decoded.avatar}</p>
					</div>
				)}

				<div>
					<h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
					<p className="text-sm">
						{new Date(account.createTime).toLocaleDateString(undefined, {
							year: "numeric",
							month: "long",
							day: "numeric",
							hour: "2-digit",
							minute: "2-digit",
						})}
					</p>
				</div>
			</div>

			<AuthorizedSessionsList account={account} />

			<Separator />

			<div>
				<DeleteAccountButton principal={principal} />
			</div>
		</div>
	)
}

function AuthorizedSessionsList({ account }: { account: vault.Account }) {
	const sessions = account.delegations || []

	if (sessions.length === 0) {
		return null
	}

	return (
		<>
			<Separator />
			<div>
				<h3 className="text-sm font-medium mb-4">Authorized Sessions</h3>
				<div className="space-y-0 rounded-md border text-sm">
					{sessions.map((session, index) => {
						const delegatePrincipal = blobs.principalToString(session.capability.decoded.delegate)
						const key = `${session.clientId}:${delegatePrincipal}`

						const isLast = index === sessions.length - 1

						// Determine Device Icon
						let DeviceIcon = Monitor
						if (session.deviceType === "mobile") DeviceIcon = Smartphone
						if (session.deviceType === "tablet") DeviceIcon = Tablet

						return (
							<div
								key={key}
								className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 ${
									!isLast ? "border-b" : ""
								}`}
							>
								<div className="flex items-start gap-4 flex-1 min-w-0">
									<div className="mt-1">
										<DeviceIcon className="size-6 text-muted-foreground" strokeWidth={1.5} />
									</div>
									<div className="min-w-0">
										<div className="font-semibold text-base truncate">{session.clientId}</div>
										<div className="text-muted-foreground mt-1 space-y-1">
											<div className="text-[13px]">
												{new Date(session.createTime).toLocaleString(undefined, {
													year: "numeric",
													month: "short",
													day: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												})}
											</div>
											<div className="text-xs font-mono cursor-help truncate">{delegatePrincipal}</div>
										</div>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</div>
		</>
	)
}

function DeleteAccountButton({ principal }: { principal: string }) {
	const actions = useActions()
	const { loading } = useAppState()
	const [confirming, setConfirming] = useState(false)

	async function handleDelete() {
		if (confirming) {
			await actions.deleteAccount(principal)
		} else {
			setConfirming(true)
			// Reset confirmation after 3 seconds
			setTimeout(() => {
				setConfirming(false)
			}, 3000)
		}
	}

	return (
		<Button
			variant={confirming ? "destructive" : "outline"}
			className={
				confirming
					? "w-full sm:w-auto"
					: "w-full sm:w-auto text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
			}
			onClick={handleDelete}
			disabled={loading}
		>
			{confirming ? "Confirm Delete Account?" : "Delete Account"}
		</Button>
	)
}
