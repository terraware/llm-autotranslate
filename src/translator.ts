import { readFileSync } from 'fs';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

export interface TranslationRequest {
  text: string;
  description: string;
  targetLanguage: string;
}

export interface BatchTranslationRequest {
  key: string;
  text: string;
  description: string;
}

export class Translator {
  private openai: OpenAI;
  private instructions: string;

  constructor(targetLanguage: string, globalInstructionsFile?: string, languageInstructionsFile?: string) {
    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({ apiKey });

    // Build instructions
    this.instructions = this.buildInstructions(targetLanguage, globalInstructionsFile, languageInstructionsFile);
  }

  private buildInstructions(
    targetLanguage: string,
    globalInstructionsFile?: string,
    languageInstructionsFile?: string
  ): string {
    const parts: string[] = [];

    // Add preamble
    const preamblePath = join(__dirname, 'preamble.txt');
    const preamble = readFileSync(preamblePath, 'utf-8');
    parts.push(preamble.replace('{LANGUAGE}', targetLanguage));

    // Add global instructions if provided
    if (globalInstructionsFile) {
      try {
        const globalInstructions = readFileSync(globalInstructionsFile, 'utf-8');
        parts.push(globalInstructions);
      } catch (error) {
        throw new Error(`Failed to read global instructions file: ${globalInstructionsFile}`);
      }
    }

    // Add language-specific instructions if provided
    if (languageInstructionsFile) {
      try {
        const languageInstructions = readFileSync(languageInstructionsFile, 'utf-8');
        parts.push(languageInstructions);
      } catch (error) {
        throw new Error(`Failed to read language instructions file: ${languageInstructionsFile}`);
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

    try {
      const response = await this.openai.beta.chat.completions.parse({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: this.instructions,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: zodResponseFormat(TranslationResponse, 'translation'),
      });

      const parsed = response.choices[0].message.parsed;
      if (!parsed || !parsed.translation) {
        throw new Error('Invalid response format from OpenAI API');
      }

      return parsed.translation;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Translation failed: ${error.message}`);
      }
      throw new Error('Translation failed with unknown error');
    }
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

    try {
      const response = await this.openai.beta.chat.completions.parse({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: this.instructions,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: zodResponseFormat(BatchTranslationResponse, 'batch_translation'),
      });

      const parsed = response.choices[0].message.parsed;
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
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Batch translation failed: ${error.message}`);
      }
      throw new Error('Batch translation failed with unknown error');
    }
  }
}
