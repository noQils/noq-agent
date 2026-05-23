import { InternalTool } from './index';
import { readFileContent, writeFileContent } from '../fileUtils';

// Define the edit_file tool
export const editFileTool: InternalTool = {
    // Tool metadata
    name: "edit_file",
    description: "Replace an exact text snippet in a file. Prefer the smallest unique snippet necessary for the intended change.",
    parameters: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: "The path to the file to edit",
                required: true,
            },
            oldText: {
                type: 'string',
                description: "The text to replace",
                required: true,
            },
            newText: {
                type: 'string',
                description: "The text to replace with",
                required: true,
            },
        },
    },
    
    execute: (args: { filePath: string, oldText: string, newText: string }) => {
        const result = editFile(args.filePath, args.oldText, args.newText);
        return result;
    },
};

function detectNewline(content: string): '\r\n' | '\n' {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeNewlines(text: string, newline: '\r\n' | '\n'): string {
    return text.replace(/\r?\n/g, newline);
}

// Function to edit a file at the specified path
export function editFile(filePath: string, oldText: string, newText: string) {
    if (oldText.length === 0) {
        throw new Error('oldText must not be empty');
    }

    let content: string;
    try {
        content = readFileContent(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`File not found: ${filePath}`);
        }

        throw error;
    }

    const newline = detectNewline(content);

    const normalizedOldText = normalizeNewlines(oldText, newline);
    const normalizedNewText = normalizeNewlines(newText, newline);

    const firstIndex = content.indexOf(normalizedOldText);
    if (firstIndex === -1) {
        throw new Error(`Exact text to replace was not found in ${filePath}`);
    }

    const secondIndex = content.indexOf(normalizedOldText, firstIndex + normalizedOldText.length);
    if (secondIndex !== -1) {
        let occurrences = 2;
        let searchStart = secondIndex + normalizedOldText.length;
        let nextIndex = content.indexOf(normalizedOldText, searchStart);
        while (nextIndex !== -1) {
            occurrences++;
            searchStart = nextIndex + normalizedOldText.length;
            nextIndex = content.indexOf(normalizedOldText, searchStart);
        }

        throw new Error(`Exact text to replace matched ${occurrences} times in ${filePath}; provide a more specific snippet.`);
    }

    const updatedContent =
        content.slice(0, firstIndex) +
        normalizedNewText +
        content.slice(firstIndex + normalizedOldText.length);
    writeFileContent(filePath, updatedContent);

    const verifiedContent = readFileContent(filePath);
    if (verifiedContent !== updatedContent) {
        throw new Error(`Post-write verification failed for ${filePath}`);
    }

    return `Updated ${filePath} by replacing 1 exact text match.`;
}
