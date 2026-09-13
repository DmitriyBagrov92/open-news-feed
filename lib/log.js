// Structured logging: one JSON object per line, the format Railway's log
// explorer parses — `level` drives the severity filter (@level:warn),
// `message` is the displayed text, every other key is a searchable
// attribute (@source:bbc-world, @visitors:>10). Everything goes to stdout:
// Railway would otherwise tag stderr lines as errors regardless of `level`.
// Locally the lines stay greppable: `npm start | grep '"usage"'`.

const STREAM = process.stdout;

// LOG_SILENT=1 mutes the stream — the test runner's output stays readable.
const SILENT = process.env.LOG_SILENT === '1';

function write(level, message, fields) {
  if (SILENT) return;
  STREAM.write(JSON.stringify({ level, message, ...fields }) + '\n');
}

export const info = (message, fields = {}) => write('info', message, fields);
export const warn = (message, fields = {}) => write('warn', message, fields);
export const error = (message, fields = {}) => write('error', message, fields);

// Error → attribute-safe fields. Stack only when the caller asks: an
// operational warning ("feed timed out") does not need one.
export function errorFields(err, { stack = false } = {}) {
  if (!(err instanceof Error)) return { error: String(err) };
  const out = { error: err.message };
  if (err.code) out.code = String(err.code);
  if (stack && err.stack) out.stack = err.stack;
  return out;
}
