<p align="center">
  <a href="https://consortium.dev">
    <img src="logo.png" width="140" alt="Consortium" />
  </a>
</p>

<h1 align="center">Consortium</h1>

<p align="center">
  <strong>Secure, remote AI coding sessions — encrypted end-to-end.</strong>
</p>

<p align="center">
  Consortium lets you run AI-powered coding sessions on remote machines and interact with them<br/>
  from anywhere — your browser, your phone, or your tablet — without ever exposing your data to anyone in between.
</p>

<p align="center">
  <a href="https://consortium.dev"><strong>Start Using Consortium &rarr;</strong></a>
</p>

<p align="center">
  <a href="https://consortium.dev">Website</a> &nbsp;·&nbsp;
  <a href="#what-it-does">What It Does</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How It Works</a> &nbsp;·&nbsp;
  <a href="#cli-reference">CLI Reference</a> &nbsp;·&nbsp;
  <a href="#api-reference">API Reference</a> &nbsp;·&nbsp;
  <a href="#self-hosting">Self-Hosting</a> &nbsp;·&nbsp;
  <a href="#license">License</a>
</p>

---

## The Fastest Way to Get Started

The easiest way to use Consortium is with the **official hosted platform** at [**consortium.dev**](https://consortium.dev):

1. **Sign up** at [consortium.dev](https://consortium.dev) — we provide a free E2EE relay so you can get started instantly.
2. **Install the Consortium CLI** on any machine you want to connect:
   ```bash
   npm install -g consortium
   ```
3. **Run the CLI** and pair it with your account:
   ```bash
   consortium
   ```
4. **Open [consortium.dev](https://consortium.dev)** in your browser to view and control your sessions.

That's it. No servers to deploy, no databases to manage, no infrastructure to maintain. Consortium handles the relay — your data stays encrypted end-to-end.

---

## What It Does

[Consortium](https://consortium.dev) lets you run AI-powered coding sessions on remote machines and interact with them from anywhere — your browser, your phone, or your tablet — without ever exposing your data to anyone in between.

**The problem:** Claude Code is a powerful AI coding assistant, but it runs in a local terminal. If you want to start a session on a cloud server, a build machine, or a colleague's workstation, there's no built-in way to watch or control it remotely.

**The solution:** [Consortium](https://consortium.dev) connects your machines to a secure relay. You view and manage every session through a clean interface. All communication is end-to-end encrypted — the relay only passes along data it cannot read.

### Key capabilities

- **Remote access** — Start a Claude Code session on any machine and interact with it from your browser, phone, or tablet.
- **End-to-end encryption** — Messages, session metadata, and agent state are encrypted on-device with AES-256-GCM before transmission. The server stores only opaque encrypted blobs it cannot decrypt.
- **Real-time streaming** — See Claude's responses, tool usage, and thinking process as they happen via WebSocket connections.
- **Zero-password authentication** — Identity is based on public-key cryptography (Ed25519). No passwords, no OAuth providers, no email addresses. You hold your key; that's your identity.
- **Session management** — View all active and past sessions, send follow-up prompts, abort running tasks, and manage machines from a single dashboard.
- **Self-hostable** — This repo contains everything you need to run the entire stack on your own infrastructure.

<p align="center">
  <a href="https://consortium.dev"><strong>Start Using Consortium &rarr;</strong></a>
</p>

---

## How It Works

Consortium is made up of three components that work together:

```
  Your Machine                     Consortium                     Your Browser
┌──────────────┐             ┌──────────────────┐             ┌──────────────┐
│              │   Encrypted │                  │  Encrypted  │              │
│  Relay CLI   │◄───────────►│   Relay Server   │◄───────────►│  Consortium  │
│              │  WebSocket  │                  │  WebSocket  │   Web App    │
│  Claude Code │   + REST    │  Stores only     │   + REST    │  Decrypts    │
│  runs here   │             │  encrypted blobs │             │  locally     │
└──────────────┘             └──────────────────┘             └──────────────┘
```

| Component | What it does |
|-----------|-------------|
| **Relay CLI** | Wraps Claude Code on your development machine. Encrypts everything locally and streams it to the relay server. |
| **Relay Server** | A lightweight message broker. Receives encrypted data, stores it, and forwards it to connected clients. It never decrypts anything. |
| **Web App** | A browser-based dashboard. Connects to the server, downloads encrypted session data, and decrypts it locally in your browser. |

### The encryption model

1. When you first run the CLI, a cryptographic key pair is generated on your machine.
2. A unique data encryption key is created for each session.
3. All messages are encrypted with **AES-256-GCM** before leaving the device.
4. Session metadata is encrypted with **NaCl secretbox**.
5. The relay server only ever handles ciphertext — it cannot read your prompts, code, or Claude's responses.
6. The web client decrypts everything locally in your browser using the same key material.

> **In short:** Even if the relay server were compromised, an attacker would only find encrypted data they cannot read. This is true whether you use the [hosted version](https://consortium.dev) or self-host.

---

## Security

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Authentication** | Ed25519 challenge-response | Proves identity without passwords |
| **Session messages** | AES-256-GCM with per-session data keys | Encrypts all prompts and responses |
| **Session metadata** | NaCl secretbox | Encrypts session names, paths, summaries |
| **Transport** | WebSocket + HTTPS | Encrypted in transit |
| **Server access** | Zero-knowledge design | Server stores only ciphertext it cannot decrypt |

The server is intentionally designed as a **zero-knowledge relay**. It authenticates clients, stores encrypted blobs, and routes events — but it never possesses the keys needed to read the data passing through it.

This zero-knowledge architecture means your data is private whether you use [Consortium's hosted infrastructure](https://consortium.dev) or deploy your own instance. We can't read your data either.

---

## CLI Reference

The `consortium` CLI wraps Claude Code with end-to-end encryption and streams your sessions through the relay server.

```bash
consortium                     # Start a new encrypted session
consortium auth login          # Authenticate and pair this machine
consortium auth status         # Check authentication status
consortium daemon start        # Start the background service
consortium doctor              # Run system diagnostics
consortium notify -p "Done!"   # Send a push notification to your devices
```

The CLI supports multiple commands for authentication, session management, daemon control, multi-model AI sessions, diagnostics, and more. All [Claude Code flags](https://docs.anthropic.com/en/docs/claude-code) are also passed through automatically.

<p align="center">
  <a href="COMMANDS.md"><strong>View All Commands &rarr;</strong></a>
</p>

### First-run setup

When you run `consortium` for the first time:

1. A **cryptographic identity** (Ed25519 key pair) is generated and stored locally on your machine.
2. A **QR code** is displayed in the terminal for pairing with your Consortium account.
3. Once paired, the CLI authenticates automatically on subsequent runs.

No passwords or email addresses are needed — your identity is your key.

---

## API Reference

The relay server exposes a REST API and a WebSocket interface. All data payloads are encrypted by the client before transmission — the server only stores and forwards ciphertext.

### Authentication

Consortium uses **Ed25519 public-key challenge-response** authentication. There are no passwords, no OAuth flows, and no email addresses.

**Direct authentication** (for clients that already have a key pair):

```
POST /v1/auth
```

| Field | Type | Description |
|-------|------|-------------|
| `publicKey` | string | Base64-encoded Ed25519 public key |
| `challenge` | string | Base64-encoded challenge bytes |
| `signature` | string | Base64-encoded signature of the challenge |

Returns a JWT token on success.

**Device pairing** (for new CLI installations):

```
POST /v1/auth/request          # CLI creates a pairing request
GET  /v1/auth/request/status   # CLI polls for approval
POST /v1/auth/response         # Web dashboard approves the request
```

This flow lets you pair a new machine by scanning a QR code in the web dashboard. The CLI displays the code, the dashboard scans it, and the server issues a token once approved.

### Sessions

All session endpoints require a valid authentication token.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/sessions` | List all sessions (most recent first, up to 150) |
| `POST` | `/v1/sessions` | Create a new session |
| `GET` | `/v1/sessions/:id/messages` | Get messages for a session (most recent first, up to 150) |
| `DELETE` | `/v1/sessions/:id` | Delete a session and all its messages |

**Create a session:**

```
POST /v1/sessions
```

| Field | Type | Description |
|-------|------|-------------|
| `tag` | string | Unique identifier for the session (prevents duplicates) |
| `metadata` | string | Encrypted session metadata (name, path, summary) |
| `dataEncryptionKey` | string? | Encrypted per-session data key (base64) |

### Machines

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/machines` | Register a machine |
| `GET` | `/v1/machines` | List all registered machines |
| `GET` | `/v1/machines/:id` | Get a specific machine by ID |

### WebSocket protocol

The relay server uses **Socket.io** for real-time communication. Connect to the WebSocket endpoint at `/v1/updates`.

**Connection authentication:**

```javascript
const socket = io(serverUrl, {
  path: '/v1/updates',
  auth: {
    token: '<jwt-token>',
    clientType: 'user-scoped',    // or 'session-scoped', 'machine-scoped'
    sessionId: '<session-id>',    // required for session-scoped
    machineId: '<machine-id>'     // required for machine-scoped
  }
});
```

**Client types:**

| Type | Description |
|------|-------------|
| `user-scoped` | Receives updates for all sessions and machines (used by the web dashboard) |
| `session-scoped` | Receives updates for a specific session only (used by the CLI) |
| `machine-scoped` | Receives updates for a specific machine only |

**Client → Server events:**

| Event | Description |
|-------|-------------|
| `message` | Send an encrypted message to a session |
| `update-metadata` | Update encrypted session metadata (with optimistic locking) |
| `update-state` | Update encrypted agent state (with optimistic locking) |
| `session-alive` | Heartbeat indicating a session is still active |
| `session-end` | Signal that a session has ended |
| `rpc-register` | Register an RPC method handler (CLI registers `bash`, `readFile`, etc.) |
| `rpc-call` | Call a registered RPC method on another connected client |

**Server → Client events:**

| Event | Description |
|-------|-------------|
| `update` | Persistent data update (new session, new message, metadata change) |
| `ephemeral` | Transient status update (session activity, machine online/offline) |
| `rpc-request` | Incoming RPC call to handle |
| `rpc-registered` | Confirmation that an RPC method was registered |

### RPC (Remote Procedure Call)

The RPC system lets the web dashboard invoke commands on the CLI through the relay server. The server routes requests between connected clients of the same user — it never interprets the request contents.

```
Web Dashboard                  Relay Server                  CLI
     │                              │                          │
     ├─ rpc-call(method, params) ──►│                          │
     │                              ├─ rpc-request(method) ───►│
     │                              │◄── response ─────────────┤
     │◄── callback(result) ────────┤                          │
```

RPC calls have a **30-second timeout**. If the target client disconnects, all its registered methods are automatically cleaned up.

---

## Self-Hosting

This repository contains the complete source code for Consortium Relay. If you prefer to run everything on your own infrastructure, you can.

> **Note:** For most users, the [hosted version at consortium.dev](https://consortium.dev) is the fastest way to get started — no servers, no databases, no maintenance. Self-hosting is available for teams that require full infrastructure control.

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [Yarn](https://yarnpkg.com/) package manager
- [PostgreSQL](https://www.postgresql.org/) database
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed

### 1. Clone and install

```bash
git clone https://github.com/ConsortiumAI/consortium-relay.git
cd consortium-relay
yarn install
```

### 2. Set up the database

```bash
cp .env.example packages/consortium-server/.env
```

Edit `packages/consortium-server/.env` with your database connection string and a random server secret:

```
DATABASE_URL=postgresql://user:password@localhost:5432/consortium
CONSORTIUM_MASTER_SECRET=your-random-secret-at-least-32-characters
PORT=3005
```

Then run the database migration:

```bash
cd packages/consortium-server
npx prisma migrate dev --name init
cd ../..
```

### 3. Start the relay server

```bash
cd packages/consortium-server
yarn start
```

The server will start on `http://localhost:3005`.

### 4. Start the CLI on your development machine

```bash
cd packages/consortium-cli
CONSORTIUM_SERVER_URL=http://localhost:3005 yarn start
```

On first run, the CLI generates your cryptographic identity and displays a QR code for pairing. It then starts Claude Code and relays the session through the server.

### 5. Open the web dashboard

```bash
cd packages/consortium-web
yarn dev
```

Open `http://localhost:5173` in your browser. Sign in using the secret key displayed by the CLI on first run, or generate a new identity and pair it.

You'll see your active Claude sessions in real time — fully decrypted in your browser.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `CONSORTIUM_MASTER_SECRET` | — | Server secret used for signing authentication tokens |
| `PORT` | `3005` | Port the relay server listens on |
| `CONSORTIUM_SERVER_URL` | `https://api.consortium-servers.com` | The relay server URL (set in the CLI environment) |

> When using the [hosted version](https://consortium.dev), the CLI connects to Consortium's servers automatically — no configuration needed.

---

## Docker

Production-ready Dockerfiles are included for self-hosted deployments.

**Relay Server:**

```bash
docker build -f Dockerfile.server -t consortium-consortium-server .
docker run -p 3005:3005 \
  -e DATABASE_URL="postgresql://..." \
  -e CONSORTIUM_MASTER_SECRET="..." \
  consortium-consortium-server
```

**Web Dashboard:**

```bash
docker build -f Dockerfile.webapp -t consortium-consortium-web .
docker run -p 80:80 consortium-consortium-web
```

The CLI runs directly on each development machine — it does not need to be containerised.

> **Prefer not to manage infrastructure?** <a href="https://consortium.dev"><strong>Start Using Consortium &rarr;</strong></a>

---

## Project Structure

```
consortium-relay/
├── packages/
│   ├── consortium-server/          Relay server (Fastify, Prisma, Socket.io)
│   │   ├── prisma/            Database schema
│   │   └── sources/           Server source code
│   │       ├── app/api/       REST endpoints and WebSocket handlers
│   │       ├── app/auth/      Token generation and verification
│   │       ├── app/events/    Real-time event routing
│   │       ├── storage/       Database client and helpers
│   │       └── utils/         Logging, shutdown, crypto utilities
│   │
│   ├── consortium-cli/             CLI agent (Claude Code SDK, E2EE)
│   │   ├── bin/               CLI entry point
│   │   └── src/
│   │       ├── api/           Server communication and encryption
│   │       ├── claude/        Claude Code SDK integration
│   │       ├── modules/       RPC command handlers
│   │       ├── ui/            Authentication and logging
│   │       └── utils/         Async utilities, message queuing
│   │
│   └── consortium-web/             Web dashboard (React, Vite)
│       └── src/
│           ├── pages/         Login, session list, chat view
│           └── lib/           API client, socket, encryption
│
├── Dockerfile.server          Server container image
├── Dockerfile.webapp          Web app container image
├── COMMANDS.md                Complete CLI command reference
├── .env.example               Environment variable template
└── LICENCE                    MIT License
```

---

## License

This project is released under the [MIT License](LICENCE).

<p align="center">
  <br/>
  <a href="https://consortium.dev">
    <img src="logo.png" width="100" alt="Consortium" />
  </a>
  <br/><br/>
  <strong>Built by Consortium</strong><br/>
  <a href="https://consortium.dev">consortium.dev</a>
</p>
