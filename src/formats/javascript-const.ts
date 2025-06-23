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
    const records: SourceRecord[] = [];
    const lines = content.split('\n');
    let currentComment = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Handle comments
      if (line.startsWith('//')) {
        currentComment = line.substring(2).trim();
        continue;
      }

      // Handle key-value pairs - extract key and quoted value
      const keyValueMatch = line.match(/^(["']?)([^"'\s:]+)\1\s*:\s*(["'])([\s\S]*?)\3\s*,?\s*$/);
      if (keyValueMatch) {
        const [, , key, , rawText] = keyValueMatch;

        if (key && rawText !== undefined) {
          try {
            // Use JSON.parse to handle string escaping - much more robust!
            // Convert to JSON format by escaping quotes and wrapping in double quotes
            const escapedText = rawText.replace(/"/g, '\\"');
            const jsonValue = `"${escapedText}"`;
            const text = JSON.parse(jsonValue);

            records.push({
              key,
              text,
              description: currentComment,
              hash: isSource ? this.calculateHashValue(text, currentComment) : '',
            });
          } catch (error) {
            // Fallback to raw text if JSON parsing fails
            records.push({
              key,
              text: rawText,
              description: currentComment,
              hash: isSource ? this.calculateHashValue(rawText, currentComment) : '',
            });
          }
        }
      }

      // Reset comment after processing a key-value pair
      if (!line.startsWith('//')) {
        currentComment = '';
      }
    }

    return records;
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
