import { UserRoleRepository } from '../../../user-role/repositories/user-role.repository'
import { UserSessionRepository } from '../../../user-session/repositories/user-session.repository'

class AuthError extends Error {
  constructor(
    public readonly code: 'UNAUTHORIZED' | 'FORBIDDEN',
    public readonly data?: Record<string, any>
  ) {
    super(code)
    this.name = 'AuthError'
  }
}

export class LogoutGlobalService {
  constructor(
    private readonly sessionRepo = new UserSessionRepository(),
    private readonly userRoleRepo = new UserRoleRepository()
  ) {}

  async execute(token: string) {
    if (!token) throw new AuthError('UNAUTHORIZED')

    // 1️⃣ Validar sesión
    const session = await this.sessionRepo.findActiveByToken(token)
    if (!session) throw new AuthError('UNAUTHORIZED')

    // 2️⃣ Validar rol ADMIN (role_id = 1)
    const isAdmin = await this.userRoleRepo.userHasRole(session.user_id, 1)
    if (!isAdmin) throw new AuthError('FORBIDDEN')

    // 3️⃣ Revocar todas las sesiones
    const revoked = await this.sessionRepo.revokeAllActiveSessions()
    return { ok: true, revoked_sessions: revoked }
  }
}
