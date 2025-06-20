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

export class JavaPropertiesFormatter implements OutputFormatter {
  format(records: StringRecord[]): string {
    const lines: string[] = [];

    for (const record of records) {
      if (record.description && record.description.trim()) {
        lines.push(`# ${record.description}`);
      }
      const escapedKey = this.escapeKey(record.key);
      const escapedValue = this.escapeValue(record.text);
      lines.push(`${escapedKey}=${escapedValue}`);
    }

    return lines.join('\n') + '\n';
  }

  private escapeKey(key: string): string {
    // In Java properties, keys need to escape: space, tab, form feed, =, :, #, !
    return key
      .replace(/\\/g, '\\\\')
      .replace(/ /g, '\\ ')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/=/g, '\\=')
      .replace(/:/g, '\\:')
      .replace(/#/g, '\\#')
      .replace(/!/g, '\\!');
  }

  private escapeValue(value: string): string {
    // In Java properties, values need to escape: backslash, newline, carriage return, tab, form feed
    // Single quotes are escaped by doubling them
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/'/g, "''");
  }
}

export class OutputFormatterRegistry {
  private formatters = new Map<string, OutputFormatter>();

  constructor() {
    this.register('java-properties', new JavaPropertiesFormatter());
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
