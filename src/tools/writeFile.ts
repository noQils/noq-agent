import { InternalTool } from './index';
import { checkPathExists, writeFileContent, ensureParentDirectory } from '../fileUtils';

// Define the write_file tool
export const writeFileTool: InternalTool = {
    // Tool metadata
    name: "write_file",
    description: "Create a file with the provided content",
    parameters: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: "The path to the file to write",
                required: true,
            },
            content: {
                type: 'string',
                description: "The content to write to the file",
                required: true,
            },
        },
    },
    
    execute: (args: { filePath: string, content: string }) => {
        const result = writeFile(args.filePath, args.content);
        return result;
    },
};

// Function to write a file at the specified path
export function writeFile(filePath: string, content: string) {
    if (checkPathExists(filePath)) {
        throw new Error(`File already exists: ${filePath}`);
    }

    ensureParentDirectory(filePath);
    writeFileContent(filePath, content);
    return `Created file: ${filePath}`;
}
