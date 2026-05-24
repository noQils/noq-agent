import fs from 'node:fs';

import {
    checkPathExists,
    ensureParentDirectory,
    readFileContent,
    resolveProjectPath,
    writeFileContent,
} from '../fileUtils';
import { type InternalTool } from './index';

type AddFileOperation = {
    type: 'add';
    filePath: string;
    lines: string[];
};

type DeleteFileOperation = {
    type: 'delete';
    filePath: string;
};

type UpdateFileOperation = {
    type: 'update';
    filePath: string;
    moveTo?: string;
    lines: string[];
};

type PatchOperation =
    | AddFileOperation
    | DeleteFileOperation
    | UpdateFileOperation;

type PatchLine = {
    kind: 'context' | 'add' | 'remove';
    text: string;
};

type FileContentParts = {
    lines: string[];
    newline: '\n' | '\r\n';
    hadTrailingNewline: boolean;
};

const beginPatchMarker = '*** Begin Patch';
const endPatchMarker = '*** End Patch';
const addFileMarker = '*** Add File: ';
const deleteFileMarker = '*** Delete File: ';
const updateFileMarker = '*** Update File: ';
const moveToMarker = '*** Move to: ';
const endOfFileMarker = '*** End of File';

function normalizePatchText(patch: string): string[] {
    const normalizedPatch = patch.replaceAll('\r\n', '\n');
    const lines = normalizedPatch.split('\n');

    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }

    return lines;
}

function parsePatchOperations(patch: string): PatchOperation[] {
    const lines = normalizePatchText(patch);
    if (lines[0] !== beginPatchMarker) {
        throw new Error(`Patch must start with "${beginPatchMarker}".`);
    }

    const operations: PatchOperation[] = [];
    let index = 1;

    while (index < lines.length) {
        const line = lines[index];
        if (line === endPatchMarker) {
            if (operations.length === 0) {
                throw new Error('Patch must contain at least one file operation.');
            }

            return operations;
        }

        if (typeof line !== 'string') {
            throw new Error('Unexpected end of patch.');
        }

        if (line.startsWith(addFileMarker)) {
            const filePath = line.slice(addFileMarker.length).trim();
            index++;
            const addedLines: string[] = [];

            while (index < lines.length) {
                const bodyLine = lines[index];
                if (!bodyLine || bodyLine.startsWith('*** ')) {
                    break;
                }

                if (!bodyLine.startsWith('+')) {
                    throw new Error(`Add File entries must use "+" lines only. Invalid line: ${bodyLine}`);
                }

                addedLines.push(bodyLine.slice(1));
                index++;
            }

            operations.push({
                type: 'add',
                filePath,
                lines: addedLines,
            });
            continue;
        }

        if (line.startsWith(deleteFileMarker)) {
            operations.push({
                type: 'delete',
                filePath: line.slice(deleteFileMarker.length).trim(),
            });
            index++;
            continue;
        }

        if (line.startsWith(updateFileMarker)) {
            const filePath = line.slice(updateFileMarker.length).trim();
            index++;

            let moveTo: string | undefined;
            if (index < lines.length && lines[index]?.startsWith(moveToMarker)) {
                moveTo = lines[index]?.slice(moveToMarker.length).trim();
                index++;
            }

            const updateLines: string[] = [];
            while (index < lines.length) {
                const bodyLine = lines[index];
                if (!bodyLine || bodyLine.startsWith('*** ')) {
                    break;
                }

                updateLines.push(bodyLine);
                index++;
            }

            operations.push({
                type: 'update',
                filePath,
                ...(moveTo ? { moveTo } : {}),
                lines: updateLines,
            });
            continue;
        }

        throw new Error(`Unknown patch operation: ${line}`);
    }

    throw new Error(`Patch must end with "${endPatchMarker}".`);
}

function extractPatchTargets(patch: string): string[] {
    try {
        const operations = parsePatchOperations(patch);
        const targets: string[] = [];

        for (const operation of operations) {
            targets.push(operation.filePath);

            if (operation.type === 'update' && typeof operation.moveTo === 'string' && operation.moveTo.length > 0) {
                targets.push(operation.moveTo);
            }
        }

        return targets;
    } catch {
        return [];
    }
}

function splitFileContent(content: string): FileContentParts {
    const newline: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n';
    const normalizedContent = content.replaceAll('\r\n', '\n');
    const hadTrailingNewline = normalizedContent.endsWith('\n');
    const withoutTrailingNewline = hadTrailingNewline
        ? normalizedContent.slice(0, -1)
        : normalizedContent;

    return {
        lines: withoutTrailingNewline.length > 0 ? withoutTrailingNewline.split('\n') : [],
        newline,
        hadTrailingNewline,
    };
}

function joinFileContent(parts: FileContentParts): string {
    const content = parts.lines.join(parts.newline);
    if (parts.hadTrailingNewline && parts.lines.length > 0) {
        return `${content}${parts.newline}`;
    }

    return content;
}

function parseUpdatePatchLines(lines: string[]): PatchLine[][] {
    if (lines.length === 0) {
        return [];
    }

    const hunks: PatchLine[][] = [];
    let currentHunk: PatchLine[] = [];

    for (const line of lines) {
        if (line === endOfFileMarker) {
            continue;
        }

        if (line.startsWith('@@')) {
            if (currentHunk.length > 0) {
                hunks.push(currentHunk);
                currentHunk = [];
            }
            continue;
        }

        const prefix = line[0];
        const text = line.slice(1);

        if (prefix === ' ') {
            currentHunk.push({ kind: 'context', text });
            continue;
        }

        if (prefix === '+') {
            currentHunk.push({ kind: 'add', text });
            continue;
        }

        if (prefix === '-') {
            currentHunk.push({ kind: 'remove', text });
            continue;
        }

        throw new Error(`Invalid update patch line: ${line}`);
    }

    if (currentHunk.length > 0) {
        hunks.push(currentHunk);
    }

    return hunks;
}

