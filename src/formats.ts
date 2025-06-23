import { existsSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';

import { SourceRecord, TargetRecord } from './csv.js';
import { calculateHash } from './hash.js';

export interface OutputSpec {
  format: string;
  file: string;
}

export interface StringRecord {
  key: string;
  text: string;
  description?: string;
}

export interface OutputFormatter {
  format(records: StringRecord[]): string;
}

export interface InputFormatter {
  parseSource(filePath: string): Promise<SourceRecord[]>;
  parseTarget(filePath: string): Promise<TargetRecord[]>;
  canParse(filePath: string): boolean;
}

export interface BidirectionalFormatter extends OutputFormatter, InputFormatter {
  writeSource(filePath: string, records: SourceRecord[]): Promise<void>;
  writeTarget(filePath: string, records: TargetRecord[]): Promise<void>;
}

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

export class JavaPropertiesFormatter implements BidirectionalFormatter {
  format(records: StringRecord[]): string {
    const lines: string[] = [];

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

export class CsvFormatter implements BidirectionalFormatter {
  format(records: StringRecord[]): string {
    // This is only used for output files, not main CSV files
    // Main CSV files are handled by csv.ts functions
    const lines: string[] = [];
    lines.push('Key,Text,Description'); // Source CSV header

    for (const record of records) {
      const key = this.escapeCsv(record.key);
      const text = this.escapeCsv(record.text);
      const description = this.escapeCsv(record.description || '');
      lines.push(`${key},${text},${description}`);
    }

    return lines.join('\n') + '\n';
  }

  canParse(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.csv');
  }

  async parseSource(filePath: string): Promise<SourceRecord[]> {
    // Delegate to existing CSV parsing logic
    const { readSourceCsv } = await import('./csv.js');
    return readSourceCsv(filePath);
  }

  async parseTarget(filePath: string): Promise<TargetRecord[]> {
    // Delegate to existing CSV parsing logic
    const { readTargetCsv } = await import('./csv.js');
    return readTargetCsv(filePath);
  }

  async writeSource(filePath: string, records: SourceRecord[]): Promise<void> {
    // For CSV, we don't use the format() method - we use the dedicated CSV writer
    // This would only be called for output files, not main CSV files
    const stringRecords: StringRecord[] = records.map((record) => ({
      key: record.key,
      text: record.text,
      description: record.description,
    }));

    const content = this.format(stringRecords);
    await writeFile(filePath, content, 'utf-8');
  }

  async writeTarget(filePath: string, records: TargetRecord[]): Promise<void> {
    // Delegate to existing CSV writing logic
    const { writeTargetCsv } = await import('./csv.js');
    return writeTargetCsv(filePath, records);
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

export class OutputFormatterRegistry {
  private formatters = new Map<string, OutputFormatter>();

  constructor() {
    this.register('java-properties', new JavaPropertiesFormatter());
    this.register('javascript-const', new JavaScriptConstFormatter());
    this.register('csv', new CsvFormatter());
  }

  register(formatName: string, formatter: OutputFormatter): void {
    this.formatters.set(formatName, formatter);
  }

  get(formatName: string): OutputFormatter | undefined {
    return this.formatters.get(formatName);
  }

  getSupportedFormats(): string[] {
    return Array.from(this.formatters.keys());
  }
}

export class BidirectionalFormatterRegistry {
  private formatters = new Map<string, BidirectionalFormatter>();

  constructor() {
    this.register('java-properties', new JavaPropertiesFormatter());
    this.register('javascript-const', new JavaScriptConstFormatter());
    this.register('csv', new CsvFormatter());
  }

  register(formatName: string, formatter: BidirectionalFormatter): void {
    this.formatters.set(formatName, formatter);
  }

  get(formatName: string): BidirectionalFormatter | undefined {
    return this.formatters.get(formatName);
  }

  getSupportedFormats(): string[] {
    return Array.from(this.formatters.keys());
  }

  detectFormat(filePath: string, explicitFormat?: string): string {
    if (explicitFormat && this.formatters.has(explicitFormat)) {
      return explicitFormat;
    }

    const ext = filePath.toLowerCase();
    if (ext.endsWith('.properties')) return 'java-properties';
    if (ext.endsWith('.js') || ext.endsWith('.mjs') || ext.endsWith('.ts')) return 'javascript-const';
    if (ext.endsWith('.csv')) return 'csv';

    return 'csv'; // default fallback
  }
}

export const outputRegistry = new OutputFormatterRegistry();
export const bidirectionalRegistry = new BidirectionalFormatterRegistry();
