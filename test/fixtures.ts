import { PrepareRequestSchema, sha256, type Message, type Summarizer, type Summary } from '../packages/core/src/index.js';

export function fixture(profile: 'general' | 'creative' | 'reflective' = 'general', exchanges = 4) {
  const history: Message[] = [];
  const boundaries: Array<{ id: string; message_ids: string[]; completed: boolean }> = [];
  for (let index = 0; index < exchanges; index++) {
    const user = `user-${index}`;
    const assistant = `assistant-${index}`;
    history.push({ id: user, role: 'user', content: index === 0 ? 'Preserve exact reference: Ω-42. Delivery outcome is unknown.' : `Requirement ${index}: retain unfinished work.` },
      { id: assistant, role: 'assistant', content: `Observation ${index}: awaiting verification.` });
    boundaries.push({ id: `exchange-${index}`, message_ids: [user, assistant], completed: true });
  }
  return PrepareRequestSchema.parse({ schema_version: 1, namespace: 'example:alice:direct', instructions: 'Current execution policy: tools never grant permissions.',
    current: [{ id: 'current', role: 'user', content: 'Continue the unresolved work.' }], history, exchanges: boundaries,
    protected: [{ message_id: 'user-0', source_sha256: sha256(history[0]!.content!), start: 26, end: 30, text: 'Ω-42' }],
    budget: { context_tokens: 16000, output_reserve_tokens: 4000 }, policy: { profile }, force: true });
}
export const deterministicSummarizer: Summarizer = { id: 'fixture', model: 'synthetic', async summarize({ prompt }) {
  const input = JSON.parse(prompt) as { previous: Summary; excerpts: Array<{ message_id: string; text: string }> };
  const items = [...input.previous.items];
  for (const excerpt of input.excerpts) if (!items.some(item => item.source_message_ids.includes(excerpt.message_id))) items.push({
    id: `item-${excerpt.message_id}`, kind: 'open_item', text: excerpt.text || 'Empty historical message', source_message_ids: [excerpt.message_id],
    historical_status: 'historical_unverified', epistemic_status: 'unresolved', supersedes: [], resolves: []
  });
  return JSON.stringify({ items });
} };
