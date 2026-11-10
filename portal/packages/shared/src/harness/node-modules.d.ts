/**
 * Minimal Node typings for harness MCP stdio spawn (lp-oop.38.17).
 * Shared does not depend on @types/node; tsc include is src-only.
 */

declare module "node:child_process" {
  export function spawn(
    command: string,
    args: readonly string[],
    options?: { stdio?: ReadonlyArray<"pipe" | "ignore" | "inherit"> },
  ): {
    stdin: { write(chunk: string): boolean; end(): void };
    stdout: { [Symbol.asyncIterator]?: unknown } & object;
    stderr: object;
    kill(signal?: string): boolean;
    on(event: "error" | "exit", listener: (...args: unknown[]) => void): unknown;
  };
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:readline" {
  export function createInterface(options: {
    input: object;
  }): AsyncIterable<string> & { close(): void };
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

interface ImportMeta {
  url: string;
}

declare const process: {
  env: Record<string, string | undefined>;
};

declare function setTimeout(handler: () => void, timeout: number): unknown;
