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

export interface TranslationRequest {
  text: string;
  description: string;
  targetLanguage: string;
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
        model: 'gpt-4o-2024-08-06',
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
}
