import { Client } from 'pg';
import * as argon2 from 'argon2';

export async function runSeeds(connectionString?: string) {
  const dbUrl = connectionString || process.env.DATABASE_URL || 'postgres://postgres:gsign_dev_password@127.0.0.1:5432/gsign_db';
  console.log('Seeding GSIGN database...');

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

    // 3. Seed Global Super Admin
    const superAdminPasswordHash = await argon2.hash('SuperAdmin@GSign2026!');
    const superAdminRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_active, email_verified_at)
       VALUES ($1, $2, $3, $4, true, true, NOW())
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_super_admin = true
       RETURNING id;`,
      ['superadmin@genemax.in', superAdminPasswordHash, 'Sunil G (Super Admin)', '+91 99000 11223']
    );
    const superAdminId = superAdminRes.rows[0].id;
    console.log('Seeded Super Admin:', 'superadmin@genemax.in', `(${superAdminId})`);

    // 4. Seed Primary Tenant (GSIGN Pvt Ltd)
    const tenant1Res = await client.query(
      `INSERT INTO tenants (name, slug, cin, gstin, contact_email, contact_phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'Active')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id;`,
      ['GSIGN Pvt Ltd', 'gsign', 'U72200KA2026PTC099881', '29AABCG1234F1Z5', 'admin@gsign.in', '+91 98765 43210']
    );
    const tenant1Id = tenant1Res.rows[0].id;

    // 5. Seed Secondary Tenant (Acme Corp for isolation tests)
    const tenant2Res = await client.query(
      `INSERT INTO tenants (name, slug, cin, gstin, contact_email, contact_phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'Active')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id;`,
      ['Acme Corporation', 'acme', 'U72200MH2026PTC100222', '27AABCA5678G2Z1', 'admin@acme.com', '+91 91234 56789']
    );
    const tenant2Id = tenant2Res.rows[0].id;
    console.log(`Seeded Tenants: [GSIGN: ${tenant1Id}] and [Acme: ${tenant2Id}]`);

    // 6. Seed Tenant Admin Users
    const defaultPasswordHash = await argon2.hash('Password123!');

    // Priya N for GSIGN
    const user1Res = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_active, email_verified_at)
       VALUES ($1, $2, $3, $4, false, true, NOW())
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['priya@gsign.in', defaultPasswordHash, 'Priya N (HR Admin)', '+91 98765 44821']
    );
    const user1Id = user1Res.rows[0].id;

    // John Doe for Acme
    const user2Res = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, is_super_admin, is_active, email_verified_at)
       VALUES ($1, $2, $3, $4, false, true, NOW())
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['john@acme.com', defaultPasswordHash, 'John Doe (Admin)', '+91 91234 00001']
    );
    const user2Id = user2Res.rows[0].id;

    // 7. Seed Tenant Memberships (Bypassing RLS during administrative seed)
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

    await client.query('COMMIT');
    console.log('Seeding completed successfully!');
    return {
      superAdminId,
      tenant1Id,
      tenant2Id,
      user1Id,
      user2Id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
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
