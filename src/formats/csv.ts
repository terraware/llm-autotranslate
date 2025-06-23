import csvParser from 'csv-parser';
import * as createCsvWriter from 'csv-writer';
import { createReadStream, existsSync } from 'fs';
import { writeFile } from 'fs/promises';

import { calculateHash } from '../hash.js';
import { SourceRecord, TargetRecord } from '../records.js';
import { BidirectionalFormatter, StringRecord } from './index.js';

interface CsvRow {
  [columnName: string]: string;
}

type RowMapper<T> = (columns: string[]) => T | null;

async function readCsvFile<T>(filePath: string, rowMapper: RowMapper<T>, which: string): Promise<T[]> {
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
          reject(new Error(`Error processing ${which} row: ${error instanceof Error ? error.message : String(error)}`));
        }
      })
      .on('end', () => {
        resolve(records);
      })
      .on('error', (error) => {
        reject(new Error(`Failed to read ${which} file ${filePath}: ${error.message}`));
      });
  });
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
    if (!existsSync(filePath)) {
      throw new Error(`Source file not found: ${filePath}`);
    }

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
      'Source CSV'
    );
  }

  async parseTarget(filePath: string): Promise<TargetRecord[]> {
    if (!existsSync(filePath)) {
      return [];
    }

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
      'Target CSV'
    );
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

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
