# noq-agent

`noq-agent` is a local AI coding agent CLI for exploring tool-using coding agents without hiding the core runtime behind a larger framework.

It currently includes:

- multiple provider adapters
- a shared internal tool registry
- a workflow layer that pushes the model to verify and finish work
- runtime-enforced permissions
- persistent global sessions with diff, undo, and saved plan artifacts
- an OpenTUI-based interactive session UI

## Current Capabilities

Today the agent can:

- inspect a repo with `list_dir`, `glob`, `grep`, and `read_file`
- read full files or line ranges
- edit files with exact snippet replacement
- write new files
- apply structured multi-file patches
- run shell commands behind a permission policy
- keep short task state with `todo_read` and `todo_write`
- provide diagnostics for TypeScript/JavaScript, Python, Java, and Go
- jump to symbol definitions in TypeScript/JavaScript, Python, Go, and best-effort Java
- persist conversations across CLI runs
- show the latest agent-generated diff for a session
- undo the latest recorded agent snapshot
- save the latest plan-mode artifact for later review
- remember named-session approvals, including approved external directories
- resume sessions from any directory
- work across directories when the permission policy allows it

## Runtime Modes

`noq-agent` runs in two modes:

- `build`
  Full coding mode. All tools are available, including editing and `run_command`, subject to permissions.
- `plan`
  Read-only planning mode. The agent can inspect the codebase and produce a grounded implementation plan, but mutation tools are not available.

Examples:

```bash
noq --mode build "Read the failing test, fix it, and rerun the test."
noq --mode plan "Inspect the runtime and tell me how to add a new tool safely."
noq --plan "Review src/workflow.ts and outline the implementation steps."
```

## Providers

Current provider backends:

- OpenAI
- OpenRouter
- Google Gemini
- Ollama

Provider setup now uses only global files under `~/.noq/`:

- `~/.noq/auth.json`
  Provider credentials and connection details
- `~/.noq/config.json`
  Global default provider and model

Workspace `noq-agent.json` can still override `defaultProvider` and `defaultModel` for a specific repo.

Provider selection order:

1. `defaultProvider` in workspace `noq-agent.json`
2. `defaultProvider` in `~/.noq/config.json`
3. auto-select exactly one fully configured provider
4. otherwise fail with a setup error

A provider is usable only when:

- OpenAI, OpenRouter, Gemini: matching auth exists in `~/.noq/auth.json` and the chosen default provider/model exists in config
- Ollama: the chosen default provider/model exists in config

The provider layer normalizes tool calling into one internal `ChatResult`, but each backend still keeps its own request and loop behavior.

## Tools

Current internal tools:

- `todo_read`
- `todo_write`
- `read_file`
- `glob`
- `grep`
- `get_diagnostics`
- `go_to_definition`
- `apply_patch`
- `edit_file`
- `write_file`
- `list_dir`
- `run_command`

Notable behavior:

- `read_file` supports optional line ranges.
- `grep` prefers `rg` and falls back when `ripgrep` is unavailable.
- `get_diagnostics` supports TypeScript/JavaScript, Python, Java, and Go.
- `go_to_definition` supports TypeScript/JavaScript, Python, Go, and best-effort Java workspace lookup.
- `edit_file` requires a unique exact match and verifies the final file after writing.
- `apply_patch` supports structured add/update/delete operations across files.
- `run_command` is build-mode only, permission-gated, output-truncated, timeout-bounded, and still hard-blocks catastrophic commands.

Plan mode only exposes:

- `read_file`
- `glob`
- `grep`
- `get_diagnostics`
- `go_to_definition`
- `list_dir`

## Workflow Layer

`src/workflow.ts` is the orchestration layer for a single user turn. It does more than just pass tool schemas to a model.

It currently enforces rules such as:

- changed files should be read back before the turn is treated as complete
- verification commands should be rerun after later mutations
- blocked actions should not be retried blindly
- repeated failed edits should trigger a smaller retry strategy
- build-mode answers should lead with the actual code change, not verification boilerplate
- plan-mode answers should stay concise and read-only
- multi-step tasks should prompt the agent to start using todos
- bounded workflow rounds should stop infinite churn

