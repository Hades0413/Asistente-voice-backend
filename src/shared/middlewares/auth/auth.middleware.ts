import { NextFunction, Request, Response } from 'express'
import { UserSessionRepository } from '../../../modules/user-session/repositories/user-session.repository'

export type AuthContext = {
  userId: number
  sessionId: string
  token: string
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization
  if (!h) return null
  if (!h.startsWith('Bearer ')) return null
  const token = h.slice('Bearer '.length).trim()
  return token.length ? token : null
}

export class AuthMiddleware {
  private static readonly sessionRepo = new UserSessionRepository()

  static readonly requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = getBearerToken(req)
      if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const session = await AuthMiddleware.sessionRepo.findActiveByToken(token)
      if (!session) return res.status(401).json({ error: 'UNAUTHORIZED' })

      req.auth = {
        userId: session.user_id,
        sessionId: String((session as any).id),
        token: session.token,
      }

      return next()
    } catch (err) {
      console.error('AUTH_MIDDLEWARE_ERROR:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  }
}
