import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {
    const connectionString = this.configService.get<string>('DATABASE_URL');
    if (connectionString) {
      this.pool = new Pool({ connectionString });
    } else {
      this.pool = new Pool({
        host: this.configService.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(this.configService.get<number>('DB_PORT', 5432)),
        user: this.configService.get<string>('DB_USER', 'postgres'),
        password: this.configService.get<string>('DB_PASSWORD', 'gsign_dev_password'),
        database: this.configService.get<string>('DB_NAME', 'gsign_db'),
        max: Number(this.configService.get<number>('DB_MAX_CONNECTIONS', 20)),
        idleTimeoutMillis: 30000,
      });
    }
  }

  async onModuleInit() {
    try {
      const client = await this.pool.connect();
      client.release();
      this.logger.log('PostgreSQL database pool connected successfully.');
    } catch (err) {
      this.logger.error('Failed to connect to PostgreSQL database:', err);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  getPool(): Pool {
    return this.pool;
  }

  /**
   * Executes a standard SQL query on the pool.
   */
  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /**
   * Executes database operations safely within an active Tenant Context
   * enforcing PostgreSQL Row-Level Security (RLS).
   */
  async executeWithTenantContext<T>(
    tenantId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Set session variables scoped to this transaction
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      await client.query("SELECT set_config('app.is_super_admin', 'false', true)");

      const result = await callback(client);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Executes administrative queries with Super Admin RLS bypass flag safely set.
   */
  async executeAsSuperAdmin<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_super_admin', 'true', true)");
      await client.query("SELECT set_config('app.current_tenant_id', '', true)");

      const result = await callback(client);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