## OpenTUI Sessions

Interactive sessions are rendered with OpenTUI and use the terminal alternate screen buffer. When the TUI exits, your previous shell screen is restored.

Starting or resuming an interactive session prompts you to choose:

- current terminal
- popup terminal window

Popup window launch is currently implemented on Windows and falls back to the current terminal elsewhere.

Useful interactive commands:

```text
/connect
/models
/mode plan
/mode build
/plan show
/diff
/undo
/exit
```

Setup flow details:

- `/connect`
  Saves provider credentials into `~/.noq/auth.json`
- `/models`
  Lets you choose the global default provider and model in `~/.noq/config.json`
- `/models` applies immediately to the next turn in the current session
- `/connect` makes a provider available immediately, but does not change the active provider/model until `/models`
- `/models` tries live model discovery first and falls back to curated presets when discovery is unavailable
- Ollama does not need an API key for `/connect`; you can just use `/models`

TUI details:

- new sessions get a generated id when you send the first real prompt
- session transcript entries are persisted with the session
- permission prompts are shown inline in the TUI with previews for commands and edits
- external-directory prompts show both the session workspace and the outside directory being requested
- `Ctrl+C` copies the current selection
- `Ctrl+V` pastes the last copied selection into the composer
- `Ctrl+O` inserts a newline in the composer

## Sessions, Diffs, and Undo

Sessions are stored under:

```text
~/.noq/sessions/<session-id>/session.json
```

Named-session debug logs are written to:

```text
~/.noq/sessions/<session-id>/debug.log
```

Session data includes:

- original workspace root
- persistent turn history
- recorded snapshots of agent-made file changes
- named-session permission approvals
- approved external directories
- latest saved plan artifact
- TUI transcript state and stored mode

Because the workspace root is stored with the session, `noq` remembers the original session directory.

When you resume a session from a different current directory, interactive startup asks whether to use:

- the session's stored workspace directory
- your current working directory

If you run a resumed one-shot command non-interactively and those directories differ, `noq` exits with guidance instead of guessing.

Examples:

```bash
noq
noq "Create src/example.ts and verify it."
noq --session session-20260602-201500
noq --session session-20260602-201500 "Continue the refactor."
noq --session session-20260602-201500 --diff
noq --session session-20260602-201500 --undo
```

## Permissions

Permissions are enforced in runtime code, not just described in prompts.

Current scopes:

- `todo`
- `read`
- `edit`
- `list`
- `glob`
- `grep`
- `bash`
- `external_directory`

Default config behavior:

- read-oriented tools are allowed
- edits ask
- commands ask
- external directory access is denied unless you override it

For `bash`, you can use either a single outcome like `"ask"` or a rule map such as:

```json
{
  "*": "ask",
  "npm test*": "allow",
  "git status*": "allow",
  "rm *": "deny"
}
```

Rule precedence is simple: the last matching rule wins.

Approval choices:

- allow once
- allow for this run or named session
- deny

In interactive TUI sessions, approvals are shown inline. In plain terminal mode, prompts fall back to a text-based approval prompt. Without a TTY, permission prompts default to deny.

External directory behavior:

- `deny` blocks outside-workspace access
- `ask` prompts on first use
- `allow` skips the prompt
- choosing the session-level approval remembers the outside directory for later turns in that session
- `allow once` does not add the directory to the remembered list

## Configuration

Workspace config lives in `noq-agent.json`.

Example:

```json
{
  "defaultMode": "build",
  "defaultProvider": "openai",
  "defaultModel": "gpt-5.4-mini",
  "permission": {
    "todo": "allow",
    "read": "allow",
    "list": "allow",
    "glob": "allow",
    "grep": "allow",
    "edit": "ask",
    "bash": {
      "*": "ask",
      "npm run build": "allow",
      "npm test*": "allow",
      "git status*": "allow",
      "rm *": "deny"
    },
    "external_directory": "ask"
  }
}
```

Global files under `~/.noq/`:

- `config.json`
  User-wide non-secret defaults such as `defaultProvider` and `defaultModel`
- `auth.json`
  Provider credentials saved by `/connect`
