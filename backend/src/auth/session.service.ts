import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { CryptoService } from './crypto.service';

export interface ActiveSession {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  isPlatformOwner: boolean;
  mustChangePassword: boolean;
  tenantId: string | null;
  role: string | null;
  permissions: string[];
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly maxAgeSeconds: number;
  private readonly idleTimeoutSeconds: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService
  ) {
    this.maxAgeSeconds = Number(this.config.get<number>('SESSION_MAX_AGE_SECONDS', 86400)); // 24 hours
    this.idleTimeoutSeconds = Number(this.config.get<number>('SESSION_IDLE_TIMEOUT_SECONDS', 3600)); // 1 hour
  }

  /**
   * Creates an authenticated session in both PostgreSQL and Redis.
   */
  async createSession(
    userId: string,
    tenantId: string | null,
    ipAddress: string,
    userAgent: string
  ): Promise<ActiveSession> {
    const sessionId = this.crypto.generateSessionId();
    const expiresAt = new Date(Date.now() + this.maxAgeSeconds * 1000);

    // 1. Fetch user details and permissions
    const userRes = await this.db.query(
      `SELECT id, email, full_name, is_super_admin, is_platform_owner, must_change_password, is_active FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      throw new Error('User not found during session creation');
    }
    const user = userRes.rows[0];

    let role: string | null = null;
    let permissions: string[] = [];

    if (user.is_platform_owner) {
      role = 'PLATFORM_OWNER';
      const allPerms = await this.db.query(`SELECT code FROM permissions`);
      permissions = allPerms.rows.map(r => r.code);
    } else if (tenantId) {
      const memberRes = await this.db.executeWithTenantContext(tenantId, async (client) => {
        return client.query(
          `SELECT tm.role_id, r.name as role_name 
           FROM tenant_memberships tm
           JOIN roles r ON tm.role_id = r.id
           WHERE tm.tenant_id = $1 AND tm.user_id = $2 AND tm.status = 'Active'`,
          [tenantId, userId]
        );
      });
      if (memberRes.rows.length > 0) {
        role = memberRes.rows[0].role_name;
        const roleId = memberRes.rows[0].role_id;

        const permRes = await this.db.query(
          `SELECT p.code FROM role_permissions rp
           JOIN permissions p ON rp.permission_id = p.id
           WHERE rp.role_id = $1`,
          [roleId]
        );
        permissions = permRes.rows.map(r => r.code);
      }
    } else if (user.is_super_admin) {
      role = 'Super Admin';
      const allPerms = await this.db.query(`SELECT code FROM permissions`);
      permissions = allPerms.rows.map(r => r.code);
    }

    // 2. Insert into PostgreSQL sessions table within RLS context
    if (tenantId) {
      await this.db.executeWithTenantContext(tenantId, async (client) => {
        await client.query(
          `INSERT INTO sessions (id, user_id, tenant_id, ip_address, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sessionId, userId, tenantId, ipAddress || '127.0.0.1', userAgent || 'Unknown', expiresAt]
        );
      });
    } else {
      await this.db.executeAsSuperAdmin(async (client) => {
        await client.query(
          `INSERT INTO sessions (id, user_id, tenant_id, ip_address, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sessionId, userId, null, ipAddress || '127.0.0.1', userAgent || 'Unknown', expiresAt]
        );
      });
    }

    const sessionData: ActiveSession = {
      sessionId,
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      isSuperAdmin: Boolean(user.is_super_admin),
      isPlatformOwner: Boolean(user.is_platform_owner),
      mustChangePassword: Boolean(user.must_change_password),
      tenantId,
      role,
      permissions,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    // 3. Cache session in Redis (best-effort; PostgreSQL remains authoritative)
    const redisKey = `session:${sessionId}`;
    try {
      await this.redis.setex(redisKey, this.maxAgeSeconds, JSON.stringify(sessionData));
    } catch (e: any) {
      this.logger.warn(`Redis setex failed during createSession; PostgreSQL session remains active: ${e?.message || e}`);
    }

    return sessionData;
  }

  /**
   * Retrieves and validates an active session.
   * PostgreSQL is authoritative for revocation, expiry, and account/tenant status;
   * Redis serves as a read/TTL cache and never overrides PostgreSQL revocation.
   */
  async getSession(sessionId: string): Promise<ActiveSession | null> {
    if (!sessionId || typeof sessionId !== 'string') {
      return null;
    }

    // 1. Best-effort Redis cache read
    let cachedSession: ActiveSession | null = null;
    try {
      const cached = await this.redis.get(`session:${sessionId}`);
      if (cached) {
        cachedSession = JSON.parse(cached);
      }
    } catch (e: any) {
      this.logger.warn(`Redis read failed during getSession; falling back to PostgreSQL: ${e?.message || e}`);
    }

    // 2. Authoritative PostgreSQL check (fail closed if DB cannot verify)
    let res: any;
    try {
      res = await this.db.executeAsSuperAdmin(async (client) => {
        return client.query(
          `SELECT s.id, s.user_id, s.tenant_id, s.expires_at, s.revoked_at,
                  u.email, u.full_name, u.is_super_admin, u.is_platform_owner, u.must_change_password, u.is_active,
                  t.status as tenant_status, (to_jsonb(t)->>'deleted_at') as tenant_deleted_at
           FROM sessions s
           JOIN users u ON s.user_id = u.id
           LEFT JOIN tenants t ON s.tenant_id = t.id
           WHERE s.id = $1`,
          [sessionId]
        );
      });
    } catch (e: any) {
      this.logger.error(`PostgreSQL session verification failed; failing closed: ${e?.message || e}`);
      return null;
    }

    if (!res || res.rows.length === 0) {
      await this.safeRedisDel(`session:${sessionId}`);
      return null;
    }
    const row = res.rows[0];

    // Check revocation, expiration, user active status, and archived/suspended tenant
    const tenantStatusLower = String(row.tenant_status || '').toLowerCase();
    if (
      row.revoked_at ||
      new Date(row.expires_at) < new Date() ||
      !row.is_active ||
      (row.tenant_id &&
        (row.tenant_deleted_at || tenantStatusLower === 'archived' || tenantStatusLower === 'suspended'))
    ) {
      await this.safeRedisDel(`session:${sessionId}`);
      return null;
    }

    if (cachedSession) {
      try {
        await this.redis.expire(`session:${sessionId}`, this.maxAgeSeconds);
      } catch (e: any) {
        this.logger.warn(`Redis expire failed during getSession: ${e?.message || e}`);
      }
      return cachedSession;
    }

    // Reconstruct permissions
    let role: string | null = null;
    let permissions: string[] = [];

    if (row.is_platform_owner) {
      role = 'PLATFORM_OWNER';
      const allPerms = await this.db.query(`SELECT code FROM permissions`);
      permissions = allPerms.rows.map(r => r.code);
    } else if (row.tenant_id) {
      const memberRes = await this.db.executeWithTenantContext(row.tenant_id, async (client) => {
        return client.query(
          `SELECT r.name as role_name, rp.permission_id, p.code
           FROM tenant_memberships tm
           JOIN roles r ON tm.role_id = r.id
           LEFT JOIN role_permissions rp ON r.id = rp.role_id
           LEFT JOIN permissions p ON rp.permission_id = p.id
           WHERE tm.tenant_id = $1 AND tm.user_id = $2 AND tm.status = 'Active'`,
          [row.tenant_id, row.user_id]
        );
      });
      if (memberRes.rows.length > 0) {
        role = memberRes.rows[0].role_name;
        permissions = memberRes.rows.map(r => r.code).filter(Boolean);
      }
    } else if (row.is_super_admin) {
      role = 'Super Admin';
      const allPerms = await this.db.query(`SELECT code FROM permissions`);
      permissions = allPerms.rows.map(r => r.code);
    }

    const sessionData: ActiveSession = {
      sessionId: row.id,
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      isSuperAdmin: Boolean(row.is_super_admin),
      isPlatformOwner: Boolean(row.is_platform_owner),
      mustChangePassword: Boolean(row.must_change_password),
      tenantId: row.tenant_id,
      role,
      permissions,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    };

    // Best-effort Redis repopulation
    const ttlSeconds = Math.max(1, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000));
    try {
      await this.redis.setex(`session:${sessionId}`, ttlSeconds, JSON.stringify(sessionData));
    } catch (e: any) {
      this.logger.warn(`Redis setex failed during getSession: ${e?.message || e}`);
    }

    return sessionData;
  }

  private async safeRedisDel(keys: string | string[]): Promise<void> {
    try {
      await this.redis.del(keys);
    } catch (e: any) {
      this.logger.warn(`Redis del failed (PostgreSQL revocation remains authoritative): ${e?.message || e}`);
    }
  }

  /**
   * Revokes a session upon user logout.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.db.executeAsSuperAdmin(async (client) => {
      await client.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE id = $1`,
        [sessionId]
      );
    });
    await this.safeRedisDel(`session:${sessionId}`);
  }

  /**
   * Revokes all active sessions for a user (e.g. password reset or admin deactivation).
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `UPDATE sessions SET revoked_at = NOW() 
         WHERE user_id = $1 AND revoked_at IS NULL 
         RETURNING id`,
        [userId]
      );
    });

    const keys = res.rows.map(r => `session:${r.id}`);
    if (keys.length > 0) {
      await this.safeRedisDel(keys);
    }
  }

  /**
   * Revokes all sessions except the current active one.
   */
  async revokeOtherUserSessions(userId: string, currentSessionId: string): Promise<void> {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `UPDATE sessions SET revoked_at = NOW() 
         WHERE user_id = $1 AND id != $2 AND revoked_at IS NULL 
         RETURNING id`,
        [userId, currentSessionId]
      );
    });

    const keys = res.rows.map(r => `session:${r.id}`);
    if (keys.length > 0) {
      await this.safeRedisDel(keys);
    }
  }

  /**
   * Revokes all active sessions associated with a tenant (e.g. on tenant removal/suspension).
   */
  async revokeTenantSessions(tenantId: string): Promise<void> {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `UPDATE sessions SET revoked_at = NOW()
         WHERE tenant_id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [tenantId],
      );
    });

    const keys = res.rows.map((r) => `session:${r.id}`);
    if (keys.length > 0) {
      await this.safeRedisDel(keys);
    }
  }

  /**
   * Revokes all active sessions for a specific user within a specific tenant
   * (e.g. role change or membership deactivation). Leaves other tenants untouched.
   */
  async revokeUserTenantSessions(userId: string, tenantId: string): Promise<number> {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `UPDATE sessions SET revoked_at = NOW()
         WHERE user_id = $1::uuid AND tenant_id = $2::uuid AND revoked_at IS NULL
         RETURNING id`,
        [userId, tenantId],
      );
    });

    const keys = res.rows.map((r) => `session:${r.id}`);
    if (keys.length > 0) {
      await this.safeRedisDel(keys);
    }
    return res.rows.length;
  }
}
