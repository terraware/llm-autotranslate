import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import { CsvFormatter } from '../formats/csv.js';
import { I18nextJsonV4Formatter } from '../formats/i18next-json-v4.js';
import { JavaPropertiesFormatter } from '../formats/java-properties.js';
import { JavaScriptConstFormatter } from '../formats/javascript-const.js';
import { SourceRecord, TargetRecord } from '../records.js';

const testDir = join(__dirname, 'temp-test-files');

beforeAll(() => {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
});

afterAll(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
});

describe('CsvFormatter', () => {
  let formatter: CsvFormatter;

  beforeEach(() => {
    formatter = new CsvFormatter();
  });

  describe('canParse', () => {
    it('should return true for .csv files', () => {
      expect(formatter.canParse('test.csv')).toBe(true);
      expect(formatter.canParse('TEST.CSV')).toBe(true);
      expect(formatter.canParse('/path/to/file.csv')).toBe(true);
    });

    it('should return false for non-csv files', () => {
      expect(formatter.canParse('test.txt')).toBe(false);
      expect(formatter.canParse('test.properties')).toBe(false);
      expect(formatter.canParse('test.js')).toBe(false);
    });
  });

  describe('format', () => {
    it('should format string records correctly', () => {
      const records = [
        { key: 'hello', text: 'Hello', description: 'A greeting' },
        { key: 'goodbye', text: 'Goodbye', description: '' },
        { key: 'complex', text: 'Text with, comma', description: 'Complex "quoted" text' },
      ];

      const result = formatter.format(records);
      const lines = result.split('\n');

      expect(lines[0]).toBe('Key,Text,Description');
      expect(lines[1]).toBe('hello,Hello,A greeting');
      expect(lines[2]).toBe('goodbye,Goodbye,');
      expect(lines[3]).toBe('complex,"Text with, comma","Complex ""quoted"" text"');
    });

    it('should handle empty records', () => {
      const result = formatter.format([]);
      expect(result).toBe('Key,Text,Description\n');
    });
  });

  describe('parseSource', () => {
    it('should parse valid source CSV file', async () => {
      const csvContent = 'Key,Text,Description\nhello,Hello,A greeting\ngoodbye,Goodbye,A farewell';
      const filePath = join(testDir, 'source.csv');
      writeFileSync(filePath, csvContent);

      const records = await formatter.parseSource(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        key: 'hello',
        text: 'Hello',
        description: 'A greeting',
        hash: expect.any(String),
      });
      expect(records[1]).toEqual({
        key: 'goodbye',
        text: 'Goodbye',
        description: 'A farewell',
        hash: expect.any(String),
      });
    });

    it('should skip rows with empty key or text', async () => {
      const csvContent = 'Key,Text,Description\nhello,Hello,A greeting\n,Empty key,Description\nvalid,Valid text,';
      const filePath = join(testDir, 'source-with-empty.csv');
      writeFileSync(filePath, csvContent);

      const records = await formatter.parseSource(filePath);

      expect(records).toHaveLength(2);
      expect(records[0].key).toBe('hello');
      expect(records[1].key).toBe('valid');
    });

    it('should throw error for non-existent file', async () => {
      await expect(formatter.parseSource('/nonexistent/file.csv')).rejects.toThrow('Source file not found');
    });
  });

  describe('parseTarget', () => {
    it('should parse valid target CSV file', async () => {
      const csvContent = 'Key,Text,Hash\nhello,Hola,abc123\ngoodbye,Adiós,def456';
      const filePath = join(testDir, 'target.csv');
      writeFileSync(filePath, csvContent);

      const records = await formatter.parseTarget(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        key: 'hello',
        text: 'Hola',
        hash: 'abc123',
      });
      expect(records[1]).toEqual({
        key: 'goodbye',
        text: 'Adiós',
        hash: 'def456',
      });
    });

    it('should return empty array for non-existent file', async () => {
      const records = await formatter.parseTarget('/nonexistent/target.csv');
      expect(records).toEqual([]);
    });
  });

  describe('writeTarget', () => {
    it('should write target records correctly', async () => {
      const records: TargetRecord[] = [
        { key: 'hello', text: 'Hola', hash: 'abc123' },
        { key: 'goodbye', text: 'Adiós', hash: 'def456' },
      ];
      const filePath = join(testDir, 'output-target.csv');

      await formatter.writeTarget(filePath, records);

      expect(existsSync(filePath)).toBe(true);
      const writtenRecords = await formatter.parseTarget(filePath);
      expect(writtenRecords).toEqual(records);
    });
  });
});

