import { createLogStack, type LogContext } from "logstack-js";

type Meta = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function toMetadata(args: unknown[]): Meta | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1) {
    const arg = args[0];
    if (arg instanceof Error) return { error: serialize(arg) as Meta };
    if (arg && typeof arg === "object" && !Array.isArray(arg)) {
      return arg as Meta;
    }
    return { value: arg as unknown };
  }
  return { extra: args.map(serialize) };
}

function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const apiKey =
  process.env.LOGSTACK_API_KEY ||
  process.env.NEXT_PUBLIC_LOGSTACK_API_KEY ||
  "";

const client = createLogStack({
  apiKey,
  endpoint: process.env.LOGSTACK_ENDPOINT || process.env.NEXT_PUBLIC_LOGSTACK_ENDPOINT,
  captureConsole: false,
  consoleInProduction: true,
  disabled: !apiKey,
  onError: (error) => {
    // Avoid recursion into this logger if ingest fails
    globalThis.console.error("[LogStack] Failed to ship logs", error);
  },
});

/**
 * App-wide logger backed by logstack-js.
 * Signature matches console.* so existing call sites stay readable:
 *   logger.info("User signed up", { userId })
 *   logger.error("Payment failed", err)
 */
export const logger = {
  debug: (message: unknown, ...args: unknown[]) =>
    client.debug(messageOf(message), toMetadata(args)),
  info: (message: unknown, ...args: unknown[]) =>
    client.info(messageOf(message), toMetadata(args)),
  log: (message: unknown, ...args: unknown[]) =>
    client.info(messageOf(message), toMetadata(args)),
  warn: (message: unknown, ...args: unknown[]) =>
    client.warn(messageOf(message), toMetadata(args)),
  error: (message: unknown, ...args: unknown[]) =>
    client.error(messageOf(message), toMetadata(args)),
  critical: (message: unknown, ...args: unknown[]) =>
    client.critical(messageOf(message), toMetadata(args)),
  fatal: (message: unknown, ...args: unknown[]) =>
    client.fatal(messageOf(message), toMetadata(args)),
  flush: () => client.flush(),
  close: () => client.close(),
  setContext: (context: LogContext) => client.setContext(context),
  clearContext: () => client.clearContext(),
};

export type Logger = typeof logger;
