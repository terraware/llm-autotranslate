import { readFile, writeFile } from 'fs/promises';

import { calculateHash } from '../hash.js';
import { SourceRecord, TargetRecord } from '../records.js';
import { BidirectionalFormatter, StringRecord } from './index.js';

interface ExtractedMessage {
  defaultMessage: string;
  description?: string;
}

export class FormatJSJsonFormatter implements BidirectionalFormatter {
  format(records: StringRecord[]): string {
    const result: Record<string, ExtractedMessage> = {};
    for (const record of records) {
      const entry: ExtractedMessage = { defaultMessage: record.text };
      if (record.description) {
        entry.description = record.description;
      }
      result[record.key] = entry;
    }
    return JSON.stringify(result, null, 2) + '\n';
  }

  canParse(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.json');
  }

  async parseSource(filePath: string): Promise<SourceRecord[]> {
    const content = await readFile(filePath, 'utf-8');
    const obj: Record<string, ExtractedMessage> = JSON.parse(content);

    return Object.entries(obj).map(([key, value]) => ({
      key,
      text: value.defaultMessage,
      description: value.description || '',
      hash: calculateHash(value.defaultMessage, value.description || ''),
    }));
  }

  async parseTarget(filePath: string): Promise<TargetRecord[]> {
    const content = await readFile(filePath, 'utf-8');
    const obj: Record<string, ExtractedMessage> = JSON.parse(content);
    return Object.entries(obj).map(([key, value]) => ({
      key,
      text: value.defaultMessage,
      hash: value.description || '', // In target files, descriptions are hashes
    }));
  }

  async writeSource(filePath: string, records: SourceRecord[]): Promise<void> {
    const result: Record<string, ExtractedMessage> = {};
    for (const record of records) {
      const entry: ExtractedMessage = { defaultMessage: record.text };
      if (record.description) {
        entry.description = record.description;
      }
      result[record.key] = entry;
    }
    const content = JSON.stringify(result, null, 2) + '\n';
    await writeFile(filePath, content, 'utf-8');
  }

  async writeTarget(filePath: string, records: TargetRecord[]): Promise<void> {
    const result: Record<string, ExtractedMessage> = {};
    for (const record of records) {
      result[record.key] = {
        defaultMessage: record.text,
      };
      if (record.hash) {
        // In target files, hashes are descriptions
        result[record.key].description = record.hash;
      }
    }
    const content = JSON.stringify(result, null, 2) + '\n';
    await writeFile(filePath, content, 'utf-8');
  }
}
