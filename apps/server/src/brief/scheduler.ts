import { PgBoss } from "pg-boss";

import { dueBriefs, runBrief, type BriefDeps } from "./service.js";

/** Checks for due briefs every 5 minutes, so a brief goes out within 5 minutes of its time. */
const TICK_CRON = "*/5 * * * *";
const TICK_QUEUE = "brief-tick";
const BRIEF_QUEUE = "brief";

export interface BriefScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Daily briefs on a Postgres-backed queue (pg-boss, in its own `pgboss` schema). A cron job
 * finds users whose brief is due and queues one `brief` job each, keyed by user and local date;
 * failed briefs retry with backoff. The `briefs` table, not the queue, guarantees one brief per
 * day.
 */
export function createBriefScheduler(deps: BriefDeps & { databaseUrl: string }): BriefScheduler {
  const { db, log } = deps;
  const boss = new PgBoss({ connectionString: deps.databaseUrl, schema: "pgboss" });
  boss.on("error", (err) => {
    log.error({ err }, "brief queue error");
  });

  return {
    async start() {
      await boss.start();
      await boss.createQueue(TICK_QUEUE, { policy: "exclusive", expireInSeconds: 120 });
      await boss.createQueue(BRIEF_QUEUE, {
        policy: "exclusive",
        retryLimit: 4,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: 300,
      });
      await boss.schedule(TICK_QUEUE, TICK_CRON);

      await boss.work(TICK_QUEUE, async () => {
        for (const due of await dueBriefs(db)) {
          await boss.send(BRIEF_QUEUE, due, { singletonKey: `${due.userId}:${due.localDate}` });
        }
      });
      await boss.work<{ userId: string; localDate: string }>(BRIEF_QUEUE, async (jobs) => {
        for (const job of jobs) {
          const { userId, localDate } = job.data;
          const outcome = await runBrief(deps, userId, { kind: "daily", localDate });
          log.info(
            {
              userId,
              localDate,
              status: outcome.status,
              episodes: outcome.episodes,
              push: outcome.push,
            },
            "morning brief",
          );
        }
      });
      log.info("morning brief scheduler started");
    },

    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
