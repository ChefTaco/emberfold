import { z } from 'zod';

export const ToolCallSchema = z.object({ id: z.string().min(1), type: z.literal('function'),
  function: z.object({ name: z.string().min(1), arguments: z.string() }).strict() }).strict();
export const ChatMessageSchema = z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(), tool_call_id: z.string().optional(), tool_calls: z.array(ToolCallSchema).optional() }).strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export const MessageSchema = ChatMessageSchema.extend({ id: z.string().min(1).max(256) });
export type Message = z.infer<typeof MessageSchema>;
export const ExchangeSchema = z.object({ id: z.string().min(1), message_ids: z.array(z.string()).min(1),
  completed: z.boolean() }).strict();
export const ProtectedSpanSchema = z.object({ message_id: z.string(), source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), text: z.string().min(1) }).strict();
export const ProfileSchema = z.enum(['general', 'creative', 'reflective']);
export const PolicySchema = z.object({
  profile: ProfileSchema.default('general'), revision: z.number().int().positive().default(1),
  recent_exchanges: z.number().int().min(0).max(100).default(2),
  trigger_ratio: z.number().min(0.1).max(1).default(0.7),
  summary_max_tokens: z.number().int().min(128).default(4000),
  summarizer_input_tokens: z.number().int().min(512).default(16000),
  summarizer_output_tokens: z.number().int().min(128).default(4000),
  max_passes: z.number().int().min(1).max(256).default(32),
  require_measured_tokens: z.boolean().default(false)
}).strict();
export type Policy = z.infer<typeof PolicySchema>;
export const SummaryItemSchema = z.object({
  id: z.string().min(1).max(256),
  kind: z.enum(['decision', 'observation', 'open_item', 'correction', 'status', 'canon', 'hypothesis', 'behavior_change']),
  text: z.string().trim().min(1).max(4000), source_message_ids: z.array(z.string()).min(1).max(32),
  historical_status: z.literal('historical_unverified'),
  epistemic_status: z.enum(['reported', 'observation', 'hypothesis', 'decision', 'unresolved']),
  supersedes: z.array(z.string()).default([]), resolves: z.array(z.string()).default([])
}).strict();
export const SummarySchema = z.object({ items: z.array(SummaryItemSchema).min(1).max(64) }).strict();
export type Summary = z.infer<typeof SummarySchema>;
export const CheckpointSchema = z.object({
  schema_version: z.literal(1), id: z.string().min(1), namespace: z.string().min(1), parent_id: z.string().nullable(),
  source_message_ids: z.array(z.string()).min(1), source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  summary: SummarySchema, protected: z.array(ProtectedSpanSchema), policy_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  profile: ProfileSchema, generation: z.number().int().positive(), provider: z.string(), model: z.string(),
  created_at: z.string().datetime(), checkpoint_sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export const PrepareRequestSchema = z.object({
  schema_version: z.literal(1), namespace: z.string().min(1).max(512),
  instructions: z.string(), current: z.array(MessageSchema).min(1), history: z.array(MessageSchema),
  exchanges: z.array(ExchangeSchema), tools: z.array(z.record(z.string(), z.unknown())).default([]),
  protected: z.array(ProtectedSpanSchema).default([]), checkpoint: CheckpointSchema.nullable().default(null),
  budget: z.object({ context_tokens: z.number().int().positive(), output_reserve_tokens: z.number().int().nonnegative(),
    safety_tokens: z.number().int().nonnegative().default(0) }).strict(),
  policy: PolicySchema.default(() => PolicySchema.parse({})),
  provider_id: z.string().min(1).optional(), tokenizer_id: z.string().min(1).optional(),
  force: z.boolean().default(false), dry_run: z.boolean().default(false)
}).strict();
export type PrepareRequest = z.infer<typeof PrepareRequestSchema>;
export const TokenAccountingSchema = z.object({ input_tokens: z.number().int().nonnegative(), max_input_tokens: z.number().int(),
  output_reserve_tokens: z.number().int().nonnegative(), method: z.enum(['provider', 'estimate']) }).strict();
export const ChangeSchema = z.object({ action: z.enum(['retained', 'summarized', 'omitted', 'truncated', 'protected']),
  message_ids: z.array(z.string()), source_sha256: z.string().optional() }).strict();
export const PrepareResultSchema = z.object({ schema_version: z.literal(1), messages: z.array(ChatMessageSchema),
  candidate_checkpoint: CheckpointSchema.nullable(), tokens: TokenAccountingSchema,
  changes: z.array(ChangeSchema), protected_spans_verified: z.number().int().nonnegative(),
  compacted: z.boolean(), fits: z.boolean(), limitations: z.array(z.string()) }).strict();
export type PrepareResult = z.infer<typeof PrepareResultSchema>;
export const ValidationRequestSchema = z.object({ checkpoint: CheckpointSchema, history: z.array(MessageSchema), namespace: z.string() }).strict();
export const RecallRequestSchema = z.object({ history: z.array(MessageSchema), message_ids: z.array(z.string()) }).strict();
export type TokenCounter = (messages: ChatMessage[], tools: object[], signal: AbortSignal) => Promise<number | null>;
export type SummarizationInput = { prompt: string; output_tokens: number; signal: AbortSignal };
export type Summarizer = { id: string; model: string; summarize: (input: SummarizationInput) => Promise<string>;
  countTokens?: TokenCounter; renderInput?: (prompt: string) => ChatMessage[] };
export type Adapters = { summarizer?: Summarizer; countTokens?: TokenCounter; signal?: AbortSignal };
