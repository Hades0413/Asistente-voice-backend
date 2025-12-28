import { Pool, QueryResultRow } from 'pg';

export abstract class BaseRepository<T extends QueryResultRow> {
  constructor(protected pool: Pool, protected tableName: string) {}

  async findAll(): Promise<T[]> {
    const { rows } = await this.pool.query<T>(`SELECT * FROM ${this.tableName}`);
    return rows;
  }

  async findById(id: string): Promise<T | null> {
    const { rows } = await this.pool.query<T>(`SELECT * FROM ${this.tableName} WHERE id=`, [id]);
    return rows[0] || null;
  }

  async create(item: Partial<T>): Promise<T> {
    const columns = Object.keys(item).join(', ');
    const values = Object.values(item);
    const placeholders = values.map((_, i) => '$' + (i + 1)).join(', ');
    const { rows } = await this.pool.query<T>(
      `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return rows[0];
  }

}
