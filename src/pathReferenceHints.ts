// Extract file references from the user prompt
function extractFileReferences(userPrompt: string): string[] {
    const fileReferenceRegex = /\b(?:[\w.-]+[\\/])*[\w.-]+\.[a-zA-Z0-9]{1,10}\b/g;
    return userPrompt.match(fileReferenceRegex) ?? [];
}

// Extract directory references from the user prompt
function extractDirectoryReferences(userPrompt: string): string[] {
    const directoryReferenceRegex = /\b(?:inside|in|under)\s+((?:[\w.-]+[\\/])+[\w.-]+)\b/gi;

    return Array.from(userPrompt.matchAll(directoryReferenceRegex))
        .map((match) => match[1]?.trim())
        .filter((directoryPath): directoryPath is string => Boolean(directoryPath));
}

// Interface for referenced path groups
export interface ReferencedPathGroup {
    candidatePaths: string[];
}

// Build referenced path groups
export function buildReferencedPathGroups(userPrompt: string): ReferencedPathGroup[] {
    const fileReferences = Array.from(new Set(extractFileReferences(userPrompt)));
    const directoryReferences = Array.from(new Set(extractDirectoryReferences(userPrompt)));

    return fileReferences.map((fileReference) => {
        const candidatePaths: string[] = [];
        const hasDirectory = fileReference.includes('/') || fileReference.includes('\\');

        if (hasDirectory) {
            candidatePaths.push(fileReference);
        } else if (directoryReferences.length === 1) {
            const directoryReference = directoryReferences[0];
            if (directoryReference) {
                const normalizedDirectoryReference = directoryReference.replace(/[\\/]+$/, '');
                candidatePaths.push(`${normalizedDirectoryReference}/${fileReference}`);
            }

            candidatePaths.push(fileReference);
        } else {
            candidatePaths.push(fileReference);
        }

        return {
            candidatePaths: Array.from(new Set(candidatePaths)),
        };
    });
}
