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

export function validateConfig(config: AutotranslateConfig, validateLlmSettings: boolean = true) {
  if (!config.source?.file) {
    throw new Error('Config must specify source.file');
  }

  if (!config.targets || config.targets.length === 0) {
    throw new Error('Config must specify at least one target language');
  }

  for (const target of config.targets) {
    if (!target.language || !target.file) {
      throw new Error('Each target must specify both language and file');
    }
  }

  if (validateLlmSettings) {
    if (!Number.isInteger(config.batchSize) || config.batchSize === undefined || config.batchSize < 1) {
      throw new Error('batchSize must be a positive integer');
    }
  }
}
