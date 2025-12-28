import { query } from '../../../infra/db/database'

export type AuthUser = {
  id: number
  username: string
  email: string
  firstname: string
  lastname: string

  password_hash: Buffer
  password_salt: Buffer

  state: boolean
  lockout_end?: Date | null
  failed_login_attempts: number

  photo?: string | null
}

export class AuthUserRepository {
  async findByEmail(email: string): Promise<AuthUser | null> {
    const rows = await query<AuthUser>(
      `
      SELECT
        id, username, email, firstname, lastname,
        password_hash, password_salt,
        state, lockout_end, failed_login_attempts,
        photo
      FROM "User"
      WHERE email = $1 AND deleted_at IS NULL
      LIMIT 1
      `,
      [email]
    )

    return rows[0] ?? null
  }

  async incrementFailedAttempts(userId: number): Promise<void> {
    await query(
      `
      UPDATE "User"
      SET failed_login_attempts = failed_login_attempts + 1,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = 'auth'
      WHERE id = $1
      `,
      [userId]
    )
  }

  async resetLoginAttemptsAndSetLastLogin(userId: number): Promise<void> {
    await query(
      `
      UPDATE "User"
      SET failed_login_attempts = 0,
          lockout_end = NULL,
          last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = 'auth'
      WHERE id = $1
      `,
      [userId]
    )
  }

  // opcional si luego quieres lockout automático
  async setLockout(userId: number, lockoutEnd: Date): Promise<void> {
    await query(
      `
      UPDATE "User"
      SET lockout_end = $2,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = 'auth'
      WHERE id = $1
      `,
      [userId, lockoutEnd]
    )
  }
}
