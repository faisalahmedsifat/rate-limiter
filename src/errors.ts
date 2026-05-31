export class RateLimiterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimiterConfigurationError";
  }
}

export class UnsupportedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStoreError";
  }
}
