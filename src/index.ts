#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, unwatchFile, watchFile } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { SourceRecord, TargetRecord, readSourceCsv, readTargetCsv, writeTargetCsv } from './csv.js';
import { needsTranslation } from './hash.js';
import { ConsoleLogger, Logger } from './logger.js';
import { BatchTranslationRequest, Translator } from './translator.js';

// Re-export useful types for library users
export { SourceRecord, TargetRecord } from './csv.js';
export { Logger, ConsoleLogger, SilentLogger } from './logger.js';
export { Translator } from './translator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliOptions {
  config: string;
  verbose: boolean;
  watch: boolean;
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

interface ParsedOptions {
  config: ConfigFile;
  watch: boolean;
}

function parseCommandLine(): ParsedOptions {
  const program = new Command();

  program
    .name('autotranslate')
    .description('A utility for automated translation of strings for localizable software')
    .version('1.0.0')
    .option('--config <path>', 'Optional path to the config file to use', 'autotranslate.json')
    .option('--watch', 'Run continuously, watching for modifications to the source-language CSV file')
    .option('-v, --verbose', 'Show details of the configuration and the progress of the translations')
    .parse();

  const options = program.opts() as CliOptions;

  // Read and parse config file
  try {
    const configContent = readFileSync(options.config, 'utf-8');
    const config = JSON.parse(configContent) as ConfigFile;

    // Set verbose mode - command line option overrides config file
    config.verbose = options.verbose || config.verbose;

    return { config, watch: options.watch };
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

  // Create logger
  const logger = new ConsoleLogger(finalConfig.verbose);

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

  logger.log(`Autotranslate starting...`);
  logger.log(`Source file: ${finalConfig.source.file}`);
  logger.log(`Target languages: ${finalConfig.targets.map((t) => `${t.language} (${t.file})`).join(', ')}`);
  logger.log(`Batch size: ${finalConfig.batchSize}`);

  if (finalConfig.instructions) {
    logger.log(`Global instructions file: ${finalConfig.instructions}`);
  }

  const languageInstructionCount = finalConfig.targets.filter((t) => t.instructions).length;
  if (languageInstructionCount > 0) {
    logger.log(`Language-specific instruction files: ${languageInstructionCount}`);
  }

  // Step 1: Read source-language CSV file (hashes calculated during read)
  logger.log(`\nReading source file: ${finalConfig.source.file}`);
  const sourceRecords = await readSourceCsv(finalConfig.source.file);
  logger.log(`Found ${sourceRecords.length} source strings`);

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
      logger,
      finalConfig.instructions,
      target.instructions,
      finalConfig.batchSize
    );
  }

  logger.log('\nAutotranslate completed successfully!');
}

