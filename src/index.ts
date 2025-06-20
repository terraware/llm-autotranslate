#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { SourceRecord, TargetRecord, readSourceCsv, readTargetCsv, writeTargetCsv } from './csv.js';
import { needsTranslation } from './hash.js';
import { BatchTranslationRequest, Translator } from './translator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliOptions {
  config: string;
}

interface TargetLanguageConfig {
  language: string;
  file: string;
  instructions?: string;
}

interface ConfigFile {
  instructions?: string;
  source: {
    file: string;
  };
  targets: TargetLanguageConfig[];
}

function parseCommandLine(): ConfigFile {
  const program = new Command();

  program
    .name('autotranslate')
    .description('A utility for automated translation of strings for localizable software')
    .version('1.0.0')
    .option('--config <path>', 'Optional path to the config file to use', 'autotranslate.json')
    .parse();

  const options = program.opts() as CliOptions;

  // Read and parse config file
  try {
    const configContent = readFileSync(options.config, 'utf-8');
    const config = JSON.parse(configContent) as ConfigFile;

    // Validate required fields
    if (!config.source?.file) {
      console.error('Error: Config file must specify source.file');
      process.exit(1);
    }

    if (!config.targets || config.targets.length === 0) {
      console.error('Error: Config file must specify at least one target language');
      process.exit(1);
    }

    for (const target of config.targets) {
      if (!target.language || !target.file) {
        console.error('Error: Each target must specify both language and file');
        process.exit(1);
      }
    }

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

async function main() {
  const config = parseCommandLine();

  console.log(`Autotranslate starting...`);
  console.log(`Source file: ${config.source.file}`);
  console.log(`Target languages: ${config.targets.map((t) => `${t.language} (${t.file})`).join(', ')}`);

  if (config.instructions) {
    console.log(`Global instructions file: ${config.instructions}`);
  }

  const languageInstructionCount = config.targets.filter((t) => t.instructions).length;
  if (languageInstructionCount > 0) {
    console.log(`Language-specific instruction files: ${languageInstructionCount}`);
  }

  // Step 1: Read source-language CSV file (hashes calculated during read)
  console.log(`\nReading source file: ${config.source.file}`);
  const sourceRecords = await readSourceCsv(config.source.file);
  console.log(`Found ${sourceRecords.length} source strings`);

  // Step 2: Create source map for easy lookup
  const sourceMap = new Map<string, SourceRecord>();
  for (const record of sourceRecords) {
    sourceMap.set(record.key, record);
  }

  // Step 3: Process each target language
  for (const target of config.targets) {
    await processTargetLanguage(target, sourceMap, config.instructions, target.instructions);
  }

  console.log('\nAutotranslate completed successfully!');
}

async function processTargetLanguage(
  target: TargetLanguageConfig,
  sourceMap: Map<string, SourceRecord>,
  globalInstructionsFile?: string,
  languageInstructionsFile?: string
) {
  console.log(`\nProcessing ${target.language} (${target.file})`);

  // Step 3.1: Read existing target language CSV file
  const existingRecords = await readTargetCsv(target.file);
  const existingMap = new Map<string, TargetRecord>();
  for (const record of existingRecords) {
    existingMap.set(record.key, record);
  }

  console.log(`Found ${existingRecords.length} existing ${target.language} strings`);

  // Step 3.2: Remove rows for keys that don't exist in source
  const validKeys = new Set(sourceMap.keys());
  const filteredExisting = existingRecords.filter((record) => {
    const isValid = validKeys.has(record.key);
    if (!isValid) {
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

  console.log(`Need to translate ${stringsToTranslate.length} strings for ${target.language}`);

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

  // Translate new/changed strings in batches
  const BATCH_SIZE = 15;
  const batches: BatchTranslationRequest[][] = [];

  for (let i = 0; i < stringsToTranslate.length; i += BATCH_SIZE) {
    const batch = stringsToTranslate.slice(i, i + BATCH_SIZE).map(({ key, sourceRecord }) => ({
      key,
      text: sourceRecord.text,
      description: sourceRecord.description,
    }));
    batches.push(batch);
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStart = batchIndex * BATCH_SIZE + 1;
    const batchEnd = Math.min((batchIndex + 1) * BATCH_SIZE, stringsToTranslate.length);

    console.log(`Translating batch ${batchIndex + 1}/${batches.length} (strings ${batchStart}-${batchEnd})`);

    try {
      const translations = await translator.translateBatch(batch);

      for (const { key, sourceRecord } of stringsToTranslate.slice(
        batchIndex * BATCH_SIZE,
        batchIndex * BATCH_SIZE + batch.length
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

        console.log(`  ✓ ${key}: ${sourceRecord.text} → ${translatedText}`);
      }
    } catch (error) {
      console.error(`  ✗ Batch translation failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`  Falling back to individual translations for this batch...`);

      // Fallback to individual translations for this batch
      for (const { key, text, description } of batch) {
        console.log(`  Translating individually: ${key}`);

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

          console.log(`    ✓ ${key}: ${text} → ${translatedText}`);
        } catch (individualError) {
          console.error(
            `    ✗ Failed to translate "${text}": ${individualError instanceof Error ? individualError.message : String(individualError)}`
          );
          throw individualError;
        }
      }
    }
  }

  // Sort by key to maintain consistent ordering
  updatedRecords.sort((a, b) => a.key.localeCompare(b.key));

  // Step 3.5: Write updated target language file
  await writeTargetCsv(target.file, updatedRecords);
  console.log(`Updated ${target.file} with ${updatedRecords.length} strings`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
