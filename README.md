# ZIAW Reporting & Governance

## Docker Environment Setup

### Prerequisites
- Docker & Docker Compose

### Getting Started

1. **Configure Environment**
   Copy the example environment file and adjust secrets if needed.
   ```bash
   cp .env.example .env
   ```

2. **Start Services**
   Run the database and adminer in detached mode.
   ```bash
   docker compose up -d
   ```
   Wait for the containers to be healthy. The Adminer service will wait for MySQL to be ready.

3. **Verify Status**
   Check that services are running and healthy.
   ```bash
   docker compose ps
   ```

4. **Access Database**
   - **Adminer UI**: [http://localhost:8081](http://localhost:8081)
     - System: MySQL
     - Server: `db`
     - Username: `ziaw_app` (from .env)
     - Password: `ziaw_app_password` (from .env)
     - Database: `ziaw`

   - **Direct Connection**: `localhost:3306`

5. **Stop Services**
   ```bash
   docker compose down
   ```
   To remove volumes (reset database):
   ```bash
   docker compose down -v
   ```

## Database Migrations (Flyway)

We use Flyway to manage database schema changes.

- **Check Status**:
  ```bash
  docker compose logs flyway
  ```
- **Add Migration**:
  Create a new SQL file in `sql/migrations` with naming convention `V{Version}__{Description}.sql`.
  Example: `V2__Add_risk_columns.sql`.
  Restart the stack:
  ```bash
  docker compose restart flyway
  ```
- **Validate State**:
  Check the `flyway_schema_history` table in Adminer or via CLI to see applied migrations.

