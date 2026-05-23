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


const incompleteSignals = [
    'if you want, i can',
    'i can also',
    'still includes',
    'still contains',
    'remaining',
    'not yet',
    'undefined',
    'broken reference',
    'broken references',
    'inconsistent',
    'i left',
    'leftover',
    'follow-up',
    'needs cleanup',
    'need to remove',
    'need to fix',
];
const continueMessage = 
    'Your last response indicates the requested change is still incomplete. Continue editing and verifying the affected file(s) until the request is fully satisfied and the affected code appears internally consistent.';
const verifyEditMessage =
    'You edited file(s) but did not verify the result. Read the edited file(s) again, confirm the requested change was applied, and then continue.';
const verifyCreateMessage =
    'You created file(s) but did not verify the result. Read the created file(s) again, confirm the requested change was applied, and then continue.';

// Function to get the file path argument
function getFilePathArg(args: Record<string, unknown>): string | null {
    const value = args.filePath;
    return typeof value === 'string' ? value : null;
}

// function getStopMessage(stopReason: ChatResult['stopReason']): string | undefined {
//     if (stopReason === 'repeated_tool_calls') {
//         return 'Stopped because the provider began repeating the same tool calls without making new progress.';
//     }

//     if (stopReason === 'tool_round_limit_reached') {
//         return 'Stopped because the provider reached the maximum number of tool-call rounds before the task fully converged.';
//     }

//     return undefined;
// }

type TurnState = {
    editedFiles: Set<string>;
    createdFiles: Set<string>;
    failedEditCounts: Map<string, number>;
    failedCreateFiles: Set<string>;
};

type WorkflowState = {
    editedFiles: Set<string>;
    createdFiles: Set<string>;
    editedFilesNeedingVerification: Set<string>;
    createdFilesNeedingVerification: Set<string>;
    successfulCommands: string[];
    flowRoundCount: number;
};

function collectTurnState(calls: ExecutedToolCall[], currentState: WorkflowState): { updatedWorkflowState: WorkflowState, turnState: TurnState } {
    const workflowState = currentState;
    const turnState: TurnState = {
        editedFiles: new Set(),
        createdFiles: new Set(),
        failedEditCounts: new Map(),
        failedCreateFiles: new Set() 
    };

    for (const call of calls) {
        const toolName = call.toolName;

        switch(toolName) {
            case 'edit_file': {
                const filePath = getFilePathArg(call.args);
                if (!filePath) continue;

                if (call.succeeded) {
                    workflowState.editedFilesNeedingVerification.add(filePath);
                    workflowState.editedFiles.add(filePath);

                    turnState.editedFiles.add(filePath);
                    turnState.failedEditCounts.delete(filePath);
                } else {
                    const failedEditCount = turnState.failedEditCounts.get(filePath) ?? 0;
                    turnState.failedEditCounts.set(filePath, failedEditCount + 1);
                }
                break;
            }

            case 'write_file': {
                const filePath = getFilePathArg(call.args);
                if (!filePath) continue;

                if (call.succeeded) {
                    workflowState.createdFilesNeedingVerification.add(filePath);
                    workflowState.createdFiles.add(filePath);
                    turnState.createdFiles.add(filePath);
                } else {
                    turnState.failedCreateFiles.add(filePath);
                }
                break;
            }

            case 'read_file': {
                const filePath = getFilePathArg(call.args);
                if (!filePath) continue;
                
                if (workflowState.editedFilesNeedingVerification.has(filePath)) {
                    workflowState.editedFilesNeedingVerification.delete(filePath);
                } 

                if (workflowState.createdFilesNeedingVerification.has(filePath)) {
                    workflowState.createdFilesNeedingVerification.delete(filePath);
                }
                break;
            }

            case 'run_command': {
                const command = call.args.command;
                if (!command) continue;
                
                if (call.succeeded) {
                    workflowState.successfulCommands.push(JSON.stringify(command));
                }
                break;
            }
        }
    }

    return {
        updatedWorkflowState: workflowState,
        turnState,
    };
}

function countFailedEditAttempts(failedEditCounts: Map<string, number>): string[] {
    return Array.from(failedEditCounts.entries())
        .filter(([, count]) => count >= 2)
        .map(([filePath]) => filePath);
}

