#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { SourceRecord, TargetRecord, readSourceCsv, readTargetCsv, writeTargetCsv } from './csv.js';
import { needsTranslation } from './hash.js';
import { BatchTranslationRequest, Translator } from './translator.js';

// Re-export useful types for library users
export { SourceRecord, TargetRecord } from './csv.js';
export { Translator } from './translator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliOptions {
  config: string;
  verbose: boolean;
}

export interface TargetLanguageConfig {
  language: string;
  file: string;
  instructions?: string;
}

export interface AutotranslateConfig {
  batchSize?: number;
  instructions?: string;
  source: {
    file: string;
  };
  targets: TargetLanguageConfig[];
  verbose?: boolean;
}

interface ConfigFile extends AutotranslateConfig {}

function parseCommandLine(): ConfigFile {
  const program = new Command();

  program
    .name('autotranslate')
    .description('A utility for automated translation of strings for localizable software')
    .version('1.0.0')
    .option('--config <path>', 'Optional path to the config file to use', 'autotranslate.json')
    .option('-v, --verbose', 'Show details of the configuration and the progress of the translations')
    .parse();

  const options = program.opts() as CliOptions;

  // Read and parse config file
  try {
    const configContent = readFileSync(options.config, 'utf-8');
    const config = JSON.parse(configContent) as ConfigFile;

    // Set verbose mode - command line option overrides config file
    config.verbose = options.verbose || config.verbose;

    return config;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error reading config file ${options.config}: ${error.message}`);
    } else {
      console.error(`Error reading config file ${options.config}: ${String(error)}`);
    }
    process.exit(1);
  }
}

export async function autotranslate(config: AutotranslateConfig): Promise<void> {
  // Set defaults
  const finalConfig = {
    batchSize: config.batchSize ?? 15,
    instructions: config.instructions,
    source: config.source,
    targets: config.targets,
    verbose: config.verbose ?? false,
  };

  // Validate configuration
  if (!finalConfig.source?.file) {
    throw new Error('Config must specify source.file');
  }

  if (!finalConfig.targets || finalConfig.targets.length === 0) {
    throw new Error('Config must specify at least one target language');
  }

  for (const target of finalConfig.targets) {
    if (!target.language || !target.file) {
      throw new Error('Each target must specify both language and file');
    }
  }

  if (!Number.isInteger(finalConfig.batchSize) || finalConfig.batchSize < 1) {
    throw new Error('batchSize must be a positive integer');
  }

  if (finalConfig.verbose) {
    console.log(`Autotranslate starting...`);
    console.log(`Source file: ${finalConfig.source.file}`);
    console.log(`Target languages: ${finalConfig.targets.map((t) => `${t.language} (${t.file})`).join(', ')}`);
    console.log(`Batch size: ${finalConfig.batchSize}`);

    if (finalConfig.instructions) {
      console.log(`Global instructions file: ${finalConfig.instructions}`);
    }

    const languageInstructionCount = finalConfig.targets.filter((t) => t.instructions).length;
    if (languageInstructionCount > 0) {
      console.log(`Language-specific instruction files: ${languageInstructionCount}`);
    }
  }

  // Step 1: Read source-language CSV file (hashes calculated during read)
  if (finalConfig.verbose) {
    console.log(`\nReading source file: ${finalConfig.source.file}`);
  }
  const sourceRecords = await readSourceCsv(finalConfig.source.file);
  if (finalConfig.verbose) {
    console.log(`Found ${sourceRecords.length} source strings`);
  }

  // Step 2: Create source map for easy lookup
  const sourceMap = new Map<string, SourceRecord>();
  for (const record of sourceRecords) {
    sourceMap.set(record.key, record);
  }

  // Step 3: Process each target language
  for (const target of finalConfig.targets) {
    await processTargetLanguage(
      target,
      sourceMap,
      finalConfig.instructions,
      target.instructions,
      finalConfig.batchSize,
      finalConfig.verbose
    );
  }

  if (finalConfig.verbose) {
    console.log('\nAutotranslate completed successfully!');
  }
}

async function main() {
  try {
    const config = parseCommandLine();
    await autotranslate(config);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function processTargetLanguage(
  target: TargetLanguageConfig,
  sourceMap: Map<string, SourceRecord>,
  globalInstructionsFile?: string,
  languageInstructionsFile?: string,
  batchSize: number = 15,
  verbose: boolean = false
) {
  if (verbose) {
    console.log(`\nProcessing ${target.language} (${target.file})`);
  }

  // Step 3.1: Read existing target language CSV file
  const existingRecords = await readTargetCsv(target.file);
  const existingMap = new Map<string, TargetRecord>();
  for (const record of existingRecords) {
    existingMap.set(record.key, record);
  }

  if (verbose) {
    console.log(`Found ${existingRecords.length} existing ${target.language} strings`);
  }

  // Step 3.2: Remove rows for keys that don't exist in source
  const validKeys = new Set(sourceMap.keys());
  const filteredExisting = existingRecords.filter((record) => {
    const isValid = validKeys.has(record.key);
    if (!isValid && verbose) {
      console.log(`Removing obsolete key: ${record.key}`);
    }
    return isValid;
  });

  // Step 3.3: Identify strings that need translation
  const stringsToTranslate: Array<{ key: string; sourceRecord: SourceRecord }> = [];

  for (const [key, sourceRecord] of sourceMap) {
    const existingRecord = existingMap.get(key);

    if (!existingRecord || sourceRecord.hash !== existingRecord.hash) {
      stringsToTranslate.push({ key, sourceRecord });
    }
  }

  if (verbose) {
    console.log(`Need to translate ${stringsToTranslate.length} strings for ${target.language}`);
  }

  // Step 3.4: Translate strings using OpenAI API
  const translator = new Translator(target.language, globalInstructionsFile, languageInstructionsFile);

  const updatedRecords: TargetRecord[] = [];

  for (const record of filteredExisting) {
    const sourceRecord = sourceMap.get(record.key);
    if (sourceRecord && sourceRecord.hash === record.hash) {
      // Keep existing translation
      updatedRecords.push(record);
    }
  }

  // Translate new/changed strings in batches (or individually if batchSize is 1)
  if (batchSize === 1) {
    // Individual translation mode
    if (verbose) {
      console.log(`Translating ${stringsToTranslate.length} strings individually (batch size = 1)`);
    }

    for (const { key, sourceRecord } of stringsToTranslate) {
      if (verbose) {
        console.log(`Translating: ${key}`);
      }

      try {
        const translatedText = await translator.translate(sourceRecord.text, sourceRecord.description);

        updatedRecords.push({
          key,
          text: translatedText,
          hash: sourceRecord.hash,
        });

        if (verbose) {
          console.log(`  ✓ ${key}: ${sourceRecord.text} → ${translatedText}`);
        }
      } catch (error) {
        console.error(
          `Failed to translate "${sourceRecord.text}": ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }
  } else {
    // Batch translation mode
    const batches: BatchTranslationRequest[][] = [];

    for (let i = 0; i < stringsToTranslate.length; i += batchSize) {
      const batch = stringsToTranslate.slice(i, i + batchSize).map(({ key, sourceRecord }) => ({
        key,
        text: sourceRecord.text,
        description: sourceRecord.description,
      }));
      batches.push(batch);
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchStart = batchIndex * batchSize + 1;
      const batchEnd = Math.min((batchIndex + 1) * batchSize, stringsToTranslate.length);

      if (verbose) {
        console.log(`Translating batch ${batchIndex + 1}/${batches.length} (strings ${batchStart}-${batchEnd})`);
      }

      try {
        const translations = await translator.translateBatch(batch);

        for (const { key, sourceRecord } of stringsToTranslate.slice(
          batchIndex * batchSize,
          batchIndex * batchSize + batch.length
        )) {
          const translatedText = translations.get(key);
          if (!translatedText) {
            throw new Error(`Missing translation for key: ${key}`);
          }

          updatedRecords.push({
            key,
            text: translatedText,
            hash: sourceRecord.hash, // Use the pre-calculated hash
          });

          if (verbose) {
            console.log(`  ✓ ${key}: ${sourceRecord.text} → ${translatedText}`);
          }
        }
      } catch (error) {
        console.error(`Batch translation failed: ${error instanceof Error ? error.message : String(error)}`);
        if (verbose) {
          console.log(`Falling back to individual translations for this batch...`);
        }

        // Fallback to individual translations for this batch
        for (const { key, text, description } of batch) {
          if (verbose) {
            console.log(`  Translating individually: ${key}`);
          }

          try {
            const sourceRecord = stringsToTranslate.find((s) => s.key === key)?.sourceRecord;
            if (!sourceRecord) {
              throw new Error(`Could not find source record for key: ${key}`);
            }

            const translatedText = await translator.translate(text, description);

            updatedRecords.push({
              key,
              text: translatedText,
              hash: sourceRecord.hash,
            });

            if (verbose) {
              console.log(`    ✓ ${key}: ${text} → ${translatedText}`);
            }
          } catch (individualError) {
            console.error(
              `Failed to translate "${text}": ${individualError instanceof Error ? individualError.message : String(individualError)}`
            );
            throw individualError;
          }
        }
      }
    }
  }

  // Sort by key to maintain consistent ordering
  updatedRecords.sort((a, b) => a.key.localeCompare(b.key));

  // Step 3.5: Write updated target language file
  await writeTargetCsv(target.file, updatedRecords);
  if (verbose) {
    console.log(`Updated ${target.file} with ${updatedRecords.length} strings`);
  }
}

// Only run main if this file is executed directly (not imported as a library)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
