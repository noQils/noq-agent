import fs from 'node:fs';
import path from 'node:path';

import { isAgentMode, type AgentMode } from '../agentMode';
import { getGlobalSessionsDirectoryPath } from '../config/noqHome';
import { buildReferencedPathGroups } from '../analysis/pathReferenceHints';
import { resetPermissionDecisionCache } from '../permissions/decisionCache';
import { type PermissionOutcome, type PermissionScope } from '../permissions/types';
import {
  type ChatMessage,
  type ExecutedToolCall,
  type StopReason,
} from '../providers/types';
import { buildSessionFileDiff } from './sessionDiff';
import { type SessionFileChange } from './sessionChangeTracker';

const sessionIdPattern = /^[A-Za-z0-9._-]+$/;
const sessionFileName = 'session.json';
const sessionDebugLogFileName = 'debug.log';
const maxVerbatimTurns = 6;
const maxCompactedTurns = 12;
const permissionScopes: PermissionScope[] = [
  'todo',
  'read',
  'edit',
  'list',
  'glob',
  'grep',
  'bash',
  'external_directory',
];

export interface SessionTurn {
  timestamp: string;
  mode: AgentMode;
  userPrompt: string;
  response: string;
  workingDirectory?: string;
  stopReason: StopReason | undefined;
  executedToolCalls: ExecutedToolCall[] | undefined;
}

export interface SessionSnapshot {
  id: string;
  createdAt: string;
  mode: AgentMode;
  userPrompt: string;
  response: string;
  fileChanges: SessionFileChange[];
  diff: string;
}

export interface LatestSessionDiffDetails {
  diffText: string;
  toolName?: 'edit' | 'write';
  filePath?: string;
  filetype?: string;
  mutationKind?: 'edit' | 'write';
  additionalFileCount?: number;
}

export interface SessionPermissionApproval {
  createdAt: string;
  scope: PermissionScope;
  targetPattern: string;
}

export type SessionPermissionOverrides = Partial<Record<PermissionScope, PermissionOutcome>>;

export interface SessionPlanArtifact {
  createdAt: string;
  userPrompt: string;
  response: string;
  referencedPaths: string[];
  proposedPaths: string[];
}

export type SessionTranscriptEntryKind = 'user' | 'assistant' | 'system';

export interface SessionTranscriptEntry {
  id: string;
  createdAt: string;
  kind: SessionTranscriptEntryKind;
  text: string;
  toolName?: string;
}

export interface SessionTuiState {
  mode: AgentMode | null;
  entries: SessionTranscriptEntry[];
}

