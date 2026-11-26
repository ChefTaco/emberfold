/** A minimal Prometheus text-format registry for the service: no labels beyond bounded route, status and error codes. */
const DurationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120] as const;
const ProviderFailure = /^(?:PROVIDER_[A-Z_]+|TOKENIZER_[A-Z_]+|CODEX_[A-Z_]+|INVALID_SUMMARY|INVALID_TOKEN_COUNT)$/;

export type ServiceMetrics = {
  request(operation: string, status: number, seconds: number): void;
  compaction(operation: string): void;
  failure(code: string): void;
  render(gauges: { in_flight: number; ready: boolean }): string;
};

const label = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const key = (labels: Record<string, string>): string => Object.entries(labels).map(([name, value]) => `${name}="${label(value)}"`).join(',');

export function createServiceMetrics(): ServiceMetrics {
  const requests = new Map<string, number>();
  const compactions = new Map<string, number>();
  const failures = new Map<string, number>();
  const durations = new Map<string, { buckets: number[]; sum: number; count: number }>();
  const add = (map: Map<string, number>, labels: string): void => { map.set(labels, (map.get(labels) ?? 0) + 1); };
  const counter = (name: string, help: string, map: Map<string, number>): string[] =>
    [`# HELP ${name} ${help}`, `# TYPE ${name} counter`, ...[...map].map(([labels, value]) => `${name}{${labels}} ${value}`)];
  return {
    request(operation, status, seconds) {
      add(requests, key({ operation, status: String(status) }));
      const labels = key({ operation });
      const histogram = durations.get(labels) ?? { buckets: DurationBuckets.map(() => 0), sum: 0, count: 0 };
      DurationBuckets.forEach((bound, index) => { if (seconds <= bound) histogram.buckets[index]!++; });
      histogram.sum += seconds;
      histogram.count++;
      durations.set(labels, histogram);
    },
    compaction(operation) { add(compactions, key({ operation })); },
    failure(code) { if (ProviderFailure.test(code)) add(failures, key({ code })); },
    render({ in_flight, ready }) {
      const lines = [
        ...counter('emberfold_requests_total', 'API requests by operation and HTTP status.', requests),
        '# HELP emberfold_request_duration_seconds API request duration by operation.', '# TYPE emberfold_request_duration_seconds histogram',
        ...[...durations].flatMap(([labels, histogram]) => [
          ...DurationBuckets.map((bound, index) => `emberfold_request_duration_seconds_bucket{${labels},le="${bound}"} ${histogram.buckets[index]}`),
          `emberfold_request_duration_seconds_bucket{${labels},le="+Inf"} ${histogram.count}`,
          `emberfold_request_duration_seconds_sum{${labels}} ${histogram.sum}`,
          `emberfold_request_duration_seconds_count{${labels}} ${histogram.count}`]),
        ...counter('emberfold_compactions_total', 'Requests that produced a new candidate checkpoint.', compactions),
        ...counter('emberfold_provider_failures_total', 'Summarizer and tokenizer failures by error code.', failures),
        '# HELP emberfold_requests_in_flight API requests being processed.', '# TYPE emberfold_requests_in_flight gauge', `emberfold_requests_in_flight ${in_flight}`,
        '# HELP emberfold_ready Whether the service accepts new requests.', '# TYPE emberfold_ready gauge', `emberfold_ready ${ready ? 1 : 0}`
      ];
      return lines.join('\n') + '\n';
    }
  };
}
