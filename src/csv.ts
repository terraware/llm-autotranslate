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

  return new Promise((resolve, reject) => {
    const records: SourceRecord[] = [];

    createReadStream(filePath)
      .pipe(
        csvParser({
          // Let csv-parser read headers from the file
        })
      )
      .on('data', (chunk) => {
        try {
          // Get the actual column names from the first row
          const columnNames = Object.keys(chunk);

          // Access columns by position: 0=key, 1=text, 2=description
          const key = chunk[columnNames[0]] || '';
          const text = chunk[columnNames[1]] || '';
          const description = chunk[columnNames[2]] || '';

          // Skip rows with empty key or text
          if (!key.trim() || !text.trim()) {
            return;
          }

          const record: SourceRecord = {
            key: key.trim(),
            text: text.trim(),
            description: description.trim(),
            hash: calculateHash(text.trim(), description.trim()),
          };

          records.push(record);
        } catch (error) {
          reject(new Error(`Error processing row: ${error instanceof Error ? error.message : String(error)}`));
        }
      })
      .on('end', () => {
        resolve(records);
      })
      .on('error', (error) => {
        reject(new Error(`Failed to read CSV file ${filePath}: ${error.message}`));
      });
  });
}

export async function readTargetCsv(filePath: string): Promise<TargetRecord[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const records: TargetRecord[] = [];

    createReadStream(filePath)
      .pipe(
        csvParser({
          // Let csv-parser read headers from the file
        })
      )
      .on('data', (chunk) => {
        try {
          // Get the actual column names from the first row
          const columnNames = Object.keys(chunk);

          // Access columns by position: 0=key, 1=text, 2=hash
          const key = chunk[columnNames[0]] || '';
          const text = chunk[columnNames[1]] || '';
          const hash = chunk[columnNames[2]] || '';

          // Skip rows with empty key or text
          if (!key.trim() || !text.trim()) {
            return;
          }

          const record: TargetRecord = {
            key: key.trim(),
            text: text.trim(),
            hash: hash.trim(),
          };

          records.push(record);
        } catch (error) {
          reject(
            new Error(`Error processing target CSV row: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      })
      .on('end', () => {
        resolve(records);
      })
      .on('error', (error) => {
        reject(new Error(`Failed to read target CSV file ${filePath}: ${error.message}`));
      });
  });
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
