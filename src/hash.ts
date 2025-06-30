import * as XXH from 'xxhashjs';

export function calculateHash(text: string, description: string = ''): string {
  // Combine text and description for hashing
  const combined = text + '|' + description;

  // Use xxHash with a fixed seed for consistent results
  const hash = XXH.h32(combined, 0xabcd);

  // Return as zero-padded hexadecimal string (8 characters for 32-bit hash)
  return hash.toString(16).padStart(8, '0');
}
