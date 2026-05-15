import fs from 'node:fs';
import path from 'node:path';
import { InternalTool } from './index';
import { readFileIfExists } from '../fileUtils';


// Define the read_file tool, which attempts to read a file at the specified path and falls back to scanning the project directory if the file is not found
export const editFileTool: InternalTool = {
    // Tool metadata
    name: "edit_file",
    description: "Replace the first occurrence of text in a file",
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
    
    execute: (args: { filePath: string, oldText: string, newText: string}) => {
        const result = editFile(args.filePath, args.oldText, args.newText);
        return result;
    },
};

// Function to read a file at the specified path
export function editFile(filePath: string, oldText: string, newText: string) {
    const fullPath = path.resolve(process.cwd(), filePath);
    const content = readFileIfExists(fullPath);
    if (content === null) {
        throw new Error(`File not found: ${filePath}`);
    }

    if (!content.includes(oldText)) {
        throw new Error(`Text not found in file: ${filePath}`);
    }
    
    const newContent = content.replace(oldText, newText);
    fs.writeFileSync(fullPath, newContent);
    return `Updated file: ${filePath}`;
}