#!/usr/bin/env node

/**
 * Relay CLI - E2EE remote coding relay
 *
 * Stripped entry point: authenticate, then run Claude in remote-only mode.
 * No subcommands, no daemon, no local mode.
 */

import { authAndSetupMachineIfNeeded } from './ui/auth';
import { runClaude, StartOptions } from './claude/runClaude';
import { logger } from './ui/logger';

async function main() {
    const args = process.argv.slice(2);

    // Parse simple flags
    let model: string | undefined;
    let permissionMode: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--model' && i + 1 < args.length) {
            model = args[++i];
        } else if (args[i] === '--permission-mode' && i + 1 < args.length) {
            permissionMode = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
consortium-cli - Encrypted Remote AI Coding Relay

Usage: consortium-cli [options]

Options:
  --model <model>             Claude model to use
  --permission-mode <mode>    Permission mode (default, acceptEdits, bypassPermissions, plan)
  --help, -h                  Show this help message

Environment:
  CONSORTIUM_SERVER_URL       Server URL (default: https://api.consortium.dev)
  CONSORTIUM_HOME_DIR         Data directory (default: ~/.consortium)
  CONSORTIUM_CLAUDE_PATH      Path to Claude Code executable
  DEBUG                       Enable debug logging
`);
            process.exit(0);
        }
    }

    try {
        // Authenticate
        const { credentials, machineId } = await authAndSetupMachineIfNeeded();

        // Build options
        const options: StartOptions = {
            model,
            permissionMode: permissionMode as any,
        };

        // Run Claude in relay mode
        await runClaude(credentials, machineId, options);
    } catch (error) {
        logger.debug('[MAIN] Fatal error:', error);
        console.error('Fatal error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main();
