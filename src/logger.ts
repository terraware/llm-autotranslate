export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

export class ConsoleLogger implements Logger {
  constructor(private verbose: boolean = false) {}

  log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  error(message: string): void {
    console.error(message);
  }
}

export class SilentLogger implements Logger {
  log(message: string): void {
    // Do nothing
  }

  error(message: string): void {
    console.error(message);
  }
}

export class PrefixedLogger implements Logger {
  constructor(
    private baseLogger: Logger,
    private prefix: string
  ) {}

  log(message: string): void {
    this.baseLogger.log(`[${this.prefix}] ${message}`);
  }

  error(message: string): void {
    this.baseLogger.error(`[${this.prefix}] ${message}`);
  }
}