export interface AgentSession {
  id: string;
  workspaceRoot: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
  snapshots: SessionSnapshot[];
  permissionApprovals: SessionPermissionApproval[];
  permissionOverrides: SessionPermissionOverrides;
  latestPlanArtifact: SessionPlanArtifact | null;
  tuiState: SessionTuiState;
  approvedExternalDirectories: string[];
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function formatSessionTimestamp(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function createSnapshotId(): string {
  return `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEntryId(prefix: string, index: number, role: SessionTranscriptEntryKind): string {
  return `${prefix}-${index + 1}-${role}`;
}

function createEmptyTuiState(): SessionTuiState {
  return {
    mode: null,
    entries: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTranscriptEntryKind(value: unknown): value is SessionTranscriptEntryKind {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function isPermissionScope(value: unknown): value is PermissionScope {
  return typeof value === 'string' && permissionScopes.includes(value as PermissionScope);
}

function readStoredString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readStoredTimestamp(value: unknown): string {
  return typeof value === 'string' && value.length > 0
    ? value
    : createTimestamp();
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value): value is string => typeof value === 'string');
}

function isStopReason(value: unknown): value is StopReason {
  return value === 'no_tool_calls'
    || value === 'repeated_tool_calls'
    || value === 'tool_round_limit_reached';
}

function normalizeExecutedToolCalls(calls: unknown): ExecutedToolCall[] | undefined {
  if (!Array.isArray(calls)) {
    return undefined;
  }

  const normalizedCalls = calls.flatMap((call) => {
    if (
      !isRecord(call)
      || typeof call.toolName !== 'string'
      || !isRecord(call.args)
      || typeof call.succeeded !== 'boolean'
    ) {
      return [];
    }

    const normalizedCall: ExecutedToolCall = {
      toolName: call.toolName,
      args: call.args,
      succeeded: call.succeeded,
    };

    if (typeof call.error === 'string') {
      normalizedCall.error = call.error;
    }

    if (
      call.failureKind === 'unknown_tool'
      || call.failureKind === 'invalid_tool_arguments'
      || call.failureKind === 'mode_denied'
      || call.failureKind === 'permission_denied'
      || call.failureKind === 'tool_error'
    ) {
      normalizedCall.failureKind = call.failureKind;
    }

    if (isPermissionScope(call.permissionScope)) {
      normalizedCall.permissionScope = call.permissionScope;
    }

    if (typeof call.target === 'string') {
      normalizedCall.target = call.target;
    }

    if (typeof call.blockedByMode === 'string' && isAgentMode(call.blockedByMode)) {
      normalizedCall.blockedByMode = call.blockedByMode;
    }

    if (call.permissionDeniedBy === 'policy' || call.permissionDeniedBy === 'user') {
      normalizedCall.permissionDeniedBy = call.permissionDeniedBy;
    }

    return [normalizedCall];
  });

  return normalizedCalls;
}

function normalizeSessionTurns(turns: unknown): SessionTurn[] {
  if (!Array.isArray(turns)) {
    return [];
  }

  return turns.flatMap((turn) => {
    if (!isRecord(turn)) {
      return [];
    }

    const userPrompt = readStoredString(turn.userPrompt);
    const response = readStoredString(turn.response);
    const executedToolCalls = normalizeExecutedToolCalls(turn.executedToolCalls);
    if (userPrompt.length === 0 && response.length === 0) {
      return [];
    }

    return [{
      timestamp: readStoredTimestamp(turn.timestamp),
      mode: typeof turn.mode === 'string' && isAgentMode(turn.mode) ? turn.mode : 'build',
      userPrompt,
      response,
      ...(typeof turn.workingDirectory === 'string' ? { workingDirectory: turn.workingDirectory } : {}),
      stopReason: isStopReason(turn.stopReason) ? turn.stopReason : undefined,
      executedToolCalls,
    }];
  });
}

function normalizeSessionFileChanges(fileChanges: unknown): SessionFileChange[] {
  if (!Array.isArray(fileChanges)) {
    return [];
  }

  return fileChanges.flatMap((change) => {
    if (
      !isRecord(change)
      || typeof change.filePath !== 'string'
      || change.filePath.length === 0
      || typeof change.existedBefore !== 'boolean'
      || typeof change.existedAfter !== 'boolean'
    ) {
      return [];
    }

    const normalizedChange: SessionFileChange = {
      filePath: change.filePath,
      existedBefore: change.existedBefore,
      existedAfter: change.existedAfter,
    };

    if (typeof change.beforeContent === 'string') {
      normalizedChange.beforeContent = change.beforeContent;
    }

    if (typeof change.afterContent === 'string') {
      normalizedChange.afterContent = change.afterContent;
    }

    return [normalizedChange];
  });
}

function normalizeSessionSnapshots(snapshots: unknown): SessionSnapshot[] {
  if (!Array.isArray(snapshots)) {
    return [];
  }

  return snapshots.flatMap((snapshot, index) => {
    if (!isRecord(snapshot)) {
      return [];
    }

    return [{
      id: typeof snapshot.id === 'string' && snapshot.id.length > 0
        ? snapshot.id
        : `snapshot-${index + 1}`,
      createdAt: readStoredTimestamp(snapshot.createdAt),
      mode: typeof snapshot.mode === 'string' && isAgentMode(snapshot.mode) ? snapshot.mode : 'build',
      userPrompt: readStoredString(snapshot.userPrompt),
      response: readStoredString(snapshot.response),
      fileChanges: normalizeSessionFileChanges(snapshot.fileChanges),
      diff: readStoredString(snapshot.diff),
    }];
  });
}

function normalizePermissionApprovals(approvals: unknown): SessionPermissionApproval[] {
  if (!Array.isArray(approvals)) {
    return [];
  }

  return approvals.flatMap((approval) => {
    if (
      !isRecord(approval)
      || !isPermissionScope(approval.scope)
      || typeof approval.targetPattern !== 'string'
    ) {
      return [];
    }

    return [{
      createdAt: readStoredTimestamp(approval.createdAt),
      scope: approval.scope,
      targetPattern: approval.targetPattern,
    }];
  });
}

function normalizePermissionOverrides(overrides: unknown): SessionPermissionOverrides {
  if (!isRecord(overrides)) {
    return {};
  }

  const normalizedOverrides: SessionPermissionOverrides = {};

  for (const [scope, outcome] of Object.entries(overrides)) {
    if (
      isPermissionScope(scope)
      && (outcome === 'allow' || outcome === 'ask' || outcome === 'deny')
    ) {
      normalizedOverrides[scope] = outcome;
    }
  }

  return normalizedOverrides;
}

function normalizeSessionPlanArtifact(artifact: unknown): SessionPlanArtifact | null {
  if (!isRecord(artifact)) {
    return null;
  }

  return {
    createdAt: readStoredTimestamp(artifact.createdAt),
    userPrompt: readStoredString(artifact.userPrompt),
    response: readStoredString(artifact.response),
    referencedPaths: normalizeStringArray(artifact.referencedPaths),
    proposedPaths: normalizeStringArray(artifact.proposedPaths),
  };
}

function normalizeTranscriptEntries(entries: unknown): SessionTranscriptEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.flatMap((entry, index) => {
    if (!isRecord(entry) || !isTranscriptEntryKind(entry.kind)) {
      return [];
    }

    const text = typeof entry.text === 'string' ? entry.text : '';
    if (entry.kind === 'user' && text.trim().startsWith('/')) {
      return [];
    }

    return [{
      id: typeof entry.id === 'string' && entry.id.length > 0
        ? entry.id
        : createEntryId('entry', index, entry.kind),
      createdAt: readStoredTimestamp(entry.createdAt),
      kind: entry.kind,
      text,
      ...(typeof entry.toolName === 'string' && entry.toolName.length > 0
        ? { toolName: entry.toolName }
        : {}),
    }];
  });
}

function normalizeTuiState(tuiState: unknown): SessionTuiState {
  if (!isRecord(tuiState)) {
    return createEmptyTuiState();
  }

  const mode = typeof tuiState.mode === 'string' && isAgentMode(tuiState.mode)
    ? tuiState.mode
    : null;

  return {
    mode,
    entries: normalizeTranscriptEntries(tuiState.entries),
  };
}

function canonicalizePath(potentialPath: string): string {
  return path.resolve(potentialPath).replaceAll(/\\/g, '/');
}

function normalizeApprovedExternalDirectories(directories: unknown): string[] {
  if (!Array.isArray(directories)) {
    return [];
  }

  return [
    ...new Set(
      directories
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map(canonicalizePath),
    ),
  ];
}

function assertValidSessionId(sessionId: string): void {
  if (!sessionIdPattern.test(sessionId) || sessionId === '.' || sessionId === '..') {
    throw new Error('Session id may contain only letters, numbers, ".", "_" and "-", and cannot be "." or "..".');
  }
}

function createEmptySession(sessionId: string, workspaceRoot = process.cwd()): AgentSession {
  const timestamp = createTimestamp();
  return {
    id: sessionId,
    workspaceRoot: path.resolve(workspaceRoot),
    createdAt: timestamp,
    updatedAt: timestamp,
    turns: [],
    snapshots: [],
    permissionApprovals: [],
    permissionOverrides: {},
    latestPlanArtifact: null,
    tuiState: createEmptyTuiState(),
    approvedExternalDirectories: [],
  };
}

export function getSessionsDirectoryPath(): string {
  return getGlobalSessionsDirectoryPath();
}

export function getSessionDirectoryPath(sessionId: string): string {
  assertValidSessionId(sessionId);
  return path.join(getSessionsDirectoryPath(), sessionId);
}

export function getSessionFilePath(sessionId: string): string {
  return path.join(getSessionDirectoryPath(sessionId), sessionFileName);
}

export function getSessionDebugLogPath(sessionId: string): string {
  return path.join(getSessionDirectoryPath(sessionId), sessionDebugLogFileName);
}

function doesSessionExist(sessionId: string): boolean {
  return fs.existsSync(getSessionDirectoryPath(sessionId));
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function extractCandidatePaths(userPrompt: string): string[] {
  return Array.from(
    new Set(
      buildReferencedPathGroups(userPrompt)
        .flatMap((group) => group.candidatePaths)
        .map((candidatePath) => candidatePath.trim())
        .filter((candidatePath) => candidatePath.length > 0),
    ),
  );
}

function extractResponsePaths(response: string): string[] {
  const fileReferenceRegex = /\b(?:[\w.-]+[\\/])*[\w.-]+\.[a-zA-Z0-9]{1,10}\b/g;
  return Array.from(new Set(response.match(fileReferenceRegex) ?? []));
}

function normalizeSnapshotFilePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\/+/, '');
}

function getFileExtension(filePath: string): string | null {
  const extension = path.posix.extname(filePath).toLowerCase();
  return extension.length > 1 ? extension.slice(1) : null;
}

function inferDiffFiletype(filePath: string): string | undefined {
  const extension = getFileExtension(filePath);
  if (!extension) {
    return undefined;
  }

  const diffFiletypeByExtension: Record<string, string> = {
    cjs: 'javascript',
    css: 'css',
    htm: 'html',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    markdown: 'markdown',
    md: 'markdown',
    mjs: 'javascript',
    mts: 'typescript',
    py: 'python',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  };

  return diffFiletypeByExtension[extension];
}

function getLatestSnapshotMutationKind(
  latestSnapshot: SessionSnapshot,
): 'edit' | 'write' | undefined {
  if (latestSnapshot.fileChanges.length === 0) {
    return undefined;
  }

  const allWrites = latestSnapshot.fileChanges.every((change) => !change.existedBefore);
  if (allWrites) {
    return 'write';
  }

  const allEdits = latestSnapshot.fileChanges.every((change) => change.existedBefore);
  if (allEdits) {
    return 'edit';
  }

  return undefined;
}

function buildLatestSessionDiffDetails(
  latestSnapshot: SessionSnapshot,
): LatestSessionDiffDetails {
  const mutationKind = getLatestSnapshotMutationKind(latestSnapshot);
  const primaryFileChange = latestSnapshot.fileChanges[0] ?? null;
  const normalizedFilePath = primaryFileChange
    ? normalizeSnapshotFilePath(primaryFileChange.filePath)
    : undefined;
  const filetype = normalizedFilePath ? inferDiffFiletype(normalizedFilePath) : undefined;
  const additionalFileCount = Math.max(0, latestSnapshot.fileChanges.length - 1);

  return {
    diffText: latestSnapshot.diff,
    ...(mutationKind ? { toolName: mutationKind, mutationKind } : {}),
    ...(normalizedFilePath ? { filePath: normalizedFilePath } : {}),
    ...(filetype ? { filetype } : {}),
    ...(additionalFileCount > 0 ? { additionalFileCount } : {}),
  };
}

function formatToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);

  return entries.join(', ');
}

function formatToolCallSummary(call: ExecutedToolCall): string {
  const formattedArgs = formatToolArgs(call.args);
  const argsSuffix = formattedArgs.length > 0 ? `(${formattedArgs})` : '()';
  const outcome = call.succeeded
    ? 'succeeded'
    : `failed${call.failureKind ? ` (${call.failureKind})` : ''}`;

  return `${call.toolName}${argsSuffix} ${outcome}`;
}

function buildTurnFactsMessage(turn: SessionTurn): ChatMessage | null {
  const facts: string[] = [];

  if (turn.workingDirectory) {
    facts.push(`working directory was "${turn.workingDirectory}"`);
  }

  if (turn.executedToolCalls && turn.executedToolCalls.length > 0) {
    const summarizedCalls = turn.executedToolCalls
      .slice(0, 3)
      .map(formatToolCallSummary)
      .join('; ');
    facts.push(`recorded tool calls: ${summarizedCalls}`);
  } else if (turn.stopReason === 'no_tool_calls') {
    facts.push('recorded tool calls: none');
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    role: 'system',
    content: `Recorded turn facts: ${facts.join('. ')}.`,
  };
}

function buildCompactedHistoryMessage(turns: SessionTurn[]): ChatMessage | null {
  if (turns.length === 0) {
    return null;
  }

  const compactedTurns = turns.slice(-maxCompactedTurns);
  const lines = compactedTurns.map((turn) => {
    const factsMessage = buildTurnFactsMessage(turn);

    return `- [${turn.mode}] User: ${truncateText(turn.userPrompt, 120)} ` +
      `Assistant: ${truncateText(turn.response, 160)}` +
      `${factsMessage?.content ? ` Facts: ${truncateText(factsMessage.content.replace(/^Recorded turn facts:\s*/i, ''), 160)}` : ''}`;
  });

  return {
    role: 'system',
    content: `Earlier session context for this workspace session (compacted):\n${lines.join('\n')}`,
  };
}

function ensureSessionsDirectory(): void {
  fs.mkdirSync(getSessionsDirectoryPath(), { recursive: true });
}

function saveSession(session: AgentSession): void {
  ensureSessionsDirectory();
  const sessionFilePath = getSessionFilePath(session.id);
  fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
  fs.writeFileSync(sessionFilePath, JSON.stringify(session, null, 2), 'utf-8');
}

function parseSessionFile(sessionId: string, sessionFilePath: string): AgentSession {
  let parsedSession: unknown;
  try {
    parsedSession = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Session file "${sessionFilePath}" is not valid JSON: ${message}`);
  }

