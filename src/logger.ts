export function renderErrorMessage(message: string, error?: unknown): string {
  if (error !== undefined) {
    const errorString = error instanceof Error ? error.message : String(error);
    return `${message}: ${errorString}`;
  } else {
    return message;
  }
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export class ConsoleLogger implements Logger {
  constructor(private verbose: boolean = false) {}

  debug(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  info(message: string): void {
    console.log(message);
  }

  error(message: string, error?: unknown): void {
    console.error(renderErrorMessage(message, error));
  }
}

export class SilentLogger implements Logger {
  debug(): void {
    // Do nothing
  }

  info(): void {
    // Do nothing
  }

  error(message: string, error?: unknown): void {
    console.error(renderErrorMessage(message, error));
  }
}

export class PrefixedLogger implements Logger {
  constructor(
    private baseLogger: Logger,
    private prefix: string
  ) {}

  debug(message: string): void {
    this.baseLogger.debug(`[${this.prefix}] ${message}`);
  }

  info(message: string): void {
    this.baseLogger.info(`[${this.prefix}] ${message}`);
  }

  error(message: string, error?: unknown): void {
    this.baseLogger.error(`[${this.prefix}] ${message}`, error);
  }
}
