# noq-agent

`noq-agent` is a local AI coding agent CLI built to explore how modern tool-using coding agents work under the hood.

Instead of relying on a full agent framework, this project implements the main layers directly:

- provider adapters for multiple model backends
- a shared internal tool system
- a workflow/orchestration layer
- a config-driven permission model
- lightweight session persistence, diffing, and undo

## What It Can Do

The current agent can:

- inspect a codebase with directory listing, glob search, grep, and file reads
- read full files or specific line ranges
- edit existing files with exact replacements
- create new files
- apply structured multi-file patches
- run shell commands under a permission policy
- ask for command approvals once or persist them across a named session
- track multi-step work with in-memory todos
- provide TypeScript/JavaScript diagnostics
- jump to TypeScript/JavaScript symbol definitions
- start a new interactive conversation with a generated session id
- persist session history across CLI invocations
- show the latest agent-generated diff for a session
- undo the last agent-generated snapshot for a session

It is designed as a terminal-first local coding assistant that can answer code questions, navigate a repository, make code changes, verify them, and keep a small amount of structured state between runs.

## Why I Built It

I built this project to better understand:

- how provider APIs differ in tool-calling behavior
- how an agent loop is separated from a provider adapter
- how tool contracts affect model reliability
- how runtime rules such as verification, permissions, and bounded loops improve agent behavior
- how persistent sessions and undo can be layered into a local coding agent

The goal was not just to use an AI SDK, but to learn the architecture behind agentic coding systems by implementing the layers myself.

## Current Architecture

The project is split into a few simple layers:

- `src/providers/`
  provider-specific adapters for OpenAI, OpenRouter, Gemini, and Ollama
- `src/tools/`
  internal tool definitions and tool implementations
- `src/workflow.ts`
  orchestration logic that manages one agent turn and enforces workflow rules
- `src/runtime/executeToolCall.ts`
  shared tool execution gate for permissions and mode enforcement
- `src/config.ts`
  config loading and validation
- `src/sessionStore.ts`
  persistent session history, snapshot diffs, and undo support
- `src/sessionChangeTracker.ts`
  tracking for agent-made file mutations, including command-driven workspace changes
- `src/systemPrompt.ts`
  shared default system prompt used by providers

## Providers

Current providers:

- OpenAI Responses API
- OpenRouter Chat Completions
- Google Gemini
- Ollama

The provider layer is responsible for:

- converting internal messages into provider-specific request formats
- converting internal tool schemas into provider-specific tool definitions
- running provider-level tool loops
- returning a normalized `ChatResult`

OpenRouter is implemented through its OpenAI-compatible API surface, but requests are still sent to OpenRouter and billed against OpenRouter credits.

Provider selection works like this:

1. `AI_PROVIDER` if explicitly set
2. `defaultProvider` from `noq-agent.json` if present
3. auto-select exactly one fully configured provider
4. otherwise fail with a clear setup error instead of silently defaulting to Ollama

## Modes

The agent supports two runtime modes:

- `build`
  full coding mode; can use mutation tools and command execution subject to permissions
- `plan`
  read-only planning mode; can inspect the codebase and produce a grounded implementation plan without changing files

You can choose the mode with:

```bash
noq --mode plan "your prompt"
noq --mode build "your prompt"
noq --plan "your prompt"
```

The default mode is configurable in `noq-agent.json`.
The default provider can also be set there when you want a workspace-level preference.

## Current Tools

Current tools:

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

Notable tool behavior:

- `read_file` supports optional line ranges
- `grep` prefers `ripgrep` and falls back to a Node-based search when `rg` is unavailable
- `get_diagnostics` and `go_to_definition` currently provide semantic support for TypeScript/JavaScript files
- `edit_file` performs exact text replacement using `oldText` and `newText`
- `edit_file` rejects missing or ambiguous matches and verifies the final file after writing
- `apply_patch` supports structured multi-file add/update/delete patch operations
- `run_command` is permission-gated, supports rule-based bash policies, and still hard-blocks catastrophic commands
- todo tools are intended for multi-step work and are available to all providers through the shared registry

