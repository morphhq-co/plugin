'use strict';
// Platform detection and hook output encoding.
//
// Claude Code, Codex CLI, Gemini CLI, and Qoder all accept the
// `hookSpecificOutput.additionalContext` JSON shape. Copilot CLI reads a bare
// `additionalContext` field, and Cursor reads snake_case `additional_context`.
// Detection is env-based where the host sets a marker, with an explicit
// `--format` override for hosts that set nothing (Cursor).

function detectFormat(env = process.env) {
  if (env.COPILOT_PLUGIN_DATA) return 'copilot';
  return 'claude';
}

function encodeContext(format, eventName, context) {
  if (!context) return '';
  if (format === 'copilot') return JSON.stringify({ additionalContext: context });
  if (format === 'cursor') return JSON.stringify({ additional_context: context });
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
  });
}

function encodeStopBlock(reason) {
  if (!reason) return '';
  return JSON.stringify({ decision: 'block', reason });
}

function writeStdout(text) {
  if (!text) return;
  try {
    process.stdout.write(text);
  } catch (e) {
    // EPIPE at hook exit must not surface as a hook failure.
  }
}

module.exports = { detectFormat, encodeContext, encodeStopBlock, writeStdout };
