import path from 'node:path';
import { readFileIfExists } from '../fileUtils';
import { scanDirectory } from '../scanner';
import { Tool } from './index';

// Define the read_file tool, which attempts to read a file at the specified path and falls back to scanning the project directory if the file is not found
export const readFileFunction: Tool = {
  // Tool metadata for the read_file function
  name: "read_file",
  description: "Read the content of a file",
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: "The path to the file to read",
      },
    },
    required: ["filePath"],
  },

  // Execute the tool to read a file, with fallback to scanning the project directory if the file is not found at the specified path
  execute: async (args: { filePath: string }) => {
    const fullPath = path.resolve(process.cwd(), args.filePath);
    let content = readFileIfExists(fullPath);

     if (content === null) {
        // If the file is not found at the specified path, scan the entire project directory for a file with the same name
        const allFiles = scanDirectory(process.cwd());
        const fileName = path.basename(args.filePath);
        const found = allFiles.find(f => path.basename(f) === fileName);
        if (found) {
            content = readFileIfExists(found);
            if (content) return content.length > 3000 ? content.slice(0, 3000) : content;
        }
        return `Error: File not found: ${args.filePath}`;
    }
    return content.length > 3000 ? content.slice(0, 3000) : content;
  }
};