export interface OutputSpec {
  format: string;
  file: string;
}

export interface StringRecord {
  key: string;
  text: string;
  description?: string;
}

export interface OutputFormatter {
  format(records: StringRecord[]): string;
}

export class JavaScriptConstFormatter implements OutputFormatter {
  format(records: StringRecord[]): string {
    const lines: string[] = [];
    lines.push('export const strings = {');

    for (const record of records) {
      if (record.description && record.description.trim()) {
        lines.push(`  // ${record.description}`);
      }
      const escapedKey = JSON.stringify(record.key);
      const escapedText = JSON.stringify(record.text);
      lines.push(`  ${escapedKey}: ${escapedText},`);
    }

    lines.push('};');
    return lines.join('\n') + '\n';
  }
}

export class OutputFormatterRegistry {
  private formatters = new Map<string, OutputFormatter>();

  constructor() {
    this.register('javascript-const', new JavaScriptConstFormatter());
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

export const outputRegistry = new OutputFormatterRegistry();
