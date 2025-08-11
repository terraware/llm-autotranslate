import { readFileSync } from 'fs';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { join } from 'path';
import { z } from 'zod';

import __dirname from './dirname.cjs';

export interface OpenAIClient {
  responses: {
    parse: OpenAI['responses']['parse'];
  };
}

const TranslationResponse = z.object({
  translation: z.string().describe('The translated text'),
});

const BatchTranslationResponse = z.object({
  translations: z
    .array(
      z.object({
        key: z.string().describe('The key of the string being translated'),
        translation: z.string().describe('The translated text'),
      })
    )
    .describe('Array of translations for the provided strings'),
});

export interface BatchTranslationRequest {
  key: string;
  text: string;
  description: string;
}

export class Translator {
  private openai: OpenAIClient;
  private readonly instructions: string;

  constructor(
    sourceLanguage: string,
    targetLanguage: string,
    globalInstructionsFile?: string,
    languageInstructionsFile?: string,
    openaiClient?: OpenAIClient
  ) {
    // Initialize OpenAI client
    if (openaiClient) {
      this.openai = openaiClient;
    } else {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
      }
      this.openai = new OpenAI({ apiKey });
    }

    // Build instructions
    this.instructions = this.buildInstructions(
      sourceLanguage,
      targetLanguage,
      globalInstructionsFile,
      languageInstructionsFile
    );
  }

  private buildInstructions(
    sourceLanguage: string,
    targetLanguage: string,
    globalInstructionsFile?: string,
    languageInstructionsFile?: string
  ): string {
    const parts: string[] = [];

    // Add preamble
    const preamblePath = join(__dirname, 'preamble.txt');
    const preamble = readFileSync(preamblePath, 'utf-8');
    parts.push(preamble.replace('{SOURCE_LANGUAGE}', sourceLanguage).replace('{TARGET_LANGUAGE}', targetLanguage));

    // Add global instructions if provided
    if (globalInstructionsFile) {
      try {
        const globalInstructions = readFileSync(globalInstructionsFile, 'utf-8');
        parts.push(globalInstructions);
      } catch (error) {
        throw new Error(`Failed to read global instructions file: ${globalInstructionsFile}`, { cause: error });
      }
    }

    // Add language-specific instructions if provided
    if (languageInstructionsFile) {
      try {
        const languageInstructions = readFileSync(languageInstructionsFile, 'utf-8');
        parts.push(languageInstructions);
      } catch (error) {
        throw new Error(`Failed to read language instructions file: ${languageInstructionsFile}`, { cause: error });
      }
    }

    return parts.join('\n\n');
  }

  async translate(text: string, description: string): Promise<string> {
    // Build the prompt with proper delimiters
    let prompt = `###${text}###`;
    if (description.trim()) {
      prompt += `\n\nDescription: ${description}`;
    }

    const response = await this.openai.responses.parse({
      model: 'gpt-5',
      input: [
        {
          role: 'system',
          content: this.instructions,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      text: {
        format: zodTextFormat(TranslationResponse, 'translation'),
      },
      temperature: 0,
    });

    const parsed = response.output_parsed;
    if (!parsed || !parsed.translation) {
      throw new Error('Invalid response format from OpenAI API');
    }

    return parsed.translation;
  }

  async translateBatch(requests: BatchTranslationRequest[]): Promise<Map<string, string>> {
    if (requests.length === 0) {
      return new Map();
    }

    // Build the batch prompt
    const promptParts = ['Translate these strings:'];

    for (const request of requests) {
      promptParts.push(`\n###${request.key}###`);
      promptParts.push(request.text);
      if (request.description.trim()) {
        promptParts.push(`Description: ${request.description}`);
      }
    }

    const prompt = promptParts.join('\n');

    const response = await this.openai.responses.parse({
      model: 'gpt-5',
      input: [
        {
          role: 'system',
          content: this.instructions,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      text: {
        format: zodTextFormat(BatchTranslationResponse, 'batch_translation'),
      },
      temperature: 0,
    });

    const parsed = response.output_parsed;
    if (!parsed || !parsed.translations) {
      throw new Error('Invalid response format from OpenAI API');
    }

    // Convert to Map for easy lookup
    const resultMap = new Map<string, string>();
    for (const translation of parsed.translations) {
      resultMap.set(translation.key, translation.translation);
    }

    // Validate that we got translations for all requested keys
    const missingKeys = requests.filter((req) => !resultMap.has(req.key)).map((req) => req.key);
    if (missingKeys.length > 0) {
      throw new Error(`Missing translations for keys: ${missingKeys.join(', ')}`);
    }

    return resultMap;
  }
}
