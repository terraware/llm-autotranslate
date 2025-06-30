#!/usr/bin/env node
import chokidar from 'chokidar';
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';

import { readSourceFile, readTargetFile, writeTargetFile } from './file-io.js';
import { StringRecord } from './formats/index.js';
import { outputRegistry } from './formats/registries.js';
import { ConsoleLogger, Logger, PrefixedLogger } from './logger.js';
import { SourceRecord, TargetRecord } from './records.js';
import { BatchTranslationRequest, Translator } from './translator.js';

// Re-export useful types for library users
export { Logger, ConsoleLogger, SilentLogger, PrefixedLogger } from './logger.js';
export { Translator } from './translator.js';

interface CliOptions {
  config: string;
  verbose: boolean;
  watch: boolean;
}

export interface OutputSpec {
  format: string;
  file: string;
}

export interface TargetLanguageConfig {
  language: string;
  file: string;
  format?: string;
  instructions?: string;
  outputs?: OutputSpec[];
}

export interface AutotranslateConfig {
  batchSize?: number;
  instructions?: string;
  source: {
    file: string;
    format?: string;
    language?: string;
    outputs?: OutputSpec[];
  };
  targets: TargetLanguageConfig[];
  verbose?: boolean;
}

interface ParsedOptions {
  config: AutotranslateConfig;
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
    const config = JSON.parse(configContent) as AutotranslateConfig;

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
  const sourceLanguage = finalConfig.source.language ?? 'English';

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

  // Step 1: Read source-language strings file (hashes calculated during read)
  logger.log(`\nReading source file: ${finalConfig.source.file}`);
  const sourceRecords = await readSourceFile(finalConfig.source.file, finalConfig.source.format);
  logger.log(`Found ${sourceRecords.length} source strings`);

  // Step 2: Create source map for easy lookup
  const sourceMap = new Map<string, SourceRecord>();
  for (const record of sourceRecords) {
    sourceMap.set(record.key, record);
  }

  // Step 3: Process all target languages concurrently (without writing files yet)
  const processingPromises = finalConfig.targets.map((target) =>
    processTargetLanguage(
      sourceLanguage,
      target,
      sourceMap,
      logger,
      finalConfig.instructions,
      target.instructions,
      finalConfig.batchSize
    )
  );

  const processingResults = await Promise.all(processingPromises);