function buildMatchLines(hunk: PatchLine[]): string[] {
    return hunk
        .filter((line) => line.kind !== 'add')
        .map((line) => line.text);
}

function buildReplacementLines(hunk: PatchLine[]): string[] {
    return hunk
        .filter((line) => line.kind !== 'remove')
        .map((line) => line.text);
}

function findUniqueMatchIndex(lines: string[], matchLines: string[], searchStartIndex: number): number {
    if (matchLines.length === 0) {
        throw new Error('Patch hunk must include at least one context or removed line.');
    }

    const matchIndexes: number[] = [];
    const maxStart = lines.length - matchLines.length;

    for (let index = searchStartIndex; index <= maxStart; index++) {
        let matched = true;

        for (let offset = 0; offset < matchLines.length; offset++) {
            if (lines[index + offset] !== matchLines[offset]) {
                matched = false;
                break;
            }
        }

        if (matched) {
            matchIndexes.push(index);
        }
    }

    if (matchIndexes.length === 0) {
        throw new Error('Patch context was not found in the target file.');
    }

    if (matchIndexes.length > 1) {
        throw new Error('Patch context matched multiple locations. Add more surrounding context.');
    }

    return matchIndexes[0]!;
}

function applyUpdateToContent(content: string, updateLines: string[]): string {
    const fileParts = splitFileContent(content);
    const hunks = parseUpdatePatchLines(updateLines);

    if (hunks.length === 0) {
        return content;
    }

    let currentLines = [...fileParts.lines];
    let searchStartIndex = 0;

    for (const hunk of hunks) {
        const matchLines = buildMatchLines(hunk);
        const replacementLines = buildReplacementLines(hunk);
        const matchIndex = findUniqueMatchIndex(currentLines, matchLines, searchStartIndex);

        currentLines = [
            ...currentLines.slice(0, matchIndex),
            ...replacementLines,
            ...currentLines.slice(matchIndex + matchLines.length),
        ];
        searchStartIndex = matchIndex + replacementLines.length;
    }

    return joinFileContent({
        lines: currentLines,
        newline: fileParts.newline,
        hadTrailingNewline: fileParts.hadTrailingNewline,
    });
}

function writeAddedFile(filePath: string, lines: string[]): void {
    if (checkPathExists(filePath)) {
        throw new Error(`File already exists: ${filePath}`);
    }

    ensureParentDirectory(filePath);

    const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
    writeFileContent(filePath, content);
}

function deleteFile(filePath: string): void {
    if (!checkPathExists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    fs.unlinkSync(resolveProjectPath(filePath));
}

function applyUpdateFile(operation: UpdateFileOperation): string {
    if (!checkPathExists(operation.filePath)) {
        throw new Error(`File not found: ${operation.filePath}`);
    }

    const originalContent = readFileContent(operation.filePath);
    const updatedContent = applyUpdateToContent(originalContent, operation.lines);
    const destinationPath = operation.moveTo ?? operation.filePath;

    ensureParentDirectory(destinationPath);
    writeFileContent(destinationPath, updatedContent);

    if (destinationPath !== operation.filePath) {
        deleteFile(operation.filePath);
    }

    const verifiedContent = readFileContent(destinationPath);
    if (verifiedContent !== updatedContent) {
        throw new Error(`Post-patch verification failed for ${destinationPath}`);
    }

    if (destinationPath !== operation.filePath) {
        return `Updated and moved ${operation.filePath} to ${destinationPath}`;
    }

    return `Updated ${destinationPath}`;
}

export function applyPatch(patch: string): string {
    const operations = parsePatchOperations(patch);
    const summaries: string[] = [];

    for (const operation of operations) {
        if (operation.type === 'add') {
            writeAddedFile(operation.filePath, operation.lines);
            summaries.push(`Created ${operation.filePath}`);
            continue;
        }

        if (operation.type === 'delete') {
            deleteFile(operation.filePath);
            summaries.push(`Deleted ${operation.filePath}`);
            continue;
        }

        summaries.push(applyUpdateFile(operation));
    }

    return `Applied patch:\n${summaries.map((summary) => `- ${summary}`).join('\n')}`;
}

export const applyPatchTool: InternalTool = {
    name: 'apply_patch',
    description: 'Apply a structured multi-file patch. Use the format with *** Begin Patch, file operations such as *** Update File:, and *** End Patch.',
    allowedModes: ['build'],
    permission: {
        scope: 'edit',
        getTarget: (args) => {
            const patch = typeof args.patch === 'string' ? args.patch : '';
            return extractPatchTargets(patch)[0] ?? 'patch';
        },
        getPathTargets: (args) => {
            const patch = typeof args.patch === 'string' ? args.patch : '';
            return extractPatchTargets(patch);
        },
    },
    parameters: {
        type: 'object',
        properties: {
            patch: {
                type: 'string',
                description: 'The full patch text using *** Begin Patch / *** Update File / *** Add File / *** Delete File / *** End Patch markers.',
                required: true,
            },
        },
        additionalProperties: false,
    },
    execute: (args: { patch: string }) => {
        if (typeof args.patch !== 'string' || args.patch.trim().length === 0) {
            throw new Error('patch must be a non-empty string.');
        }

        return applyPatch(args.patch);
    },
};