describe('JavaPropertiesFormatter', () => {
  let formatter: JavaPropertiesFormatter;

  beforeEach(() => {
    formatter = new JavaPropertiesFormatter();
  });

  describe('canParse', () => {
    it('should return true for .properties files', () => {
      expect(formatter.canParse('test.properties')).toBe(true);
      expect(formatter.canParse('TEST.PROPERTIES')).toBe(true);
      expect(formatter.canParse('/path/to/file.properties')).toBe(true);
    });

    it('should return false for non-properties files', () => {
      expect(formatter.canParse('test.csv')).toBe(false);
      expect(formatter.canParse('test.txt')).toBe(false);
      expect(formatter.canParse('test.js')).toBe(false);
    });
  });

  describe('format', () => {
    it('should format string records correctly', () => {
      const records = [
        { key: 'hello', text: 'Hello', description: 'A greeting' },
        { key: 'goodbye', text: 'Goodbye', description: '' },
        { key: 'special:key', text: "Text with 'quotes'", description: undefined },
      ];

      const result = formatter.format(records);
      const lines = result.split('\n');

      expect(lines[0]).toBe('# encoding: UTF-8');
      expect(lines[1]).toBe('# A greeting');
      expect(lines[2]).toBe('hello=Hello');
      expect(lines[3]).toBe('goodbye=Goodbye');
      expect(lines[4]).toBe("special\\:key=Text with ''quotes''");
    });

    it('should handle empty records', () => {
      const result = formatter.format([]);
      expect(result).toBe('# encoding: UTF-8\n');
    });
  });

  describe('parseSource', () => {
    it('should parse valid properties file', async () => {
      const content = `# encoding: UTF-8
# A greeting
hello=Hello
# A farewell
goodbye=Goodbye
special\\:key=Text with ''quotes''`;
      const filePath = join(testDir, 'source.properties');
      writeFileSync(filePath, content);

      const records = await formatter.parseSource(filePath);

      expect(records).toHaveLength(3);
      expect(records[0]).toEqual({
        key: 'hello',
        text: 'Hello',
        description: 'A greeting',
        hash: expect.any(String),
      });
      expect(records[1]).toEqual({
        key: 'goodbye',
        text: 'Goodbye',
        description: 'A farewell',
        hash: expect.any(String),
      });
      expect(records[2]).toEqual({
        key: 'special:key',
        text: "Text with 'quotes'",
        description: '',
        hash: expect.any(String),
      });
    });

    it('should not treat encoding header line as a string description', async () => {
      const content = `# encoding: UTF-8
hello=Hello
# encoding: UTF-8
goodbye=Goodbye\n`;
      const filePath = join(testDir, 'source.properties');
      writeFileSync(filePath, content);

      const records = await formatter.parseSource(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        key: 'hello',
        text: 'Hello',
        description: '',
        hash: expect.any(String),
      });
      expect(records[1]).toEqual({
        key: 'goodbye',
        text: 'Goodbye',
        description: 'encoding: UTF-8',
        hash: expect.any(String),
      });
    });

    it('should throw error for non-existent file', async () => {
      await expect(formatter.parseSource('/nonexistent/file.properties')).rejects.toThrow(
        'Java properties source file not found'
      );
    });
  });

  describe('parseTarget', () => {
    it('should parse target properties file', async () => {
      const content = `# abc123
hello=Hola
# def456
goodbye=Adiós`;
      const filePath = join(testDir, 'target.properties');
      writeFileSync(filePath, content);

      const records = await formatter.parseTarget(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        key: 'hello',
        text: 'Hola',
        hash: 'abc123',
      });
      expect(records[1]).toEqual({
        key: 'goodbye',
        text: 'Adiós',
        hash: 'def456',
      });
    });

    it('should return empty array for non-existent file', async () => {
      const records = await formatter.parseTarget('/nonexistent/target.properties');
      expect(records).toEqual([]);
    });
  });

  describe('writeTarget', () => {
    it('should write target records correctly', async () => {
      const records: TargetRecord[] = [
        { key: 'hello', text: 'Hola', hash: 'abc123' },
        { key: 'special:key', text: "Text with 'quotes'", hash: 'def456' },
      ];
      const filePath = join(testDir, 'output-target.properties');

      await formatter.writeTarget(filePath, records);

      expect(existsSync(filePath)).toBe(true);
      const writtenRecords = await formatter.parseTarget(filePath);
      expect(writtenRecords).toEqual(records);
    });
  });
});

