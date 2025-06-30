import { calculateHash } from '../hash.js';

describe('calculateHash', () => {
  it('should generate consistent hash for same input', () => {
    const text = 'Hello, world!';
    const description = 'A greeting message';

    const hash1 = calculateHash(text, description);
    const hash2 = calculateHash(text, description);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(8);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should generate different hashes for different text', () => {
    const description = 'A message';

    const hash1 = calculateHash('Hello', description);
    const hash2 = calculateHash('Goodbye', description);

    expect(hash1).not.toBe(hash2);
    expect(hash1).toHaveLength(8);
    expect(hash2).toHaveLength(8);
  });

  it('should generate different hashes for different descriptions', () => {
    const text = 'Hello';

    const hash1 = calculateHash(text, 'A greeting');
    const hash2 = calculateHash(text, 'A salutation');

    expect(hash1).not.toBe(hash2);
    expect(hash1).toHaveLength(8);
    expect(hash2).toHaveLength(8);
  });

  it('should handle empty description', () => {
    const text = 'Hello';

    const hash1 = calculateHash(text, '');
    const hash2 = calculateHash(text);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(8);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle empty text', () => {
    const description = 'Empty text test';

    const hash = calculateHash('', description);

    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle special characters', () => {
    const text = 'Text with special chars: äöü, 中文, 🎉';
    const description = 'Unicode test';

    const hash = calculateHash(text, description);

    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle very long strings', () => {
    const text = 'x'.repeat(10000);
    const description = 'y'.repeat(5000);

    const hash = calculateHash(text, description);

    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should generate different hashes when text and description are swapped', () => {
    const hash1 = calculateHash('Hello', 'World');
    const hash2 = calculateHash('World', 'Hello');

    expect(hash1).not.toBe(hash2);
  });

  it('should handle newlines and whitespace', () => {
    const text1 = 'Hello\nWorld';
    const text2 = 'Hello World';
    const description = 'Test';

    const hash1 = calculateHash(text1, description);
    const hash2 = calculateHash(text2, description);

    expect(hash1).not.toBe(hash2);
  });

  it('should return lowercase hexadecimal', () => {
    const hash = calculateHash('Test', 'Description');

    expect(hash).toBe(hash.toLowerCase());
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
