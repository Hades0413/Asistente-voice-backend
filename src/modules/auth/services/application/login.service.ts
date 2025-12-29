import crypto from 'node:crypto'

import { UserLoginHistoryRepository } from '../../../user-login-history/repositories/user-login-history.repository'
import { UserSessionRepository } from '../../../user-session/repositories/user-session.repository'
import { LoginDto } from '../../dtos/login.dto'
import { AuthUserRepository } from '../../repositories/auth-user.repository'
import { PasswordService } from '../domain/password.service'

class AuthError extends Error {
  constructor(
    public readonly code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'LOCKED' | 'TOO_MANY_SESSIONS',
    public readonly data?: Record<string, any>
  ) {
    super(code)
    this.name = 'AuthError'
  }
}

export class LoginService {
  private static readonly MAX_ACTIVE_SESSIONS = 3

  private static readonly MAX_FAILED_ATTEMPTS = 5
  private static readonly BASE_LOCK_MINUTES = 10
  private static readonly MAX_LOCK_MINUTES = 24 * 60 // tope: 24h

  constructor(
    private readonly userRepo = new AuthUserRepository(),
    private readonly sessionRepo = new UserSessionRepository(),
    private readonly loginHistoryRepo = new UserLoginHistoryRepository()
  ) {}

  private computeNextLockMinutes(currentLockoutEnd?: Date | null): number {
    if (!currentLockoutEnd) return LoginService.BASE_LOCK_MINUTES

    const now = Date.now()
    const lockMs = currentLockoutEnd.getTime() - now

    if (lockMs > 0) {
      const remainingMinutes = Math.ceil(lockMs / (60 * 1000))
      return Math.min(
        Math.max(remainingMinutes * 2, LoginService.BASE_LOCK_MINUTES),
        LoginService.MAX_LOCK_MINUTES
      )
    }

    return Math.min(LoginService.BASE_LOCK_MINUTES * 2, LoginService.MAX_LOCK_MINUTES)
  }

  private retryAfterSeconds(lockoutEnd: Date): number {
    const ms = lockoutEnd.getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / 1000))
  }

  async execute(dto: LoginDto, meta: { ip?: string; userAgent?: string }) {
    const email = dto.email.trim().toLowerCase()
    const password = dto.password

    if (!email || !password) throw new AuthError('VALIDATION_ERROR')

    const user = await this.userRepo.findByEmail(email)
    if (!user || user.state === false) throw new AuthError('UNAUTHORIZED')

    if (user.lockout_end) {
      const lockEnd = new Date(user.lockout_end)
      if (lockEnd > new Date()) {
        throw new AuthError('LOCKED', { retry_after_seconds: this.retryAfterSeconds(lockEnd) })
      }
    }

    const ok = await PasswordService.verifyPassword(
      password,
      user.password_salt,
      user.password_hash
    )

    if (!ok) {
      await this.userRepo.incrementFailedAttempts(user.id)

      await this.loginHistoryRepo.create({
        user_id: user.id,
        success: false,
        ip_address: meta.ip,
        user_agent: meta.userAgent,
      })

      const nextFailedAttempts = (user.failed_login_attempts ?? 0) + 1

      if (nextFailedAttempts >= LoginService.MAX_FAILED_ATTEMPTS) {
        const nextLockMinutes = this.computeNextLockMinutes(
          user.lockout_end ? new Date(user.lockout_end) : null
        )

        const lockoutUntil = new Date(Date.now() + nextLockMinutes * 60 * 1000)

        await this.userRepo.setLockout(user.id, lockoutUntil)

        throw new AuthError('LOCKED', { retry_after_seconds: this.retryAfterSeconds(lockoutUntil) })
      }

      throw new AuthError('UNAUTHORIZED')
    }

    const activeSessions = await this.sessionRepo.countActiveByUser(user.id)
    if (activeSessions >= LoginService.MAX_ACTIVE_SESSIONS) {
      throw new AuthError('TOO_MANY_SESSIONS', { max_sessions: LoginService.MAX_ACTIVE_SESSIONS })
    }

    await this.userRepo.resetLoginAttemptsAndSetLastLogin(user.id)

    await this.loginHistoryRepo.create({
      user_id: user.id,
      success: true,
      ip_address: meta.ip,
      user_agent: meta.userAgent,
    })

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const session = await this.sessionRepo.create({
      user_id: user.id,
      token,
      expires_at: expiresAt,
      ip_address: meta.ip,
      user_agent: meta.userAgent,
    })

    return {
      token: session.token,
      expires_at: session.expires_at,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        photo: user.photo,
      },
    }
  }
}
