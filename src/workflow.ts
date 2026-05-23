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
    flowRoundCount: number;
};

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

function buildContinueMessage(affectedFiles: string[]): string {
    const suffix = affectedFiles.length > 0
        ? ` Affected file(s): ${affectedFiles.join(', ')}`
        : '';

    return (
        'Your last response indicates the task is still incomplete. ' +
        'Continue working until the request is fully satisfied and the affected code appears internally consistent.' +
        suffix
    );
}

function buildVerifyMutationsMessage(affectedFiles: string[]): string {
    const suffix = affectedFiles.length > 0
        ? ` Changed file(s): ${affectedFiles.join(', ')}.`
        : '';

    return (
        'You changed file(s) but did not verify the result. ' +
        'Read the changed file(s) again, confirm the requested change was applied, and then continue.' +
        suffix
    );
}

function buildRepeatedFailedEditMessage(filePaths: string[]): string {
    return (
        `You previously failed to edit these file(s) multiple times in the last attempt: ${filePaths.join(', ')}. ` +
        'Re-read those file(s) and try again using a smaller exact snippet. ' +
        'Do not use run_command to modify files.'
    );
}

function buildSummaryOnlyMessage(): string {
    return 'The requested changes are already applied and verified. Provide a concise final summary only.';
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

    for (const group of referencedPathGroups) {
        console.log(`Referenced path group: ${group.candidatePaths}`);
        for (const candidatePath of group.candidatePaths) {
            if (checkPathExists(candidatePath)) {
                break;
            }

            projectFiles ??= getProjectFilePaths();
            const match = findClosestFileMatch(candidatePath, projectFiles);
            if (!match) {
                continue;
            }

            messages.push({
                role: 'system',
                content: `The referenced file "${candidatePath}" does not exist. A close existing file match was found: "${match.candidate}". Use the existing file only if it appears to be the intended target; otherwise follow the user's request literally.`,
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
