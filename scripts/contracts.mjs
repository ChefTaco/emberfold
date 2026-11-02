import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { PrepareRequestSchema, PrepareResultSchema, CheckpointSchema, PolicySchema, ValidationRequestSchema, RecallRequestSchema } from '../packages/core/dist/index.js';

const schemas = { PrepareRequest: PrepareRequestSchema, PrepareResult: PrepareResultSchema, Checkpoint: CheckpointSchema, Policy: PolicySchema,
  ValidationRequest: ValidationRequestSchema, RecallRequest: RecallRequestSchema };
const documents = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [`contracts/${name}.schema.json`, z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })]));
const paths = {};
for (const [path, request, response] of [['/v1/prepare', 'PrepareRequest', 'PrepareResult'], ['/v1/checkpoints/rebuild', 'PrepareRequest', 'PrepareResult'], ['/v1/checkpoints/validate', 'ValidationRequest', null]]) {
  paths[path] = { post: { security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${request}` } } } },
    responses: { 200: { description: 'Validated result', content: { 'application/json': { schema: response ? { $ref: `#/components/schemas/${response}` } : { type: 'object', properties: { valid: { const: true }, checkpoint_id: { type: 'string' } }, required: ['valid', 'checkpoint_id'] } } } },
      400: { description: 'Malformed JSON or schema' }, 401: { description: 'Unauthorized' }, 403: { description: 'Browser origin rejected' },
      413: { description: 'Request too large' }, 415: { description: 'JSON required' }, 422: { description: 'Context cannot be prepared' }, 429: { description: 'Overloaded' }, 504: { description: 'Deadline exceeded' } } } };
}
for (const path of ['/healthz', '/readyz']) paths[path] = { get: { responses: { 200: { description: 'Service metadata' }, 503: { description: 'Service is draining' } } } };
documents['contracts/openapi.json'] = { openapi: '3.1.0', info: { title: 'Emberfold', version: '0.1.0' }, paths,
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { target: 'draft-2020-12', io: name === 'PrepareResult' ? 'output' : 'input' })])) } };
await mkdir('contracts', { recursive: true });
for (const [path, document] of Object.entries(documents)) {
  const content = JSON.stringify(document, null, 2) + '\n';
  if (process.argv.includes('--write')) await writeFile(path, content);
  else if (await readFile(path, 'utf8') !== content) throw new Error(`Stale contract: ${path}`);
}
console.log(`Validated ${Object.keys(documents).length} contract documents`);
