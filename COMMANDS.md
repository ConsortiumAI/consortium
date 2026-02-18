<p align="center">
  <a href="https://consortium.dev">
    <img src="logo.png" width="100" alt="Consortium" />
  </a>
</p>

<h1 align="center">Consortium CLI — Command Reference</h1>

<p align="center">
  Complete reference for every command, subcommand, and flag available in the <code>consortium</code> CLI.
</p>

---

## Table of Contents

- [consortium](#consortium) — Start an AI coding session
- [consortium auth](#consortium-auth) — Authentication and credentials
- [consortium connect](#consortium-connect) — Connect AI vendor API keys
- [consortium codex](#consortium-codex) — Start a Codex (OpenAI) session
- [consortium gemini](#consortium-gemini) — Start a Gemini (Google) session
- [consortium daemon](#consortium-daemon) — Background service management
- [consortium doctor](#consortium-doctor) — Diagnostics and troubleshooting
- [consortium notify](#consortium-notify) — Send push notifications
- [Claude Code Passthrough Flags](#claude-code-passthrough-flags)

---

## `consortium`

Start an encrypted AI coding session with remote access from any device.

```bash
consortium [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--yolo` | Bypass all permission prompts (shorthand for `--dangerously-skip-permissions`) |
| `--pm` | Start as a Project Manager agent with session orchestration tools |
| `--chrome` | Enable Chrome browser access for this session |
| `--no-chrome` | Disable Chrome even if enabled by default |
| `--js-runtime <runtime>` | JavaScript runtime to use: `node` or `bun` (default: `node`) |
| `--claude-env <KEY=VALUE>` | Pass environment variables to Claude (e.g., `ANTHROPIC_BASE_URL=...`) |
| `--consortium-starting-mode <mode>` | Starting mode: `local` or `remote` |
| `--started-by <source>` | Who started this session: `daemon` or `terminal` |
| `-h`, `--help` | Show help and exit |
| `-v`, `--version` | Show version and exit |

### Examples

```bash
# Start a new session
consortium

# Start with all permissions auto-approved
consortium --yolo

# Start as a Project Manager orchestrating multiple sessions
consortium --pm

# Start with Chrome browser access enabled
consortium --chrome

# Pass a custom API base URL to Claude
consortium --claude-env ANTHROPIC_BASE_URL=https://my-proxy.example.com

# Resume your most recent session
consortium --continue

# Resume a specific session by ID
consortium --resume abc123
```

All unrecognised flags are passed directly to Claude Code. See [Claude Code Passthrough Flags](#claude-code-passthrough-flags) for the full list.

---

## `consortium auth`

Manage authentication, credentials, and machine registration.

```bash
consortium auth <subcommand>
```

### `consortium auth login`

Authenticate with Consortium and register this machine.

```bash
consortium auth login [--force]
```

| Flag | Description |
|------|-------------|
| `--force`, `-f` | Clear existing credentials, machine ID, and daemon state before re-authenticating |

On first run, a cryptographic identity (Ed25519 key pair) is generated locally. A QR code is displayed in the terminal for pairing with your Consortium account via the web dashboard. No passwords or email addresses are needed.

### `consortium auth provision`

Authenticate using a VPS provision configuration file.

```bash
consortium auth provision <config>
```

| Argument | Description |
|----------|-------------|
| `<config>` | Path to a provision configuration file |

Used for automated deployments on virtual private servers.

### `consortium auth logout`

Remove all authentication data and machine registration from this device.

```bash
consortium auth logout
```

Prompts for confirmation before clearing the Consortium home directory and stopping the daemon.

### `consortium auth status`

Show the current authentication and machine registration status.

```bash
consortium auth status
```

Displays:
- Authentication token (truncated preview)
- Machine ID
- Server host
- Daemon status
- Data directory path

### `consortium auth help`

```bash
consortium auth help
consortium auth --help
consortium auth -h
```

---

## `consortium connect`

Connect AI vendor API keys to Consortium's encrypted cloud storage so your sessions can use them across devices.

```bash
consortium connect <subcommand>
```

### `consortium connect codex`

Store your OpenAI API key.

```bash
consortium connect codex
```

Prompts for your OpenAI API key and stores it encrypted in Consortium's cloud.

### `consortium connect claude`

Store your Anthropic API key.

```bash
consortium connect claude
```

Prompts for your Anthropic API key and stores it encrypted in Consortium's cloud.

### `consortium connect gemini`

Store your Gemini API key.

```bash
consortium connect gemini
```

Prompts for your Gemini API key and stores it encrypted in Consortium's cloud.

### `consortium connect status`

Show the connection status for all AI vendors.

```bash
consortium connect status
```

Displays whether each vendor (OpenAI, Anthropic, Gemini) is connected, expired, or not configured.

### `consortium connect help`

```bash
consortium connect help
consortium connect --help
consortium connect -h
```

---

## `consortium codex`

Start a coding session using OpenAI's Codex model.

```bash
consortium codex [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--started-by <source>` | Who started this session: `daemon` or `terminal` |

Requires a connected OpenAI API key (see `consortium connect codex`).

---

## `consortium gemini`

Start a coding session using Google's Gemini model, or manage Gemini configuration.

```bash
consortium gemini [subcommand] [options]
```

### `consortium gemini` (no subcommand)

Start a Gemini coding session.

```bash
consortium gemini
```

| Flag | Description |
|------|-------------|
| `--started-by <source>` | Who started this session: `daemon` or `terminal` |

### `consortium gemini model set`

Set the Gemini model to use.

```bash
consortium gemini model set <model>
```

| Model | Description |
|-------|-------------|
| `gemini-2.5-pro` | Most capable model (default) |
| `gemini-2.5-flash` | Fast and efficient |
| `gemini-2.5-flash-lite` | Lightweight and fastest |

### `consortium gemini model get`

Show the currently configured Gemini model.

```bash
consortium gemini model get
```

Checks the config file, then the `GEMINI_MODEL` environment variable, and defaults to `gemini-2.5-pro`.

### `consortium gemini project set`

Set the Google Cloud Project ID (required for Google Workspace accounts).

```bash
consortium gemini project set <project-id>
```

| Argument | Description |
|----------|-------------|
| `<project-id>` | Your Google Cloud Project ID |

### `consortium gemini project get`

Show the currently configured Google Cloud Project ID.

```bash
consortium gemini project get
```

Checks the config file, then the `GOOGLE_CLOUD_PROJECT` environment variable.

### `consortium gemini project`

Show project configuration help and setup guide.

```bash
consortium gemini project
```

---

## `consortium daemon`

Manage the background daemon that enables spawning sessions from any device.

```bash
consortium daemon <subcommand>
```

### `consortium daemon start`

Start the daemon as a detached background process.

```bash
consortium daemon start
```

The daemon runs independently and survives terminal closure. It enables the web dashboard and mobile app to start and manage sessions on this machine.

### `consortium daemon stop`

Stop the running daemon.

```bash
consortium daemon stop
```

Active sessions remain alive after the daemon stops.

### `consortium daemon status`

Show the current daemon status.

```bash
consortium daemon status
```

### `consortium daemon list`

List all active sessions the daemon is aware of.

```bash
consortium daemon list
```

Outputs a JSON list of active sessions. Sessions started by older versions may not appear.

### `consortium daemon stop-session`

Stop a specific active session.

```bash
consortium daemon stop-session <session-id>
```

| Argument | Description |
|----------|-------------|
| `<session-id>` | The ID of the session to stop |

### `consortium daemon logs`

Print the path to the most recent daemon log file.

```bash
consortium daemon logs
```

### `consortium daemon install`

Install the daemon as a system service so it starts automatically on boot.

```bash
consortium daemon install
```

Platform-specific installation (macOS launchd, Linux systemd, etc.).

### `consortium daemon uninstall`

Remove the daemon system service.

```bash
consortium daemon uninstall
```

### `consortium daemon start-sync`

Start the daemon synchronously (internal use only).

```bash
consortium daemon start-sync
```

Used internally when the daemon is started by the CLI process itself.

---

## `consortium doctor`

Run system diagnostics or clean up stuck processes.

```bash
consortium doctor [subcommand]
```

### `consortium doctor` (no subcommand)

Run a full diagnostic check of your Consortium installation.

```bash
consortium doctor
```

Checks and reports on:
- Environment configuration
- Installed dependencies
- Authentication status
- Daemon health
- Network connectivity

### `consortium doctor clean`

Kill any runaway or stuck Consortium processes.

```bash
consortium doctor clean
```

Reports how many processes were found and terminated.

---

## `consortium notify`

Send a push notification to your paired mobile devices.

```bash
consortium notify -p <message> [-t <title>]
```

### Options

| Flag | Description |
|------|-------------|
| `-p <message>` | Notification message body (required) |
| `-t <title>` | Notification title (optional, defaults to "Consortium") |
| `-h`, `--help` | Show help |

### Examples

```bash
# Send a simple notification
consortium notify -p "Deployment complete!"

# Send with a custom title
consortium notify -p "Database backup finished" -t "Server Status"

# Alert with title
consortium notify -t "Alert" -p "Build failed on main branch"
```

Requires authentication (`consortium auth login`) and a paired mobile device.

---

## `consortium logout`

> **Deprecated.** Use `consortium auth logout` instead.

```bash
consortium logout
```

Displays a deprecation warning and forwards to `consortium auth logout`.

---

## Claude Code Passthrough Flags

The `consortium` CLI passes all unrecognised flags directly to Claude Code. These are the most commonly used:

| Flag | Description |
|------|-------------|
| `--model <model>` | Use a specific Claude model (e.g., `sonnet`, `opus`) |
| `--max-turns <n>` | Limit the number of agent turns |
| `--continue` | Resume the most recent session in the current directory |
| `--resume <id>` | Resume a specific session by ID |
| `--allowedTools <tools>` | Comma-separated list of tools Claude is allowed to use |
| `--disallowedTools <tools>` | Comma-separated list of tools Claude cannot use |
| `--permission-mode <mode>` | Permission mode: `default`, `acceptEdits`, `bypassPermissions`, `plan` |
| `--system-prompt <prompt>` | Override the system prompt |
| `--append-system-prompt <prompt>` | Append text to the default system prompt |
| `--mcp-config <json>` | MCP server configuration (JSON string) |
| `--dangerously-skip-permissions` | Skip all permission checks (use `--yolo` as shorthand) |
| `--output-format <format>` | Output format: `text`, `json`, `stream-json` |
| `--input-format <format>` | Input format: `text`, `stream-json` |
| `--verbose` | Enable verbose output |
| `--fallback-model <model>` | Fallback model if primary is unavailable |

For the complete list of Claude Code flags, see the [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code).

---

<p align="center">
  <br/>
  <a href="https://consortium.dev">
    <img src="logo.png" width="80" alt="Consortium" />
  </a>
  <br/><br/>
  <strong>Built by Consortium</strong><br/>
  <a href="https://consortium.dev">consortium.dev</a>
</p>
