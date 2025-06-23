import { SourceRecord, TargetRecord } from '../records';

export interface StringRecord {
  key: string;
  text: string;
  description?: string;
}

export interface OutputFormatter {
  format(records: StringRecord[]): string;
}

export interface InputFormatter {
  parseSource(filePath: string): Promise<SourceRecord[]>;

  parseTarget(filePath: string): Promise<TargetRecord[]>;

  canParse(filePath: string): boolean;
}

export interface BidirectionalFormatter extends OutputFormatter, InputFormatter {
  writeSource(filePath: string, records: SourceRecord[]): Promise<void>;

  writeTarget(filePath: string, records: TargetRecord[]): Promise<void>;
}
