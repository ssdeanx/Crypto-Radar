import type { DbHandle } from './db.js';
import type { UserRow } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';

export class AuthStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async getUserByEmail(email: string): Promise<UserRow | undefined> {
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("users")} WHERE email = @email LIMIT 1`;
      const [rows] = await this.h.bq.query({ query: sql, params: { email } });
      return rows[0] as UserRow | undefined;
    } else if (this.h.db) {
      return this.h.oneRow<UserRow>(
        this.h.prep("SELECT * FROM users WHERE email = ?"),
        email,
      );
    }
    return undefined;
  }

  async getUserById(id: string): Promise<UserRow | undefined> {
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("users")} WHERE id = @id LIMIT 1`;
      const [rows] = await this.h.bq.query({ query: sql, params: { id } });
      return rows[0] as UserRow | undefined;
    } else if (this.h.db) {
      return this.h.oneRow<UserRow>(this.h.prep("SELECT * FROM users WHERE id = ?"), id);
    }
    return undefined;
  }

  async createUser(user: UserRow): Promise<void> {
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      await dataset.table("users").insert([{
        insertId: user.id,
        json: user,
      }]);
    } else if (this.h.db) {
      this.h.prep(
        "INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        user.id,
        user.email,
        user.password_hash,
        user.name,
        user.role,
        user.created_at,
        user.updated_at,
      );
    }
  }

  async updateUser(
    id: string,
    fields: Partial<Pick<UserRow, "name" | "role" | "password_hash">>,
  ): Promise<void> {
    if (this.h.bq) {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      if (fields.name !== undefined) {
        sets.push("name = @name");
        params.name = fields.name;
      }
      if (fields.role !== undefined) {
        sets.push("role = @role");
        params.role = fields.role;
      }
      if (fields.password_hash !== undefined) {
        sets.push("password_hash = @password_hash");
        params.password_hash = fields.password_hash;
      }
      if (sets.length === 0) return;
      sets.push("updated_at = CURRENT_TIMESTAMP()");
      const sql = `UPDATE ${this.h.getTable("users")} SET ${sets.join(", ")} WHERE id = @id`;
      await this.h.bq.query({ query: sql, params });
    } else if (this.h.db) {
      const sets: string[] = [];
      const params: SQLInputValue[] = [];
      if (fields.name !== undefined) {
        sets.push("name = ?");
        params.push(fields.name);
      }
      if (fields.role !== undefined) {
        sets.push("role = ?");
        params.push(fields.role);
      }
      if (fields.password_hash !== undefined) {
        sets.push("password_hash = ?");
        params.push(fields.password_hash);
      }
      if (sets.length === 0) return;
      sets.push("updated_at = datetime('now')");
      this.h.prep(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(
        ...params,
        id,
      );
    }
  }
}
