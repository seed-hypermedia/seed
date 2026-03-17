#!/usr/bin/env bun
/**
 * Seed CLI - Command-line interface for Seed Hypermedia
 */

import {Command} from 'commander'
import {createSeedClient} from '@seed-hypermedia/client'
import {formatOutput, printError, printSuccess} from './output'
import {loadConfig, setConfigValue, getConfigValue} from './config'
import type {OutputFormat} from './output'

// Commands
import {registerDocumentCommands} from './commands/document'
import {registerCommentCommands} from './commands/comment'
import {registerCapabilityCommands} from './commands/capability'
import {registerContactCommands} from './commands/contact'
import {registerAccountCommands} from './commands/account'
import {registerSearchCommand} from './commands/search'
import {registerQueryCommands} from './commands/query'
import {registerKeyCommands} from './commands/key'
import {registerDraftCommands} from './commands/draft'

const program = new Command()

program
  .name('seed-cli')
  .description('CLI for Seed Hypermedia')
  .version('0.1.1')
  .option('-s, --server <url>', 'Server URL (default: https://hyper.media)')
  .option('--md', 'Markdown output (default)')
  .option('--json', 'JSON output')
  .option('--yaml', 'YAML output')
  .option('--pretty', 'Beautify output (colorized JSON/YAML, rendered markdown)')
  .option('-q, --quiet', 'Minimal output')
  .option('--dev', 'Use development environment (alias for --server https://dev.hyper.media + dev keyring)')

// Validate that --dev and --server are not used together. They target separate isolated networks
// and combining them is always a mistake.
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals()
  if (opts.dev && opts.server) {
    printError(
      'Cannot use --dev and --server together. --dev implies --server https://dev.hyper.media. Use one or the other.',
    )
    process.exit(1)
  }
})

/** Returns the output format from CLI options. */
export function getOutputFormat(options: Record<string, unknown>): OutputFormat {
  if (options.yaml) return 'yaml'
  return 'json'
}

/** Returns true if --pretty was passed. */
export function isPretty(options: Record<string, unknown>): boolean {
  return !!options.pretty
}

/**
 * Resolves the server URL from CLI options, config, and environment.
 *
 * Resolution order:
 * 1. --dev flag → https://dev.hyper.media (conflicts with --server)
 * 2. --server flag → explicit URL
 * 3. SEED_SERVER env var
 * 4. Config file server value
 * 5. Default: https://hyper.media
 *
 * Bare domains (no scheme) are automatically prepended with https://.
 */
export function getServerUrl(options: Record<string, unknown>): string {
  const explicitServer = options.server as string | undefined
  const dev = !!options.dev

  let server: string
  if (dev) {
    server = 'https://dev.hyper.media'
  } else if (explicitServer) {
    server = explicitServer
  } else {
    server = process.env.SEED_SERVER || getConfigValue('server') || 'https://hyper.media'
  }

  // Normalize: prepend https:// for bare domains
  if (!server.startsWith('http://') && !server.startsWith('https://')) {
    server = `https://${server}`
  }

  return server.replace(/\/+$/, '')
}

/** Creates a Seed API client configured with the resolved server URL. */
export function getClient(options: Record<string, unknown>) {
  return createSeedClient(getServerUrl(options))
}

// Register command groups
registerDocumentCommands(program)
registerCommentCommands(program)
registerCapabilityCommands(program)
registerContactCommands(program)
registerAccountCommands(program)
registerKeyCommands(program)
registerDraftCommands(program)

// Register top-level commands
registerSearchCommand(program)
registerQueryCommands(program)

// Config command
program
  .command('config')
  .description('Manage CLI configuration')
  .option('--server <url>', 'Set default server URL')
  .option('--show', 'Show current configuration')
  .action((options, cmd) => {
    const globalOpts = cmd.optsWithGlobals()
    if (options.show) {
      const config = loadConfig()
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)
      console.log(formatOutput(config, format, pretty))
      return
    }

    if (options.server) {
      setConfigValue('server', options.server)
      if (!globalOpts.quiet) printSuccess(`Server set to ${options.server}`)
    }
  })

// Parse and run
program.parse()
