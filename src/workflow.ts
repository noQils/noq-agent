import { checkPathExists, getProjectFilePaths } from './fileUtils';
import { findClosestFileMatch } from './pathMatcher';
import { provider } from './providers';
import { 
    type ChatMessage, 
    type ChatResult, 
    type ExecutedToolCall 
} from './providers/base';
import { getDefaultSystemPrompt } from './systemPrompt';
import { buildReferencedPathGroups } from './pathReferenceHints';

// Function to get the file path argument
function getFilePathArg(args: Record<string, unknown>): string | null {
    const value = args.filePath;
    return typeof value === 'string' ? value : null;
}

type TurnState = {
    mutatedFiles: Set<string>;
    failedMutationCounts: Map<string, number>;
};

type WorkflowState = {
    mutatedFilesNeedingVerification: Set<string>;
    verificationCommandsNeedingRerun: Set<string>;
    commandsRunSinceLastMutation: Set<string>;
    flowRoundCount: number;
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
    };

    for (const call of calls) {
        const toolName = call.toolName;

        if (toolName === 'edit_file' || toolName === 'write_file') {
            const filePath = getFilePathArg(call.args);
            if (!filePath) continue;

            if (call.succeeded) {
                workflowState.mutatedFilesNeedingVerification.add(filePath);
                for (const command of workflowState.commandsRunSinceLastMutation) {
                    workflowState.verificationCommandsNeedingRerun.add(command);
                }
                workflowState.commandsRunSinceLastMutation.clear();
                turnState.mutatedFiles.add(filePath);
                turnState.failedMutationCounts.delete(filePath);
            } else {
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

function buildVerifyMutationsMessage(affectedFiles: string[]): string {
    const suffix = affectedFiles.length > 0
        ? ` Changed file(s): ${affectedFiles.join(', ')}.`
        : '';

    return buildWorkflowReminder(
        'You changed file(s) but did not verify the result. ' +
        'Read the changed file(s) again, confirm the requested change was applied, and then continue with any remaining part of the original request.' +
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

function buildSummaryOnlyMessage(): string {
    return buildWorkflowReminder('The requested changes are already applied and verified. Provide a concise final summary answering the original user request only.');
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

// Function to run an agent turn
export async function runAgentTurn(userPrompt: string): Promise<string> {
    if (!provider) {
        throw new Error('Provider is not available.');
    }

    const messages: ChatMessage[] = [{ role: 'system', content: getDefaultSystemPrompt() }];
    messages.push({ role: 'user' as const, content: userPrompt });

    const referencedPathGroups = buildReferencedPathGroups(userPrompt);
    let projectFiles: string[] | undefined;
    const hintedPaths = new Set<string>();

    for (const group of referencedPathGroups) {
        console.log(`Referenced path group: ${group.candidatePaths}`);
        for (const candidatePath of group.candidatePaths) {
            if (checkPathExists(candidatePath)) {
                if (!hintedPaths.has(candidatePath)) {
                    messages.push({
                        role: 'system',
                        content: buildExistingPathMessage(candidatePath),
                    });
                    hintedPaths.add(candidatePath);
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
            console.log(messages.at(-1)?.content);
            break;
        }
    }
    console.log('\n\nAgent response:')

    const maxFlowRounds = 3;
    let response: ChatResult = { text: ''};
    let stopMessage: string | undefined;
    let workflowState: WorkflowState = {
        mutatedFilesNeedingVerification: new Set(),
        verificationCommandsNeedingRerun: new Set(),
        commandsRunSinceLastMutation: new Set(),
        flowRoundCount: 0,
    }
    
    while (workflowState.flowRoundCount < maxFlowRounds) {
        workflowState.flowRoundCount++;
        console.log('\nFlow round: ', workflowState.flowRoundCount);

        response = await provider.chat(messages);
        messages.push({ role: 'model' as const, content: response.text });

        const executedToolCalls = response.executedToolCalls ?? [];
        const { updatedWorkflowState, turnState } = collectTurnState(executedToolCalls, workflowState);
        workflowState = updatedWorkflowState;

        const repeatedFailedEditFiles = countRepeatedFailedMutationAttempts(turnState.failedMutationCounts);
        if (repeatedFailedEditFiles.length > 0) {
            messages.push({
                role: 'user' as const,
                content: buildRepeatedFailedEditMessage(repeatedFailedEditFiles),
            });
            continue;
        }

        const failedMutationFiles = Array.from(turnState.failedMutationCounts.keys());
        if (failedMutationFiles.length > 0 && turnState.mutatedFiles.size === 0) {
            messages.push({
                role: 'user' as const,
                content: buildFailedMutationRetryMessage(failedMutationFiles),
            });
            continue;
        }

        console.log('\nMutated files needing verification:', Array.from(workflowState.mutatedFilesNeedingVerification));

        const allMutationsVerified = workflowState.mutatedFilesNeedingVerification.size === 0;
        const unverifiedMutatedFiles = Array.from(workflowState.mutatedFilesNeedingVerification);
        const affectedFiles = Array.from([
            ...workflowState.mutatedFilesNeedingVerification, 
            ...turnState.mutatedFiles
        ]);

        if (response.stopReason === 'tool_round_limit_reached') {
            if (allMutationsVerified) {
                if (response.text?.trim()) {
                    return response.text;
                }

                messages.push({ 
                    role: 'user' as const, 
                    content: buildSummaryOnlyMessage(),
                });

                workflowState.flowRoundCount = maxFlowRounds - 1;
                continue;
            }

            messages.push({ 
                role: 'user' as const, 
                content: buildVerifyMutationsMessage(unverifiedMutatedFiles),
            });
            continue;
        }

        if (!allMutationsVerified) {
            messages.push({ 
                role: 'user' as const, 
                content: buildVerifyMutationsMessage(unverifiedMutatedFiles),
            });
            continue;
        }

        const verificationCommandsNeedingRerun = Array.from(workflowState.verificationCommandsNeedingRerun);
        if (verificationCommandsNeedingRerun.length > 0) {
            messages.push({
                role: 'user' as const,
                content: buildRerunVerificationCommandMessage(verificationCommandsNeedingRerun),
            });
            continue;
        }

        if (allMutationsVerified && response.text?.trim()) {
            console.log('Workflow complete.');
            return response.text;
        }

        if (executedToolCalls.length === 0 || response.stopReason === 'no_tool_calls') {
            return response.text;
        }

        messages.push({ 
            role: 'user' as const, 
            content: buildContinueMessage(affectedFiles),
        });
    }

    if (!stopMessage) {
        stopMessage = 'Stopped because the workflow reached its maximum number of rounds before the task fully converged.';
    }
    
    return response.text
        ? `${stopMessage}\n\nLatest response:\n${response.text}`
        : stopMessage;
}
