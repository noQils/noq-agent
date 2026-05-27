import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { type AgentMode } from './agentMode';
import { ensureParentDirectory, resolveProjectPath, writeFileContent } from './fileUtils';
import { buildReferencedPathGroups } from './pathReferenceHints';
import { type PermissionScope } from './permissions/types';
import { type ChatMessage } from './providers/types';
import { type SessionFileChange } from './sessionChangeTracker';

const sessionIdPattern = /^[A-Za-z0-9._-]+$/;
const sessionsRootDirectory = '.noq-agent/sessions';
const maxVerbatimTurns = 6;
const maxCompactedTurns = 12;

export interface SessionTurn {
  timestamp: string;
  mode: AgentMode;
  userPrompt: string;
  response: string;
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

export interface SessionPermissionApproval {
  createdAt: string;
  scope: PermissionScope;
  targetPattern: string;
}

export interface SessionPlanArtifact {
  createdAt: string;
  userPrompt: string;
  response: string;
  referencedPaths: string[];
  proposedPaths: string[];
}

export interface AgentSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
  snapshots: SessionSnapshot[];
  permissionApprovals: SessionPermissionApproval[];
  latestPlanArtifact: SessionPlanArtifact | null;
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

function assertValidSessionId(sessionId: string): void {
  if (!sessionIdPattern.test(sessionId)) {
    throw new Error('Session id may contain only letters, numbers, ".", "_" and "-".');
  }
}

function createEmptySession(sessionId: string): AgentSession {
  const timestamp = createTimestamp();
  return {
    id: sessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    turns: [],
    snapshots: [],
    permissionApprovals: [],
    latestPlanArtifact: null,
  };
}

function getSessionsDirectoryPath(): string {
  return resolveProjectPath(sessionsRootDirectory);
}

function getSessionFilePath(sessionId: string): string {
  assertValidSessionId(sessionId);
  return path.join(getSessionsDirectoryPath(), `${sessionId}.json`);
}

function doesSessionExist(sessionId: string): boolean {
  return fs.existsSync(getSessionFilePath(sessionId));
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

function buildCompactedHistoryMessage(turns: SessionTurn[]): ChatMessage | null {
  if (turns.length === 0) {
    return null;
  }

  const compactedTurns = turns.slice(-maxCompactedTurns);
  const lines = compactedTurns.map((turn) => (
    `- [${turn.mode}] User: ${truncateText(turn.userPrompt, 120)} ` +
    `Assistant: ${truncateText(turn.response, 160)}`
  ));

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
  ensureParentDirectory(path.relative(process.cwd(), sessionFilePath));
  fs.writeFileSync(sessionFilePath, JSON.stringify(session, null, 2), 'utf-8');
}

function loadSessionFile(sessionId: string): AgentSession | null {
  const sessionFilePath = getSessionFilePath(sessionId);
  if (!fs.existsSync(sessionFilePath)) {
    return null;
  }

  const session = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8')) as Partial<AgentSession>;

  return {
    id: session.id ?? sessionId,
    createdAt: session.createdAt ?? createTimestamp(),
    updatedAt: session.updatedAt ?? session.createdAt ?? createTimestamp(),
    turns: Array.isArray(session.turns) ? session.turns : [],
    snapshots: Array.isArray(session.snapshots) ? session.snapshots : [],
    permissionApprovals: Array.isArray(session.permissionApprovals) ? session.permissionApprovals : [],
    latestPlanArtifact: session.latestPlanArtifact ?? null,
  };
}

function writeSnapshotSide(
  targetDirectory: string,
  fileChanges: SessionFileChange[],
  side: 'before' | 'after',
): void {
  for (const change of fileChanges) {
    const exists = side === 'before' ? change.existedBefore : change.existedAfter;
    if (!exists) {
      continue;
    }

    const content = side === 'before'
      ? change.beforeContent ?? ''
      : change.afterContent ?? '';
    const targetPath = path.join(targetDirectory, change.filePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');
  }
}

function buildFallbackDiff(fileChanges: SessionFileChange[]): string {
  const lines = fileChanges.map((change) => {
    if (!change.existedBefore && change.existedAfter) {
      return `created ${change.filePath}`;
    }

    if (change.existedBefore && !change.existedAfter) {
      return `deleted ${change.filePath}`;
    }

    return `modified ${change.filePath}`;
  });

  return `Git diff unavailable. Changed files:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function sanitizeGitBackedDiff(diff: string): string {
  return diff
    .replaceAll('a/before/', 'a/')
    .replaceAll('a/after/', 'a/')
    .replaceAll('b/before/', 'b/')
    .replaceAll('b/after/', 'b/')
    .trim();
}

function buildGitBackedDiff(fileChanges: SessionFileChange[]): string {
  if (fileChanges.length === 0) {
    return '';
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-session-diff-'));
  const beforeDirectory = path.join(tempRoot, 'before');
  const afterDirectory = path.join(tempRoot, 'after');
  fs.mkdirSync(beforeDirectory, { recursive: true });
  fs.mkdirSync(afterDirectory, { recursive: true });

  try {
    writeSnapshotSide(beforeDirectory, fileChanges, 'before');
    writeSnapshotSide(afterDirectory, fileChanges, 'after');

    const diffResult = spawnSync(
      'git',
      ['diff', '--no-index', '--src-prefix=a/', '--dst-prefix=b/', 'before', 'after'],
      {
        cwd: tempRoot,
        encoding: 'utf-8',
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    if (diffResult.error || (diffResult.status !== 0 && diffResult.status !== 1)) {
      return buildFallbackDiff(fileChanges);
    }

    const sanitizedDiff = sanitizeGitBackedDiff(diffResult.stdout);
    return sanitizedDiff.length > 0 ? sanitizedDiff : buildFallbackDiff(fileChanges);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function restoreBeforeState(change: SessionFileChange): void {
  const resolvedPath = resolveProjectPath(change.filePath);

  if (!change.existedBefore) {
    fs.rmSync(resolvedPath, { force: true });
    return;
  }

  ensureParentDirectory(change.filePath);
  writeFileContent(change.filePath, change.beforeContent ?? '');
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
    return session.turns.flatMap((turn) => ([
      { role: 'user' as const, content: turn.userPrompt },
      { role: 'model' as const, content: turn.response },
    ]));
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
  }

  return messages;
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
      diff: buildGitBackedDiff(fileChanges),
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
  const session = loadSessionFile(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

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
  const session = loadSessionFile(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const latestSnapshot = session.snapshots.at(-1);
  if (!latestSnapshot) {
    return `No agent-generated file snapshots are recorded for session "${sessionId}".`;
  }

  return latestSnapshot.diff || `No diff is stored for snapshot ${latestSnapshot.id}.`;
}

export function undoLastSessionSnapshot(sessionId: string): string {
  const session = loadSessionFile(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const latestSnapshot = session.snapshots.pop();
  if (!latestSnapshot) {
    throw new Error(`Session "${sessionId}" has no recorded agent snapshot to undo.`);
  }

  for (const change of latestSnapshot.fileChanges) {
    restoreBeforeState(change);
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
  });
  session.updatedAt = createTimestamp();
  saveSession(session);

  return response;
}
