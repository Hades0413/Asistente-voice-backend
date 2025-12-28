import { query } from '../../../infra/db/database'
import { UserSession } from '../models/user-session.model'

export class UserSessionRepository {
  async countActiveByUser(userId: number): Promise<number> {
    const rows = await query<{ count: string }>(
      `
      SELECT COUNT(*)::int AS count
      FROM "UserSession"
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND deleted_at IS NULL
        AND expires_at > NOW()
      `,
      [userId]
    )
    return Number(rows[0]?.count ?? 0)
  }

  async findActiveByToken(token: string): Promise<UserSession | null> {
    const rows = await query<UserSession>(
      `
      SELECT *
      FROM "UserSession"
      WHERE token = $1
        AND revoked_at IS NULL
        AND deleted_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
      `,
      [token]
    )
    return rows[0] ?? null
  }

  async revokeByToken(token: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `
      UPDATE "UserSession"
      SET revoked_at = NOW()
      WHERE token = $1
        AND revoked_at IS NULL
        AND deleted_at IS NULL
      RETURNING id
      `,
      [token]
    )

    return (rows?.length ?? 0) > 0
  }

  async revokeAllActiveSessions(): Promise<number> {
    const rows = await query<{ count: string }>(
      `
      WITH updated AS (
        UPDATE "UserSession"
        SET revoked_at = NOW()
        WHERE revoked_at IS NULL
          AND deleted_at IS NULL
          AND expires_at > NOW()
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM updated
      `
    )
    return Number(rows[0]?.count ?? 0)
  }

  async create(data: {
    user_id: number
    token: string
    expires_at: Date
    ip_address?: string
    user_agent?: string
  }): Promise<UserSession> {
    const rows = await query<UserSession>(
      `
      INSERT INTO "UserSession"
        (user_id, token, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
      `,
      [data.user_id, data.token, data.expires_at, data.ip_address ?? null, data.user_agent ?? null]
    )

    return rows[0]
  }
}
