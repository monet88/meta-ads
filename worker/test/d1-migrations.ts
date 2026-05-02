export const migrations = [
  {
    name: "0001_audit_schema.sql",
    queries: [
      `CREATE TABLE IF NOT EXISTS config_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        configJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        createdBy TEXT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_config_versions_version
        ON config_versions(version)`,
      `CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        failedAt TEXT,
        summaryJson TEXT,
        errorJson TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_automation_runs_status_started_at
        ON automation_runs(status, startedAt DESC)`,
      `CREATE TABLE IF NOT EXISTS campaign_states (
        campaignId TEXT PRIMARY KEY,
        lastDecision TEXT,
        lastAction TEXT,
        lastActionAt TEXT,
        lastRunId TEXT,
        pausedByTool INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_campaign_states_last_run_id
        ON campaign_states(lastRunId)`,
      `CREATE TABLE IF NOT EXISTS action_logs (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        campaignId TEXT,
        decision TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        occurredAt TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        FOREIGN KEY (runId) REFERENCES automation_runs(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_action_logs_run_id_occurred_at
        ON action_logs(runId, occurredAt DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_action_logs_campaign_id_occurred_at
        ON action_logs(campaignId, occurredAt DESC)`,
    ],
  },
];