## Workflow Layer

`runAgentTurn()` in `src/workflow.ts` acts as the orchestrator for one user request.

It currently enforces behaviors such as:

- changes should be read back before being considered verified
- verification commands should be rerun after later mutations
- repeated blocked or failed actions should not be retried blindly
- final answers should be based on actual tool results
- bounded workflow rounds should prevent infinite churn
- plan-mode answers should stay concise and grounded

This layer exists because “tool calling works” is not enough by itself; the runtime also needs lightweight control over completion, verification, and convergence.

## Permissions

The agent uses a config-driven permission model loaded from `noq-agent.json`.

Current permission scopes:

- `todo`
- `read`
- `edit`
- `list`
- `glob`
- `grep`
- `bash`
- `external_directory`

Default behavior:

- read-oriented tools are allowed
- edit and command tools ask for permission
- external-directory access is denied

Permissions are enforced before tool execution, not just described in the prompt.
For `bash`, you can keep a simple `"ask"` rule or switch to command patterns like `"npm run build": "allow"` and `"rm *": "deny"`.
When a command asks for approval, the CLI supports:

- allow once
- allow always for the current run
- allow always for the current named session when `--session` is active
- deny

Interactive sessions keep the same process alive across turns, so “allow always for this run” remains available until you exit that conversation. Resumed named sessions can also reuse approvals that were stored with “allow always for this named session”.

For rule-based `bash` permissions, the last matching rule wins.

## Sessions, Diffs, and Undo

The agent supports persistent local sessions.

Running `noq` starts a new interactive conversation and automatically creates a session id like `session-20260527-114600`. Running `noq "your prompt"` also creates a persistent session automatically, sends that prompt as the first turn, and prints a resume command afterward.

When you start or resume an interactive conversation with `noq` or `noq --session <id>`, the CLI first asks whether to open the session TUI in:

- the current terminal
- a popup terminal window

The interactive session UI is rendered with Ink. Popup terminal launch is currently implemented for Windows and falls back to the current terminal when a popup cannot be opened.
The Ink TUI uses the terminal's alternate screen buffer, so it behaves like a full-screen terminal app while active and restores your previous shell screen when you exit.

All sessions are stored under `.noq-agent/sessions` in the current workspace and prior turns are replayed as compacted history in future runs.

Session features:

- persistent turn history
- auto-generated session ids for new conversations
- latest snapshot diff via `--diff`
- undo last agent-generated snapshot via `--undo`
- tracking of agent-made file changes from edit tools and workspace changes caused by `run_command`

Example:

```bash
noq
noq "Create src/example.ts and verify it."
noq --session session-20260527-114600
noq --session session-20260527-114600 --diff
noq --session session-20260527-114600 --undo
```

## CLI Usage

After building and linking the CLI locally, you can run:

```bash
noq
```

That interactive flow will first ask whether you want to use the Ink-based session TUI in the current terminal or in a popup terminal window. While active, the TUI takes over the terminal window and restores your previous shell content on exit.

Start a new session with a first prompt:

```bash
noq "Read src/tools/runCommand.ts and summarize it."
```

During development, you can also run:

```bash
npm run dev -- "Read src/tools/runCommand.ts and summarize it."
```

Help output:

```bash
noq --help
```

Version output:

```bash
noq --version
```

Resume a previous conversation:

```bash
noq --session session-20260527-114600
```

Resuming a conversation uses the same launch choice flow and the same Ink TUI behavior.

Interactive session commands:

```text
/mode plan
/mode build
/plan show
/diff
/undo
/exit
```

## Example Prompts

Read-only planning:

```bash
noq --mode plan "Inspect src/workflow.ts and tell me how you would add a new tool safely."
```

Targeted edit:

```bash
noq "Read src/tools/runCommand.ts, make one small clarity improvement, verify it, and summarize the result."
```

Patch-based edit:

```bash
noq "Use apply_patch to update two related sections in one file, then read back the changed lines and summarize exactly what changed."
```

Semantic navigation:

```bash
noq --mode plan "Inspect src/tools/readFile.ts, use semantic navigation to find where readFileContent is defined, and check diagnostics in src/typescriptService.ts."
```

Session + undo:

```bash
noq "Create tmp/session-memory.txt containing the text 'first turn', then confirm it."
noq --session session-20260527-114600 --diff
noq --session session-20260527-114600 --undo
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure provider credentials.

You can provide them in any of these places:

- shell environment variables
- `~/.noq-agent/.env` for user-wide defaults
- `.noq-agent/.env` inside a workspace for project-specific overrides
- `noq-agent.env` in the workspace root as an alternative local env file
- the repo-local `.env` when you are running `noq-agent` from inside this repo during development

Example values depend on which provider you want to use:

```env
AI_PROVIDER=openai

OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.4-mini

OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4.1-mini
OPENROUTER_HTTP_REFERER=https://your-app.example
OPENROUTER_APP_TITLE=noq-agent

GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash

OLLAMA_DEFAULT_MODEL=llama3.1:8b
```

If `AI_PROVIDER` is not set, `noq-agent` will:

1. use `defaultProvider` from `noq-agent.json` if present
2. otherwise auto-select a provider only when exactly one backend is fully configured
3. otherwise fail clearly and ask you to choose explicitly by setting `AI_PROVIDER`

3. Optionally create `noq-agent.json` in the workspace root to set a default mode, default provider, and permission policy.

Example:

```json
{
  "defaultMode": "build",
  "defaultProvider": "openai",
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
    "external_directory": "deny"
  }
}
```

4. Build the CLI:

```bash
npm run build
```

5. Link it locally:

```bash
npm link
```

6. Run the agent:

```bash
noq
```

## Current Safety Model

This project uses lightweight safeguards rather than a full sandbox.

- runtime-enforced permissions for reads, edits, commands, and external paths
- rule-based bash permissions with allow-once and allow-always approvals
- `plan` mode for read-only planning
- exact-text verification for `edit_file`
- read-back verification after mutations
- bounded provider and workflow loops
- policy-driven command execution with a hard danger floor
- session undo based on stored before-state snapshots

These safeguards are intentionally simple, but they noticeably improve reliability for a local learning project.

## Current Limitations

- semantic diagnostics and definition lookup are currently TypeScript/JavaScript-specific
- this is not a sandbox; it is a guarded local runtime
- provider support is normalized, but each backend still has different tool-calling behavior and quality characteristics

## What I Learned

A few practical lessons from building this:

- provider APIs may share the same idea of tool calling while requiring very different message and loop handling
- tool design matters a lot; smaller and clearer tool contracts improve reliability
- verification logic belongs above the provider layer
- permission checks are much stronger when enforced in runtime code instead of only described in prompts
- persistent sessions and undo add a lot of usability, but only if mutation tracking is explicit
- simple orchestration rules can noticeably improve agent behavior without needing a large framework

## Current State

This is still an evolving learning project, but the current version already demonstrates:

- multi-provider tool-calling support
- plan/build execution modes
- a shared internal tool schema
- a custom orchestration layer
- repository navigation and code search
- exact-text editing and patch-based editing
- policy-driven command execution
- TypeScript/JavaScript semantic tooling
- config-driven permissions
- persistent sessions with diff and undo support

## Next Steps

Planned improvements include:

- more language backends beyond TypeScript/JavaScript semantics
- safer and more configurable command execution
- more polished CLI output and ergonomics
- stronger session tooling and history inspection
- continued hardening of search, verification, and convergence behavior

## Repository

GitHub: https://github.com/noQils/noq-agent