- `sessions/`
  Stored session state, diff history, and debug logs

`NOQ_HOME` can override the default `~/.noq` location.

## Environment Variables

Provider setup no longer comes from environment variables or `.env` files. Use `/connect` and `/models`, or edit `~/.noq/auth.json` and `~/.noq/config.json` directly.

Environment loading still exists for runtime settings and home-directory overrides.

Useful variables:

```env
NOQ_HOME=C:\Users\you\.noq
NOQ_DEBUG=true
NOQ_PROVIDER_TIMEOUT_MS=180000
NOQ_PROVIDER_MAX_TOOL_ROUNDS=10
```

The runtime will also load `.env` files from:

- workspace `.noq/.env`
- workspace `noq-agent.env`
- `~/.noq/.env`
- repo-local `.env` when you are running inside the `noq-agent` package workspace during development

## Setup

1. Install dependencies.

```bash
npm install
```

2. Build the CLI.

```bash
npm run build
```

3. Link it locally for development.

```bash
npm link
```

4. Run `noq`.

```bash
noq
```

5. Inside the TUI:

- run `/connect` to save hosted-provider credentials into `~/.noq/auth.json`
- run `/models` to choose the active global provider and model in `~/.noq/config.json`

Fresh-install behavior:

- if `~/.noq/config.json` is missing or empty, it is treated like no global model has been selected yet
- if no provider is fully configured, `noq` starts and shows setup guidance instead of crashing

## CLI Usage

Basic usage:

```bash
noq
noq "Read src/tools/runCommand.ts and summarize it."
noq --session session-20260602-201500
noq --session session-20260602-201500 "Continue the task."
noq --session session-20260602-201500 --diff
noq --session session-20260602-201500 --undo
noq --mode plan "Inspect src/workflow.ts and propose the implementation."
noq --tui
noq --help
noq --version
```

Notes:

- `noq` with no prompt starts an interactive OpenTUI session.
- `noq "prompt"` runs one turn, prints the response, and prints a resume hint for the created session id.
- `--session <id>` resumes an existing session only. It does not create a new one if the id is invalid.
- `--tui` skips the launch chooser and starts the OpenTUI in the current terminal.
- `--diff` and `--undo` require `--session <id>`.

During development you can also run:

```bash
npm run dev -- "Read src/tools/runCommand.ts and summarize it."
```

## Packaging

The npm packaging flow targets a wrapper package plus platform runtime packages.

Repo commands:

```bash
npm run sync:package-versions
npm run build:runtime:current
npm run pack:smoke
```

Available runtime targets:

- `npm run build:runtime:windows-x64`
- `npm run build:runtime:darwin-arm64`
- `npm run build:runtime:darwin-x64`
- `npm run build:runtime:linux-x64`
- `npm run build:runtime:linux-arm64`

The wrapper package lives in `packages/noq-agent/`. Platform runtime packages live under `packages/noq-agent-*`.

The standalone runtime is built from `src/runtimeExecutable.ts` with Bun's compile pipeline and the OpenTUI Solid preload, so end users do not need Bun installed.

## Development

Useful scripts:

```bash
npm run typecheck
npm run check:tui:opentui
npm test
npm run verify
npm run dev:tui:opentui
npm run dev:runtime
```

## Current Safety Model

This is a guarded local runtime, not a sandbox.

Current safeguards include:

- runtime-enforced permissions
- command allow, ask, and deny rules
- hard-blocking catastrophic commands
- read-back verification after mutations
- exact-match verification for `edit_file`
- bounded provider tool loops
- bounded workflow rounds
- session snapshot undo

## Limitations

- non-TypeScript languages currently use lighter integrations: Python diagnostics use `py_compile`, Java diagnostics use `javac`, Go diagnostics use `go build`, Python definition lookup uses Jedi, Go uses `gopls`, and Java definition lookup is best-effort workspace search
- `plan` mode is intentionally read-only and does not expose mutation tools
- popup TUI windows currently have first-class support on Windows only
- command execution is guarded, but it is still local command execution on your machine
- provider quality and tool-calling behavior still vary across backends

## Repository

GitHub: https://github.com/noQils/noq-agent
