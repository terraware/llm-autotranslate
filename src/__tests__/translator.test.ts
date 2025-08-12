import { writeFileSync } from 'fs';
import { join } from 'path';

import { Translator } from '../translator.js';
import { MockOpenAI } from './mocks.js';

describe('Translator', () => {
  let mockOpenAI: MockOpenAI;

  beforeEach(() => {
    mockOpenAI = new MockOpenAI();
  });

  afterEach(() => {
    mockOpenAI.resetMocks();
  });

  describe('constructor', () => {
    it('should create instance with provided OpenAI client', () => {
      const translator = new Translator('English', 'Spanish', undefined, undefined, mockOpenAI);
      expect(translator).toBeInstanceOf(Translator);
    });

    it('should create instance without OpenAI client when API key is set', () => {
      const originalApiKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';

      const translator = new Translator('English', 'Spanish');
      expect(translator).toBeInstanceOf(Translator);

      process.env.OPENAI_API_KEY = originalApiKey;
    });

    it('should throw error when no OpenAI client and no API key', () => {
      const originalApiKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      expect(() => {
        new Translator('English', 'Spanish');
      }).toThrow('OPENAI_API_KEY environment variable is required');

      process.env.OPENAI_API_KEY = originalApiKey;
    });

    it('should read global instructions file when provided', () => {
      const globalInstructionsPath = join(__dirname, 'test-global-instructions.txt');
      const globalInstructions = 'Use formal tone for all translations.';
      writeFileSync(globalInstructionsPath, globalInstructions);

      const translator = new Translator('English', 'Spanish', globalInstructionsPath, undefined, mockOpenAI);
      expect(translator).toBeInstanceOf(Translator);
    });

    it('should read language-specific instructions file when provided', () => {
      const languageInstructionsPath = join(__dirname, 'test-language-instructions.txt');
      const languageInstructions = 'Use Mexican Spanish dialect.';
      writeFileSync(languageInstructionsPath, languageInstructions);

      const translator = new Translator('English', 'Spanish', undefined, languageInstructionsPath, mockOpenAI);
      expect(translator).toBeInstanceOf(Translator);
    });

    it('should throw error when global instructions file is not found', () => {
      expect(() => {
        new Translator('English', 'Spanish', '/nonexistent/path.txt', undefined, mockOpenAI);
      }).toThrow('Failed to read global instructions file');
    });

    it('should throw error when language instructions file is not found', () => {
      expect(() => {
        new Translator('English', 'Spanish', undefined, '/nonexistent/path.txt', mockOpenAI);
      }).toThrow('Failed to read language instructions file');
    });
  });

  describe('translate', () => {
    let translator: Translator;

    beforeEach(() => {
      translator = new Translator('English', 'Spanish', undefined, undefined, mockOpenAI);
    });

    it('should translate text successfully', async () => {
      const expectedTranslation = 'Hola';
      mockOpenAI.mockTranslationResponse(expectedTranslation);

      const result = await translator.translate('Hello', 'A greeting');

      expect(result).toBe(expectedTranslation);
      expect(mockOpenAI.responses.parse).toHaveBeenCalledWith({
        model: 'gpt-4.1',
        input: [
          {
            role: 'system',
            content: expect.stringContaining('translator'),
          },
          {
            role: 'user',
            content: '###Hello###\n\nDescription: A greeting',
          },
        ],
        text: expect.objectContaining({
          format: expect.objectContaining({
            name: 'translation',
            type: 'json_schema',
          }),
        }),
        temperature: 0,
      });
    });

    it('should translate text without description', async () => {
      const expectedTranslation = 'Hola';
      mockOpenAI.mockTranslationResponse(expectedTranslation);

      const result = await translator.translate('Hello', '');

      expect(result).toBe(expectedTranslation);
      expect(mockOpenAI.responses.parse).toHaveBeenCalledWith({
        model: 'gpt-4.1',
        input: [
          {
            role: 'system',
            content: expect.stringContaining('translator'),
          },
          {
            role: 'user',
            content: '###Hello###',
          },
        ],
        text: expect.objectContaining({
          format: expect.objectContaining({
            name: 'translation',
            type: 'json_schema',
          }),
        }),
        temperature: 0,
      });
    });

    it('should handle API errors', async () => {
      const apiError = new Error('API rate limit exceeded');
      mockOpenAI.mockError(apiError);

      await expect(translator.translate('Hello', 'A greeting')).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle invalid response format', async () => {
      mockOpenAI.mockInvalidResponse();

      await expect(translator.translate('Hello', 'A greeting')).rejects.toThrow(
        'Invalid response format from OpenAI API'
      );
    });
  });

  describe('translateBatch', () => {
    let translator: Translator;

    beforeEach(() => {
      translator = new Translator('English', 'Spanish', undefined, undefined, mockOpenAI);
    });

    it('should return empty map for empty requests', async () => {
      const result = await translator.translateBatch([]);
      expect(result).toEqual(new Map());
      expect(mockOpenAI.responses.parse).not.toHaveBeenCalled();
    });

    it('should translate batch of requests successfully', async () => {
      const requests = [
        { key: 'hello', text: 'Hello', description: 'A greeting' },
        { key: 'goodbye', text: 'Goodbye', description: 'A farewell' },
      ];

      const expectedTranslations = [
        { key: 'hello', translation: 'Hola' },
        { key: 'goodbye', translation: 'Adiós' },
      ];

      mockOpenAI.mockBatchTranslationResponse(expectedTranslations);

      const result = await translator.translateBatch(requests);

      expect(result.get('hello')).toBe('Hola');
      expect(result.get('goodbye')).toBe('Adiós');
      expect(result.size).toBe(2);

      expect(mockOpenAI.responses.parse).toHaveBeenCalledWith({
        model: 'gpt-4.1',
        input: [
          {
            role: 'system',
            content: expect.stringContaining('translator'),
          },
          {
            role: 'user',
            content: expect.stringContaining('###hello###\nHello\nDescription: A greeting'),
          },
        ],
        text: expect.objectContaining({
          format: expect.objectContaining({
            name: 'batch_translation',
            type: 'json_schema',
          }),
        }),
        temperature: 0,
      });
    });

    it('should handle requests without descriptions', async () => {
      const requests = [
        { key: 'hello', text: 'Hello', description: '' },
        { key: 'goodbye', text: 'Goodbye', description: '   ' },
      ];

      const expectedTranslations = [
        { key: 'hello', translation: 'Hola' },
        { key: 'goodbye', translation: 'Adiós' },
      ];

      mockOpenAI.mockBatchTranslationResponse(expectedTranslations);

      const result = await translator.translateBatch(requests);

      expect(result.get('hello')).toBe('Hola');
      expect(result.get('goodbye')).toBe('Adiós');

      const callArgs = mockOpenAI.responses.parse.mock.calls[0][0];
      const userMessage = callArgs.input![1] as { role: string; content: string };
      expect(userMessage.content).not.toContain('Description:');
    });

    it('should handle API errors in batch translation', async () => {
      const requests = [{ key: 'hello', text: 'Hello', description: 'A greeting' }];
      const apiError = new Error('Batch API error');
      mockOpenAI.mockError(apiError);

      await expect(translator.translateBatch(requests)).rejects.toThrow('Batch API error');
    });

    it('should handle invalid batch response format', async () => {
      const requests = [{ key: 'hello', text: 'Hello', description: 'A greeting' }];
      mockOpenAI.mockInvalidResponse();

      await expect(translator.translateBatch(requests)).rejects.toThrow('Invalid response format from OpenAI API');
    });

    it('should handle missing translations in batch response', async () => {
      const requests = [
        { key: 'hello', text: 'Hello', description: 'A greeting' },
        { key: 'goodbye', text: 'Goodbye', description: 'A farewell' },
      ];

      // Mock response missing one translation
      const incompleteTranslations = [{ key: 'hello', translation: 'Hola' }];
      mockOpenAI.mockBatchTranslationResponse(incompleteTranslations);

      await expect(translator.translateBatch(requests)).rejects.toThrow('Missing translations for keys: goodbye');
    });
  });
});
