# Current Architecture State

## System Overview
- **Project**: ZIAW Reporting & Governance
- **Stage**: Phase 1 (Foundation)

## Components
- **Database**: MySQL 8 (Dockerized)
- **Migration Tool**: Flyway (Dockerized)
- **API**: Node.js/Express (Port 8080)
- **Management UI**: Adminer (Port 8081)

## Schema State
- Flyway: integrated and running
- Applied migrations:
  - V1: ziaw governance reporting (applied successfully)
  - V2: seed stage checklists (applied successfully)
- Pending migrations: None

## Codebase
- **Language**: Node.js
- **Key Modules**: SnaphotEngine, ChecklistEvaluator

## Runtime State
- Docker containers: db/adminer/flyway healthy
- API: Node/Express running on http://localhost:8080
- Seed script: seed_data.js runs and creates Workspace 1 + sample artifacts
- Snapshot endpoint: exists but currently has an export/name mismatch to fix
