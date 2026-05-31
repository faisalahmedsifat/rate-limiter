declare module "node:test" {
  export interface TestContext {}

  export default function test(
    name: string,
    fn: (context: TestContext) => void | Promise<void>,
  ): void;
}

declare module "node:assert/strict" {
  export interface Assert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    match(
      actual: string,
      expected: RegExp,
      message?: string,
    ): void;
  }

  const assert: Assert;
  export default assert;
}
