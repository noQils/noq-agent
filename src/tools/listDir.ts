import { InternalTool } from './index';
import { checkPathExists, checkIsDirectory, listDirectoryEntries } from '../fileUtils';

// Define the list_dir tool
export const listDirTool: InternalTool = {
    // Tool metadata
    name: 'list_dir',
    description: "List the files in a directory",
    parameters: {
        type: 'object',
        properties: {
            dirPath: {
                type: 'string',
                description: "The path to the directory to list",
                required: true,
            },
        },
    },
    
    execute: (args: { dirPath: string }) => {
        const result = listDir(args.dirPath);
        return result;
    },
};

// Function to return the list of files in a directory
export function listDir(dirPath: string) {
    if (!checkPathExists(dirPath)) {
        throw new Error(`Directory not found: ${dirPath}`);
    }
    if (!checkIsDirectory(dirPath)) {
        throw new Error(`${dirPath} is not a directory`);
    }

    const items = listDirectoryEntries(dirPath)
        .map((entry) => entry.isDirectory ? `${entry.name}/` : entry.name);

    return items.join('\n');
}
