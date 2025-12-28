import { Request, Response } from 'express'
import { LoginDto } from '../dtos/login.dto'
import { LoginService } from '../services/application/login.service'
import { LogoutGlobalService } from '../services/application/logout-global.service'
import { LogoutService } from '../services/application/logout.service'

type AuthServiceError = {
  name?: string
  message?: string
  code?: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'LOCKED' | 'TOO_MANY_SESSIONS' | 'FORBIDDEN'
  data?: Record<string, any>
}

type LoginContext = {
  ip?: string
  userAgent?: string
}

export class AuthController {
  private readonly loginService = new LoginService()
  private readonly logoutService = new LogoutService()
  private readonly logoutGlobalService = new LogoutGlobalService()

  login = async (req: Request, res: Response) => {
    try {
      const dto = req.body as LoginDto
      const ctx = this.buildContext(req)

      const result = await this.loginService.execute(dto, ctx)
      return res.status(200).json(result)
    } catch (err: unknown) {
      return this.handleLoginError(res, err)
    }
  }

  //requiere AuthMiddleware.requireAuth antes de llegar aquí
  logout = async (req: Request, res: Response) => {
    try {
      const token = req.auth?.token
      if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const result = await this.logoutService.execute(token)
      return res.status(200).json(result)
    } catch (err: unknown) {
      return this.handleLogoutError(res, err)
    }
  }

  //requiere AuthMiddleware.requireAuth antes de llegar aquí
  logoutGlobal = async (req: Request, res: Response) => {
    try {
      const token = req.auth?.token
      if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const result = await this.logoutGlobalService.execute(token)
      return res.status(200).json(result)
    } catch (err: unknown) {
      return this.handleLogoutGlobalError(res, err)
    }
  }

  private buildContext(req: Request): LoginContext {
    const ip =
      typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.socket.remoteAddress ?? undefined

    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined

    return { ip, userAgent }
  }

  private handleLoginError(res: Response, err: unknown) {
    const e = err as AuthServiceError
    const code = e.code ?? (e.message as any)

    switch (code) {
      case 'VALIDATION_ERROR':
        return res.status(400).json({ error: 'INVALID_REQUEST' })

      case 'LOCKED': {
        const retryAfterSeconds =
          typeof e.data?.retry_after_seconds === 'number' ? e.data.retry_after_seconds : null

        const payload: Record<string, any> = { error: 'LOCKED' }
        if (retryAfterSeconds !== null) payload.retry_after_seconds = retryAfterSeconds

        return res.status(423).json(payload)
      }

      case 'TOO_MANY_SESSIONS': {
        const maxSessions = typeof e.data?.max_sessions === 'number' ? e.data.max_sessions : 3
        return res.status(429).json({ error: 'TOO_MANY_SESSIONS', max_sessions: maxSessions })
      }

      case 'UNAUTHORIZED':
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' })

      default:
        console.error('LOGIN_ERROR:', err)
        return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  }

  private handleLogoutError(res: Response, err: unknown) {
    const e = err as AuthServiceError
    const code = e.code ?? (e.message as any)

    if (code === 'UNAUTHORIZED') return res.status(401).json({ error: 'UNAUTHORIZED' })

    console.error('LOGOUT_ERROR:', err)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }

  private handleLogoutGlobalError(res: Response, err: unknown) {
    const e = err as AuthServiceError
    const code = e.code ?? (e.message as any)

    if (code === 'UNAUTHORIZED') return res.status(401).json({ error: 'UNAUTHORIZED' })
    if (code === 'FORBIDDEN') return res.status(403).json({ error: 'FORBIDDEN' })

    console.error('LOGOUT_GLOBAL_ERROR:', err)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
}
