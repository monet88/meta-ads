import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach } from "vitest";

import { migrations } from "./d1-migrations";

beforeAll(async () => {
  if (!env.AUDIT_DB) {
    return;
  }

  await applyD1Migrations(env.AUDIT_DB, migrations);
});

beforeEach(async () => {
  if (!env.AUDIT_DB) {
    return;
  }

  await env.AUDIT_DB.exec(`
    DELETE FROM action_logs;
    DELETE FROM campaign_states;
    DELETE FROM config_versions;
    DELETE FROM automation_runs;
  `);
});