function buildVerificationMessage(
    allEditedFilesVerified: boolean,
    allCreatedFilesVerified: boolean,
    workflowState: WorkflowState,
): string {
    const verifyEditContent = allEditedFilesVerified
        ? ''
        : verifyEditMessage + ` Edited file(s): ${Array.from(workflowState.editedFilesNeedingVerification).join(', ')}.`;
    const verifyCreateContent = allCreatedFilesVerified
        ? ''
        : verifyCreateMessage + ` Created file(s): ${Array.from(workflowState.createdFilesNeedingVerification).join(', ')}.`;

    return [verifyEditContent, verifyCreateContent].filter(Boolean).join('\n ');
}

// Function to run an agent turn
export async function runAgentTurn(userPrompt: string): Promise<string> {
    if (!provider) {
        throw new Error('Provider is not available.');
    }

    const messages: ChatMessage[] = [{ role: 'system', content: getDefaultSystemPrompt() }];
    messages.push({ role: 'user' as const, content: userPrompt });

    const projectFiles = getProjectFilePaths();
    const referencedPathGroups = buildReferencedPathGroups(userPrompt);

    for (const group of referencedPathGroups) {
        console.log(`Referenced path group: ${group.candidatePaths}`);
        for (const candidatePath of group.candidatePaths) {
            if (checkPathExists(candidatePath)) {
                break;
            }

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
        editedFiles: new Set(),
        createdFiles: new Set(),
        editedFilesNeedingVerification: new Set(),
        createdFilesNeedingVerification: new Set(),
        successfulCommands: [],
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

        const repeatedFailedEditFiles = countFailedEditAttempts(turnState.failedEditCounts);
        if (repeatedFailedEditFiles.length > 0) {
            messages.push({
                role: 'user' as const,
                content:
                    `You previously failed to edit these file(s) multiple times in the last attempt: ${repeatedFailedEditFiles.join(', ')}. ` +
                    `Re-read those file(s) and try again using a smaller exact snippet. ` +
                    `Do not use run_command to modify files.`,
            });
            continue;
        }

        const allEditedFilesVerified = workflowState.editedFilesNeedingVerification.size === 0;
        const allCreatedFilesVerified = workflowState.createdFilesNeedingVerification.size === 0;
        const allMutationsVerified = allEditedFilesVerified && allCreatedFilesVerified;
        const responseText = response.text?.toLowerCase() ?? '';
        const hasIncompleteSignal = incompleteSignals.some(signal => responseText.includes(signal));
        const affectedFiles = Array.from(
            new Set([
                ...workflowState.editedFilesNeedingVerification,
                ...workflowState.createdFilesNeedingVerification,
                ...turnState.editedFiles,
                ...turnState.createdFiles,
            ])
        );

        if (response.stopReason === 'tool_round_limit_reached') {
            if (allMutationsVerified) {
                if (response.text?.trim()) {
                    return response.text;
                }

                messages.push({ 
                    role: 'user' as const, 
                    content: `The requested changes are already applied and verified. Provide a concise final summary only.`
                });

                workflowState.flowRoundCount = maxFlowRounds - 1;
                continue;
            }

            messages.push({ 
                role: 'user' as const, 
                content: buildVerificationMessage(allEditedFilesVerified, allCreatedFilesVerified, workflowState),
            });
            continue;
        }

        if (!allMutationsVerified) {
            messages.push({ 
                role: 'user' as const, 
                content: buildVerificationMessage(allEditedFilesVerified, allCreatedFilesVerified, workflowState),
            });
            continue;
        }

        if (allMutationsVerified && response.text?.trim() && !hasIncompleteSignal) {
            return response.text;
        }

        if (hasIncompleteSignal) {
            messages.push({ 
                role: 'user' as const, 
                content: continueMessage + ` Affected file(s): ${affectedFiles.join(', ')}`
            });
            continue;
        }

        if (executedToolCalls.length === 0 || response.stopReason === 'no_tool_calls') {
            return response.text;
        }

        messages.push({ 
            role: 'user' as const, 
            content: continueMessage + ` Affected file(s): ${affectedFiles.join(', ')}`
        });
    }

    if (!stopMessage) {
        stopMessage = 'Stopped because the workflow reached its maximum number of rounds before the task fully converged.';
    }
    
    return response.text
        ? `${stopMessage}\n\nLatest response:\n${response.text}`
        : stopMessage;
}
