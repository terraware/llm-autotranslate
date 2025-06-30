import { existsSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';

import { calculateHash } from '../hash.js';
import { SourceRecord, TargetRecord } from '../records.js';
import { BidirectionalFormatter, StringRecord } from './index.js';

export class JavaScriptConstFormatter implements BidirectionalFormatter {
  format(records: StringRecord[]): string {
    const lines: string[] = [];
    lines.push('export const strings = {');

    for (const record of records) {
      if (record.description && record.description.trim()) {
        lines.push(`  // ${record.description}`);
      }
      const escapedKey = JSON.stringify(record.key);
      const escapedText = JSON.stringify(record.text);
      lines.push(`  ${escapedKey}: ${escapedText},`);
    }

    lines.push('};');
    return lines.join('\n') + '\n';
  }

  canParse(filePath: string): boolean {
    const ext = filePath.toLowerCase();
    return ext.endsWith('.js') || ext.endsWith('.mjs') || ext.endsWith('.ts');
  }

  async parseSource(filePath: string): Promise<SourceRecord[]> {
    if (!existsSync(filePath)) {
      throw new Error(`JavaScript source file not found: ${filePath}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    return this.parseJavaScriptContent(content, true);
  }

  async parseTarget(filePath: string): Promise<TargetRecord[]> {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const sourceRecords = this.parseJavaScriptContent(content, false);

    return sourceRecords.map((record) => ({
      key: record.key,
      text: record.text,
      hash: record.description || '', // In target files, comments are hashes
    }));
  }

  private parseJavaScriptContent(content: string, isSource: boolean): SourceRecord[] {
    try {
      const records = this.parseJavaScriptContentInternal(content, isSource);
      this.validateTranslationFile(records);
      return records;
    } catch (error) {
      if (error instanceof Error && error.message.includes('line')) {
        // Already has line info
        throw error;
      }

      throw new Error(
        `Failed to parse JavaScript translation file: ${error instanceof Error ? error.message : String(error)}\n\n` +
          `Expected format:\n` +
          `export const strings = {\n` +
          `  // Optional comment\n` +
          `  KEY_NAME: 'text value',\n` +
          `  ANOTHER_KEY: "another value",\n` +
          `};\n`
      );
    }
  }

  private parseJavaScriptContentInternal(content: string, isSource: boolean): SourceRecord[] {
    const records: SourceRecord[] = [];
    const lines = content.split('\n');
    let currentComment = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip empty lines and structural elements
      if (!line || line.startsWith('export') || line.includes('{') || line.includes('}')) {
        continue;
      }

      // Handle comments
      if (line.startsWith('//')) {
        currentComment = line.substring(2).trim();
        continue;
      }

      try {
        const record = this.parseKeyValueLine(line, currentComment, isSource, lineNumber);
        if (record) {
          records.push(record);
        }
      } catch (error) {
        throw new Error(`Error parsing line ${lineNumber} ${line}`, { cause: error });
      }

      // Reset comment after processing a key-value pair
      if (!line.startsWith('//')) {
        currentComment = '';
      }
    }

    return records;
  }

  private parseKeyValueLine(line: string, comment: string, isSource: boolean, lineNumber: number): SourceRecord | null {
    // More flexible regex for keys and values
    const keyValueMatch = line.match(/^(['"]?)(.+?)\1\s*:\s*(['"`])(.*?)\3\s*,?\s*$/);

    if (!keyValueMatch) {
      return null;
    }

    const [, , key, valueQuote, rawText] = keyValueMatch;
    const text = this.parseStringValue(rawText, valueQuote, lineNumber);

    return {
      key: key.trim(),
      text,
      description: comment,
      hash: isSource ? this.calculateHashValue(text, comment) : '',
    };
  }

  private parseStringValue(rawText: string, quote: string, lineNumber: number): string {
    try {
      switch (quote) {
        case '"':
          // For double quotes, we can use JSON.parse safely
          return JSON.parse(`"${rawText}"`);

        case "'":
          // For single quotes, handle escapes manually
          return rawText
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t');

        case '`':
          throw new Error('Template literals are not supported in translation files');

        default:
          return rawText;
      }
    } catch (error) {
      throw new Error(`Invalid string value on line ${lineNumber}`, { cause: error });
    }
  }

  private validateTranslationFile(records: SourceRecord[]): void {
    const keys = new Set<string>();

    for (const record of records) {
      // Check for duplicate keys
      if (keys.has(record.key)) {
        throw new Error(`Duplicate key found: "${record.key}"`);
      }
      keys.add(record.key);

      // Check for suspiciously empty text values
      if (record.text.trim().length === 0) {
        console.warn(`Warning: Empty text value for key "${record.key}"`);
      }

      // Check for extremely long values that might indicate a mistake
      if (record.text.length > 1000) {
        console.warn(`Warning: Very long text value for key "${record.key}" (${record.text.length} characters)`);
      }
    }
  }

  private calculateHashValue(text: string, description: string): string {
    return calculateHash(text, description);
  }

  async writeSource(filePath: string, records: SourceRecord[]): Promise<void> {
    const stringRecords: StringRecord[] = records.map((record) => ({
      key: record.key,
      text: record.text,
      description: record.description,
    }));

    const content = this.format(stringRecords);
    await writeFile(filePath, content, 'utf-8');
  }

  async writeTarget(filePath: string, records: TargetRecord[]): Promise<void> {
    const stringRecords: StringRecord[] = records.map((record) => ({
      key: record.key,
      text: record.text,
      description: record.hash, // In target files, we store hash as "description" for formatting
    }));

    const content = this.format(stringRecords);
    await writeFile(filePath, content, 'utf-8');
  }
}
