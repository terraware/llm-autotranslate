import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { AutotranslateConfig, autotranslate } from '../index.js';

// Mock the Translator class to use our mock OpenAI
jest.mock('../translator.js', () => {
  const originalModule = jest.requireActual('../translator.js');
  return {
    ...originalModule,
    Translator: jest.fn().mockImplementation(() => {
      return {
        translate: jest.fn().mockImplementation(async (text) => {
          // Simple mock translation: reverse the text
          return text.split('').reverse().join('');
        }),
        translateBatch: jest.fn().mockImplementation(async (requests) => {
          const results = new Map();
          for (const request of requests) {
            results.set(request.key, request.text.split('').reverse().join(''));
          }
          return results;
        }),
      };
    }),
  };
});

const testDir = join(__dirname, 'temp-integration-test');

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

describe('autotranslate integration', () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  it('should complete full translation workflow', async () => {
    // Create source CSV file
    const sourceFile = join(testDir, 'source.csv');
    const sourceContent = `Key,Text,Description
hello,Hello,A greeting
goodbye,Goodbye,A farewell
welcome,Welcome,`;
    writeFileSync(sourceFile, sourceContent);

    // Create target file (initially empty)
    const targetFile = join(testDir, 'spanish.csv');

    const config: AutotranslateConfig = {
      source: {
        file: sourceFile,
        format: 'csv',
        language: 'English',
      },
      targets: [
        {
          language: 'Spanish',
          file: targetFile,
          format: 'csv',
        },
      ],
      batchSize: 2,
      verbose: false,
    };

    await autotranslate(config);

    // Verify target file was created and has content
    expect(existsSync(targetFile)).toBe(true);

    // The mock translator reverses the text, so we expect:
    // Hello -> olleH, Goodbye -> eybdooG, Welcome -> emocleW
    const targetContent = readFileSync(targetFile, 'utf-8');
    expect(targetContent).toContain('olleH');
    expect(targetContent).toContain('eybdooG');
    expect(targetContent).toContain('emocleW');
  });

  it('should handle incremental updates', async () => {
    // Create source CSV file
    const sourceFile = join(testDir, 'source.csv');
    const sourceContent = `Key,Text,Description
hello,Hello,A greeting
goodbye,Goodbye,A farewell`;
    writeFileSync(sourceFile, sourceContent);

    // Create existing target file with one translation
    const targetFile = join(testDir, 'spanish.csv');
    const existingTargetContent = `Key,Text,Hash
hello,Hola,abc123`;
    writeFileSync(targetFile, existingTargetContent);

    const config: AutotranslateConfig = {
      source: {
        file: sourceFile,
        format: 'csv',
        language: 'English',
      },
      targets: [
        {
          language: 'Spanish',
          file: targetFile,
          format: 'csv',
        },
      ],
      batchSize: 15,
      verbose: false,
    };

    await autotranslate(config);

    // Verify target file was updated
    expect(existsSync(targetFile)).toBe(true);

    const targetContent = readFileSync(targetFile, 'utf-8');
    // Should contain the new translation for 'goodbye'
    expect(targetContent).toContain('eybdooG');
  });

  it('should handle multiple target languages', async () => {
    // Create source CSV file
    const sourceFile = join(testDir, 'source.csv');
    const sourceContent = `Key,Text,Description
hello,Hello,A greeting`;
    writeFileSync(sourceFile, sourceContent);

    const spanishFile = join(testDir, 'spanish.csv');
    const frenchFile = join(testDir, 'french.csv');

    const config: AutotranslateConfig = {
      source: {
        file: sourceFile,
        format: 'csv',
        language: 'English',
      },
      targets: [
        {
          language: 'Spanish',
          file: spanishFile,
          format: 'csv',
        },
        {
          language: 'French',
          file: frenchFile,
          format: 'csv',
        },
      ],
      batchSize: 15,
      verbose: false,
    };

    await autotranslate(config);

    // Verify both target files were created
    expect(existsSync(spanishFile)).toBe(true);
    expect(existsSync(frenchFile)).toBe(true);

    const spanishContent = readFileSync(spanishFile, 'utf-8');
    const frenchContent = readFileSync(frenchFile, 'utf-8');

    expect(spanishContent).toContain('olleH');
    expect(frenchContent).toContain('olleH');
  });

  it('should handle output files', async () => {
    // Create source CSV file
    const sourceFile = join(testDir, 'source.csv');
    const sourceContent = `Key,Text,Description
hello,Hello,A greeting`;
    writeFileSync(sourceFile, sourceContent);

    const targetFile = join(testDir, 'spanish.csv');
    const outputFile = join(testDir, 'output.js');

    const config: AutotranslateConfig = {
      source: {
        file: sourceFile,
        format: 'csv',
        language: 'English',
      },
      targets: [
        {
          language: 'Spanish',
          file: targetFile,
          format: 'csv',
          outputs: [
            {
              file: outputFile,
              format: 'javascript-const',
            },
          ],
        },
      ],
      batchSize: 15,
      verbose: false,
    };

    await autotranslate(config);

    // Verify output file was created
    expect(existsSync(outputFile)).toBe(true);

    const outputContent = readFileSync(outputFile, 'utf-8');
    expect(outputContent).toContain('export const strings = {');
    expect(outputContent).toContain('"hello":');
    expect(outputContent).toContain('olleH');
  });

  describe('error handling', () => {
    it('should throw error for missing source file', async () => {
      const config: AutotranslateConfig = {
        source: {
          file: '/nonexistent/source.csv',
          format: 'csv',
          language: 'English',
        },
        targets: [
          {
            language: 'Spanish',
            file: join(testDir, 'spanish.csv'),
            format: 'csv',
          },
        ],
        batchSize: 15,
        verbose: false,
      };

      await expect(autotranslate(config)).rejects.toThrow();
    });

    it('should throw error for invalid configuration', async () => {
      const config: AutotranslateConfig = {
        source: {
          file: '', // Empty file path
          format: 'csv',
          language: 'English',
        },
        targets: [],
        batchSize: 15,
        verbose: false,
      };

      await expect(autotranslate(config)).rejects.toThrow('Config must specify source.file');
    });

    it('should throw error for no target languages', async () => {
      const sourceFile = join(testDir, 'source.csv');
      writeFileSync(sourceFile, 'Key,Text,Description\nhello,Hello,A greeting');

      const config: AutotranslateConfig = {
        source: {
          file: sourceFile,
          format: 'csv',
          language: 'English',
        },
        targets: [],
        batchSize: 15,
        verbose: false,
      };

      await expect(autotranslate(config)).rejects.toThrow('Config must specify at least one target language');
    });

    it('should throw error for invalid batch size', async () => {
      const sourceFile = join(testDir, 'source.csv');
      writeFileSync(sourceFile, 'Key,Text,Description\nhello,Hello,A greeting');

      const config: AutotranslateConfig = {
        source: {
          file: sourceFile,
          format: 'csv',
          language: 'English',
        },
        targets: [
          {
            language: 'Spanish',
            file: join(testDir, 'spanish.csv'),
            format: 'csv',
          },
        ],
        batchSize: 0, // Invalid batch size
        verbose: false,
      };

      await expect(autotranslate(config)).rejects.toThrow('batchSize must be a positive integer');
    });
  });
});
