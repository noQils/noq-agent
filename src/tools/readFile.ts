import { InternalTool } from './index';
import { readFileContent } from '../fileUtils';

// Define the read_file tool, which reads a whole file or a specific 1-based line range
export const readFileTool: InternalTool = {
  // Tool metadata
  name: "read_file",
  description: "Read a file. Optionally pass startLine and endLine to read only a specific line range.",
  allowedModes: ['plan', 'build'],
  permission: {
    scope: 'read',
    getTarget: (args) => typeof args.filePath === 'string' ? args.filePath : '',
  },
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: "The path to the file to read",
        required: true,
      },
      startLine: {
        type: 'integer',
        description: "Optional 1-based start line for a partial read",
        required: false,
        nullable: true,
      },
      endLine: {
        type: 'integer',
        description: "Optional 1-based end line for a partial read",
        required: false,
        nullable: true,
      },
    },
  },

  execute: (args: { filePath: string; startLine?: number; endLine?: number }) => {
    const result = readFile(args.filePath, args.startLine, args.endLine);
    return result;
  },
};

function splitLines(content: string): string[] {
    if (content.length === 0) {
        return [];
    }

    const normalizedContent = content.replace(/\r\n/g, '\n');
    const withoutTrailingNewline = normalizedContent.endsWith('\n')
        ? normalizedContent.slice(0, -1)
        : normalizedContent;

    return withoutTrailingNewline.length > 0
        ? withoutTrailingNewline.split('\n')
        : [];
}

function validateLineNumber(value: number | undefined, fieldName: string): void {
    if (value === undefined) {
        return;
    }

    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${fieldName} must be a positive integer.`);
    }
}

function formatLineRange(filePath: string, lines: string[], startLine: number, endLine: number): string {
    const width = String(endLine).length;
    const numberedLines = lines.map((line, index) =>
        `${String(startLine + index).padStart(width, ' ')} | ${line}`
    );

    return [
        `File: ${filePath}`,
        `Lines: ${startLine}-${endLine}`,
        '',
        ...numberedLines,
    ].join('\n');
}

// Function to read a file at the specified path
export function readFile(filePath: string, startLine?: number, endLine?: number): string {
    try {
        const content = readFileContent(filePath);
        validateLineNumber(startLine, 'startLine');
        validateLineNumber(endLine, 'endLine');

        if (startLine === undefined && endLine === undefined) {
            return content;
        }

        const lines = splitLines(content);
        const totalLines = lines.length;
        const resolvedStartLine = startLine ?? 1;
        const resolvedEndLine = endLine ?? totalLines;

        if (resolvedStartLine > resolvedEndLine) {
            throw new Error('startLine must be less than or equal to endLine.');
        }

        if (totalLines === 0) {
            throw new Error(`Cannot read line range from empty file: ${filePath}`);
        }

        if (resolvedStartLine > totalLines) {
            throw new Error(
                `startLine ${resolvedStartLine} is outside the file. ${filePath} has ${totalLines} line(s).`
            );
        }

        const clampedEndLine = Math.min(resolvedEndLine, totalLines);
        const selectedLines = lines.slice(resolvedStartLine - 1, clampedEndLine);

        return formatLineRange(filePath, selectedLines, resolvedStartLine, clampedEndLine);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`File not found: ${filePath}`);
        }

        throw error;
    }
}
