export interface FileMatchHint {
  requested: string;
  candidate: string;
  score: number;
}

// Calculate the Levenshtein distance between two strings
function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Initialize two arrays to represent the matrix rows
    let prevRow = new Array(n + 1).fill(0);
    let currRow = new Array(n + 1).fill(0);

    // Initialize the first row with consecutive numbers
    for (let j = 0; j <= n; j++) {
        prevRow[j] = j;
    }

    // Dynamic programming to fill the matrix
    for (let i = 1; i <= m; i++) {
        currRow[0] = i;

        for (let j = 1; j <= n; j++) {
            // Check if characters at the current positions are equal
            if (a[i - 1] === b[j - 1]) {
                currRow[j] = prevRow[j - 1]; // No operation required
            } else {
                // Choose the minimum of three possible operations (insert, remove, replace)
                currRow[j] = 1 + Math.min(
                    currRow[j - 1],   // Insert
                    prevRow[j],       // Remove
                    prevRow[j - 1]    // Replace
                );
            }
        }

        // Update the previous row with the current row for the next iteration
        const temp = prevRow;
        prevRow = currRow;
        currRow = temp;
    }

    // The result is the value at the bottom-right corner of the matrix
    return prevRow[n];
}

// Calculate the similarity score between two strings
function scoreStringSimilarity(a: string, b: string): number {
    if (a.length === 0 || b.length === 0) return 0;
    const distance = levenshteinDistance(a, b);
    return 1 - distance / Math.max(a.length, b.length);
}

// Calculate the similarity score for file extensions
function scoreExtensionSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.startsWith(b) || b.startsWith(a)) return 0.8;

    const distance = levenshteinDistance(a, b);
    if (distance === 1) return 0.6;
    if (distance === 2) return 0.3;

    return 0;
}

function getBaseNameFromNormalizedPath(filePath: string): string {
    const lastSlashIndex = filePath.lastIndexOf('/');
    return lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
}

function getExtensionFromNormalizedPath(filePath: string): string {
    const baseName = getBaseNameFromNormalizedPath(filePath);
    const lastDotIndex = baseName.lastIndexOf('.');

    return lastDotIndex === -1 ? '' : baseName.slice(lastDotIndex + 1);
}

function getFileStemFromNormalizedPath(filePath: string): string {
    const baseName = getBaseNameFromNormalizedPath(filePath);
    const lastDotIndex = baseName.lastIndexOf('.');

    return lastDotIndex === -1 ? baseName : baseName.slice(0, lastDotIndex);
}

// Normalize the path for matching
function normalizePathForMatching(filePath: string): string {
  return filePath
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

function hasDirectoryPart(filePath: string): boolean {
  return filePath.includes('/') || filePath.includes('\\');
}

// Find the closest file match
export function findClosestFileMatch(
  requestedPath: string,
  existingPaths: string[],
): FileMatchHint | null {
    const requestedHasDirectory = hasDirectoryPart(requestedPath);
    const requestedNormalized = normalizePathForMatching(requestedPath);
    const requestedStem = getFileStemFromNormalizedPath(requestedNormalized);
    const requestedExtension = getExtensionFromNormalizedPath(requestedNormalized);
    let bestMatch: FileMatchHint | null = null;
    let secondBestMatch: FileMatchHint | null = null;

    for (const existingPath of existingPaths) {
        const existingNormalized = normalizePathForMatching(existingPath);
        const existingStem = getFileStemFromNormalizedPath(existingNormalized);
        const existingExtension = getExtensionFromNormalizedPath(existingNormalized);

        if (requestedNormalized === existingNormalized) {
            return { requested: requestedPath, candidate: existingPath, score: 1 };
        }

        const stemScore = scoreStringSimilarity(requestedStem, existingStem);
        const extensionScore = scoreExtensionSimilarity(requestedExtension, existingExtension);
        const fullPathScore = scoreStringSimilarity(requestedNormalized, existingNormalized);

        const score = requestedHasDirectory
            ? stemScore * 0.4 + extensionScore * 0.15 + fullPathScore * 0.45
            : stemScore * 0.65 + extensionScore * 0.2 + fullPathScore * 0.15;

        const match = { requested: requestedPath, candidate: existingPath, score };
        if (!bestMatch || score > bestMatch.score) {
            secondBestMatch = bestMatch;
            bestMatch = match;
        } else if (!secondBestMatch || score > secondBestMatch.score) {
            secondBestMatch = match;
        }
    }

    if (bestMatch) {
        if (secondBestMatch && bestMatch.score - secondBestMatch.score < 0.1) {
            return null;
        }

        return bestMatch.score >= 0.7 ? bestMatch : null;
    }

    return null;
}
