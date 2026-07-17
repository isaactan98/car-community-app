/**
 * Tiny structured logger. Every line goes through one choke point so the
 * no-speed guarantee (spec Hard Constraint 1) can be enforced and tested:
 * any log entry containing a speed-like field throws in dev/test and is
 * redacted in production.
 */

export type LogSink = (line: string) => void;

const sinks: LogSink[] = [(line) => process.stdout.write(line + '\n')];

/** Test hook: capture every emitted log line. Returns an unsubscribe fn. */
export function addLogSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

const FORBIDDEN = /speed|velocity/i;

function emit(level: string, msg: string, fields?: Record<string, unknown>) {
  let entry = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...fields });
  if (FORBIDDEN.test(entry)) {
    // Hard Constraint 1: never log speed. Fail loudly in dev/test, redact otherwise.
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`logger: refusing to log a forbidden field (msg=${JSON.stringify(msg)})`);
    }
    entry = JSON.stringify({ level: 'error', ts: new Date().toISOString(), msg: 'log entry redacted: forbidden field' });
  }
  for (const sink of sinks) sink(entry);
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
