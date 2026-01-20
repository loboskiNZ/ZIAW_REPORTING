# Architecture Decisions

## [ADR-001] Flyway for Migrations
- **Status**: Accepted
- **Context**: Need reliable, versioned schema management consistent with CI/CD.
- **Decision**: Use Flyway (Docker) running against MySQL.
- **Consequences**: No manual SQL execution allowed. All changes via `sql/migrations/V*__*.sql`.

## [ADR-002] DB-Backed Checklists
- **Status**: Accepted
- **Context**: Need transactional integrity for stage gates. Configuration files are too loose for audit.
- **Decision**: Store Definition and Status in SQL (`stage_checklist_definition`, `workspace_checklist_status`).

## [ADR-003] Snapshot Immutability
- **Status**: Accepted
- **Context**: Governance reports must be historical proof.
- **Decision**: `workspace_snapshot` is append-only. `metrics_json` stores the exact input factors used at time of computation.
## [ADR-004] Flyway Migration Discipline
- **Status**: Accepted
- **Context**: Flyway migrations were edited after application during early development, creating ambiguity about schema authority and reproducibility.
- **Decision**:
  - Once a Flyway migration version has been applied to any environment, it must not be edited.
  - All subsequent schema changes must be introduced as a new migration (V3, V4, …).
- **Consequences**:
  - Database wipes (`docker compose down -v`) are permitted only for local development resets.
  - Shared, staging, and production environments must never rely on edited or replayed migrations.

