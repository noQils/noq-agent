import path from 'node:path';
import { readFileIfExists } from '../fileUtils';
import { FunctionDeclaration, Type } from "@google/genai";
import { scanDirectory } from '../scanner';

// Define the function declaration for reading a file
export const readFileFunction: FunctionDeclaration = {
  name: "read_file",
  description: "Read the content of a file",
  parameters: {
    type: Type.OBJECT,
    properties: {
      filePath: {
        type: Type.STRING,
        description: "The path to the file to read",
      },
    },
    required: ["filePath"],
  },
};

// Export the function declaration for use in tools
export function executeReadFile(args: { filePath: string}): string | null {
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
