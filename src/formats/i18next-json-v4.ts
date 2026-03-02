import { readFile, writeFile } from 'fs/promises';

import { calculateHash } from '../hash.js';
import { SourceRecord, TargetRecord } from '../records.js';
import { BidirectionalFormatter, StringRecord } from './index.js';

const HASHES_KEY = '__hashes';

type NestedObject = { [key: string]: string | NestedObject };
type HashesMap = { [key: string]: string };

function flatten(obj: NestedObject, prefix = ''): { key: string; text: string }[] {
  const results: { key: string; text: string }[] = [];

  for (const [k, v] of Object.entries(obj)) {
    if (k === HASHES_KEY) continue;

    const fullKey = prefix ? `${prefix}.${k}` : k;

    if (typeof v === 'string') {
      results.push({ key: fullKey, text: v });
    } else if (typeof v === 'object' && v !== null) {
      results.push(...flatten(v, fullKey));
    }
  }

  return results;
}

function unflatten(entries: { key: string; text: string }[]): NestedObject {
  const root: NestedObject = {};

  for (const { key, text } of entries) {
    const parts = key.split('.');
    let current: NestedObject = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] === 'string') {
        current[part] = {};
      }
      current = current[part] as NestedObject;
    }

    current[parts[parts.length - 1]] = text;
  }

  return root;
}

export class I18nextJsonV4Formatter implements BidirectionalFormatter {
  format(records: StringRecord[]): string {
    const nested = unflatten(records.map((r) => ({ key: r.key, text: r.text })));
    return JSON.stringify(nested, null, 2) + '\n';
  }

  canParse(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.json');
  }

  async parseSource(filePath: string): Promise<SourceRecord[]> {
    const content = await readFile(filePath, 'utf-8');
    const obj: NestedObject = JSON.parse(content);
    const entries = flatten(obj);

    return entries.map((entry) => ({
      key: entry.key,
      text: entry.text,
      description: '',
      hash: calculateHash(entry.text, ''),
    }));
  }

  async parseTarget(filePath: string): Promise<TargetRecord[]> {
    const content = await readFile(filePath, 'utf-8');
    const obj = JSON.parse(content);

    // Empty object or only hashes → no records
    const hashes: HashesMap = obj[HASHES_KEY] || {};
    const entries = flatten(obj);

    if (entries.length === 0) {
      return [];
    }

    return entries.map((entry) => ({
      key: entry.key,
      text: entry.text,
      hash: hashes[entry.key] || '',
    }));
  }

  async writeSource(filePath: string, records: SourceRecord[]): Promise<void> {
    const nested = unflatten(records.map((r) => ({ key: r.key, text: r.text })));
    const content = JSON.stringify(nested, null, 2) + '\n';
    await writeFile(filePath, content, 'utf-8');
  }

  async writeTarget(filePath: string, records: TargetRecord[]): Promise<void> {
    const hashes: HashesMap = {};
    for (const record of records) {
      hashes[record.key] = record.hash;
    }

    const nested = unflatten(records.map((r) => ({ key: r.key, text: r.text })));
    const output = { [HASHES_KEY]: hashes, ...nested };
    const content = JSON.stringify(output, null, 2) + '\n';
    await writeFile(filePath, content, 'utf-8');
  }
}
