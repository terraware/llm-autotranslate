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

interface CsvRow {
  [columnName: string]: string;
}

type RowMapper<T> = (columns: string[]) => T | null;

async function readCsvFile<T>(
  filePath: string,
  rowMapper: RowMapper<T>,
  options: {
    throwOnMissing?: boolean;
    errorContext?: string;
  } = {}
): Promise<T[]> {
  const { throwOnMissing = true, errorContext = 'CSV' } = options;

  if (!existsSync(filePath)) {
    if (throwOnMissing) {
      throw new Error(`${errorContext} file not found: ${filePath}`);
    }
    return [];
  }

  return new Promise((resolve, reject) => {
    const records: T[] = [];

    createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (chunk: CsvRow) => {
        try {
          const columnNames = Object.keys(chunk);
          const columns = columnNames.map((name) => (chunk[name] || '').trim());

          const record = rowMapper(columns);
          if (record !== null) {
            records.push(record);
          }
        } catch (error) {
          reject(
            new Error(`Error processing ${errorContext} row: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      })
      .on('end', () => {
        resolve(records);
      })
      .on('error', (error) => {
        reject(new Error(`Failed to read ${errorContext} file ${filePath}: ${error.message}`));
      });
  });
}

export async function readSourceCsv(filePath: string): Promise<SourceRecord[]> {
  return readCsvFile(
    filePath,
    (columns: string[]) => {
      const [key, text, description] = columns;

      // Skip rows with empty key or text
      if (!key || !text) {
        return null;
      }

      return {
        key,
        text,
        description: description || '',
        hash: calculateHash(text, description || ''),
      };
    },
    { throwOnMissing: true, errorContext: 'Source CSV' }
  );
}

export async function readTargetCsv(filePath: string): Promise<TargetRecord[]> {
  return readCsvFile(
    filePath,
    (columns: string[]) => {
      const [key, text, hash] = columns;

      // Skip rows with empty key or text
      if (!key || !text) {
        return null;
      }

      return {
        key,
        text,
        hash: hash || '',
      };
    },
    { throwOnMissing: false, errorContext: 'Target CSV' }
  );
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
