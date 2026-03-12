#!/usr/bin/env bun
/**
 * Seed CLI - Command-line interface for Seed Hypermedia
 */

import {Command} from 'commander'
import {createSeedClient} from '@seed-hypermedia/client'
import {formatOutput, printError, printSuccess, printInfo} from './output'
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

const program = new Command()

program
  .name('seed-cli')
  .description('CLI for Seed Hypermedia')
  .version('0.1.1')
  .option('-s, --server <url>', 'Server URL', process.env.SEED_SERVER || 'https://hyper.media')
  .option('--json', 'JSON output (default)')
  .option('--yaml', 'YAML output')
  .option('--pretty', 'Beautify output (colorized JSON/YAML, clean markdown)')
  .option('-q, --quiet', 'Minimal output')
  .option('--dev', 'Use development environment (seed-daemon-dev keyring)')

// Helper to get output format from options
export function getOutputFormat(options: Record<string, unknown>): OutputFormat {
  if (options.yaml) return 'yaml'
  return 'json'
}

// Helper to check if pretty mode is active
export function isPretty(options: Record<string, unknown>): boolean {
  return !!options.pretty
}

// Helper to create client from options
export function getClient(options: Record<string, unknown>) {
  const server = (options.server as string) || getConfigValue('server') || 'https://hyper.media'
  return createSeedClient(server)
}

// Register command groups
registerDocumentCommands(program)
registerCommentCommands(program)
registerCapabilityCommands(program)
registerContactCommands(program)
registerAccountCommands(program)
registerKeyCommands(program)

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
