# noq-agent

`noq-agent` is a local AI coding agent CLI I built to learn how modern tool-using coding agents work under the hood.

Instead of relying on a full agent framework, this project implements the core pieces directly:

- provider adapters for multiple model backends
- a shared tool system
- a workflow/orchestration layer
- bounded tool loops and verification rules for safer file edits

## What It Does

The agent can currently:

- inspect a codebase
- list directory contents
- search files with glob patterns
- search file contents
- read files
- edit existing files by replacing a specific line range
- create new files
- run a small allowlisted set of verification commands

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

### Workflow Layer

`runAgentTurn()` in `src/workflow.ts` acts as the orchestrator for one user request.

It currently enforces behaviors such as:

- if a file is edited, it should be verified with `read_file`
- if the model's response suggests the task is still incomplete, continue another round
- stop after a bounded number of workflow rounds to avoid infinite churn

This layer was added after observing that "tool calling works" is not enough by itself; the runtime also needs lightweight control over completion and verification.

## Example Usage

Run the CLI with a natural-language prompt:

```bash
npx ts-node src/index.ts "Inspect the tool system for this project."
```

Example prompts:

```bash
npx ts-node src/index.ts "Use glob to list files in src/tools, grep to find fast-glob usage, then read the relevant files and summarize them."
```

```bash
npx ts-node src/index.ts "Create a new file named src/test/example.ts using the write_file tool and then verify its contents."
```

```bash
npx ts-node src/index.ts "Delete the duplicated console log call in dummy-edit-test.ts and verify the final file."
```

```bash
npx ts-node src/index.ts "Use list_dir to inspect src/tools, read the most relevant file for file creation, and summarize what it does."
```

```bash
npx ts-node src/index.ts "Use run_command to run npx tsc --noEmit and summarize the result."
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

3. Run the agent:

```bash
npx ts-node src/index.ts "your prompt"
```

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
- repository navigation, file creation, and file editing workflows
- basic command execution for verification
- basic safeguards against incomplete or unverified edits

## Next Steps

Planned improvements include:

- more precise read/edit workflows
- safer and more configurable command execution
- stronger post-edit verification workflows
- better convergence controls for repeated edit loops
- more polished CLI output

## Repository

GitHub: https://github.com/noQils/noq-agent
