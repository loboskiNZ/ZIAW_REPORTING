-- 1) Add governance columns to workspace
ALTER TABLE workspace
  ADD COLUMN pipeline_stage ENUM(
    'INTAKE','DISCOVERY','DESIGN','PLANNING','BUILD','VERIFY_CAB','RELEASE','CLOSED'
  ) NOT NULL DEFAULT 'INTAKE',
  ADD COLUMN cab_readiness_status ENUM(
    'NOT_READY','PENDING_REVIEW','APPROVED','REJECTED'
  ) NOT NULL DEFAULT 'NOT_READY';

CREATE INDEX idx_workspace_stage ON workspace(pipeline_stage);
CREATE INDEX idx_workspace_cab_status ON workspace(cab_readiness_status);

-- 2) Create stage_checklist_definition (rules)
CREATE TABLE stage_checklist_definition (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  pipeline_stage ENUM(
    'INTAKE','DISCOVERY','DESIGN','PLANNING','BUILD','VERIFY_CAB','RELEASE','CLOSED'
  ) NOT NULL,
  rule_key VARCHAR(96) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  ownership_type ENUM('AUTO','HUMAN','AGENT_SUGGESTED') NOT NULL DEFAULT 'AUTO',
  rule_kind ENUM(
    'HAS_ARTIFACT',
    'HAS_RELATION',
    'HAS_ATTACHMENT_KIND',
    'MANUAL_CONFIRM',
    'JIRA_CONDITION'
  ) NOT NULL,
  rule_spec_json JSON NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 100,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stage_rulekey (pipeline_stage, rule_key),
  KEY idx_stage_active (pipeline_stage, is_active),
  KEY idx_stage_order (pipeline_stage, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Create workspace_checklist_status (per workspace state)
CREATE TABLE workspace_checklist_status (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  workspace_id BIGINT NOT NULL,
  checklist_definition_id BIGINT NOT NULL,
  status ENUM(
    'NOT_EVALUATED',
    'PASS',
    'FAIL',
    'WAIVED',
    'PENDING_REVIEW'
  ) NOT NULL DEFAULT 'NOT_EVALUATED',
  last_evaluated_at DATETIME NULL,
  evaluation_detail_json JSON NULL,
  confirmed_by_actor_type ENUM('HUMAN','SYSTEM') NULL,
  confirmed_by_actor_id BIGINT NULL,
  confirmed_at DATETIME NULL,
  confirmation_note TEXT NULL,
  evidence_refs_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wcs_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspace(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_wcs_definition
    FOREIGN KEY (checklist_definition_id) REFERENCES stage_checklist_definition(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_workspace_definition (workspace_id, checklist_definition_id),
  KEY idx_wcs_workspace (workspace_id),
  KEY idx_wcs_status (workspace_id, status),
  KEY idx_wcs_updated (workspace_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Create workspace_snapshot (immutable metrics)
CREATE TABLE workspace_snapshot (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  workspace_id BIGINT NOT NULL,
  pipeline_stage ENUM(
    'INTAKE','DISCOVERY','DESIGN','PLANNING','BUILD','VERIFY_CAB','RELEASE','CLOSED'
  ) NOT NULL,
  progress_score INT NOT NULL,
  risk_score INT NOT NULL,
  readiness_score INT NOT NULL,
  confidence_score INT NOT NULL,
  open_findings_count INT NOT NULL DEFAULT 0,
  critical_findings_count INT NOT NULL DEFAULT 0,
  open_risks_count INT NOT NULL DEFAULT 0,
  accepted_risks_count INT NOT NULL DEFAULT 0,
  missing_checklist_count INT NOT NULL DEFAULT 0,
  jira_total_count INT NOT NULL DEFAULT 0,
  jira_done_count INT NOT NULL DEFAULT 0,
  metrics_json JSON NULL,
  snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ws_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspace(id)
    ON DELETE CASCADE,
  KEY idx_snapshot_workspace_time (workspace_id, snapshot_at),
  KEY idx_snapshot_stage_time (workspace_id, pipeline_stage, snapshot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) Create stage_transition_log (all attempts)
CREATE TABLE stage_transition_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  workspace_id BIGINT NOT NULL,
  from_stage ENUM(
    'INTAKE','DISCOVERY','DESIGN','PLANNING','BUILD','VERIFY_CAB','RELEASE','CLOSED'
  ) NOT NULL,
  to_stage ENUM(
    'INTAKE','DISCOVERY','DESIGN','PLANNING','BUILD','VERIFY_CAB','RELEASE','CLOSED'
  ) NOT NULL,
  actor_type ENUM('HUMAN','SYSTEM') NOT NULL,
  actor_id BIGINT NULL,
  decision ENUM('APPROVED','REJECTED','FAILED_PRECONDITION') NOT NULL,
  rationale TEXT NOT NULL,
  snapshot_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stl_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspace(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_stl_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES workspace_snapshot(id)
    ON DELETE SET NULL,
  KEY idx_stl_workspace_time (workspace_id, created_at),
  KEY idx_stl_workspace_decision (workspace_id, decision, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