  const session = isRecord(parsedSession) ? parsedSession : {};
  const createdAt = readStoredTimestamp(session.createdAt);
  const storedWorkspaceRoot = typeof session.workspaceRoot === 'string' && session.workspaceRoot.trim().length > 0
    ? path.resolve(session.workspaceRoot)
    : path.resolve(path.dirname(path.dirname(sessionFilePath)));

  return {
    id: typeof session.id === 'string' && session.id.length > 0 ? session.id : sessionId,
    workspaceRoot: storedWorkspaceRoot,
    createdAt,
    updatedAt: typeof session.updatedAt === 'string' && session.updatedAt.length > 0
      ? session.updatedAt
      : createdAt,
    turns: normalizeSessionTurns(session.turns),
    snapshots: normalizeSessionSnapshots(session.snapshots),
    permissionApprovals: normalizePermissionApprovals(session.permissionApprovals),
    permissionOverrides: normalizePermissionOverrides(session.permissionOverrides),
    latestPlanArtifact: normalizeSessionPlanArtifact(session.latestPlanArtifact),
    tuiState: normalizeTuiState(session.tuiState),
    approvedExternalDirectories: normalizeApprovedExternalDirectories(session.approvedExternalDirectories),
  };
}

function loadSessionFile(sessionId: string): AgentSession | null {
  const sessionFilePath = getSessionFilePath(sessionId);
  if (!fs.existsSync(sessionFilePath)) {
    return null;
  }

  return parseSessionFile(sessionId, sessionFilePath);
}

