import client from 'prom-client';
import { env } from './config';

client.collectDefaultMetrics({ prefix: `${env.METRICS_PREFIX}_` });

export const refreshSuccessCounter = new client.Counter({
  name: `${env.METRICS_PREFIX}_refresh_success_total`,
  help: 'Successful refresh attempts'
});

export const refreshFailureCounter = new client.Counter({
  name: `${env.METRICS_PREFIX}_refresh_failure_total`,
  help: 'Failed refresh attempts'
});

export const refreshDurationHistogram = new client.Histogram({
  name: `${env.METRICS_PREFIX}_refresh_duration_ms`,
  help: 'Refresh duration in milliseconds',
  buckets: [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
});

export const connectedUsersGauge = new client.Gauge({
  name: `${env.METRICS_PREFIX}_connected_users`,
  help: 'Number of active connected users'
});

export const refreshRunningGauge = new client.Gauge({
  name: `${env.METRICS_PREFIX}_refresh_running`,
  help: 'Whether a refresh cycle is running'
});

export async function metricsText(): Promise<string> {
  return client.register.metrics();
}