  // Step 4: Write all files at once
  await executeSourceOutputFiles(finalConfig.source.outputs, sourceRecords, logger);
  await executeAllFileWrites(processingResults, logger);

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

async function runWatchMode(config: AutotranslateConfig) {
  const logger = new ConsoleLogger(config.verbose ?? false);

  logger.log('Starting watch mode...');
  logger.log(`Watching: ${config.source.file}`);
  logger.log('Press Ctrl+C to stop.\n');

  // Run initial translation
  await autotranslate(config);

  // Set up file watcher with chokidar
  let isProcessing = false;

  const watcher = chokidar.watch(config.source.file, {
    ignoreInitial: true, // Don't trigger on initial scan
    persistent: true,
    usePolling: false, // Use native file system events when possible
    awaitWriteFinish: {
      stabilityThreshold: 300, // Wait for file to be stable for 300ms
      pollInterval: 100, // Check every 100ms
    },
  });

  watcher.on('change', async () => {
    if (isProcessing) {
      return; // Avoid overlapping runs
    }

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
  });

  watcher.on('error', (error) => {
    logger.error(`Watcher error: ${error instanceof Error ? error.message : String(error)}`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.log('\nStopping watch mode...');
    await watcher.close();
    process.exit(0);
  });

  // Keep the process alive
  process.stdin.resume();
}

interface TranslationCandidate {
  key: string;
  sourceRecord: SourceRecord;
}

interface ProcessingResult {
  target: TargetLanguageConfig;
  updatedRecords: TargetRecord[];
  hasChanges: boolean;
}

async function readAndFilterExistingRecords(
  targetFile: string,
  targetFormat: string | undefined,
  sourceMap: Map<string, SourceRecord>,
  logger: Logger
): Promise<{ filteredExisting: TargetRecord[]; existingMap: Map<string, TargetRecord>; removedCount: number }> {
  const existingRecords = await readTargetFile(targetFile, targetFormat);
  const existingMap = new Map<string, TargetRecord>();
  for (const record of existingRecords) {
    existingMap.set(record.key, record);
  }

  logger.log(`Found ${existingRecords.length} existing strings`);

  const validKeys = new Set(sourceMap.keys());
  let removedCount = 0;
  const filteredExisting = existingRecords.filter((record) => {
    const isValid = validKeys.has(record.key);
    if (!isValid) {
      logger.log(`Removing obsolete key: ${record.key}`);
      removedCount++;
    }
    return isValid;
  });

  return { filteredExisting, existingMap, removedCount };
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
  sourceLanguage: string,
  target: TargetLanguageConfig,
  sourceMap: Map<string, SourceRecord>,
  logger: Logger,
  globalInstructionsFile?: string,
  languageInstructionsFile?: string,
  batchSize: number = 15
): Promise<ProcessingResult> {
  const prefixedLogger = new PrefixedLogger(logger, target.language);

  prefixedLogger.log(`Processing ${target.language} (${target.file})`);

  // Step 1: Read and filter existing records
  const { filteredExisting, existingMap, removedCount } = await readAndFilterExistingRecords(
    target.file,
    target.format,
    sourceMap,
    prefixedLogger
  );

  // Step 2: Identify strings that need translation
  const candidates = identifyTranslationCandidates(sourceMap, existingMap, prefixedLogger, target.language);

  // Check if any changes are needed (no translations needed and no records removed)
  if (candidates.length === 0 && removedCount === 0) {
    prefixedLogger.log(`No changes needed for ${target.file}`);
    const existingRecords = preserveExistingTranslations(filteredExisting, sourceMap);
    return {
      target,
      updatedRecords: existingRecords,
      hasChanges: false,
    };
  }

  // Step 3: Preserve existing translations that are still valid
  const updatedRecords = preserveExistingTranslations(filteredExisting, sourceMap);

  // Step 4: Translate new/changed strings
  if (candidates.length > 0) {
    const translator = new Translator(
      sourceLanguage,
      target.language,
      globalInstructionsFile,
      languageInstructionsFile
    );
    const newTranslations = await executeTranslations(candidates, translator, batchSize, prefixedLogger);
    updatedRecords.push(...newTranslations);
  }

  // Step 5: Sort records (writing will happen later)
  updatedRecords.sort((a, b) => a.key.localeCompare(b.key));

  prefixedLogger.log(`Prepared ${updatedRecords.length} strings for ${target.file}`);

  return {
    target,
    updatedRecords,
    hasChanges: true,
  };
}

async function executeAllFileWrites(processingResults: ProcessingResult[], logger: Logger): Promise<void> {
  logger.log('\nWriting all files...');

  // Write target files
  for (const result of processingResults) {
    if (result.hasChanges) {
      const prefixedLogger = new PrefixedLogger(logger, result.target.language);
      await writeTargetFile(result.target.file, result.updatedRecords, result.target.format);
      prefixedLogger.log(`Updated ${result.target.file} with ${result.updatedRecords.length} strings`);
    }
  }

  // Write target output files
  for (const result of processingResults) {
    if (result.target.outputs && result.target.outputs.length > 0) {
      // Only generate output files if there are changes OR if the file doesn't exist
      if (result.hasChanges) {
        await executeTargetOutputFiles(result.target.outputs, result.updatedRecords, logger, result.target.language);
      }
    }
  }
}

async function executeTargetOutputFiles(
  outputs: OutputSpec[],
  records: TargetRecord[],
  logger: Logger,
  language: string
): Promise<void> {
  const prefixedLogger = new PrefixedLogger(logger, language);

  for (const output of outputs) {
    try {
      const formatter = outputRegistry.get(output.format);
      if (!formatter) {
        prefixedLogger.error(`Unknown output format: ${output.format}`);
        continue;
      }

      // Convert records to StringRecord format
      const stringRecords: StringRecord[] = records.map((record) => ({
        key: record.key,
        text: record.text,
        description: undefined, // Target records don't have descriptions
      }));

      const content = formatter.format(stringRecords);
      writeFileSync(output.file, content, 'utf-8');
      prefixedLogger.log(`Generated ${output.format} output: ${output.file}`);
    } catch (error) {
      prefixedLogger.error(
        `Failed to generate ${output.format} output ${output.file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function executeSourceOutputFiles(
  sourceOutputs: OutputSpec[] | undefined,
  sourceRecords: SourceRecord[],
  logger: Logger
): Promise<void> {
  if (!sourceOutputs || sourceOutputs.length === 0) {
    return;
  }

  const prefixedLogger = new PrefixedLogger(logger, 'Source');

  for (const output of sourceOutputs) {
    try {
      const formatter = outputRegistry.get(output.format);
      if (!formatter) {
        prefixedLogger.error(`Unknown output format: ${output.format}`);
        continue;
      }

      // Convert records to StringRecord format
      const stringRecords: StringRecord[] = sourceRecords.map((record) => ({
        key: record.key,
        text: record.text,
        description: record.description,
      }));

      const content = formatter.format(stringRecords);
      writeFileSync(output.file, content, 'utf-8');
      prefixedLogger.log(`Generated ${output.format} output: ${output.file}`);
    } catch (error) {
      prefixedLogger.error(
        `Failed to generate ${output.format} output ${output.file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

// Only run main if this file is executed directly (not imported as a library)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
