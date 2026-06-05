import { checkPathExists, getProjectFilePaths } from './fileUtils';
import { findClosestFileMatch } from './pathMatcher';
import { type AgentMode } from './agentMode';
import { getProvider } from './providers';
import {
  type ChatMessage,
  type ChatResult,
  type ExecutedToolCall,
  type Provider,
  type StopReason,
  type ToolMutationCallback,
} from './providers/types';
import { getSystemPrompt } from './systemPrompt';
import { buildReferencedPathGroups } from './pathReferenceHints';
import { resetPermissionDecisionCache } from './runtime/executeToolCall';
import { debugLog } from './runtimeSettings';
import { getToolsForMode } from './tools';
import { formatTodoItems, hasTodoItems, resetTodoState } from './todoState';

export interface RunAgentTurnOptions {
    historyMessages?: ChatMessage[];
    onMutation?: ToolMutationCallback;
    provider?: Provider;
}

export interface RunAgentTurnResult {
    response: string;
    executedToolCalls: ExecutedToolCall[];
    stopReason: StopReason | undefined;
}

// Function to get the file path argument
function getFilePathArg(args: Record<string, unknown>): string | null {
    const value = args.filePath;
    return typeof value === 'string' ? value : null;
}

type TurnState = {
    mutatedFiles: Set<string>;
    failedMutationCounts: Map<string, number>;
    blockedActionCalls: ExecutedToolCall[];
};

type WorkflowState = {
    mutatedFilesNeedingVerification: Set<string>;
    verificationCommandsNeedingRerun: Set<string>;
    commandsRunSinceLastMutation: Set<string>;
    flowRoundCount: number;
    buildResponseRewriteIssued: boolean;
    planResponseRewriteIssued: boolean;
    planFalseCompletionRewriteIssued: boolean;
    sawSuccessfulMutation: boolean;
    todoReminderIssued: boolean;
    toolUsageContradictionRewriteIssued: boolean;
};

function getRunCommandArg(args: Record<string, unknown>): string | null {
    const value = args.command;
    return typeof value === 'string' ? value : null;
}

function didCommandReachExecution(call: ExecutedToolCall, command: string): boolean {
    if (call.succeeded) {
        return true;
    }

    return typeof call.error === 'string' && call.error.startsWith(`Command ${command} failed:`);
}

function collectTurnState(calls: ExecutedToolCall[], currentState: WorkflowState): { updatedWorkflowState: WorkflowState, turnState: TurnState } {
    const workflowState = currentState;
    const turnState: TurnState = {
        mutatedFiles: new Set(),
        failedMutationCounts: new Map(),
        blockedActionCalls: [],
    };

    for (const call of calls) {
        const toolName = call.toolName;

        if (call.failureKind === 'permission_denied' || call.failureKind === 'mode_denied') {
            turnState.blockedActionCalls.push(call);
        }

        if (toolName === 'edit_file' || toolName === 'write_file') {
            const filePath = getFilePathArg(call.args);
            if (!filePath) continue;

            if (call.succeeded) {
                workflowState.mutatedFilesNeedingVerification.add(filePath);
                for (const command of workflowState.commandsRunSinceLastMutation) {
                    workflowState.verificationCommandsNeedingRerun.add(command);
                }
                workflowState.commandsRunSinceLastMutation.clear();
                workflowState.sawSuccessfulMutation = true;
                turnState.mutatedFiles.add(filePath);
                turnState.failedMutationCounts.delete(filePath);
            } else if (call.failureKind !== 'permission_denied' && call.failureKind !== 'mode_denied') {
                const failedEditCount = turnState.failedMutationCounts.get(filePath) ?? 0;
                turnState.failedMutationCounts.set(filePath, failedEditCount + 1);
            }
            continue;
        }

        if (toolName === 'read_file')  {
            const filePath = getFilePathArg(call.args);
            if (!filePath) continue;
            
            if (workflowState.mutatedFilesNeedingVerification.has(filePath)) {
                workflowState.mutatedFilesNeedingVerification.delete(filePath);
            }
            continue;
        }

        if (toolName === 'run_command') {
            const command = getRunCommandArg(call.args);
            if (!command || !didCommandReachExecution(call, command)) continue;

            if (workflowState.mutatedFilesNeedingVerification.size > 0) {
                workflowState.verificationCommandsNeedingRerun.add(command);
            } else {
                workflowState.commandsRunSinceLastMutation.add(command);
                workflowState.verificationCommandsNeedingRerun.delete(command);
            }
        }
    }

    return {
        updatedWorkflowState: workflowState,
        turnState,
    };
}