function restoreBeforeState(change: SessionFileChange, workspaceRoot: string): void {
  const resolvedPath = path.resolve(workspaceRoot, change.filePath);

  if (!change.existedBefore) {
    fs.rmSync(resolvedPath, { force: true });
    return;
  }

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, change.beforeContent ?? '', 'utf-8');
}

export function loadOrCreateSession(sessionId: string): AgentSession {
  const existingSession = loadSessionFile(sessionId);
  if (existingSession) {
    return existingSession;
  }

  const session = createEmptySession(sessionId);
  saveSession(session);
  return session;
}

export function loadExistingSession(sessionId: string): AgentSession {
  assertValidSessionId(sessionId);
  const existingSession = loadSessionFile(sessionId);
  if (existingSession) {
    return existingSession;
  }

  throw new Error(`Session not found: ${sessionId}`);
}

export function generateUniqueSessionId(now: Date = new Date()): string {
  const baseSessionId = `session-${formatSessionTimestamp(now)}`;
  let sessionId = baseSessionId;
  let suffix = 2;

  while (doesSessionExist(sessionId)) {
    sessionId = `${baseSessionId}-${suffix}`;
    suffix++;
  }

  return sessionId;
}

export function createSessionWithGeneratedId(now: Date = new Date()): AgentSession {
  const sessionId = generateUniqueSessionId(now);
  const session = createEmptySession(sessionId);
  saveSession(session);
  return session;
}

