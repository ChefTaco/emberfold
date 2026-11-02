#!/usr/bin/env node
import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (process.env.EMBERFOLD_FIXTURE_HANG) return;
  if (process.env.EMBERFOLD_FIXTURE_FAIL) { send({ id: message.id, error: { message: 'fixture failure' } }); return; }
  const activeMcp = process.env.EMBERFOLD_FIXTURE_MCP && !process.argv.some(argument => argument === 'mcp_servers.fixture.enabled=false');
  const results = { initialize: {}, 'account/read': { account: { type: 'chatgpt' } }, 'config/read': { config: { mcp_servers: activeMcp ? { fixture: { enabled: true } } : {} } },
    'thread/start': { thread: { id: 'fixture-thread' } }, 'turn/start': { turn: { id: 'fixture-turn' } } };
  send({ id: message.id, result: results[message.method] ?? {} });
  if (message.method === 'turn/start') {
    send({ method: 'item/completed', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'agentMessage', phase: 'final_answer', text: '{"items":[]}' } } });
    send({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { id: 'fixture-turn', status: 'completed' } } });
  }
});
