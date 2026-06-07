import { InternalTool } from './index';
import { checkPathExists, writeFileContent, ensureParentDirectory, resolveProjectPath } from '../fileUtils';
import { debugLog } from '../config/runtimeSettings';
import path from 'node:path';

// Define the write_file tool
export const writeFileTool: InternalTool = {
    // Tool metadata
    name: "write_file",
    description: "Create a file with the provided content",
    allowedModes: ['build'],
    permission: {
        scope: 'edit',
        getTarget: (args) => typeof args.filePath === 'string' ? args.filePath : '',
    },
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

    const resolvedPath = resolveProjectPath(filePath);
    debugLog('write_file preparing to create file.', {
        filePath,
        workspaceRoot: process.cwd(),
        resolvedPath,
        parentDirectoryPath: path.dirname(resolvedPath),
    });

    ensureParentDirectory(filePath);
    writeFileContent(filePath, content);
    return `Created file: ${filePath}`;
}
