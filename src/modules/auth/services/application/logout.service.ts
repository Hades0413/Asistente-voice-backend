import { UserSessionRepository } from '../../../user-session/repositories/user-session.repository'

class AuthError extends Error {
  constructor(
    public readonly code: 'UNAUTHORIZED',
    public readonly data?: Record<string, any>
  ) {
    super(code)
    this.name = 'AuthError'
  }
}

export class LogoutService {
  constructor(private readonly sessionRepo = new UserSessionRepository()) {}

  async execute(token: string) {
    if (!token) throw new AuthError('UNAUTHORIZED')

    const ok = await this.sessionRepo.revokeByToken(token)
    if (!ok) throw new AuthError('UNAUTHORIZED')

    return { ok: true }
  }
}
