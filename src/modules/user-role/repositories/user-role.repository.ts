import { query } from '../../../infra/db/database'
import { UserRole } from '../models/user-role.model'

type CreateUserRoleInput = {
  user_id: number
  role_id: number
  state: boolean
}

export class UserRoleRepository {
  async userHasRole(userId: number, roleId: number): Promise<boolean> {
    const rows = await query<{ ok: boolean }>(
      `
    SELECT true AS ok
    FROM "UserRole"
    WHERE user_id = $1
      AND role_id = $2
      AND state = true
    LIMIT 1
    `,
      [userId, roleId]
    )

    return !!rows[0]
  }

  async findByIds(userId: number, roleId: number): Promise<UserRole | null> {
    const rows = await query<UserRole>(
      `SELECT * FROM "UserRole" WHERE user_id = $1 AND role_id = $2 LIMIT 1`,
      [userId, roleId]
    )
    return rows[0] ?? null
  }

  async findAll(): Promise<UserRole[]> {
    return query<UserRole>(`SELECT * FROM "UserRole" ORDER BY created_at DESC`)
  }

  async findByUserId(userId: number): Promise<UserRole[]> {
    return query<UserRole>(`SELECT * FROM "UserRole" WHERE user_id = $1 ORDER BY created_at DESC`, [
      userId,
    ])
  }

  async findByRoleId(roleId: number): Promise<UserRole[]> {
    return query<UserRole>(`SELECT * FROM "UserRole" WHERE role_id = $1 ORDER BY created_at DESC`, [
      roleId,
    ])
  }

  async create(input: CreateUserRoleInput): Promise<UserRole> {
    const rows = await query<UserRole>(
      `
      INSERT INTO "UserRole" (user_id, role_id, state)
      VALUES ($1, $2, $3)
      RETURNING *;
      `,
      [input.user_id, input.role_id, input.state]
    )

    return rows[0]
  }

  async updateState(userId: number, roleId: number, state: boolean): Promise<UserRole> {
    const rows = await query<UserRole>(
      `
      UPDATE "UserRole"
      SET state = $1,
          row_version = gen_random_uuid()
      WHERE user_id = $2 AND role_id = $3
      RETURNING *;
      `,
      [state, userId, roleId]
    )

    if (!rows[0]) throw new Error('NOT_FOUND: UserRole not found')
    return rows[0]
  }

  async delete(userId: number, roleId: number): Promise<boolean> {
    const rows = await query<{ user_id: number; role_id: number }>(
      `
      DELETE FROM "UserRole"
      WHERE user_id = $1 AND role_id = $2
      RETURNING user_id, role_id;
      `,
      [userId, roleId]
    )

    return !!rows[0]
  }
}