export function getSessionPermissionApprovals(sessionId: string): SessionPermissionApproval[] {
  const session = loadOrCreateSession(sessionId);
  return session.permissionApprovals;
}

export function getSessionPermissionOverrides(sessionId: string): SessionPermissionOverrides {
  const session = loadOrCreateSession(sessionId);
  return { ...session.permissionOverrides };
}

export function getSessionApprovedExternalDirectories(sessionId: string): string[] {
  const session = loadOrCreateSession(sessionId);
  return session.approvedExternalDirectories;
}

export function setSessionPermissionOverride(
  sessionId: string,
  scope: PermissionScope,
  outcome: PermissionOutcome,
): AgentSession {
  const session = loadOrCreateSession(sessionId);
  session.permissionOverrides = {
    ...session.permissionOverrides,
    [scope]: outcome,
  };
  session.updatedAt = createTimestamp();
  saveSession(session);
  resetPermissionDecisionCache();
  return session;
}

export function appendSessionApprovedExternalDirectory(
  sessionId: string,
  directory: string,
): AgentSession {
  const session = loadOrCreateSession(sessionId);
  session.approvedExternalDirectories = normalizeApprovedExternalDirectories([
    ...session.approvedExternalDirectories,
    directory,
  ]);
  session.updatedAt = createTimestamp();
  saveSession(session);
  return session;
}

