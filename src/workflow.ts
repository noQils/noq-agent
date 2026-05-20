import { checkPathExists, getProjectFilePaths } from './fileUtils';
import { findClosestFileMatch } from './pathMatcher';
import { provider } from './providers';
import { type ChatMessage, type ChatResult } from './providers/base';
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
    'Your last response indicates the requested change is still incomplete. Continue editing and verifying the affected file(s) until the request is fully satisfied and the affected code appears internally consistent, then respond with the completed result.';
const verifyMessage =
    'You edited file(s) but did not verify the result. Read the edited file(s) again, confirm the requested change was applied, and then continue.';

// Function to get the file path argument
function getFilePathArg(args: Record<string, unknown>): string | null {
    const value = args.filePath;
    return typeof value === 'string' ? value : null;
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
            break;
        }
    }

    let response: ChatResult = { text: ''};

    const maxFlowRounds = 3;
    let flowRoundCount = 0;
    
    while (flowRoundCount < maxFlowRounds) {
        response = await provider.chat(messages);
        messages.push({ role: 'model' as const, content: response.text });
        flowRoundCount++;

        const executedToolCalls = response.executedToolCalls ?? [];
        if (executedToolCalls.length === 0) {
            return response.text;
        }
        
        const editedFilesNeedingVerification: Set<string> = new Set();
        const verifiedEditedFiles: Set<string> = new Set();

        for (const call of executedToolCalls) {
            const toolName = call.toolName;

            if (toolName === 'edit_file') {
                const filePath = getFilePathArg(call.args);
                if (!filePath) continue;

                editedFilesNeedingVerification.add(filePath);
            }

            if (toolName === 'read_file') {
                const filePath = getFilePathArg(call.args);
                if (!filePath) continue;
                
                if (editedFilesNeedingVerification.has(filePath)) {
                    verifiedEditedFiles.add(filePath);
                }
            }
        }

        if (editedFilesNeedingVerification.size === 0) {
            return response.text;
        }
        
        if (verifiedEditedFiles.size === editedFilesNeedingVerification.size) {
            if (!incompleteSignals.some(signal => response.text?.toLowerCase().includes(signal))) {
                return response.text;
            }

            messages.push({ role: 'user' as const, content: continueMessage + ` Affected file(s): ${Array.from(editedFilesNeedingVerification).join(', ')}`});
            continue;
        }

        messages.push({ role: 'user' as const, content: verifyMessage + ` Edited file(s): ${Array.from(editedFilesNeedingVerification).join(', ')}`});
    }
    
    return `Stopped after reaching the workflow round limit before the task fully converged. The task may be incomplete.\n\nLatest response:\n${response.text}`;
}
