# Kyomei Docker Development Environment

This directory contains Docker Compose configuration for running Kyomei's development stack.

## Services

### TimescaleDB (PostgreSQL + TimescaleDB)
- **Image:** `timescale/timescaledb:latest-pg16`
- **Port:** `5432`
- **User/Pass:** `kyomei/kyomei`
- **Database:** `kyomei`

**Performance Tuning (v2.0):**
- `max_connections=200` - Supports 100 connection pool + buffer
- `shared_buffers=256MB` - Memory allocated for data caching
- `work_mem=4MB` - Memory per operation
- `max_parallel_workers=8` - Parallel query execution
- Optimized for SSD storage and high concurrency

### LocalStack (S3-compatible storage)
- **Image:** `localstack/localstack:latest`
- **Port:** `4566`
- **Service:** S3 only
- **Credentials:** `test/test`
- **Region:** `us-east-1`

### eRPC (RPC Proxy)
- **Image:** `ghcr.io/erpc/erpc:latest`
- **Ports:** `4000` (HTTP), `4001` (Metrics)
- **Config:** `./erpc.yaml`

## Quick Start

### 1. Start Services

```bash
cd docker
docker-compose up -d
```

### 2. Check Status

```bash
docker-compose ps
docker-compose logs -f timescaledb
```

### 3. Connect to Database

```bash
# From host
psql postgresql://kyomei:kyomei@localhost:5432/kyomei

# From container
docker exec -it kyomei-timescaledb psql -U kyomei -d kyomei
```

### 4. Stop Services

```bash
docker-compose down
# To remove volumes (WARNING: deletes all data)
docker-compose down -v
```

## Database Initialization

On first startup, the following happens automatically:

1. **TimescaleDB Extension:** Installed via `init-scripts/01-init-extensions.sql`
2. **Schemas Created:**
   - `kyomei_sync` - Raw blockchain events
   - `kyomei_app` - Application data (versioned)
   - `kyomei_crons` - Cron job data (versioned)

## PostgreSQL Configuration

The docker-compose configuration includes optimized PostgreSQL settings for Kyomei v2.0:

### Connection Management
- **200 max connections** - Supports:
  - 100 connection pool (4 workers + 50 handlers + buffer)
  - Additional overhead for migrations, monitoring, etc.

### Memory Settings
- **256MB shared_buffers** - Data cache in memory
- **1GB effective_cache_size** - Estimated OS file cache
- **64MB maintenance_work_mem** - For VACUUM, CREATE INDEX
- **4MB work_mem** - Per-query operation memory

### Parallelism
- **8 max_parallel_workers** - Total parallel worker processes
- **4 max_parallel_workers_per_gather** - Workers per query
- **8 max_worker_processes** - Background workers (includes parallel)

### Write-Ahead Log (WAL)
- **16MB wal_buffers** - WAL buffer size
- **1GB-4GB wal_size** - Reduces checkpoint frequency for high-write workloads

### Storage Optimization
- **random_page_cost=1.1** - Assumes SSD storage (default is 4.0 for HDD)
- **effective_io_concurrency=200** - Concurrent I/O operations for SSDs

## Environment Variables

Default environment variables are set in docker-compose.yml. Override them by creating a `.env` file:

```env
# Database
POSTGRES_USER=kyomei
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=kyomei

# AWS/LocalStack
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
DEFAULT_REGION=us-east-1
```

## Resource Limits

Current limits are set for development:

- **CPU:** 2-4 cores
- **Memory:** 1-2GB

For production, adjust in docker-compose.yml under `deploy.resources`.

## Troubleshooting

### Too Many Connections Error

If you see "too many clients already", the application is exceeding PostgreSQL's `max_connections=200`.

**Solutions:**
1. Reduce `connectionPoolSize` in your Kyomei config
2. Reduce `parallelWorkers` or `processorConcurrency`
3. Increase `max_connections` in docker-compose.yml

### Out of Memory

If PostgreSQL runs out of memory:

1. Reduce `shared_buffers` in docker-compose.yml
2. Increase Docker memory limit in `deploy.resources`
3. Reduce parallel workers in Kyomei config

### Slow Query Performance

1. Check if TimescaleDB extension is enabled:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'timescaledb';
   ```

2. Verify hypertables are created:
   ```sql
   SELECT * FROM timescaledb_information.hypertables;
   ```

3. Check connection count:
   ```sql
   SELECT count(*) FROM pg_stat_activity;
   ```

### Connection Pool Monitoring

Monitor active connections:

```sql
SELECT
  datname,
  count(*) as connections,
  max_conn,
  round(100.0 * count(*) / max_conn, 2) as pct_used
FROM pg_stat_activity
JOIN (SELECT setting::int as max_conn FROM pg_settings WHERE name='max_connections') mc ON true
GROUP BY datname, max_conn;
```

## Production Considerations

For production deployments:

1. **Security:**
   - Use strong passwords (not `kyomei/kyomei`)
   - Restrict port exposure
   - Use SSL/TLS connections
   - Enable PostgreSQL authentication logging

2. **Performance:**
   - Increase `max_connections` based on load (formula: workers + concurrency + 40)
   - Tune memory settings based on available RAM
   - Monitor connection pool usage
   - Enable query logging for slow queries

3. **Persistence:**
   - Use named volumes (already configured)
   - Regular backups (use Kyomei's backup command)
   - Consider external volume mounts for production data

4. **Monitoring:**
   - Enable PostgreSQL metrics export
   - Monitor connection pool saturation
   - Track query performance
   - Monitor disk I/O and WAL growth

## Version Compatibility

- **PostgreSQL:** 16.x
- **TimescaleDB:** Latest (2.x)
- **Kyomei:** 2.0+

## Additional Resources

- [PostgreSQL Tuning](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server)
- [TimescaleDB Best Practices](https://docs.timescale.com/use-timescale/latest/configuration/)
- [Connection Pooling](https://www.postgresql.org/docs/current/runtime-config-connection.html)
