import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export async function runMigrations(connectionString?: string) {
  const dbUrl = connectionString || process.env.DATABASE_URL || 'postgres://postgres:gsign_dev_password@127.0.0.1:5432/gsign_db';
  console.log('Running GSIGN migrations on:', dbUrl.replace(/:[^:@]+@/, ':****@'));

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const schemaSqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaSqlPath, 'utf8');

    console.log('Applying database schema and RLS policies...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Schema migration applied successfully.');

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
