export interface SourceRecord {
  key: string;
  text: string;
  description: string;
  /** Calculated hash of text and description. */
  hash: string;
}

export interface TargetRecord {
  key: string;
  text: string;
  /** Hash of the source-language text+description that was used to generate the translation. */
  hash: string;
}