describe('JavaScriptConstFormatter', () => {
  let formatter: JavaScriptConstFormatter;

  beforeEach(() => {
    formatter = new JavaScriptConstFormatter();
  });

  describe('canParse', () => {
    it('should return true for .js files', () => {
      expect(formatter.canParse('test.js')).toBe(true);
      expect(formatter.canParse('TEST.JS')).toBe(true);
      expect(formatter.canParse('/path/to/file.js')).toBe(true);
    });

    it('should return false for non-js files', () => {
      expect(formatter.canParse('test.csv')).toBe(false);
      expect(formatter.canParse('test.properties')).toBe(false);
      expect(formatter.canParse('test.txt')).toBe(false);
    });
  });

  describe('format', () => {
    it('should format string records correctly', () => {
      const records = [
        { key: 'hello', text: 'Hello', description: 'A greeting' },
        { key: 'goodbye', text: 'Goodbye', description: '' },
        { key: 'special', text: 'Text with \'quotes\' and "double quotes"', description: undefined },
      ];

      const result = formatter.format(records);

      expect(result).toContain('export const strings = {');
      expect(result).toContain('// A greeting');
      expect(result).toContain('"hello": "Hello",');
      expect(result).toContain('"goodbye": "Goodbye",');
      expect(result).toContain('"special": "Text with \'quotes\' and \\"double quotes\\"",');
      expect(result).toContain('};');
    });

    it('should handle empty records', () => {
      const result = formatter.format([]);
      expect(result).toBe('export const strings = {\n};\n');
    });
  });

  describe('writeSource and writeTarget', () => {
    it('should write source records correctly', async () => {
      const records: SourceRecord[] = [
        { key: 'hello', text: 'Hello', description: 'A greeting', hash: 'abc123' },
        { key: 'goodbye', text: 'Goodbye', description: '', hash: 'def456' },
      ];
      const filePath = join(testDir, 'output-source.js');

      await formatter.writeSource(filePath, records);

      expect(existsSync(filePath)).toBe(true);
    });

    it('should write target records correctly', async () => {
      const records: TargetRecord[] = [
        { key: 'hello', text: 'Hola', hash: 'abc123' },
        { key: 'goodbye', text: 'Adiós', hash: 'def456' },
      ];
      const filePath = join(testDir, 'output-target.js');

      await formatter.writeTarget(filePath, records);

      expect(existsSync(filePath)).toBe(true);
    });
  });
});