export function appendSessionPermissionApproval(
  sessionId: string,
  approval: Omit<SessionPermissionApproval, 'createdAt'>,
): AgentSession {
  const session = loadOrCreateSession(sessionId);
  const createdAt = createTimestamp();
  const nextApproval: SessionPermissionApproval = {
    createdAt,
    ...approval,
  };

  const existingApprovalIndex = session.permissionApprovals.findIndex((existingApproval) => (
    existingApproval.scope === nextApproval.scope
    && existingApproval.targetPattern === nextApproval.targetPattern
  ));

  if (existingApprovalIndex >= 0) {
    session.permissionApprovals[existingApprovalIndex] = nextApproval;
  } else {
    session.permissionApprovals.push(nextApproval);
  }

  session.updatedAt = createdAt;
  saveSession(session);
  return session;
}

export function buildSessionHistoryMessages(session: AgentSession): ChatMessage[] {
  if (session.turns.length <= maxVerbatimTurns) {
    return session.turns.flatMap((turn) => {
      const messages: ChatMessage[] = [
        { role: 'user' as const, content: turn.userPrompt },
        { role: 'model' as const, content: turn.response },
      ];
      const factsMessage = buildTurnFactsMessage(turn);
      if (factsMessage) {
        messages.push(factsMessage);
      }
      return messages;
    });
  }

  const compactedTurns = session.turns.slice(0, -maxVerbatimTurns);
  const recentTurns = session.turns.slice(-maxVerbatimTurns);
  const messages: ChatMessage[] = [];
  const compactedHistoryMessage = buildCompactedHistoryMessage(compactedTurns);

  if (compactedHistoryMessage) {
    messages.push(compactedHistoryMessage);
  }

  for (const turn of recentTurns) {
    messages.push(
      { role: 'user', content: turn.userPrompt },
      { role: 'model', content: turn.response },
    );
    const factsMessage = buildTurnFactsMessage(turn);
    if (factsMessage) {
      messages.push(factsMessage);
    }
  }

  return messages;
}

export function buildSessionTuiEntriesFromTurns(turns: SessionTurn[]): SessionTranscriptEntry[] {
  return turns.flatMap((turn, index) => ([
    {
      id: createEntryId('turn', index, 'user'),
      createdAt: turn.timestamp,
      kind: 'user' as const,
      text: turn.userPrompt,
    },
    {
      id: createEntryId('turn', index, 'assistant'),
      createdAt: turn.timestamp,
      kind: 'assistant' as const,
      text: turn.response,
    },
  ]));
}

export function loadSessionTuiState(sessionId: string): SessionTuiState {
  const session = loadOrCreateSession(sessionId);
  if (session.tuiState.entries.length > 0 || session.turns.length === 0) {
    return session.tuiState;
  }

  return {
    mode: session.tuiState.mode,
    entries: buildSessionTuiEntriesFromTurns(session.turns),
  };
}

export function saveSessionTuiEntries(
  sessionId: string,
  entries: SessionTranscriptEntry[],
): AgentSession {
  const session = loadOrCreateSession(sessionId);
  session.tuiState = {
    mode: session.tuiState.mode,
    entries: normalizeTranscriptEntries(entries),
  };
  session.updatedAt = createTimestamp();
  saveSession(session);
  return session;
}

