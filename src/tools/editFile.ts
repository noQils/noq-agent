import { InternalTool } from './index';
import { readFileIfExists, writeFileContent } from '../fileUtils';


// Define the read_file tool, which attempts to read a file at the specified path and falls back to scanning the project directory if the file is not found
export const editFileTool: InternalTool = {
    // Tool metadata
    name: "edit_file",
    description: "Replace a specific line range in a file. Use the smallest line range necessary for the intended change.",
    parameters: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: "The path to the file to edit",
                required: true,
            },
            startLine: {
                type: 'integer',
                description: "The line number to start from",
                required: true,
            },
            endLine: {
                type: 'integer',
                description: "The line number to end at",
                required: true,
            },
            newText: {
                type: 'string',
                description: "The text to replace with",
                required: true,
            },
        },
    },
    
    execute: (args: { filePath: string, startLine: number, endLine: number, newText: string}) => {
        const result = editFile(args.filePath, args.startLine, args.endLine, args.newText);
        return result;
    },
};

// Function to read a file at the specified path
export function editFile(filePath: string, startLine: number, endLine: number, newText: string) {
    if (!Number.isInteger(startLine)) {
        throw new TypeError("startLine must be an integer");
    }
    if (!Number.isInteger(endLine)) {
        throw new TypeError("endLine must be an integer");
    }
    if (startLine < 1) {
        throw new Error("startLine must be greater than 0");
    }
    if (startLine > endLine) {
        throw new Error("startLine must be less than or equal to endLine");
    }

    const content = readFileIfExists(filePath);
    if (content === null) {
        throw new Error(`File not found: ${filePath}`);
    }

    const lines = content.split('\n');
    if (startLine > lines.length) {
        throw new Error(`startLine cannot be greater than the number of lines in the file`);
    }
    if (endLine > lines.length) {
        throw new Error(`endLine cannot be greater than the number of lines in the file`);
    }
    
    const startIndex = startLine - 1;
    const deleteCount = endLine - startIndex;
    const newLines = newText.split('\n');
    lines.splice(startIndex, deleteCount, ...newLines);
    
    writeFileContent(filePath, lines.join('\n'));
    return `Updated ${filePath} at lines ${startLine}-${endLine} with ${newLines.length} replacement lines.`;
}