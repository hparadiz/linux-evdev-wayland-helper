declare module "node:child_process" {
  export type StdioOptions = "pipe" | "ignore" | "inherit" | Array<"pipe" | "ignore" | "inherit">;
  export type SpawnOptions = { stdio?: StdioOptions };
  export type ChildProcessWithoutNullStreams = {
    pid?: number;
    stdin: { write(chunk: string): boolean; end(chunk?: string): void; destroy?(): void };
    stdout: { on(event: "data", cb: (chunk: Uint8Array | string) => void): void };
    stderr: { on(event: "data", cb: (chunk: Uint8Array | string) => void): void };
    on(event: "error", cb: (err: Error) => void): void;
    on(event: "exit", cb: (code: number | null, signal: string | null) => void): void;
    once(event: "error", cb: (err: Error) => void): void;
    once(event: "exit", cb: (code: number | null, signal: string | null) => void): void;
    kill(signal?: string): boolean;
  };
  export function spawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcessWithoutNullStreams;
}

declare module "node:events" {
  export class EventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    removeAllListeners(event?: string | symbol): this;
  }
}

declare module "node:fs" {
  export function readdirSync(path: string, options?: { withFileTypes?: false } | string): string[];
  export function accessSync(path: string, mode?: number): void;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: BufferEncoding): string;
  export const constants: { R_OK: number; X_OK: number };
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  platform: string;
  pid: number;
  env: Record<string, string | undefined>;
};

type BufferEncoding = "utf8";
