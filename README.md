# noq-agent

`noq-agent` is a local AI coding agent CLI built to explore how modern tool-using coding agents work under the hood.

Instead of relying on a full agent framework, this project implements the main layers directly:

- provider adapters for multiple model backends
- a shared internal tool system
- a workflow/orchestration layer
- lightweight safety and verification rules for edits and commands

## What It Does

The agent can currently:

- inspect a codebase
- list directory contents
- search files with guarded glob patterns
- search file contents
- read files
- edit existing files by replacing an exact text snippet
- create new files
- run a small trusted set of verification commands

It is designed as a terminal-first local coding assistant that can answer code questions, navigate a repository, make small code changes, and run basic verification commands inside a project.

## Why I Built It

I built this project to better understand:

- how model providers differ in tool-calling behavior
- how an agent loop is separated from a provider adapter
- how tool contracts affect model reliability
- how workflow rules such as "edit, verify, continue if incomplete" improve agent behavior

The goal was not just to use an AI SDK, but to learn the architecture behind agentic coding systems by implementing the layers myself.

## Current Architecture

The project is split into a few simple layers:

- `src/providers/`
  provider-specific adapters for OpenAI, Gemini, and Ollama
- `src/tools/`
  internal tool definitions and tool implementations
- `src/workflow.ts`
  orchestration logic that manages one agent turn and enforces workflow rules
- `src/systemPrompt.ts`
  shared default system prompt used by providers
- `src/fileUtils.ts`
  shared low-level file operations used by tools

### Provider Layer

The provider layer is responsible for:

- converting internal messages into provider-specific request formats
- converting internal tool schemas into provider-specific tool definitions
- running provider-level tool loops
- returning a normalized `ChatResult`

Current providers:

- OpenAI Responses API
- Google Gemini
- Ollama

### Tool Layer

Current tools:

- `list_dir`
- `glob`
- `grep`
- `read_file`
- `edit_file`
- `write_file`
- `run_command`

These tools share a common internal schema and are exposed to all providers through the same tool registry.

Notable tool behavior:

- `edit_file` performs exact text replacement using `oldText` and `newText`
- `edit_file` rejects missing or ambiguous matches and verifies the final file after writing
- `glob` rejects overly broad recursive patterns to reduce accidental repo-wide scans
- `run_command` only allows trusted commands and rejects untrusted or dangerous ones

### Workflow Layer

`runAgentTurn()` in `src/workflow.ts` acts as the orchestrator for one user request.

It currently enforces behaviors such as:

- if a file is edited, it should be verified with `read_file`
- if the model's response suggests the task is still incomplete, continue another round
- stop after a bounded number of workflow rounds to avoid infinite churn

This layer was added after observing that "tool calling works" is not enough by itself; the runtime also needs lightweight control over completion and verification.

## CLI Usage

After building and linking the CLI locally, you can run the agent with:

```bash
noq "Read the file src/tools/runCommand.ts. Summarize what it does."
```

During development, you can also run:

```bash
npm run dev -- "Read the file src/tools/runCommand.ts. Summarize what it does."
```

## Example Prompts

```bash
noq "Use list_dir to inspect src/tools, then read the most relevant command-related file and summarize it."
```

```bash
noq "Read src/tools/runCommand.ts, make one small clarity improvement with edit_file using an exact existing snippet, verify the edit with read_file, and summarize the result."
```

```bash
noq "Create a new file named src/test/example.ts with write_file, verify it with read_file, and summarize the result."
```

```bash
noq "Use run_command to run npx tsc --noEmit, then summarize the result."
```

```bash
noq "Use list_dir to inspect src/test, create a new file named src/test/release-check.ts with write_file containing a tiny exported constant, verify it with read_file, then read the most relevant command-related tool in src/tools, make one small clarity improvement with edit_file, verify the edit, run npx tsc --noEmit with run_command, and summarize the whole result."
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add environment variables in `.env`.

Example values depend on which provider you want to use:

```env
AI_PROVIDER=openai

OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.4-mini

GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash

OLLAMA_DEFAULT_MODEL=llama3.1:8b
```

3. Build the CLI:

```bash
npm run build
```

4. Link it locally:

```bash
npm link
```

5. Run the agent:

```bash
noq "your prompt"
```

## Current Safety Model

This project uses lightweight safeguards rather than a full sandbox.

- `edit_file` requires exact existing text and verifies the file after writing
- `glob` discourages and rejects broad recursive scans
- `run_command` only permits a trusted set of commands such as `npx tsc --noEmit`
- workflow rounds are bounded to reduce infinite repair loops

These safeguards are intentionally simple, but they noticeably improve reliability for a local learning project.

## What I Learned

A few practical lessons from building this:

- provider APIs may share the same idea of "tool calling" while requiring very different message and loop handling
- tool design matters a lot; smaller and clearer tool contracts improve reliability
- verification logic belongs above the provider layer
- bounded loops are essential to prevent local repair cycles from running forever
- simple orchestration rules can noticeably improve agent behavior without needing a large framework

## Current State

This is still an evolving learning project, but the current version already demonstrates:

- multi-provider tool-calling support
- a shared internal tool schema
- a custom orchestration layer
- repository navigation, file creation, and exact-text file editing workflows
- trusted command execution for verification
- basic safeguards against incomplete or unverified edits

## Next Steps

Planned improvements include:

- better typo-aware file selection when users reference near-miss file paths
- safer and more configurable command execution
- stronger convergence controls for repeated edit loops
- more polished CLI output and ergonomics
- continued hardening of search and verification behavior

## Repository

GitHub: https://github.com/noQils/noq-agent