export function saveSessionTuiMode(
  sessionId: string,
  mode: AgentMode,
): AgentSession {
  const session = loadOrCreateSession(sessionId);
  session.tuiState = {
    mode,
    entries: session.tuiState.entries,
  };
  session.updatedAt = createTimestamp();
  saveSession(session);
  return session;
}

export function appendSessionTurn(
  sessionId: string,
  turn: SessionTurn,
  fileChanges: SessionFileChange[],
): AgentSession {
  const session = loadOrCreateSession(sessionId);
  session.turns.push(turn);

  if (fileChanges.length > 0) {
    session.snapshots.push({
      id: createSnapshotId(),
      createdAt: turn.timestamp,
      mode: turn.mode,
      userPrompt: turn.userPrompt,
      response: turn.response,
      fileChanges,
      diff: buildSessionFileDiff(fileChanges),
    });
  }

  session.updatedAt = createTimestamp();
  saveSession(session);
  return session;
}

export function saveSessionPlanArtifact(
  sessionId: string,
  artifact: Pick<SessionPlanArtifact, 'userPrompt' | 'response'>,
): AgentSession {
  const session = loadOrCreateSession(sessionId);
  session.latestPlanArtifact = {
    createdAt: createTimestamp(),
    userPrompt: artifact.userPrompt,
    response: artifact.response,
    referencedPaths: extractCandidatePaths(artifact.userPrompt),
    proposedPaths: extractResponsePaths(artifact.response),
  };
  session.updatedAt = createTimestamp();
  saveSession(session);
  return session;
}

export function formatLatestSessionPlan(sessionId: string): string {
  const session = loadExistingSession(sessionId);

  const artifact = session.latestPlanArtifact;
  if (!artifact) {
    return `No saved plan is recorded for session "${sessionId}".`;
  }

  const sections = [
    `Latest saved plan for session "${sessionId}":`,
    '',
    `Prompt: ${artifact.userPrompt}`,
  ];

  if (artifact.referencedPaths.length > 0) {
    sections.push('', `Referenced paths: ${artifact.referencedPaths.join(', ')}`);
  }

  if (artifact.proposedPaths.length > 0) {
    sections.push('', `Proposed paths: ${artifact.proposedPaths.join(', ')}`);
  }

  sections.push('', 'Plan response:', artifact.response);
  return sections.join('\n');
}

export function getLatestSessionDiff(sessionId: string): string {
  const session = loadExistingSession(sessionId);

  const latestSnapshot = session.snapshots.at(-1);
  if (!latestSnapshot) {
    return `No agent-generated file snapshots are recorded for session "${sessionId}".`;
  }

  return latestSnapshot.diff || `No diff is stored for snapshot ${latestSnapshot.id}.`;
}

export function getLatestSessionDiffDetails(sessionId: string): LatestSessionDiffDetails {
  const session = loadExistingSession(sessionId);

  const latestSnapshot = session.snapshots.at(-1);
  if (!latestSnapshot) {
    throw new Error(`No agent-generated file snapshots are recorded for session "${sessionId}".`);
  }

  if (!latestSnapshot.diff) {
    throw new Error(`No diff is stored for snapshot ${latestSnapshot.id}.`);
  }

  return buildLatestSessionDiffDetails(latestSnapshot);
}

export function undoLastSessionSnapshot(sessionId: string): string {
  const session = loadExistingSession(sessionId);

  const latestSnapshot = session.snapshots.pop();
  if (!latestSnapshot) {
    throw new Error(`Session "${sessionId}" has no recorded agent snapshot to undo.`);
  }

  for (const change of latestSnapshot.fileChanges) {
    restoreBeforeState(change, session.workspaceRoot);
  }

  const response = [
    `Reverted snapshot ${latestSnapshot.id} in session "${sessionId}".`,
    '',
    ...latestSnapshot.fileChanges.map((change) => `- ${change.filePath}`),
  ].join('\n');

  session.turns.push({
    timestamp: createTimestamp(),
    mode: 'build',
    userPrompt: 'Undo the last agent change in this session.',
    response,
    stopReason: undefined,
    executedToolCalls: undefined,
  });
  session.updatedAt = createTimestamp();
  saveSession(session);

  return response;
}
