import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createCodexSummarizer, createHttpSummarizer } from '@hivemagnus/emberfold/adapters';
import type { Adapters, Summarizer } from '@hivemagnus/emberfold';

const HttpProvider = z.object({ type: z.literal('http'), id: z.string().min(1), base_url: z.string().url(), model: z.string().min(1),
  api_key_env: z.string().optional(), input_tokens_path: z.string().optional(), timeout_ms: z.number().int().positive().optional() }).strict();
const CodexProvider = z.object({ type: z.literal('codex'), id: z.string().min(1), command: z.string().min(1), model: z.string().min(1),
  cwd: z.string().min(1), effort: z.string().optional(), auth_mode: z.enum(['chatgpt', 'apiKey']).optional(), timeout_ms: z.number().int().positive().optional() }).strict();
export const ServiceConfigSchema = z.object({ providers: z.array(z.discriminatedUnion('type', [HttpProvider, CodexProvider])).default([]),
  default_provider_id: z.string().optional(), token_env: z.string().default('EMBERFOLD_API_TOKEN'),
  host: z.enum(['127.0.0.1', '::1', '0.0.0.0']).default('127.0.0.1'), port: z.number().int().min(0).max(65535).default(8096),
  max_body_bytes: z.number().int().positive().default(16777216), concurrency: z.number().int().min(1).max(128).default(2),
  timeout_ms: z.number().int().positive().default(120000) }).strict();
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export function configureProviders(config: ServiceConfig, env: NodeJS.ProcessEnv = process.env): Map<string, Summarizer> {
  const providers = new Map<string, Summarizer>();
  for (const provider of config.providers) {
    if (providers.has(provider.id)) throw new Error('Duplicate provider ID');
    providers.set(provider.id, provider.type === 'http' ? createHttpSummarizer(provider, env) : createCodexSummarizer(provider, env));
  }
  if (config.default_provider_id && !providers.has(config.default_provider_id)) throw new Error('Default provider is absent');
  return providers;
}
export async function loadServiceConfig(path?: string): Promise<ServiceConfig> {
  return ServiceConfigSchema.parse(path ? JSON.parse(await readFile(path, 'utf8')) : {});
}
export function requestAdapters(value: { provider_id?: string | undefined; tokenizer_id?: string | undefined }, config: ServiceConfig,
  providers: Map<string, Summarizer>, signal: AbortSignal): Adapters {
  const id = value.provider_id ?? config.default_provider_id;
  const summarizer = id ? providers.get(id) : undefined;
  if (id && !summarizer) throw new Error('PROVIDER_UNCONFIGURED: unknown provider ID');
  const tokenizer = value.tokenizer_id ? providers.get(value.tokenizer_id) : undefined;
  if (value.tokenizer_id && !tokenizer?.countTokens) throw new Error('TOKENIZER_UNAVAILABLE: unknown tokenizer ID');
  return { signal, ...(summarizer ? { summarizer } : {}), ...(tokenizer?.countTokens ? { countTokens: tokenizer.countTokens } : {}) };
}
