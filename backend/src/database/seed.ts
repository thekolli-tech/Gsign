import { Client } from 'pg';
import * as argon2 from 'argon2';

export async function runSeeds(connectionString?: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  const dbUrl = isProduction
    ? connectionString || process.env.DATABASE_URL
    : connectionString || process.env.DATABASE_URL || 'postgres://postgres:gsign_dev_password@127.0.0.1:5432/gsign_db';

  if (!dbUrl) {
    throw new Error('DATABASE_URL is required when NODE_ENV=production.');
  }

  console.log(`Seeding GSIGN database (mode: ${isProduction ? 'production' : 'development'})...`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Seed Permissions
    const permissions = [
      { code: 'agreement:create', category: 'Agreements', description: 'Create new agreement drafts' },
      { code: 'agreement:read', category: 'Agreements', description: 'View agreement details and audit log' },
      { code: 'agreement:update', category: 'Agreements', description: 'Edit agreement details' },
      { code: 'agreement:delete', category: 'Agreements', description: 'Cancel or delete agreements' },
      { code: 'agreement:sign', category: 'Agreements', description: 'Sign or witness agreements' },
      { code: 'template:create', category: 'Templates', description: 'Create agreement templates' },
      { code: 'template:read', category: 'Templates', description: 'View agreement templates' },
      { code: 'template:update', category: 'Templates', description: 'Edit agreement template fields' },
      { code: 'template:publish', category: 'Templates', description: 'Publish template versions' },
      { code: 'receipt:issue', category: 'Receipts', description: 'Acknowledge payment and issue receipts' },
      { code: 'receipt:read', category: 'Receipts', description: 'View issued receipts' },
      { code: 'team:invite', category: 'Team', description: 'Invite new team members' },
      { code: 'team:manage', category: 'Team', description: 'Assign roles and deactivate members' },
      { code: 'branding:read', category: 'Branding', description: 'View branding and custom domain configs' },
      { code: 'branding:update', category: 'Branding', description: 'Update logo, colors and custom domain' },
      { code: 'tenant:manage', category: 'Tenants', description: 'Manage tenant settings and subscriptions' },
    ];

    const permMap = new Map<string, string>();
    for (const p of permissions) {
      const res = await client.query(
        `INSERT INTO permissions (code, category, description) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description 
         RETURNING id;`,
        [p.code, p.category, p.description]
      );
      permMap.set(p.code, res.rows[0].id);
    }
    console.log(`Seeded ${permissions.length} permissions.`);

    // 2. Seed System Global Roles
    const roles = [
      { name: 'PLATFORM_OWNER', description: 'Platform Owner with full unrestricted access to platform administration', perms: Array.from(permMap.keys()) },
      { name: 'Company Admin', description: 'Full administrative access to company tenant', perms: Array.from(permMap.keys()) },
      { name: 'Legal Reviewer', description: 'Template and agreement legal compliance reviewer', perms: ['agreement:read', 'agreement:update', 'template:create', 'template:read', 'template:update', 'template:publish'] },
      { name: 'HR Manager', description: 'Human resources agreement dispatcher and team recruiter', perms: ['agreement:create', 'agreement:read', 'receipt:read', 'team:invite', 'team:manage'] },
      { name: 'Sales Executive', description: 'Commercial customer agreement creator', perms: ['agreement:create', 'agreement:read'] },
      { name: 'Signatory', description: 'External or internal recipient with signing rights', perms: ['agreement:read', 'agreement:sign'] },
    ];

    const roleMap = new Map<string, string>();
    for (const r of roles) {
      const res = await client.query(
        `INSERT INTO roles (name, description, is_system_role) 
         VALUES ($1, $2, true) 
         ON CONFLICT DO NOTHING 
         RETURNING id;`,
        [r.name, r.description]
      );
      let roleId = res.rows[0]?.id;
      if (!roleId) {
        const existing = await client.query('SELECT id FROM roles WHERE name = $1 AND is_system_role = true', [r.name]);
        roleId = existing.rows[0].id;
      }
      roleMap.set(r.name, roleId);

      // Link permissions
      for (const pCode of r.perms) {
        const permId = permMap.get(pCode);
        if (permId) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id) 
             VALUES ($1, $2) 
             ON CONFLICT DO NOTHING;`,
            [roleId, permId]
          );
        }
      }
    }
    console.log(`Seeded ${roles.length} system roles with permissions.`);

    // 3. Bootstrap Platform Owner (Genemax IT Solution)
    const ownerEmail = isProduction
      ? process.env.GSIGN_OWNER_EMAIL
      : process.env.GSIGN_OWNER_EMAIL || 'genemaxitsolution@gmail.com';
    const ownerPassword = isProduction
      ? process.env.GSIGN_OWNER_INITIAL_PASSWORD
      : process.env.GSIGN_OWNER_INITIAL_PASSWORD || 'gsign#2k26';

    if (!ownerEmail) {
      throw new Error('GSIGN_OWNER_EMAIL is required when NODE_ENV=production.');
    }

    const existingOwner = await client.query('SELECT id, password_hash, must_change_password FROM users WHERE email = $1', [ownerEmail]);
    let ownerId: string;
    if (existingOwner.rows.length === 0) {
      if (!ownerPassword) {
        throw new Error('GSIGN_OWNER_INITIAL_PASSWORD is required to bootstrap the initial Platform Owner when NODE_ENV=production.');
      }
      const ownerPasswordHash = await argon2.hash(ownerPassword);
      const ownerRes = await client.query(
        `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_platform_owner, must_change_password, is_active, email_verified_at)
         VALUES ($1, $2, 'Genemax Platform Owner', '+91 99000 00000', true, true, true, true, NOW())
         RETURNING id;`,
        [ownerEmail, ownerPasswordHash]
      );
      ownerId = ownerRes.rows[0].id;
      console.log('Bootstrapped Platform Owner:', ownerEmail, `(${ownerId})`);

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, reason, metadata)
         VALUES ($1, $2, 'PLATFORM_OWNER', 'OWNER_BOOTSTRAP', 'USER', $3, 'Initial secure platform owner provisioning', '{"provider":"bootstrap"}');`,
        [ownerId, ownerEmail, ownerId]
      );
    } else {
      ownerId = existingOwner.rows[0].id;
      // Ensure platform owner flags are set, but preserve existing password and must_change_password state
      await client.query(
        `UPDATE users SET is_super_admin = true, is_platform_owner = true WHERE id = $1;`,
        [ownerId]
      );
      console.log('Platform Owner already exists. Preserving password and security state for:', ownerEmail);
    }

    // 3.2 Seed Paid Subscription Plans (NO FREE TRIAL)
    const plans = [
      {
        name: 'Starter Plan',
        slug: 'starter',
        description: '25 documents/month; 2 users; standard templates',
        monthly_price: 499.00,
        annual_price: 4990.00,
        max_agreements: 25,
        max_users: 2,
        features: JSON.stringify([
          '25 documents/month',
          '2 users',
          'Standard templates',
          'Email OTP verification & audit trail',
        ]),
      },
      {
        name: 'Business Plan',
        slug: 'business',
        description: '100 documents/month; 5 users; custom branding and templates',
        monthly_price: 1499.00,
        annual_price: 14990.00,
        max_agreements: 100,
        max_users: 5,
        features: JSON.stringify([
          '100 documents/month',
          '5 users',
          'Custom branding and templates',
          'Email OTP verification & audit trail',
        ]),
      },
      {
        name: 'Professional Plan',
        slug: 'professional',
        description: '300 documents/month; 15 users; advanced workflows and reports',
        monthly_price: 2999.00,
        annual_price: 29990.00,
        max_agreements: 300,
        max_users: 15,
        features: JSON.stringify([
          '300 documents/month',
          '15 users',
          'Advanced workflows and reports',
          'Email OTP verification & audit trail',
        ]),
      },
      {
        name: 'Enterprise Plan',
        slug: 'enterprise',
        description: 'Higher volume, custom domain, advanced branding, integrations and support',
        monthly_price: 0.00,
        annual_price: 0.00,
        max_agreements: -1,
        max_users: -1,
        features: JSON.stringify([
          'Custom document volume',
          'Unlimited team members',
          'Custom domain & advanced branding',
          'Dedicated integrations and priority support',
        ]),
      },
    ];

    await client.query(`UPDATE subscription_plans SET is_active = false WHERE slug = 'growth'`);

    const planMap = new Map<string, string>();
    for (const p of plans) {
      const res = await client.query(
        `INSERT INTO subscription_plans (name, slug, description, monthly_price, annual_price, max_agreements_per_month, max_users, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET 
           monthly_price = EXCLUDED.monthly_price,
           annual_price = EXCLUDED.annual_price,
           max_agreements_per_month = EXCLUDED.max_agreements_per_month,
           max_users = EXCLUDED.max_users,
           features = EXCLUDED.features
         RETURNING id;`,
        [p.name, p.slug, p.description, p.monthly_price, p.annual_price, p.max_agreements, p.max_users, p.features]
      );
      planMap.set(p.slug, res.rows[0].id);
    }
    console.log('Seeded 3 paid subscription plans (Starter, Growth, Enterprise).');

    // 3.5 Provision Default Genemax Tenant & Company Admin
    const genemaxEmail =
      process.env.GENEMAX_TENANT_ADMIN_EMAIL || 'genemaxit@gmail.com';
    const genemaxPassword =
      process.env.GENEMAX_TENANT_ADMIN_PASSWORD || 'Gmax@2026';

    const genemaxTenantRes = await client.query(
      `INSERT INTO tenants (name, slug, cin, gstin, contact_email, contact_phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'Active')
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         contact_email = EXCLUDED.contact_email,
         status = 'Active',
         updated_at = NOW()
       RETURNING id;`,
      [
        'Genemax IT Solution',
        'genemax',
        'U72900KA2020PTC135001',
        '29AABCG1234F1Z5',
        genemaxEmail,
        '+91 99000 00001',
      ],
    );
    const genemaxTenantId = genemaxTenantRes.rows[0].id;

    const genemaxPasswordHash = await argon2.hash(genemaxPassword);
    const genemaxUserRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_platform_owner, must_change_password, is_active, email_verified_at)
       VALUES ($1, $2, 'Genemax IT Admin', '+91 99000 00001', false, false, false, true, NOW())
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         is_active = true,
         email_verified_at = COALESCE(users.email_verified_at, NOW())
       RETURNING id;`,
      [genemaxEmail, genemaxPasswordHash],
    );
    const genemaxUserId = genemaxUserRes.rows[0].id;

    const companyAdminRoleRes = await client.query(
      `SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1;`,
    );
    if (companyAdminRoleRes.rows[0]) {
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1, $2, $3, 'Executive', 'Active')
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'Active';`,
        [genemaxTenantId, genemaxUserId, companyAdminRoleRes.rows[0].id],
      );
    }

    const defaultEnterprisePlanId = planMap.get('enterprise');
    if (defaultEnterprisePlanId) {
      await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'annual', 'ACTIVE', NOW(), NOW() + INTERVAL '1 year')
         ON CONFLICT (tenant_id) DO UPDATE SET status = 'ACTIVE', plan_id = EXCLUDED.plan_id;`,
        [genemaxTenantId, defaultEnterprisePlanId],
      );
    }
    console.log('Seeded Default Genemax Tenant & Admin:', genemaxEmail);

    let superAdminId: string | null = null;
    let tenant1Id: string | null = null;
    let tenant2Id: string | null = null;
    let user1Id: string | null = null;
    let user2Id: string | null = null;

    if (!isProduction) {
      // 4. Development Only: Seed Global Super Admin
      const superAdminPasswordHash = await argon2.hash('SuperAdmin@GSign2026!');
      const superAdminRes = await client.query(
        `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_active, email_verified_at)
         VALUES ($1, $2, $3, $4, true, true, NOW())
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_super_admin = true
         RETURNING id;`,
        ['superadmin@genemax.in', superAdminPasswordHash, 'Sunil G (Super Admin)', '+91 99000 11223']
      );
      superAdminId = superAdminRes.rows[0].id;
      console.log('Seeded Dev Super Admin:', 'superadmin@genemax.in', `(${superAdminId})`);

      // 5. Development Only: Seed Primary & Secondary Demo Tenants
      const tenant1Res = await client.query(
        `INSERT INTO tenants (name, slug, cin, gstin, contact_email, contact_phone, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Active')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id;`,
        ['GSIGN Pvt Ltd', 'gsign', 'U72200KA2026PTC099881', '29AABCG1234F1Z5', 'admin@gsign.in', '+91 98765 43210']
      );
      tenant1Id = tenant1Res.rows[0].id;

      const tenant2Res = await client.query(
        `INSERT INTO tenants (name, slug, cin, gstin, contact_email, contact_phone, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Active')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id;`,
        ['Acme Corporation', 'acme', 'U72200MH2026PTC100222', '27AABCA5678G2Z1', 'admin@acme.com', '+91 91234 56789']
      );
      tenant2Id = tenant2Res.rows[0].id;
      console.log(`Seeded Dev Tenants: [GSIGN: ${tenant1Id}] and [Acme: ${tenant2Id}]`);

      // 6. Development Only: Seed Demo Tenant Admin Users
      const defaultPasswordHash = await argon2.hash('Password123!');

      const user1Res = await client.query(
        `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_active, email_verified_at)
         VALUES ($1, $2, $3, $4, false, true, NOW())
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id;`,
        ['priya@gsign.in', defaultPasswordHash, 'Priya N (HR Admin)', '+91 98765 44821']
      );
      user1Id = user1Res.rows[0].id;

      const user2Res = await client.query(
        `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_active, email_verified_at)
         VALUES ($1, $2, $3, $4, false, true, NOW())
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id;`,
        ['john@acme.com', defaultPasswordHash, 'John Doe (Admin)', '+91 91234 00001']
      );
      user2Id = user2Res.rows[0].id;

      // 7. Development Only: Seed Demo Tenant Memberships (Bypassing RLS during administrative seed)
      await client.query("SET LOCAL app.is_super_admin = 'true';");

      const companyAdminRoleId = roleMap.get('Company Admin')!;
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1, $2, $3, 'HR', 'Active')
         ON CONFLICT (tenant_id, user_id) DO NOTHING;`,
        [tenant1Id, user1Id, companyAdminRoleId]
      );

      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1, $2, $3, 'Executive', 'Active')
         ON CONFLICT (tenant_id, user_id) DO NOTHING;`,
        [tenant2Id, user2Id, companyAdminRoleId]
      );

      // 8. Development Only: Seed Demo Tenant Subscriptions
      const enterprisePlanId = planMap.get('enterprise')!;
      const businessPlanId = planMap.get('business')!;

      await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'annual', 'ACTIVE', NOW(), NOW() + INTERVAL '1 year')
         ON CONFLICT (tenant_id) DO UPDATE SET status = 'ACTIVE';`,
        [tenant1Id, enterprisePlanId]
      );

      await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'monthly', 'ACTIVE', NOW(), NOW() + INTERVAL '1 month')
         ON CONFLICT (tenant_id) DO UPDATE SET status = 'ACTIVE';`,
        [tenant2Id, businessPlanId]
      );
    } else {
      console.log('Production mode: skipped demo Super Admin, demo tenants, demo users, and demo subscriptions.');
    }

    await client.query('COMMIT');
    console.log('Seeding completed successfully!');
    return {
      ownerId,
      superAdminId,
      tenant1Id,
      tenant2Id,
      user1Id,
      user2Id,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback error if transaction was not started
    }
    console.error('Seeding failed:', err instanceof Error ? err.message : 'Unknown error');
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runSeeds()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
