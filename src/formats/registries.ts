import { CsvFormatter } from './csv.js';
import { BidirectionalFormatter, OutputFormatter } from './index.js';
import { JavaPropertiesFormatter } from './java-properties.js';
import { JavaScriptConstFormatter } from './javascript-const.js';

export class OutputFormatterRegistry {
  private formatters = new Map<string, OutputFormatter>();

  constructor() {
    this.register('java-properties', new JavaPropertiesFormatter());
    this.register('javascript-const', new JavaScriptConstFormatter());
    this.register('csv', new CsvFormatter());
  }

  register(formatName: string, formatter: OutputFormatter): void {
    this.formatters.set(formatName, formatter);
  }

  get(formatName: string): OutputFormatter | undefined {
    return this.formatters.get(formatName);
  }

  getSupportedFormats(): string[] {
    return Array.from(this.formatters.keys());
  }
}

export class BidirectionalFormatterRegistry {
  private formatters = new Map<string, BidirectionalFormatter>();

  constructor() {
    this.register('java-properties', new JavaPropertiesFormatter());
    this.register('javascript-const', new JavaScriptConstFormatter());
    this.register('csv', new CsvFormatter());
  }

  register(formatName: string, formatter: BidirectionalFormatter): void {
    this.formatters.set(formatName, formatter);
  }

  get(formatName: string): BidirectionalFormatter | undefined {
    return this.formatters.get(formatName);
  }

  getSupportedFormats(): string[] {
    return Array.from(this.formatters.keys());
  }

  detectFormat(filePath: string, explicitFormat?: string): string {
    if (explicitFormat && this.formatters.has(explicitFormat)) {
      return explicitFormat;
    }

    const ext = filePath.toLowerCase();
    if (ext.endsWith('.properties')) return 'java-properties';
    if (ext.endsWith('.js') || ext.endsWith('.mjs') || ext.endsWith('.ts')) return 'javascript-const';
    if (ext.endsWith('.csv')) return 'csv';

    return 'csv'; // default fallback
  }
}

export const outputRegistry = new OutputFormatterRegistry();
export const bidirectionalRegistry = new BidirectionalFormatterRegistry();
