/**
 * Context-free, single-code-point lowercase for the editor's identity checks.
 * This follows the simple lowercase comparison used by our PostgreSQL indexes;
 * whole-string JS lowercasing applies contextual casing and full expansions.
 * The server remains authoritative for identity ownership and uniqueness.
 */
export function identityTextKey(value: string | undefined): string {
  return Array.from((value ?? "").trim(), (character) => {
    return Array.from(character.toLowerCase())[0] ?? character;
  }).join("");
}
