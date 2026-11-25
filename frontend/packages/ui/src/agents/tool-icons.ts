import {
  BookOpenText,
  Bot,
  Compass,
  Info,
  ListChecks,
  PackageCheck,
  PenLine,
  Route,
  Search,
  SquareTerminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/** Kind-keyed fallback icons. Every icon is distinct — a shared wrench says nothing about a row. */
const toolIcons: Record<string, LucideIcon> = {
  search: Search,
  read: BookOpenText,
  resolve: Route,
  navigate: Compass,
  write: PenLine,
  generic: Wrench,
  // Hidden-kind rows are the session's own bookkeeping (status, plan) — notes about the work,
  // not work.
  hidden: Info,
}

/**
 * Name-keyed icons for calls whose kind icon would say the wrong thing: delegation and code
 * execution are registered as "write" tools, but a pen tells the reader nothing about spawning a
 * child or running a script.
 */
const toolIconsByName: Record<string, LucideIcon> = {
  delegate: Bot,
  sub_session: Bot,
  run_workflow: Workflow,
  execute: SquareTerminal,
  execute_code: SquareTerminal,
  return_result: PackageCheck,
  status: Info,
  plan: ListChecks,
}

/** The icon for a tool, shared by thread rows and the composer's `/` tool commands. */
export function getToolIcon(name: string, kind?: string): LucideIcon {
  return toolIconsByName[name] ?? toolIcons[kind || 'generic'] ?? Wrench
}
