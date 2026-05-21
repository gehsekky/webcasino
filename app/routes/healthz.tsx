import { json } from '@remix-run/node';
import { prisma } from 'db.server';

/**
 * Liveness + readiness probe. Returns 200 if the server is up AND the
 * DB responds to a trivial query within ~1s; 503 otherwise. Orchestrator
 * checks (k8s probes, Fly health checks, ALB targets) hit this.
 *
 * No auth, no CSRF — must be reachable before the user session is set
 * up. Doesn't leak anything an attacker doesn't already know (the box
 * is up if /anything works).
 *
 * Response body is JSON so logs / dashboards can show "what failed."
 */
export async function loader(): Promise<Response> {
  const startedAt = Date.now();
  try {
    // Lightest possible roundtrip — no table access, just confirms the
    // connection pool can serve a query.
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    return json(
      {
        status: 'unhealthy',
        db: 'down',
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
  return json({
    status: 'ok',
    db: 'up',
    latencyMs: Date.now() - startedAt,
  });
}
