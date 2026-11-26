#!/usr/bin/env node
import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (process.env.CODEX_FIXTURE_HANG) return;
  if (process.env.CODEX_FIXTURE_FAIL) { send({ id: message.id, error: { message: 'fixture failure' } }); return; }
  if (process.env.CODEX_FIXTURE_MALFORMED && message.method === 'account/read') { send({ id: message.id, result: {} }); return; }
  const activeMcp = process.env.CODEX_FIXTURE_MCP && !process.argv.some(argument => argument === 'mcp_servers.fixture.enabled=false');
  const results = { initialize: {}, 'account/read': { account: { type: 'chatgpt' } }, 'config/read': { config: { mcp_servers: activeMcp ? { fixture: { enabled: true } } : {} } },
    'thread/start': { thread: { id: 'fixture-thread' } }, 'turn/start': { turn: { id: 'fixture-turn' } } };
  send({ id: message.id, result: results[message.method] ?? {} });
  if (message.method === 'turn/start') {
    // CODEX_FIXTURE_ENV answers with the sorted names of the environment this process received.
    const text = process.env.CODEX_FIXTURE_ENV ? JSON.stringify(Object.keys(process.env).sort()) : '{"items":[]}';
    send({ method: 'item/completed', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'agentMessage', phase: 'final_answer', text } } });
    send({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { id: 'fixture-turn', status: 'completed' } } });
  }
});