describe('I18nextJsonV4Formatter', () => {
  let formatter: I18nextJsonV4Formatter;

  beforeEach(() => {
    formatter = new I18nextJsonV4Formatter();
  });

  describe('canParse', () => {
    it('should return true for .json files', () => {
      expect(formatter.canParse('test.json')).toBe(true);
      expect(formatter.canParse('TEST.JSON')).toBe(true);
      expect(formatter.canParse('/path/to/file.json')).toBe(true);
    });

    it('should return false for non-json files', () => {
      expect(formatter.canParse('test.csv')).toBe(false);
      expect(formatter.canParse('test.properties')).toBe(false);
      expect(formatter.canParse('test.js')).toBe(false);
    });
  });

  describe('format', () => {
    it('should format flat records into nested JSON', () => {
      const records = [
        { key: 'welcome.heading', text: 'Hello', description: '' },
        { key: 'welcome.continue', text: 'Continue', description: '' },
      ];

      const result = formatter.format(records);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        welcome: {
          heading: 'Hello',
          continue: 'Continue',
        },
      });
    });

    it('should handle empty records', () => {
      const result = formatter.format([]);
      expect(JSON.parse(result)).toEqual({});
    });
  });

  describe('parseSource', () => {
    it('should parse nested JSON into flat source records', async () => {
      const content = JSON.stringify({
        welcome: {
          heading: 'Hello',
          continue: 'Continue',
        },
      });
      const filePath = join(testDir, 'source.json');
      await writeFile(filePath, content);

      const records = await formatter.parseSource(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        key: 'welcome.heading',
        text: 'Hello',
        description: '',
        hash: expect.any(String),
      });
      expect(records[1]).toEqual({
        key: 'welcome.continue',
        text: 'Continue',
        description: '',
        hash: expect.any(String),
      });
    });

    it('should throw error for non-existent file', async () => {
      await expect(formatter.parseSource('/nonexistent/file.json')).rejects.toThrow('no such file or directory');
    });
  });

  describe('parseTarget', () => {
    it('should parse target JSON with hashes', async () => {
      const content = JSON.stringify({
        __hashes: {
          'welcome.heading': 'abc123',
          'welcome.continue': 'def456',
        },
        welcome: {
          heading: 'Hola',
          continue: 'Continuar',
        },
      });
      const filePath = join(testDir, 'target.json');
      await writeFile(filePath, content);

      const records = await formatter.parseTarget(filePath);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        key: 'welcome.heading',
        text: 'Hola',
        hash: 'abc123',
      });
      expect(records[1]).toEqual({
        key: 'welcome.continue',
        text: 'Continuar',
        hash: 'def456',
      });
    });

    it('should throw error for non-existent file', async () => {
      await expect(formatter.parseTarget('/nonexistent/target.json')).rejects.toThrow('no such file or directory');
    });

    it('should return empty array for empty JSON object', async () => {
      const filePath = join(testDir, 'empty-target.json');
      await writeFile(filePath, '{}');

      const records = await formatter.parseTarget(filePath);
      expect(records).toEqual([]);
    });
  });

  describe('writeTarget', () => {
    it('should write nested JSON with hashes and round-trip correctly', async () => {
      const records: TargetRecord[] = [
        { key: 'welcome.heading', text: 'Hola', hash: 'abc123' },
        { key: 'welcome.continue', text: 'Continuar', hash: 'def456' },
      ];
      const filePath = join(testDir, 'output-target.json');

      await formatter.writeTarget(filePath, records);

      const writtenRecords = await formatter.parseTarget(filePath);
      expect(writtenRecords).toEqual(records);
    });
  });

  describe('writeSource', () => {
    it('should write clean nested JSON without hashes', async () => {
      const records: SourceRecord[] = [
        { key: 'welcome.heading', text: 'Hello', description: '', hash: 'abc123' },
        { key: 'welcome.continue', text: 'Continue', description: '', hash: 'def456' },
      ];
      const filePath = join(testDir, 'output-source.json');

      await formatter.writeSource(filePath, records);

      const content = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(content).toEqual({
        welcome: {
          heading: 'Hello',
          continue: 'Continue',
        },
      });
      expect(content.__hashes).toBeUndefined();
    });
  });

  describe('nested key handling', () => {
    it('should handle multi-level nesting correctly', async () => {
      const content = JSON.stringify({
        updates: {
          greeting: {
            friendly: 'Howdy',
            formal: 'Salutations',
          },
        },
      });
      const filePath = join(testDir, 'nested.json');
      await writeFile(filePath, content);

      const records = await formatter.parseSource(filePath);

      expect(records).toHaveLength(2);
      expect(records[0].key).toBe('updates.greeting.friendly');
      expect(records[1].key).toBe('updates.greeting.formal');

      // Round-trip: write and re-read
      const outPath = join(testDir, 'nested-out.json');
      await formatter.writeSource(outPath, records);
      const roundTripped = JSON.parse(await readFile(outPath, 'utf-8'));
      expect(roundTripped).toEqual({
        updates: {
          greeting: {
            friendly: 'Howdy',
            formal: 'Salutations',
          },
        },
      });
    });
  });

  describe('plural suffixes', () => {
    it('should treat plural suffixes as leaf keys, not nesting separators', async () => {
      const content = JSON.stringify({
        updates: {
          treeCount_one: '{{count}} Tree',
          treeCount_other: '{{count}} Trees',
        },
      });
      const filePath = join(testDir, 'plurals.json');
      await writeFile(filePath, content);

      const records = await formatter.parseSource(filePath);

      expect(records).toHaveLength(2);
      expect(records[0].key).toBe('updates.treeCount_one');
      expect(records[0].text).toBe('{{count}} Tree');
      expect(records[1].key).toBe('updates.treeCount_other');
      expect(records[1].text).toBe('{{count}} Trees');
    });
  });
});
