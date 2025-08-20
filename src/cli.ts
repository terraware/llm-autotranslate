import chokidar from 'chokidar';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

import { AutotranslateConfig, autotranslate } from './index.js';
import { ConsoleLogger } from './logger.js';

interface CliOptions {
  config: string;
  verbose: boolean;
  watch: boolean;
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

async function main() {
  try {
    dotenv.config({ quiet: true });
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
    logger.error(`Watcher error: ${error instanceof Error ? error.message : String(error)}`);
  });

  process.on('SIGINT', async () => {
    logger.log('\nStopping watch mode...');
    await watcher.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
