#!/usr/bin/env node
import chokidar from 'chokidar';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

import { AutotranslateConfig, autotranslate } from './index.js';
import { ConsoleLogger, renderErrorMessage } from './logger.js';

interface CliOptions {
  config: string;
  verbose: boolean;
  watch: boolean;
  updateHashes: boolean;
}

interface ParsedOptions {
  config: AutotranslateConfig;
  watch: boolean;
  updateHashes: boolean;
}

function parseCommandLine(): ParsedOptions {
  const program = new Command();

  program
    .name('autotranslate')
    .description('A utility for automated translation of strings for localizable software')
    .version('1.0.0')
    .option('--config <path>', 'Optional path to the config file to use', 'autotranslate.json')
    .option('--update-hashes', 'Update hashes in target files without generating new translations')
    .option('-v, --verbose', 'Show details of the configuration and the progress of the translations')
    .option('--watch', 'Run continuously, watching for modifications to the source-language CSV file')
    .parse();

  const options = program.opts() as CliOptions;

  // Read and parse config file
  try {
    const configContent = readFileSync(options.config, 'utf-8');
    const config = JSON.parse(configContent) as AutotranslateConfig;

    // Command line --verbose overrides "verbose":false in config file
    config.verbose = options.verbose || config.verbose;

    return { config, watch: options.watch, updateHashes: options.updateHashes };
  } catch (error) {
    console.error(renderErrorMessage(`Error reading config file ${options.config}`, error));
    process.exit(1);
  }
}

async function main() {
  try {
    dotenv.config({ quiet: true });
    const { config, watch, updateHashes } = parseCommandLine();

    if (watch && updateHashes) {
      console.error('Error: --watch and --update-hashes cannot be used together');
      process.exit(1);
    }

    if (watch) {
      await runWatchMode(config);
    } else if (updateHashes) {
      const { updateHashes: updateHashesFunction } = await import('./updateHashes.js');
      await updateHashesFunction(config);
    } else {
      await autotranslate(config);
    }
  } catch (error) {
    console.error(renderErrorMessage('Error', error));
    process.exit(1);
  }
}

async function runWatchMode(config: AutotranslateConfig) {
  const logger = new ConsoleLogger(config.verbose ?? false);

  logger.info(`Watching: ${config.source.file}`);
  logger.info('Press Ctrl+C to stop.');

  // If the source file changes while we're in the middle of translating the previous version,
  // we want to wait until the original run is done then scan the file again.
  let isProcessing = false;
  let needsScan = true;

  const processTranslationUpdates = async () => {
    if (isProcessing) {
      needsScan = true;
      return;
    }

    while (needsScan) {
      needsScan = false;
      isProcessing = true;
      logger.debug('Source file changed; updating translations');

      try {
        await autotranslate(config);
        logger.info('Translations updated successfully');
      } catch (error) {
        logger.error('Translation update failed', error);
      } finally {
        isProcessing = false;
      }
    }
  };

  const watcher = chokidar.watch(config.source.file, {
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on('add', processTranslationUpdates);
  watcher.on('change', processTranslationUpdates);

  watcher.on('error', (error) => {
    logger.error('Watcher error', error);
  });

  process.on('SIGINT', async () => {
    logger.debug('\nStopping watch mode...');
    await watcher.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(renderErrorMessage('Error', error));
  process.exit(1);
});
