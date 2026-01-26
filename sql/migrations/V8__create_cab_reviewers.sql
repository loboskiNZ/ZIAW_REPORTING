CREATE TABLE cab_reviewers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  reviewer_id VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_workspace_reviewer (workspace_id, reviewer_id),
  INDEX idx_workspace (workspace_id),
  CONSTRAINT fk_reviewer_workspace FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
