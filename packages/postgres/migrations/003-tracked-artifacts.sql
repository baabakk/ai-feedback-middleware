-- llm-feedback-middleware v2.1: tracked_artifacts
--
-- Mutable lifecycle row. Owns `status`, lease metadata, and terminal
-- transition info. Read by the Lifecycle Worker. See spec §9.2 and §11.

CREATE TABLE IF NOT EXISTS tracked_artifacts (
  artifact_id                 TEXT PRIMARY KEY REFERENCES captured_artifacts(artifact_id) ON DELETE CASCADE,
  artifact_type               TEXT NOT NULL,
  artifact_version            INTEGER NOT NULL,
  partition_key               TEXT NOT NULL,
  producer                    TEXT NOT NULL,
  task_type                   TEXT NOT NULL,

  status                      TEXT NOT NULL CHECK (status IN (
    'waiting', 'reacted', 'silently_accepted',
    'silently_rejected_expired', 'cancelled', 'superseded'
  )),
  expires_at                  TIMESTAMPTZ NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  terminal_status_at          TIMESTAMPTZ,
  terminal_reaction_event_id  TEXT REFERENCES captured_evaluated_reactions(event_id) ON DELETE SET NULL,

  last_checked_at             TIMESTAMPTZ,
  lease_owner                 TEXT,
  lease_until                 TIMESTAMPTZ
);

-- Hot path: Lifecycle Worker scans waiting rows whose deadline has passed.
CREATE INDEX IF NOT EXISTS idx_tracked_artifacts_due
  ON tracked_artifacts(status, expires_at)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_tracked_artifacts_type
  ON tracked_artifacts(artifact_type, status);
