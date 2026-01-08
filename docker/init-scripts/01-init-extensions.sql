-- Initialize TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create schemas for Kyomei
CREATE SCHEMA IF NOT EXISTS kyomei_sync;
CREATE SCHEMA IF NOT EXISTS kyomei_app;
CREATE SCHEMA IF NOT EXISTS kyomei_crons;

-- Grant permissions
GRANT ALL ON SCHEMA kyomei_sync TO CURRENT_USER;
GRANT ALL ON SCHEMA kyomei_app TO CURRENT_USER;
GRANT ALL ON SCHEMA kyomei_crons TO CURRENT_USER;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Kyomei database initialized successfully with TimescaleDB';
END $$;
