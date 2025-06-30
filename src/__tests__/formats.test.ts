import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { CsvFormatter } from '../formats/csv.js';
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

      expect(lines[0]).toBe('# A greeting');
      expect(lines[1]).toBe('hello=Hello');
      expect(lines[2]).toBe('goodbye=Goodbye');
      expect(lines[3]).toBe("special\\:key=Text with ''quotes''");
    });

    it('should handle empty records', () => {
      const result = formatter.format([]);
      expect(result).toBe('\n');
    });
  });

  describe('parseSource', () => {
    it('should parse valid properties file', async () => {
      const content = `# A greeting
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
