import { AutotranslateConfig, TargetLanguageConfig, validateConfig } from './config.js';
import { readSourceFile, readTargetFile, writeTargetFile } from './file-io.js';
import { ConsoleLogger, Logger, PrefixedLogger } from './logger.js';
import { SourceRecord, TargetRecord } from './records.js';

export async function updateHashes(config: AutotranslateConfig): Promise<void> {
  const finalConfig = {
    source: config.source,
    targets: config.targets,
    verbose: config.verbose ?? false,
  };

  validateConfig(finalConfig, false);

  const logger = new ConsoleLogger(finalConfig.verbose);

  logger.debug(`Update hashes starting...`);
  logger.debug(`Source file: ${finalConfig.source.file}`);
  logger.debug(`Target languages: ${finalConfig.targets.map((t) => `${t.language} (${t.file})`).join(', ')}`);

  const sourceRecords = await readSourceFile(finalConfig.source.file, finalConfig.source.format);

  const sourceMap = new Map<string, SourceRecord>();
  for (const record of sourceRecords) {
    sourceMap.set(record.key, record);
  }

  for (const target of finalConfig.targets) {
    await updateHashesForTarget(target, sourceMap, logger);
  }

  logger.debug('Hash update completed successfully');
}

async function updateHashesForTarget(
  target: TargetLanguageConfig,
  sourceMap: Map<string, SourceRecord>,
  logger: Logger
): Promise<void> {
  const prefixedLogger = new PrefixedLogger(logger, target.language);

  prefixedLogger.debug(`Updating hashes in ${target.file}`);

  const existingRecords = await readTargetFile(target.file, target.format);
  const existingMap = new Map<string, TargetRecord>();
  for (const record of existingRecords) {
    existingMap.set(record.key, record);
  }

  prefixedLogger.debug(`Found ${existingRecords.length} existing strings`);

  const validKeys = new Set(sourceMap.keys());
  let removedCount = 0;
  const filteredExisting = existingRecords.filter((record) => {
    const isValid = validKeys.has(record.key);
    if (!isValid) {
      prefixedLogger.debug(`Removing obsolete key: ${record.key}`);
      removedCount++;
    }
    return isValid;
  });

  const updatedRecords: TargetRecord[] = [];
  let updatedCount = 0;

  for (const record of filteredExisting) {
    const sourceRecord = sourceMap.get(record.key);
    if (sourceRecord) {
      const updatedRecord: TargetRecord = {
        key: record.key,
        text: record.text,
        hash: sourceRecord.hash,
      };
      updatedRecords.push(updatedRecord);

      if (record.hash !== sourceRecord.hash) {
        updatedCount++;
      }
    }
  }

  updatedRecords.sort((a, b) => a.key.localeCompare(b.key));

  if (removedCount > 0 || updatedCount > 0) {
    await writeTargetFile(target.file, updatedRecords, target.format);
    prefixedLogger.info(`Updated ${target.file}: ${updatedCount} updated, ${removedCount} removed`);
  } else {
    prefixedLogger.info(`No changes needed for ${target.file}`);
  }
}
