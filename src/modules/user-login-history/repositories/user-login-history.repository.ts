import { query } from '../../../infra/db/database'
import { UserLoginHistory } from '../models/user-login-history.model'

export class UserLoginHistoryRepository {
  async create(data: {
    user_id: number
    success: boolean
    ip_address?: string
    user_agent?: string
  }): Promise<UserLoginHistory> {
    const rows = await query<UserLoginHistory>(
      `
      INSERT INTO "UserLoginHistory"
        (user_id, success, ip_address, user_agent)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [data.user_id, data.success, data.ip_address ?? null, data.user_agent ?? null]
    )

    return rows[0]
  }
}
