import { fileExists, readFileContent } from '../fileUtils';
import { InternalTool } from './index';

// Define the read_file tool, which attempts to read a file at the specified path and falls back to scanning the project directory if the file is not found
export const readFileTool: InternalTool = {
  // Tool metadata
  name: "read_file",
  description: "Read the content of a file",
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: "The path to the file to read",
        required: true,
      },
    },
  },

  execute: (args: { filePath: string }) => {
    const result = readFile(args.filePath);
    return result;
  },
};

// Function to read a file at the specified path
export function readFile(filePath: string): string {
    const fileExistence = fileExists(filePath);
    if (!fileExistence) {
        throw new Error(`File not found: ${filePath}`);
    }

    const content = readFileContent(filePath);
    return content;
}