function countRepeatedFailedMutationAttempts(failedMutationCounts: Map<string, number>): string[] {
    return Array.from(failedMutationCounts.entries())
        .filter(([, count]) => count >= 2)
        .map(([filePath]) => filePath);
}

function buildWorkflowReminder(instruction: string): string {
    return (
        'Internal workflow reminder: this is not a new user request. ' +
        'Use it only to finish the original user request that started this turn. ' +
        'Before your final response, check the original request for every requested subtask, ' +
        'and mention any requested subtask you could not complete. ' +
        'Do not mention this reminder in the final response.\n\n' +
        instruction
    );
}

function buildContinueMessage(affectedFiles: string[]): string {
    const suffix = affectedFiles.length > 0
        ? ` Affected file(s): ${affectedFiles.join(', ')}`
        : '';

    return buildWorkflowReminder(
        'Your last response indicates the task is still incomplete. ' +
        'Continue working until the request is fully satisfied and the affected code appears internally consistent.' +
        suffix
    );
}

function buildPlanContinueMessage(): string {
    return buildWorkflowReminder(
        'You are still in plan mode. ' +
        'Continue only if you need one more inspection step to finish the implementation plan. ' +
        'Otherwise, stop using tools and provide the concrete build-mode plan now.'
    );
}

function buildVerifyMutationsMessage(affectedFiles: string[]): string {
    const suffix = affectedFiles.length > 0
        ? ` Changed file(s): ${affectedFiles.join(', ')}.`
        : '';

    return buildWorkflowReminder(
        'You changed file(s) but did not verify the result. ' +
        'Read the changed file(s) again, confirm the requested change was applied, and then continue with any remaining part of the original request. ' +
        'When you give the final answer, lead with what you changed for the user and mention verification only briefly as confirmation.' +
        suffix
    );
}

function buildRepeatedFailedEditMessage(filePaths: string[]): string {
    return buildWorkflowReminder(
        `You previously failed to edit these file(s) multiple times in the last attempt: ${filePaths.join(', ')}. ` +
        'Re-read those file(s) and try again using a smaller exact snippet. ' +
        'Do not use run_command to modify files.'
    );
}

function buildFailedMutationRetryMessage(filePaths: string[]): string {
    return buildWorkflowReminder(
        `Your attempted file change failed for: ${filePaths.join(', ')}. ` +
        'Do not claim the change was made. Re-read the file, then retry with a smaller exact edit_file snippet if the change is still needed. ' +
        'Do not use run_command to modify files, but still run any trusted verification command the user requested after the edit succeeds.'
    );
}

function buildBlockedActionMessage(calls: ExecutedToolCall[]): string {
    const blockedActions = Array.from(
        new Set(
            calls.map((call) => {
                if (call.failureKind === 'mode_denied') {
                    const target = call.target ? `target=${call.target}` : 'target=(none)';
                    const mode = call.blockedByMode ?? 'current';
                    return `${call.toolName} (unavailable in ${mode} mode, ${target})`;
                }

                const scope = call.permissionScope ? `scope=${call.permissionScope}` : 'scope=unknown';
                const target = call.target ? `target=${call.target}` : 'target=(none)';
                const deniedBy = call.permissionDeniedBy === 'policy'
                    ? 'blocked by config'
                    : 'rejected by user';
                return `${call.toolName} (${scope}, ${target}, ${deniedBy})`;
            })
        )
    );

    return buildWorkflowReminder(
        `The following action(s) were blocked: ${blockedActions.join('; ')}. ` +
        'Do not retry the same blocked tool call in this turn. ' +
        'If the original request cannot be completed without those actions, explain that clearly and summarize what remains blocked.'
    );
}

