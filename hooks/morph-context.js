#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const event = process.argv[2];

function main() {
  if (event !== 'SessionStart' && event !== 'SubagentStart') return;

  let context = fs.readFileSync(path.join(__dirname, '..', 'MORPH.md'), 'utf8').trim();
  if (event === 'SubagentStart') {
    context += '\n\nAs a subagent, use shared context when relevant and return durable findings to the parent agent. Do not create a competing task record.';
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: context,
    },
  }));
}

main();
