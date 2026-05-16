import { provider } from './providers';
import { ChatMessage } from './providers/base';

function getFilePathArg(args: Record<string, unknown>): string | null {
    const value = args.filePath;
    return typeof value === 'string' ? value : null;
}

export async function runAgentTurn(userPrompt: string): Promise<string> {
    if (!provider) {
        throw new Error('Provider is not available.');
    }

    const messages: ChatMessage[] = [{ role: 'user' as const, content: userPrompt }];

    while (true) {
        const response = await provider.chat(messages);
        messages.push({ role: 'model' as const, content: response.text });

        const executedToolCalls = response.executedToolCalls ?? [];
        if (executedToolCalls.length === 0) {
            return response.text ?? '';
        }
        
        const edited: Set<string> = new Set();
        const verified: Set<string> = new Set();

        for (const call of executedToolCalls) {
            const toolName = call.toolName;

            if (toolName === 'edit_file') {
                const filePath = getFilePathArg(call.args);
                if (!filePath) continue;

                edited.add(filePath);
            }

            if (toolName === 'read_file') {
                const filePath = getFilePathArg(call.args);
                if (!filePath) continue;
                
                if (edited.has(filePath)) {
                    verified.add(filePath);
                }
            }
        }

        if (verified.size === edited.size) {
            return response.text ?? '';
        }

        messages.push({ role: 'user' as const, content: 'Please verify the changes made to the following files: ' + Array.from(edited).join(', ') });
    }
}