function buildSummaryOnlyMessage(): string {
    return buildWorkflowReminder(
        'The requested changes are already applied and verified. ' +
        'Provide a concise final summary answering the original user request only. ' +
        'Lead with what you created or changed, name the relevant file when helpful, and mention verification only briefly as supporting evidence instead of the main point.'
    );
}

function buildPlanSummaryOnlyMessage(): string {
    return buildWorkflowReminder(
        'You already gathered enough inspection context for the original user request. ' +
        'Provide the final plan now. ' +
        'State what you inspected, name the exact file or path you would create or edit, describe what you would change there, and mention the main follow-up check if it matters.'
    );
}

function buildAnswerNowMessage(): string {
    return buildWorkflowReminder(
        'You already gathered the relevant tool results for the original user request. ' +
        'Do not call more tools unless a truly missing fact blocks the answer. ' +
        'Provide the concise final answer now based on the current evidence.'
    );
}

function isToolUsageFollowupRequest(userPrompt: string): boolean {
    return /\b(tool|tools|tool call|tool usage|used a tool|used tools|how did you get|how did you know|assumption|guess)\b/i.test(userPrompt);
}

function isToolUsageDenialResponse(responseText: string): boolean {
    const normalized = responseText.trim().toLowerCase();
    return /i didn['’]t (actually )?use a tool/.test(normalized)
        || /i did not (actually )?use a tool/.test(normalized)
        || /relying on an assumption/.test(normalized)
        || /made a bad assumption/.test(normalized)
        || /wasn['’]t actually.*tool/.test(normalized);
}

function extractRecordedToolFactMessages(historyMessages: ChatMessage[]): string[] {
    return historyMessages
        .flatMap((message) => (
            message.role === 'system' && typeof message.content === 'string'
                ? [message.content.trim()]
                : []
        ))
        .filter((content) => /^Recorded turn facts:/i.test(content))
        .filter((content) => /recorded tool calls:/i.test(content) && !/recorded tool calls:\s*none/i.test(content));
}

function shouldRewriteToolUsageContradictionResponse(
    userPrompt: string,
    responseText: string,
    historyMessages: ChatMessage[],
    rewriteIssued: boolean,
): boolean {
    if (rewriteIssued || !isToolUsageFollowupRequest(userPrompt) || !isToolUsageDenialResponse(responseText)) {
        return false;
    }

    return extractRecordedToolFactMessages(historyMessages).length > 0;
}

function buildToolUsageContradictionRewriteMessage(recordedFactMessages: string[]): string {
    const recentFacts = recordedFactMessages.slice(-2).join('\n');

    return buildWorkflowReminder(
        'Rewrite your previous answer. ' +
        'Your answer contradicted the recorded session facts about prior tool usage. ' +
        'Base the rewrite on the recorded facts below, state that the earlier turn did use tools, and mention the relevant recorded tool call(s) directly. ' +
        'Do not claim that you relied only on assumption or memory.\n\n' +
        recentFacts
    );
}

function buildRerunVerificationCommandMessage(commands: string[]): string {
    return buildWorkflowReminder(
        'You ran verification command(s) before the latest file changes were read back. ' +
        `Run the verification command(s) again now that file verification is complete: ${commands.join(', ')}. ` +
        'Then continue with any remaining part of the original request.'
    );
}

function buildExistingPathMessage(filePath: string): string {
    return `The referenced path "${filePath}" exists. Use this exact path directly when it is relevant instead of searching for it again.`;
}

function buildClosestPathMessage(requestedPath: string, candidatePath: string): string {
    return `The referenced file "${requestedPath}" does not exist. A close existing file match was found: "${candidatePath}". If the request sounds like editing or adding content inside an existing file, treat "${candidatePath}" as the intended target and read it directly. Do not keep searching for "${requestedPath}" unless you need to decide whether the user clearly asked for a new file with that exact path.`;
}

function shouldRewritePlanModeResponse(mode: AgentMode, responseText: string, rewriteIssued: boolean): boolean {
    if (mode !== 'plan' || rewriteIssued) {
        return false;
    }

    return /```/.test(responseText)
        || /if you want, i can/i.test(responseText)
        || /example usage/i.test(responseText);
}

function isPlanStyleUserRequest(userPrompt: string): boolean {
    return /\b(create|add|make|write|implement|update|edit|modify|change|fix|refactor|rename|remove|delete)\b/i.test(userPrompt);
}

function isPlanModeMetaRequest(userPrompt: string): boolean {
    return /\b(plan mode|planning mode|read-only mode)\b/i.test(userPrompt);
}

function isPlanModeRefusalResponse(responseText: string): boolean {
    const trimmed = responseText.trim().toLowerCase();
    return /^i can['’]t complete that in plan mode\b/.test(trimmed)
        || /^plan mode cannot complete\b/.test(trimmed)
        || /^i cannot complete that in plan mode\b/.test(trimmed);
}

function isPlanModeFalseCompletionResponse(responseText: string): boolean {
    const trimmed = responseText.trim().toLowerCase();
    return /^done\b/.test(trimmed)
        || /^completed\b/.test(trimmed)
        || /^i (created|added|updated|edited|implemented|wrote|made|finished)\b/.test(trimmed)
        || /\bdone\s+[—-]\s+i (created|added|updated|edited|implemented|wrote|made|finished)\b/.test(trimmed);
}

function isMutationStyleUserRequest(userPrompt: string): boolean {
    return /\b(create|add|make|write|implement|update|edit|modify|change|fix|refactor|rename|remove|delete)\b/i.test(userPrompt);
}

function isVerificationFocusedUserRequest(userPrompt: string): boolean {
    return /\b(verify|verification|check|confirm|test|validate)\b/i.test(userPrompt);
}

function isVerificationCenteredResponse(responseText: string): boolean {
    const trimmed = responseText.trim().toLowerCase();
    return /^i (verified|checked|confirmed)\b/.test(trimmed)
        || /^verified\b/.test(trimmed)
        || /^verification (is )?complete\b/.test(trimmed);
}

function buildPlanModeRewriteMessage(): string {
    return buildWorkflowReminder(
        'Rewrite your previous answer for plan mode. ' +
        'Keep it to 2 to 4 sentences or a numbered list with at most 3 items. ' +
        'Lead with the concrete implementation plan, not with a limitation sentence. ' +
        'Base the answer on what you inspected, name the exact file or path you would create or edit in build mode, and describe what you would implement there. ' +
        'Do not include code fences, sample implementations, usage examples, or "if you want, I can" menus. ' +
        'Keep the answer practical and read-only.'
    );
}

function buildPlanAnswerNowMessage(): string {
    return buildWorkflowReminder(
        'You already gathered the relevant inspection results for the original user request. ' +
        'Do not call more tools unless a truly missing fact blocks the plan. ' +
        'Provide the concise build-mode implementation plan now based on the current evidence.'
    );
}

function shouldRewritePlanRefusalResponse(
    mode: AgentMode,
    userPrompt: string,
    responseText: string,
    rewriteIssued: boolean,
): boolean {
    if (mode !== 'plan' || rewriteIssued) {
        return false;
    }

    if (!isPlanStyleUserRequest(userPrompt) || isPlanModeMetaRequest(userPrompt)) {
        return false;
    }

    return isPlanModeRefusalResponse(responseText);
}

function buildPlanRefusalRewriteMessage(): string {
    return buildWorkflowReminder(
        'Rewrite your previous answer for plan mode. ' +
        'Do not begin with a refusal or limitation sentence. ' +
        'For this coding request, give the direct implementation plan: say what you inspected, name the exact file or path you would create or edit, and describe what you would implement there. ' +
        'Keep it concise, practical, and read-only. ' +
        'Do not call more tools.'
    );
}

function shouldRewritePlanFalseCompletionResponse(
    mode: AgentMode,
    userPrompt: string,
    responseText: string,
    rewriteIssued: boolean,
): boolean {
    if (mode !== 'plan' || rewriteIssued) {
        return false;
    }

    if (!isPlanStyleUserRequest(userPrompt) || isPlanModeMetaRequest(userPrompt)) {
        return false;
    }

    return isPlanModeFalseCompletionResponse(responseText);
}

function buildPlanFalseCompletionRewriteMessage(): string {
    return buildWorkflowReminder(
        'Rewrite your previous answer for plan mode. ' +
        'Do not claim that any file was created, edited, updated, implemented, or completed. ' +
        'Describe the work only as a proposed build-mode plan based on what you inspected: name the exact file or path you would create or edit, explain what you would change there, and mention the main follow-up check if it matters. ' +
        'Do not call more tools.'
    );
}

function shouldRewriteBuildResponse(
    mode: AgentMode,
    userPrompt: string,
    responseText: string,
    workflowState: WorkflowState,
): boolean {
    if (mode !== 'build' || workflowState.buildResponseRewriteIssued) {
        return false;
    }

    if (!workflowState.sawSuccessfulMutation || workflowState.mutatedFilesNeedingVerification.size > 0) {
        return false;
    }

    if (!isMutationStyleUserRequest(userPrompt) || isVerificationFocusedUserRequest(userPrompt)) {
        return false;
    }

    return isVerificationCenteredResponse(responseText);
}

function buildBuildResponseRewriteMessage(): string {
    return buildWorkflowReminder(
        'Rewrite your previous answer for build mode. ' +
        'The requested change is already complete and verified. ' +
        'Answer the original user request directly, lead with what you created or changed, name the relevant file when helpful, and mention verification only briefly as confirmation. ' +
        'Do not call more tools.'
    );
}

function shouldPromptForTodoTracking(
    mode: AgentMode,
    executedToolCalls: ExecutedToolCall[],
    workflowState: WorkflowState,
    stopReason?: ChatResult['stopReason'],
): boolean {
    return mode === 'build'
        && !workflowState.todoReminderIssued
        && !hasTodoItems()
        && executedToolCalls.length >= 2
        && stopReason !== 'no_tool_calls'
        && workflowState.flowRoundCount >= 1;
}

function buildTodoTrackingReminderMessage(): string {
    return buildWorkflowReminder(
        'This task appears to involve multiple meaningful steps. ' +
        'Before continuing, create a short todo list with todo_write and keep it updated as steps start, complete, or change. ' +
        'Use the full updated list on each todo_write call.'
    );
}

function buildTodoStateMessage(): string {
    return (
        `${formatTodoItems()}\n` +
        'Use todo_write to keep this list current by replacing the full list when progress changes.'
    );
}

type CompletionAction =
    | { type: 'return'; text: string }
    | { type: 'continue'; reminder: string; fastForwardToFinalRound?: boolean };

function handlePlanModeCompletion(
    userPrompt: string,
    response: ChatResult,
    executedToolCalls: ExecutedToolCall[],
    workflowState: WorkflowState,
): CompletionAction | null {
    if (response.text?.trim()) {
        if (shouldRewritePlanFalseCompletionResponse('plan', userPrompt, response.text, workflowState.planFalseCompletionRewriteIssued)) {
            workflowState.planFalseCompletionRewriteIssued = true;
            return {
                type: 'continue',
                reminder: buildPlanFalseCompletionRewriteMessage(),
            };
        }

        if (shouldRewritePlanRefusalResponse('plan', userPrompt, response.text, workflowState.planResponseRewriteIssued)) {
            workflowState.planResponseRewriteIssued = true;
            return {
                type: 'continue',
                reminder: buildPlanRefusalRewriteMessage(),
            };
        }

        if (shouldRewritePlanModeResponse('plan', response.text, workflowState.planResponseRewriteIssued)) {
            workflowState.planResponseRewriteIssued = true;
            return {
                type: 'continue',
                reminder: buildPlanModeRewriteMessage(),
            };
        }

        return { type: 'return', text: response.text };
    }

    if (response.stopReason === 'tool_round_limit_reached') {
        return {
            type: 'continue',
            reminder: buildPlanSummaryOnlyMessage(),
            fastForwardToFinalRound: true,
        };
    }

    if (response.stopReason === 'no_tool_calls' && executedToolCalls.length > 0) {
        return {
            type: 'continue',
            reminder: buildPlanAnswerNowMessage(),
        };
    }

    if (executedToolCalls.length === 0 || response.stopReason === 'no_tool_calls') {
        return { type: 'return', text: response.text };
    }

    return {
        type: 'continue',
        reminder: buildPlanContinueMessage(),
    };
}

function handleBuildModeCompletion(
    userPrompt: string,
    response: ChatResult,
    executedToolCalls: ExecutedToolCall[],
    workflowState: WorkflowState,
): CompletionAction | null {
    const allMutationsVerified = workflowState.mutatedFilesNeedingVerification.size === 0;

    if (response.stopReason === 'tool_round_limit_reached') {
        if (allMutationsVerified) {
            if (response.text?.trim()) {
                if (shouldRewriteBuildResponse('build', userPrompt, response.text, workflowState)) {
                    workflowState.buildResponseRewriteIssued = true;
                    return {
                        type: 'continue',
                        reminder: buildBuildResponseRewriteMessage(),
                    };
                }

                return { type: 'return', text: response.text };
            }

            return {
                type: 'continue',
                reminder: buildSummaryOnlyMessage(),
                fastForwardToFinalRound: true,
            };
        }

        return {
            type: 'continue',
            reminder: buildVerifyMutationsMessage(Array.from(workflowState.mutatedFilesNeedingVerification)),
        };
    }

    if (!allMutationsVerified) {
        return {
            type: 'continue',
            reminder: buildVerifyMutationsMessage(Array.from(workflowState.mutatedFilesNeedingVerification)),
        };
    }

    const verificationCommandsNeedingRerun = Array.from(workflowState.verificationCommandsNeedingRerun);
    if (verificationCommandsNeedingRerun.length > 0) {
        return {
            type: 'continue',
            reminder: buildRerunVerificationCommandMessage(verificationCommandsNeedingRerun),
        };
    }

    if (response.text?.trim()) {
        if (shouldRewriteBuildResponse('build', userPrompt, response.text, workflowState)) {
            workflowState.buildResponseRewriteIssued = true;
            return {
                type: 'continue',
                reminder: buildBuildResponseRewriteMessage(),
            };
        }

        return { type: 'return', text: response.text };
    }

    if (response.stopReason === 'no_tool_calls' && executedToolCalls.length > 0) {
        return {
            type: 'continue',
            reminder: buildAnswerNowMessage(),
        };
    }

    if (executedToolCalls.length === 0 || response.stopReason === 'no_tool_calls') {
        return { type: 'return', text: response.text };
    }

    const affectedFiles = Array.from([
        ...workflowState.mutatedFilesNeedingVerification,
        ...executedToolCalls
            .filter((call) => (call.toolName === 'edit_file' || call.toolName === 'write_file') && call.succeeded)
            .map((call) => getFilePathArg(call.args))
            .filter((filePath): filePath is string => Boolean(filePath)),
    ]);

    return {
        type: 'continue',
        reminder: buildContinueMessage(affectedFiles),
    };
}

// Function to run an agent turn
export async function runAgentTurn(
    userPrompt: string,
    mode: AgentMode,
    options?: RunAgentTurnOptions,
): Promise<RunAgentTurnResult> {
    const provider = options?.provider ?? getProvider();

    resetPermissionDecisionCache();
    resetTodoState();

    const messages: ChatMessage[] = [{ role: 'system', content: getSystemPrompt(mode) }];
    if (options?.historyMessages?.length) {
        messages.push(...options.historyMessages);
    }
    messages.push({ role: 'user' as const, content: userPrompt });
    const availableTools = getToolsForMode(mode);
    debugLog('Agent turn start:', {
        mode,
        promptLength: userPrompt.length,
        historyMessageCount: options?.historyMessages?.length ?? 0,
        availableToolCount: availableTools.length,
    });

    const referencedPathGroups = buildReferencedPathGroups(userPrompt);
    let projectFiles: string[] | undefined;
    const hintedPaths = new Set<string>();

    for (const group of referencedPathGroups) {
        for (const candidatePath of group.candidatePaths) {
            if (checkPathExists(candidatePath)) {
                if (!hintedPaths.has(candidatePath)) {
                    messages.push({
                        role: 'system',
                        content: buildExistingPathMessage(candidatePath),
                    });
                    hintedPaths.add(candidatePath);
                    debugLog('Path hint added: referenced path exists.', {
                        candidatePath,
                    });
                }
                break;
            }

            projectFiles ??= getProjectFilePaths();
            const match = findClosestFileMatch(candidatePath, projectFiles);
            if (!match) {
                continue;
            }

            messages.push({
                role: 'system',
                content: buildClosestPathMessage(candidatePath, match.candidate),
            });
            debugLog('Path hint added: closest file match.', {
                requestedPath: candidatePath,
                matchedPath: match.candidate,
            });
            break;
        }
    }

    const maxFlowRounds = mode === 'plan' ? 4 : 3;
    let response: ChatResult = { text: ''};
    let stopMessage: string | undefined;
    let workflowState: WorkflowState = {
        mutatedFilesNeedingVerification: new Set(),
        verificationCommandsNeedingRerun: new Set(),
        commandsRunSinceLastMutation: new Set(),
        flowRoundCount: 0,
        buildResponseRewriteIssued: false,
        planResponseRewriteIssued: false,
        planFalseCompletionRewriteIssued: false,
        sawSuccessfulMutation: false,
        todoReminderIssued: false,
        toolUsageContradictionRewriteIssued: false,
    }
    
    while (workflowState.flowRoundCount < maxFlowRounds) {
        workflowState.flowRoundCount++;
        debugLog(`Flow round ${workflowState.flowRoundCount}`);

        const messagesForProvider = hasTodoItems()
            ? [
                ...messages,
                { role: 'system' as const, content: buildTodoStateMessage() },
              ]
            : messages;

        response = await provider.chat(messagesForProvider, {
            mode,
            tools: availableTools,
            ...(options?.onMutation ? { onMutation: options.onMutation } : {}),
        });
        debugLog('Provider response received:', {
            flowRound: workflowState.flowRoundCount,
            stopReason: response.stopReason,
            textLength: response.text?.length ?? 0,
            executedToolCallCount: response.executedToolCalls?.length ?? 0,
        });
        messages.push({ role: 'model' as const, content: response.text });

        const executedToolCalls = response.executedToolCalls ?? [];
        const { updatedWorkflowState, turnState } = collectTurnState(executedToolCalls, workflowState);
        workflowState = updatedWorkflowState;

        if (turnState.blockedActionCalls.length > 0) {
            if (response.text?.trim()) {
                debugLog('Agent turn returning after blocked action with provider text.', {
                    blockedActionCount: turnState.blockedActionCalls.length,
                });
                return {
                    response: response.text,
                    executedToolCalls,
                    stopReason: response.stopReason,
                };
            }

            debugLog('Workflow continuing after blocked action.', {
                blockedActionCount: turnState.blockedActionCalls.length,
            });
            messages.push({
                role: 'user' as const,
                content: buildBlockedActionMessage(turnState.blockedActionCalls),
            });
            continue;
        }

        const repeatedFailedEditFiles = countRepeatedFailedMutationAttempts(turnState.failedMutationCounts);
        if (repeatedFailedEditFiles.length > 0) {
            debugLog('Workflow continuing after repeated failed mutations.', {
                filePaths: repeatedFailedEditFiles,
            });
            messages.push({
                role: 'user' as const,
                content: buildRepeatedFailedEditMessage(repeatedFailedEditFiles),
            });
            continue;
        }

        const failedMutationFiles = Array.from(turnState.failedMutationCounts.keys());
        if (failedMutationFiles.length > 0 && turnState.mutatedFiles.size === 0) {
            debugLog('Workflow continuing after failed mutation attempt.', {
                filePaths: failedMutationFiles,
            });
            messages.push({
                role: 'user' as const,
                content: buildFailedMutationRetryMessage(failedMutationFiles),
            });
            continue;
        }

        const completionAction = mode === 'plan'
            ? handlePlanModeCompletion(userPrompt, response, executedToolCalls, workflowState)
            : handleBuildModeCompletion(userPrompt, response, executedToolCalls, workflowState);

        if (completionAction) {
            if (
                completionAction.type === 'return'
                && shouldRewriteToolUsageContradictionResponse(
                    userPrompt,
                    completionAction.text,
                    options?.historyMessages ?? [],
                    workflowState.toolUsageContradictionRewriteIssued,
                )
            ) {
                workflowState.toolUsageContradictionRewriteIssued = true;
                const recordedFactMessages = extractRecordedToolFactMessages(options?.historyMessages ?? []);
                messages.push({
                    role: 'user' as const,
                    content: buildToolUsageContradictionRewriteMessage(recordedFactMessages),
                });
                debugLog('Workflow continuing after tool-usage contradiction.', {
                    flowRound: workflowState.flowRoundCount,
                    recordedFactCount: recordedFactMessages.length,
                });
                continue;
            }

            if (completionAction.type === 'return') {
                debugLog('Agent turn returning final response.', {
                    flowRound: workflowState.flowRoundCount,
                    responseLength: completionAction.text.length,
                });
                return {
                    response: completionAction.text,
                    executedToolCalls,
                    stopReason: response.stopReason,
                };
            }

            debugLog('Workflow continuing with reminder.', {
                flowRound: workflowState.flowRoundCount,
                reminderLength: completionAction.reminder.length,
                fastForwardToFinalRound: completionAction.fastForwardToFinalRound ?? false,
            });
            messages.push({
                role: 'user' as const,
                content: completionAction.reminder,
            });

            if (completionAction.fastForwardToFinalRound) {
                workflowState.flowRoundCount = maxFlowRounds - 1;
            }

            continue;
        }

        if (shouldPromptForTodoTracking(mode, executedToolCalls, workflowState, response.stopReason)) {
            workflowState.todoReminderIssued = true;
            debugLog('Workflow continuing with todo tracking reminder.');
            messages.push({
                role: 'user' as const,
                content: buildTodoTrackingReminderMessage(),
            });
            continue;
        }

        if (executedToolCalls.length === 0 || response.stopReason === 'no_tool_calls') {
            debugLog('Agent turn returning provider response without more tool work.', {
                flowRound: workflowState.flowRoundCount,
                stopReason: response.stopReason,
                responseLength: response.text.length,
            });
            return {
                response: response.text,
                executedToolCalls,
                stopReason: response.stopReason,
            };
        }

        debugLog('Workflow continuing after tool calls.', {
            flowRound: workflowState.flowRoundCount,
            mutatedFileCount: turnState.mutatedFiles.size,
            executedToolCallCount: executedToolCalls.length,
        });
        messages.push({
            role: 'user' as const,
            content: buildContinueMessage(Array.from(turnState.mutatedFiles)),
        });
    }

    if (!stopMessage) {
        stopMessage = 'Stopped because the workflow reached its maximum number of rounds before the task fully converged.';
    }
    debugLog('Agent turn stopped at max workflow rounds.', {
        maxFlowRounds,
        latestResponseLength: response.text?.length ?? 0,
    });
    
    return {
        response: response.text
            ? `${stopMessage}\n\nLatest response:\n${response.text}`
            : stopMessage,
        executedToolCalls: response.executedToolCalls ?? [],
        stopReason: response.stopReason,
    };
}
