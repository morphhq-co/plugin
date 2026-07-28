#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const event = process.argv[2];

function main() {
  if (event === 'Stop') {
    let input = {};
    try {
      input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    } catch {}

    process.stdout.write(JSON.stringify(input.stop_hook_active ? {} : {
      decision: 'block',
      reason: 'Before finishing a substantive task, update Morph with any durable decisions, blockers, milestones, and resumable handoff state that are not already recorded. Follow organization guidance and update existing context rather than creating duplicates. If nothing durable changed or Morph is unavailable, finish without mentioning it.',
    }));
    return;
  }

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
