import { existsSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';

import { calculateHash } from '../hash.js';
import { SourceRecord, TargetRecord } from '../records.js';
import { BidirectionalFormatter, StringRecord } from './index.js';

export class JavaPropertiesFormatter implements BidirectionalFormatter {
  format(records: StringRecord[]): string {
    const lines: string[] = ['# encoding: UTF-8'];

    for (const record of records) {
      if (record.description && record.description.trim()) {
        lines.push(`# ${record.description}`);
      }
      const escapedKey = this.escapeKey(record.key);
      const escapedValue = this.escapeValue(record.text);
      lines.push(`${escapedKey}=${escapedValue}`);
    }

    return lines.join('\n') + '\n';
  }

  canParse(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.properties');
  }

  async parseSource(filePath: string): Promise<SourceRecord[]> {
    if (!existsSync(filePath)) {
      throw new Error(`Java properties source file not found: ${filePath}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    return this.parsePropertiesContent(content, true);
  }

  async parseTarget(filePath: string): Promise<TargetRecord[]> {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const sourceRecords = this.parsePropertiesContent(content, false);

    return sourceRecords.map((record) => ({
      key: record.key,
      text: record.text,
      hash: record.description || '', // In target files, comments are hashes
    }));
  }

  private parsePropertiesContent(content: string, isSource: boolean): SourceRecord[] {
    const records: SourceRecord[] = [];
    const lines = content.split('\n');

    let currentComment = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        currentComment = '';
        continue;
      }

      // Ignore encoding if it's the first line of the file
      if (line.startsWith('# encoding:') && i === 0) {
        continue;
      }

      // Handle comments
      if (line.startsWith('#')) {
        currentComment = line.substring(1).trim();
        continue;
      }

      // Handle key=value pairs
      const equalIndex = line.indexOf('=');
      if (equalIndex > 0) {
        const key = this.unescapeKey(line.substring(0, equalIndex).trim());
        const value = this.unescapeValue(line.substring(equalIndex + 1));

        if (key) {
          records.push({
            key,
            text: value,
            description: currentComment,
            hash: isSource ? this.calculateHashValue(value, currentComment) : '',
          });
        }
      }

      // Reset comment after processing a key-value pair
      currentComment = '';
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

  private escapeKey(key: string): string {
    // In Java properties, keys need to escape: space, tab, form feed, =, :, #, !
    return key
      .replace(/\\/g, '\\\\')
      .replace(/ /g, '\\ ')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/=/g, '\\=')
      .replace(/:/g, '\\:')
      .replace(/#/g, '\\#')
      .replace(/!/g, '\\!');
  }

  private escapeValue(value: string): string {
    // In Java properties, values need to escape: backslash, newline, carriage return, tab, form feed
    // Single quotes are escaped by doubling them
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/'/g, "''");
  }

  private unescapeKey(key: string): string {
    // Reverse the escaping done in escapeKey
    return key
      .replace(/\\!/g, '!')
      .replace(/\\#/g, '#')
      .replace(/\\:/g, ':')
      .replace(/\\=/g, '=')
      .replace(/\\f/g, '\f')
      .replace(/\\t/g, '\t')
      .replace(/\\ /g, ' ')
      .replace(/\\\\/g, '\\');
  }

  private unescapeValue(value: string): string {
    // Reverse the escaping done in escapeValue
    return value
      .replace(/''/g, "'")
      .replace(/\\f/g, '\f')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }
}
