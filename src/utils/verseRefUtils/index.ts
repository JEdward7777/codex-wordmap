
export const verseRefRegex = /(\b[A-Z, 1-9]{3}\s\d+:\d+\b)/;

export function extractVerseRefFromLine(line: string): string | null {
    // Implement logic to extract the verse reference (e.g., 'MAT 1:1') from a line
    // Return the verse reference as a string, or null if not found
    const match = line.match(verseRefRegex);
    return match ? match[0] : null;
}
