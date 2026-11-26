import { Client } from 'pg';
import * as argon2 from 'argon2';

export async function bootstrapGenemaxTenant(connectionString?: string) {
  const dbUrl =
    connectionString ||
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://postgres:gsign_dev_password@127.0.0.1:5432/gsign_db';

  const adminEmail = (process.env.GENEMAX_INITIAL_ADMIN_EMAIL || 'genemaxit@gmail.com')
    .trim()
    .toLowerCase();
  const initialPassword = process.env.GENEMAX_INITIAL_ADMIN_PASSWORD;

  if (!initialPassword || initialPassword.length < 8) {
    throw new Error(
      'GENEMAX_INITIAL_ADMIN_PASSWORD environment variable (min 8 chars) is required to bootstrap Genemax IT Solutions.',
    );
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Create Genemax IT Solutions tenant only if it does not already exist
    const existingTenant = await client.query(
      `SELECT id, name, slug FROM tenants WHERE slug = 'genemax' LIMIT 1;`,
    );
    let tenantId: string;
    let tenantCreated = false;
    if (existingTenant.rows.length > 0) {
      tenantId = existingTenant.rows[0].id;
    } else {
      const insertedTenant = await client.query(
        `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
         VALUES ('Genemax IT Solutions', 'genemax', $1, '+91 99000 00001', 'Active')
         RETURNING id;`,
        [adminEmail],
      );
      tenantId = insertedTenant.rows[0].id;
      tenantCreated = true;
    }

    // 2. Create Company Admin user only if not already present (never reset existing password)
    const existingUser = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1;`,
      [adminEmail],
    );
    let userId: string;
    let userCreated = false;
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
    } else {
      const passwordHash = await argon2.hash(initialPassword, { type: argon2.argon2id });
      const insertedUser = await client.query(
        `INSERT INTO users (
           email, password_hash, full_name, is_super_admin, is_platform_owner,
           must_change_password, is_active, email_verified_at
         )
         VALUES ($1, $2, 'Genemax IT Admin', false, false, true, true, NOW())
         RETURNING id;`,
        [adminEmail, passwordHash],
      );
      userId = insertedUser.rows[0].id;
      userCreated = true;
    }

    // 3. Assign Company Admin role (never Platform Owner)
    const roleRes = await client.query(
      `SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1;`,
    );
    if (roleRes.rows.length === 0) {
      throw new Error("Required system role 'Company Admin' not found. Run seed first.");
    }
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
       VALUES ($1, $2, $3, 'Executive', 'Active')
       ON CONFLICT (tenant_id, user_id) DO NOTHING;`,
      [tenantId, userId, roleRes.rows[0].id],
    );

    // 4. Create PAYMENT_PENDING subscription if none exists (never grant free ACTIVE subscription)
    const planRes = await client.query(
      `SELECT id FROM subscription_plans WHERE slug = 'starter' LIMIT 1;`,
    );
    if (planRes.rows.length > 0) {
      await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status)
         VALUES ($1, $2, 'monthly', 'PAYMENT_PENDING')
         ON CONFLICT (tenant_id) DO NOTHING;`,
        [tenantId, planRes.rows[0].id],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason)
       VALUES ($1, $2, 'SYSTEM', 'GENEMAX_TENANT_BOOTSTRAP', 'tenant', $3, $4, $5);`,
      [
        userId,
        adminEmail,
        tenantId,
        tenantId,
        `Idempotent Genemax bootstrap (tenantCreated=${tenantCreated}, userCreated=${userCreated})`,
      ],
    );

    await client.query('COMMIT');
    console.log(
      `Genemax bootstrap completed (tenantCreated=${tenantCreated}, userCreated=${userCreated}, tenantId=${tenantId}).`,
    );
    return { tenantId, userId, tenantCreated, userCreated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  bootstrapGenemaxTenant()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Genemax bootstrap failed:', err instanceof Error ? err.message : 'Unknown error');
      process.exit(1);
    });
}
