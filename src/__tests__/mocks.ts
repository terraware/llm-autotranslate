import OpenAI from 'openai';

import { OpenAIClient } from '../translator.js';

// Mock OpenAI client for testing
export class MockOpenAI implements OpenAIClient {
  public responses: {
    parse: jest.MockedFunction<OpenAI['responses']['parse']>;
  };

  constructor() {
    this.responses = {
      parse: jest.fn() as jest.MockedFunction<OpenAI['responses']['parse']>,
    };
  }

  // Mock the structured response format
  mockTranslationResponse(translation: string) {
    this.responses.parse.mockResolvedValueOnce({
      output_parsed: { translation },
    } as Awaited<ReturnType<OpenAI['responses']['parse']>>);
  }

  // Mock batch translation response
  mockBatchTranslationResponse(translations: Array<{ key: string; translation: string }>) {
    this.responses.parse.mockResolvedValueOnce({
      output_parsed: { translations },
    } as Awaited<ReturnType<OpenAI['responses']['parse']>>);
  }

  // Mock API error
  mockError(error: Error) {
    this.responses.parse.mockRejectedValueOnce(error);
  }

  // Mock invalid response format
  mockInvalidResponse() {
    this.responses.parse.mockResolvedValueOnce({
      output_parsed: null,
    } as Awaited<ReturnType<OpenAI['responses']['parse']>>);
  }

  // Reset all mocks
  resetMocks() {
    this.responses.parse.mockReset();
  }
}
