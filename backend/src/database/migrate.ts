import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export async function runMigrations(connectionString?: string) {
  const dbUrl =
    connectionString ||
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://postgres:gsign_dev_password@127.0.0.1:5432/gsign_db';
  console.log('Running GSIGN migrations on:', dbUrl.replace(/:[^:@]+@/, ':****@'));

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const schemaSqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaSqlPath, 'utf8');

    console.log('Applying database schema and RLS policies...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query('COMMIT');
    console.log('Schema migration applied successfully.');

    // Apply ordered, versioned migrations in backend/src/database/migrations/*.sql
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const appliedRes = await client.query(
          `SELECT 1 FROM schema_migrations WHERE version = $1 LIMIT 1`,
          [file],
        );
        if (appliedRes.rows.length > 0) {
          continue;
        }
        const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log(`Applying versioned migration: ${file}...`);
        await client.query('BEGIN');
        await client.query(migrationSql);
        await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
        await client.query('COMMIT');
      }
    }

    // Verification check of created tables
    const tableCheckQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    const tables = await client.query(tableCheckQuery);
    console.log('Verified Tables:', tables.rows.map(r => r.table_name).join(', '));

    // Verification check of RLS policies
    const rlsCheckQuery = `
      SELECT tablename, policyname, permissive, roles, cmd, qual 
      FROM pg_policies 
      WHERE schemaname = 'public';
    `;
    const policies = await client.query(rlsCheckQuery);
    console.log('Active RLS Policies:');
    policies.rows.forEach(p => console.log(` - [${p.tablename}] Policy: ${p.policyname}`));

    const forceRlsRes = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
      ORDER BY relname;
    `);
    console.log('FORCE RLS Verified Tables:', forceRlsRes.rows.filter(r => r.relforcerowsecurity).map(r => r.relname).join(', '));

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed successfully.');
      process.exit(0);
    })
    .catch(() => process.exit(1));
}
