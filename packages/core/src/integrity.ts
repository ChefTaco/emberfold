import { createHash } from 'node:crypto';
import { CheckpointSchema, SummarySchema, type Checkpoint, type Message, type Summary } from './contracts.js';

export function canonical(value: unknown): string {
  if (value === undefined) throw new Error('INVALID_INPUT: undefined cannot be canonicalized');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const sourceDigest = (messages: Message[]): string => sha256(canonical(messages));
export function checkpointDigest(checkpoint: Omit<Checkpoint, 'checkpoint_sha256'> | Checkpoint): string {
  const { checkpoint_sha256: omitted, ...body } = checkpoint as Checkpoint;
  void omitted;
  return sha256(canonical(body));
}
export function validateSummary(value: unknown, sources: ReadonlySet<string>, previous?: Summary): Summary {
  const summary = SummarySchema.parse(value);
  const items = new Map(summary.items.map(item => [item.id, item]));
  if (items.size !== summary.items.length) throw new Error('INVALID_SUMMARY: duplicate item ID');
  const previousItems = new Map(previous?.items.map(item => [item.id, item]) ?? []);
  for (const item of summary.items) {
    if (item.source_message_ids.some(id => !sources.has(id))) throw new Error('INVALID_SUMMARY: absent source reference');
    const prior = previousItems.get(item.id);
    if (prior && canonical(prior) !== canonical(item)) throw new Error('INVALID_SUMMARY: existing item identity was changed');
    for (const target of [...item.supersedes, ...item.resolves]) {
      if (!items.has(target)) throw new Error('INVALID_SUMMARY: absent relationship target');
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('INVALID_SUMMARY: cyclic relationship');
    if (visited.has(id)) return;
    visiting.add(id);
    const item = items.get(id)!;
    for (const target of [...item.supersedes, ...item.resolves]) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of items.keys()) visit(id);
  return summary;
}
export function resolveSources(history: Message[], messageIds: string[]): Message[] {
  const messages = new Map(history.map(message => [message.id, message]));
  if (messages.size !== history.length) throw new Error('INVALID_INPUT: duplicate message ID');
  return messageIds.map(id => {
    const message = messages.get(id);
    if (!message) throw new Error('SOURCE_UNAVAILABLE: original message is missing');
    return structuredClone(message);
  });
}
export function validateCheckpoint(value: unknown, history: Message[], namespace: string): Checkpoint {
  const checkpoint = CheckpointSchema.parse(value);
  if (checkpoint.namespace !== namespace) throw new Error('CHECKPOINT_INVALID: namespace mismatch');
  if (checkpointDigest(checkpoint) !== checkpoint.checkpoint_sha256) throw new Error('CHECKPOINT_INVALID: checkpoint digest mismatch');
  if (new Set(checkpoint.source_message_ids).size !== checkpoint.source_message_ids.length) throw new Error('CHECKPOINT_INVALID: duplicate source ID');
  const sources = resolveSources(history, checkpoint.source_message_ids);
  if (sourceDigest(sources) !== checkpoint.source_sha256) throw new Error('CHECKPOINT_INVALID: source digest mismatch');
  validateSummary(checkpoint.summary, new Set(sources.map(message => message.id)));
  for (const span of checkpoint.protected) {
    const message = resolveSources(history, [span.message_id])[0]!;
    if (sha256(message.content ?? '') !== span.source_sha256 || span.end <= span.start ||
      (message.content ?? '').slice(span.start, span.end) !== span.text) throw new Error('CHECKPOINT_INVALID: protected source differs');
  }
  return checkpoint;
}
