import { bidirectionalRegistry } from './formats/registries.js';
import { SourceRecord, TargetRecord } from './records.js';

export async function readSourceFile(filePath: string, format?: string): Promise<SourceRecord[]> {
  const detectedFormat = bidirectionalRegistry.detectFormat(filePath, format);
  const formatter = bidirectionalRegistry.get(detectedFormat);

  if (!formatter) {
    throw new Error(`Unsupported format: ${detectedFormat}`);
  }

  return formatter.parseSource(filePath);
}

export async function readTargetFile(filePath: string, format?: string): Promise<TargetRecord[]> {
  const detectedFormat = bidirectionalRegistry.detectFormat(filePath, format);
  const formatter = bidirectionalRegistry.get(detectedFormat);

  if (!formatter) {
    throw new Error(`Unsupported format: ${detectedFormat}`);
  }

  return formatter.parseTarget(filePath);
}

export async function writeTargetFile(filePath: string, records: TargetRecord[], format?: string): Promise<void> {
  const detectedFormat = bidirectionalRegistry.detectFormat(filePath, format);
  const formatter = bidirectionalRegistry.get(detectedFormat);

  if (!formatter) {
    throw new Error(`Unsupported format: ${detectedFormat}`);
  }

  return formatter.writeTarget(filePath, records);
}
