import { describe, expect, it } from 'vitest';
import { prepareContext, rebuildCheckpoint, resolveSources, validateCheckpoint, validateSummary, checkpointDigest, fitContext, sha256, type Summary } from '../packages/core/src/index.js';
import { fixture, deterministicSummarizer } from './fixtures.js';

describe('portable context continuity', () => {
  it('retains instructions, exact passages and complete recent exchanges without mutating sources', async () => {
    const request = fixture();
    const original = JSON.stringify(request);
    const result = await prepareContext(request, { summarizer: deterministicSummarizer });
    expect(result.compacted).toBe(true);
    expect(result.protected_spans_verified).toBe(1);
    expect(result.messages[0]?.content).toBe(request.instructions);
    expect(result.messages.at(-1)?.content).toBe(request.current[0]!.content);
    expect(result.messages.some(message => message.content?.includes('Ω-42'))).toBe(true);
    expect(result.candidate_checkpoint!.source_message_ids).toEqual(request.history.slice(0, 4).map(message => message.id));
    expect(validateCheckpoint(result.candidate_checkpoint, request.history, request.namespace).id).toBe(result.candidate_checkpoint!.id);
    expect(JSON.stringify(request)).toBe(original);
  });
  for (const profile of ['general', 'creative', 'reflective'] as const) it(`preserves ${profile} continuity through five compactions and a rebuild`, async () => {
    let request = fixture(profile);
    let previousId: string | null = null;
    for (let generation = 1; generation <= 5; generation++) {
      const result = await prepareContext(request, { summarizer: deterministicSummarizer });
      const checkpoint = result.candidate_checkpoint!;
      expect(checkpoint.parent_id).toBe(previousId);
      expect(checkpoint.generation).toBe(generation);
      expect(checkpoint.summary.items.every(item => item.historical_status === 'historical_unverified')).toBe(true);
      previousId = checkpoint.id;
      const index = request.exchanges.length;
      request = { ...request, checkpoint, history: [...request.history, { id: `user-${index}`, role: 'user', content: `New observation ${index}` },
        { id: `assistant-${index}`, role: 'assistant', content: 'Still unresolved' }],
        exchanges: [...request.exchanges, { id: `exchange-${index}`, message_ids: [`user-${index}`, `assistant-${index}`], completed: true }] };
    }
    const rebuilt = await rebuildCheckpoint(request, { summarizer: deterministicSummarizer });
    expect(rebuilt.candidate_checkpoint!.generation).toBe(1);
    expect(rebuilt.candidate_checkpoint!.parent_id).toBeNull();
    expect(rebuilt.candidate_checkpoint!.protected[0]?.text).toBe('Ω-42');
  });
  it('allows append-only history but detects original changes, foreign namespaces and corrupted summaries', async () => {
    const request = fixture();
    const checkpoint = (await prepareContext(request, { summarizer: deterministicSummarizer })).candidate_checkpoint!;
    expect(() => validateCheckpoint(checkpoint, [...request.history, { id: 'later', role: 'user', content: 'later' }], request.namespace)).not.toThrow();
    expect(() => validateCheckpoint(checkpoint, request.history, 'foreign')).toThrow('namespace');
    expect(() => validateCheckpoint({ ...checkpoint, model: 'altered' }, request.history, request.namespace)).toThrow('digest');
    expect(() => validateCheckpoint(checkpoint, request.history.map(message => ({ ...message, content: 'altered' })), request.namespace)).toThrow('source digest');
  });
  it('rejects bad exact spans, duplicates, unordered boundaries and incomplete tool groups', async () => {
    const request = fixture();
    await expect(prepareContext({ ...request, protected: [{ ...request.protected[0], text: 'wrong' }] })).rejects.toThrow('PROTECTED_CONTENT');
    await expect(prepareContext({ ...request, current: [request.history[0]] })).rejects.toThrow('duplicate message');
    await expect(prepareContext({ ...request, exchanges: [...request.exchanges].reverse() })).rejects.toThrow('boundary');
    await expect(fitContext({ messages: [{ role: 'tool', content: 'orphan', tool_call_id: 'absent' }], max_input_tokens: 1000 })).rejects.toThrow('INVALID_TOOL');
  });
  it('does not summarize unfinished exchanges', async () => {
    const request = fixture();
    request.exchanges[0]!.completed = false;
    const result = await prepareContext(request, { summarizer: deterministicSummarizer });
    expect(result.candidate_checkpoint?.source_message_ids).not.toContain('user-0');
    expect(result.messages.some(message => message.content === request.history[0]!.content)).toBe(true);
  });
  it('fails safely on unavailable providers, oversized protected content, invalid references and cancellation', async () => {
    const request = fixture();
    await expect(prepareContext(request)).rejects.toThrow('UNAVAILABLE');
    await expect(prepareContext({ ...request, instructions: 'x'.repeat(100000) }, { summarizer: deterministicSummarizer })).rejects.toThrow('BUDGET');
    await expect(prepareContext(request, { summarizer: { ...deterministicSummarizer, summarize: async () => JSON.stringify({ items: [{ id: 'bad', kind: 'status', text: 'bad', source_message_ids: ['missing'], historical_status: 'historical_unverified', epistemic_status: 'reported' }] }) } })).rejects.toThrow('absent source');
    const controller = new AbortController();
    controller.abort();
    await expect(prepareContext(request, { signal: controller.signal })).rejects.toThrow();
  });
  it('labels estimates, supports measured counting, and performs no model calls for dry runs', async () => {
    const request = fixture();
    const result = await prepareContext({ ...request, dry_run: true }, { summarizer: { ...deterministicSummarizer, summarize: async () => { throw new Error('must not call'); } } });
    expect(result.candidate_checkpoint).toBeNull();
    expect(result.tokens.method).toBe('estimate');
    const measured = await prepareContext({ ...request, force: false }, { countTokens: async () => 100 });
    expect(measured.tokens.method).toBe('provider');
    await expect(prepareContext({ ...request, policy: { require_measured_tokens: true } })).rejects.toThrow('TOKENIZER_UNAVAILABLE');
    await expect(prepareContext(request, { countTokens: async () => NaN })).rejects.toThrow('INVALID_TOKEN_COUNT');
  });
  it('resolves originals exactly and rejects missing source IDs', () => {
    const request = fixture();
    expect(resolveSources(request.history, ['user-0'])[0]).toEqual(request.history[0]);
    expect(() => resolveSources(request.history, ['missing'])).toThrow('SOURCE_UNAVAILABLE');
  });
  it('allows one bounded validation repair without accepting changed item identities', async () => {
    const request = fixture();
    let calls = 0;
    const result = await prepareContext(request, { summarizer: { ...deterministicSummarizer, summarize: async input => {
      calls++;
      if (calls === 1) return '{"items":[]}';
      expect(JSON.parse(input.prompt).validation_error).toBeDefined();
      return deterministicSummarizer.summarize(input);
    } } });
    expect(calls).toBe(2);
    expect(result.compacted).toBe(true);
  });
  it('validates supersession and resolution without rewriting existing identities', () => {
    const old = { id: 'weekly', kind: 'decision' as const, text: 'Weekly', source_message_ids: ['one'], historical_status: 'historical_unverified' as const,
      epistemic_status: 'decision' as const, supersedes: [], resolves: [] };
    const next = { ...old, id: 'monthly', text: 'Monthly', source_message_ids: ['two'], supersedes: ['weekly'] };
    const sources = new Set(['one', 'two']);
    expect(validateSummary({ items: [old, next] }, sources, { items: [old] }).items[1]?.supersedes).toEqual(['weekly']);
    expect(() => validateSummary({ items: [next] }, sources)).toThrow('absent relationship');
    expect(() => validateSummary({ items: [{ ...old, supersedes: ['monthly'] }, next] }, sources)).toThrow('cyclic');
    expect(() => validateSummary({ items: [{ ...old, text: 'Monthly' }] }, sources, { items: [old] })).toThrow('identity');
    expect(() => validateSummary({ items: [{ ...old, historical_status: 'completed' }] }, sources)).toThrow();
  });
  it('rejects a protected-span corruption even when the envelope digest is recomputed', async () => {
    const request = fixture();
    const checkpoint = (await prepareContext(request, { summarizer: deterministicSummarizer })).candidate_checkpoint!;
    checkpoint.protected[0]!.source_sha256 = sha256('other');
    checkpoint.checkpoint_sha256 = checkpointDigest(checkpoint);
    expect(() => validateCheckpoint(checkpoint, request.history, request.namespace)).toThrow('protected source');
  });
  it('splits oversized sources into bounded excerpts without losing exact protected content', async () => {
    const request = fixture();
    request.history[0]!.content += '文'.repeat(12000);
    request.protected[0]!.source_sha256 = sha256(request.history[0]!.content!);
    request.policy.summarizer_input_tokens = 2048;
    const seen: string[] = [];
    const result = await prepareContext(request, { summarizer: { ...deterministicSummarizer, summarize: async input => {
      seen.push(input.prompt);
      const parsed = JSON.parse(input.prompt) as { previous: Summary; excerpts: Array<{ message_id: string }> };
      return JSON.stringify({ items: parsed.previous.items.length ? parsed.previous.items : [{ id: 'first', kind: 'observation', text: 'Large source remains recoverable', source_message_ids: [parsed.excerpts[0]!.message_id], historical_status: 'historical_unverified', epistemic_status: 'reported', supersedes: [], resolves: [] }] });
    } } });
    expect(seen.length).toBeGreaterThan(4);
    expect(result.protected_spans_verified).toBe(1);
  });
});

