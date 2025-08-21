export function renderErrorMessage(message: string, error?: any): string {
  if (error !== undefined) {
    const errorString = error instanceof Error ? error.message : String(error);
    return `${message}: ${errorString}`;
  } else {
    return message;
  }
}

export interface Logger {
  log(message: string): void;
  error(message: string, error?: any): void;
}

export class ConsoleLogger implements Logger {
  constructor(private verbose: boolean = false) {}

  log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  error(message: string, error?: any): void {
    console.error(renderErrorMessage(message, error));
  }
}

export class SilentLogger implements Logger {
  log(): void {
    // Do nothing
  }

  error(message: string, error?: any): void {
    console.error(renderErrorMessage(message, error));
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

  error(message: string, error?: any): void {
    this.baseLogger.error(`[${this.prefix}] ${message}`, error);
  }
}
