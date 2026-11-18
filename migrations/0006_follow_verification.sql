ALTER TABLE actions ADD COLUMN flow_node_id TEXT;
CREATE INDEX actions_flow_node ON actions(run_id,flow_node_id);