describe('active prompt fitting', () => {
  const messages = [
    { role: 'system' as const, content: 'Current authority' }, { role: 'user' as const, content: 'Current goal' },
    ...[0, 1, 2].flatMap(index => [{ role: 'assistant' as const, content: null, tool_calls: [{ id: `call-${index}`, type: 'function' as const, function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool' as const, tool_call_id: `call-${index}`, content: 'x'.repeat(12000) }]),
    { role: 'user' as const, content: 'Latest correction must survive.' }
  ];
  it('fits complete tool transactions and preserves later user corrections', async () => {
    const original = JSON.stringify(messages);
    const result = await fitContext({ messages, max_input_tokens: 2000 });
    expect(result.messages.at(-1)?.content).toBe('Latest correction must survive.');
    expect(result.messages[0]?.content).toBe('Current authority');
    expect(result.changes.some(change => change.action === 'truncated')).toBe(true);
    expect(JSON.stringify(messages)).toBe(original);
  });
  it('shortens only as many tool results as the budget needs', async () => {
    const parallel = [{ role: 'system' as const, content: 'Current authority' }, { role: 'user' as const, content: 'Current goal' },
      { role: 'assistant' as const, content: null, tool_calls: ['first', 'second'].map(id => ({ id, type: 'function' as const, function: { name: 'read', arguments: '{}' } })) },
      { role: 'tool' as const, tool_call_id: 'first', content: 'x'.repeat(12000) }, { role: 'tool' as const, tool_call_id: 'second', content: 'y'.repeat(12000) }];
    const result = await fitContext({ messages: parallel, max_input_tokens: 6500 });
    expect(result.tokens.input_tokens).toBeLessThanOrEqual(6500);
    expect(result.changes).toEqual([{ action: 'truncated', message_ids: ['3'], source_sha256: sha256('x'.repeat(12000)) }]);
    expect(result.messages[4]?.content).toBe('y'.repeat(12000));
  });
  it('fails rather than shorten protected tool results or hide oversized tool schemas', async () => {
    await expect(fitContext({ messages, max_input_tokens: 2000, protected_indices: [7] })).rejects.toThrow('BUDGET');
    await expect(fitContext({ messages, tools: [{ description: 'z'.repeat(50000) }], max_input_tokens: 2000 })).rejects.toThrow('BUDGET');
  });
});
