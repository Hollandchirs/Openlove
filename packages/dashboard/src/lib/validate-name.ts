/**
 * Validates a character name to prevent path traversal attacks.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function validateCharacterName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && !name.includes("..");
}