async function main() {
  try {
    const { config, watch } = parseCommandLine();

    if (watch) {
      await runWatchMode(config);
    } else {
      await autotranslate(config);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runWatchMode(config: ConfigFile) {
  const logger = new ConsoleLogger(config.verbose ?? false);

  logger.log('Starting watch mode...');
  logger.log(`Watching: ${config.source.file}`);
  logger.log('Press Ctrl+C to stop.\n');

  // Run initial translation
  await autotranslate(config);

  // Set up file watcher
  let isProcessing = false;

  watchFile(config.source.file, { interval: 1000 }, async (curr, prev) => {
    if (isProcessing) {
      return; // Avoid overlapping runs
    }

    if (curr.mtime > prev.mtime) {
      isProcessing = true;
      logger.log(`\n[${new Date().toLocaleTimeString()}] Source file changed, updating translations...`);

      try {
        await autotranslate(config);
        logger.log(`[${new Date().toLocaleTimeString()}] Translations updated successfully.\n`);
      } catch (error) {
        logger.error(
          `[${new Date().toLocaleTimeString()}] Translation update failed: ${error instanceof Error ? error.message : String(error)}\n`
        );
      } finally {
        isProcessing = false;
      }
    }
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.log('\nStopping watch mode...');
    unwatchFile(config.source.file);
    process.exit(0);
  });

  // Keep the process alive
  process.stdin.resume();
}

interface TranslationCandidate {
  key: string;
  sourceRecord: SourceRecord;
}

async function readAndFilterExistingRecords(
  targetFile: string,
  sourceMap: Map<string, SourceRecord>,
  logger: Logger
): Promise<{ filteredExisting: TargetRecord[]; existingMap: Map<string, TargetRecord> }> {
  const existingRecords = await readTargetCsv(targetFile);
  const existingMap = new Map<string, TargetRecord>();
  for (const record of existingRecords) {
    existingMap.set(record.key, record);
  }

  logger.log(`Found ${existingRecords.length} existing strings`);

  const validKeys = new Set(sourceMap.keys());
  const filteredExisting = existingRecords.filter((record) => {
    const isValid = validKeys.has(record.key);
    if (!isValid) {
      logger.log(`Removing obsolete key: ${record.key}`);
    }
    return isValid;
  });

  return { filteredExisting, existingMap };
}

function identifyTranslationCandidates(
  sourceMap: Map<string, SourceRecord>,
  existingMap: Map<string, TargetRecord>,
  logger: Logger,
  language: string
): TranslationCandidate[] {
  const stringsToTranslate: TranslationCandidate[] = [];

  for (const [key, sourceRecord] of sourceMap) {
    const existingRecord = existingMap.get(key);

    if (!existingRecord || sourceRecord.hash !== existingRecord.hash) {
      stringsToTranslate.push({ key, sourceRecord });
    }
  }

  logger.log(`Need to translate ${stringsToTranslate.length} strings for ${language}`);

  return stringsToTranslate;
}

function preserveExistingTranslations(
  filteredExisting: TargetRecord[],
  sourceMap: Map<string, SourceRecord>
): TargetRecord[] {
  const updatedRecords: TargetRecord[] = [];

  for (const record of filteredExisting) {
    const sourceRecord = sourceMap.get(record.key);
    if (sourceRecord && sourceRecord.hash === record.hash) {
      updatedRecords.push(record);
    }
  }

  return updatedRecords;
}

async function translateIndividually(
  candidates: TranslationCandidate[],
  translator: Translator,
  logger: Logger
): Promise<TargetRecord[]> {
  logger.log(`Translating ${candidates.length} strings individually (batch size = 1)`);

  const newRecords: TargetRecord[] = [];

  for (const { key, sourceRecord } of candidates) {
    logger.log(`Translating: ${key}`);

    try {
      const translatedText = await translator.translate(sourceRecord.text, sourceRecord.description);

      newRecords.push({
        key,
        text: translatedText,
        hash: sourceRecord.hash,
      });

      logger.log(`  ✓ ${key}: ${sourceRecord.text} → ${translatedText}`);
    } catch (error) {
      logger.error(
        `Failed to translate "${sourceRecord.text}": ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  return newRecords;
}

async function translateInBatches(
  candidates: TranslationCandidate[],
  translator: Translator,
  batchSize: number,
  logger: Logger
): Promise<TargetRecord[]> {
  const newRecords: TargetRecord[] = [];
  const batches: BatchTranslationRequest[][] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize).map(({ key, sourceRecord }) => ({
      key,
      text: sourceRecord.text,
      description: sourceRecord.description,
    }));
    batches.push(batch);
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStart = batchIndex * batchSize + 1;
    const batchEnd = Math.min((batchIndex + 1) * batchSize, candidates.length);

    logger.log(`Translating batch ${batchIndex + 1}/${batches.length} (strings ${batchStart}-${batchEnd})`);

    try {
      const translations = await translator.translateBatch(batch);

      for (const { key, sourceRecord } of candidates.slice(
        batchIndex * batchSize,
        batchIndex * batchSize + batch.length
      )) {
        const translatedText = translations.get(key);
        if (!translatedText) {
          throw new Error(`Missing translation for key: ${key}`);
        }

        newRecords.push({
          key,
          text: translatedText,
          hash: sourceRecord.hash,
        });

        logger.log(`  ✓ ${key}: ${sourceRecord.text} → ${translatedText}`);
      }
    } catch (error) {
      logger.error(`Batch translation failed: ${error instanceof Error ? error.message : String(error)}`);
      logger.log(`Falling back to individual translations for this batch...`);

      // Fallback to individual translations for this batch
      for (const { key, text, description } of batch) {
        logger.log(`  Translating individually: ${key}`);

        try {
          const sourceRecord = candidates.find((s) => s.key === key)?.sourceRecord;
          if (!sourceRecord) {
            throw new Error(`Could not find source record for key: ${key}`);
          }

          const translatedText = await translator.translate(text, description);

          newRecords.push({
            key,
            text: translatedText,
            hash: sourceRecord.hash,
          });

          logger.log(`    ✓ ${key}: ${text} → ${translatedText}`);
        } catch (individualError) {
          logger.error(
            `Failed to translate "${text}": ${individualError instanceof Error ? individualError.message : String(individualError)}`
          );
          throw individualError;
        }
      }
    }
  }

  return newRecords;
}

async function executeTranslations(
  candidates: TranslationCandidate[],
  translator: Translator,
  batchSize: number,
  logger: Logger
): Promise<TargetRecord[]> {
  if (batchSize === 1) {
    return await translateIndividually(candidates, translator, logger);
  } else {
    return await translateInBatches(candidates, translator, batchSize, logger);
  }
}

async function processTargetLanguage(
  target: TargetLanguageConfig,
  sourceMap: Map<string, SourceRecord>,
  logger: Logger,
  globalInstructionsFile?: string,
  languageInstructionsFile?: string,
  batchSize: number = 15
) {
  logger.log(`\nProcessing ${target.language} (${target.file})`);

  // Step 1: Read and filter existing records
  const { filteredExisting, existingMap } = await readAndFilterExistingRecords(target.file, sourceMap, logger);

  // Step 2: Identify strings that need translation
  const candidates = identifyTranslationCandidates(sourceMap, existingMap, logger, target.language);

  // Step 3: Preserve existing translations that are still valid
  const updatedRecords = preserveExistingTranslations(filteredExisting, sourceMap);

  // Step 4: Translate new/changed strings
  if (candidates.length > 0) {
    const translator = new Translator(target.language, globalInstructionsFile, languageInstructionsFile);
    const newTranslations = await executeTranslations(candidates, translator, batchSize, logger);
    updatedRecords.push(...newTranslations);
  }

  // Step 5: Sort and write updated records
  updatedRecords.sort((a, b) => a.key.localeCompare(b.key));
  await writeTargetCsv(target.file, updatedRecords);

  logger.log(`Updated ${target.file} with ${updatedRecords.length} strings`);
}

// Only run main if this file is executed directly (not imported as a library)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
