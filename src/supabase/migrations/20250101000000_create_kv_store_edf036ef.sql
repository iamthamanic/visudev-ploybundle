-- KV Store für Edge Functions (Projekte, AppFlow, Blueprint, Data, Logs, Integrations, etc.)
-- Entspricht kv_store_edf036ef aus src/supabase/functions/server/kv_store.tsx
-- Duplikat von supabase/migrations/… — CLI nutzt workdir src/

CREATE TABLE IF NOT EXISTS kv_store_edf036ef (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL
);

COMMENT ON TABLE kv_store_edf036ef IS 'Key-value store for VisuDEV Edge Functions (projects, appflow, blueprint, data, logs, integrations)';
