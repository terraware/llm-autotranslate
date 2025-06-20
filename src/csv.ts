import csvParser from 'csv-parser';
import * as createCsvWriter from 'csv-writer';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { pipeline } from 'stream/promises';

import { calculateHash } from './hash.js';

export interface SourceRecord {
  key: string;
  text: string;
  description: string;
  hash: string;
}

export interface TargetRecord {
  key: string;
  text: string;
  hash: string;
}

export async function readSourceCsv(filePath: string): Promise<SourceRecord[]> {
  if (!existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const records: SourceRecord[] = [];
  let isFirstRow = true;

  await pipeline(
    createReadStream(filePath),
    csvParser({
      headers: ['key', 'text', 'description'],
    }),
    async function* (source) {
      for await (const chunk of source) {
        // Skip the first row (header row)
        if (isFirstRow) {
          isFirstRow = false;
          continue;
        }

        const record: SourceRecord = {
          key: chunk.key || '',
          text: chunk.text || '',
          description: chunk.description || '',
          hash: calculateHash(chunk.text || '', chunk.description || ''),
        };

        records.push(record);
        yield record;
      }
    }
  );

  return records;
}

export async function readTargetCsv(filePath: string): Promise<TargetRecord[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  const records: TargetRecord[] = [];
  let isFirstRow = true;

  await pipeline(
    createReadStream(filePath),
    csvParser({
      headers: ['key', 'text', 'hash'],
    }),
    async function* (source) {
      for await (const chunk of source) {
        // Skip the first row (header row)
        if (isFirstRow) {
          isFirstRow = false;
          continue;
        }

        const record: TargetRecord = {
          key: chunk.key || '',
          text: chunk.text || '',
          hash: chunk.hash || '',
        };

        records.push(record);
        yield record;
      }
    }
  );

  return records;
}

export async function writeTargetCsv(filePath: string, records: TargetRecord[]): Promise<void> {
  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'key', title: 'Key' },
      { id: 'text', title: 'Text' },
      { id: 'hash', title: 'Hash' },
    ],
  });

  await csvWriter.writeRecords(records);
}
