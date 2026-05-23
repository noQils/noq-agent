import { InternalTool } from './index';
import { readFileContent } from '../fileUtils';

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
    try {
        return readFileContent(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`File not found: ${filePath}`);
        }

        throw error;
    }
}
