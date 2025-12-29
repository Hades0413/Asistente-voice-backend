import { Request, Response } from 'express'
import { CreateUserRoleDto } from '../dtos/create-user-role.dto'
import { UpdateUserRoleDto } from '../dtos/update-user-role.dto'
import { UserRoleRepository } from '../repositories/user-role.repository'
import { UserRoleService } from '../services/domain/user-role.service'

export class UserRoleController {
  private readonly service = new UserRoleService(new UserRoleRepository())

  create = async (req: Request, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const dto = req.body as CreateUserRoleDto
      const created = await this.service.create(dto)
      return res.status(201).json(created)
    } catch (err: any) {
      return this.handleError(res, 'USER_ROLE_CREATE_ERROR', err)
    }
  }

  list = async (req: Request, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const userIdQ = req.query.user_id
      const roleIdQ = req.query.role_id

      if (userIdQ !== undefined) {
        const userId = this.parseNumberQuery(userIdQ, 'user_id')
        if (userId === null)
          return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid user_id' })

        const rows = await this.service.listByUserId(userId)
        return res.status(200).json(rows)
      }

      if (roleIdQ !== undefined) {
        const roleId = this.parseNumberQuery(roleIdQ, 'role_id')
        if (roleId === null)
          return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid role_id' })

        const rows = await this.service.listByRoleId(roleId)
        return res.status(200).json(rows)
      }

      const rows = await this.service.listAll()
      return res.status(200).json(rows)
    } catch (err: any) {
      return this.handleError(res, 'USER_ROLE_LIST_ERROR', err)
    }
  }

  getByIds = async (req: Request, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const userId = this.parseNumberParam(req.params.userId)
      const roleId = this.parseNumberParam(req.params.roleId)

      if (userId === null || roleId === null) {
        return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid ids' })
      }

      const row = await this.service.getByIds(userId, roleId)
      return res.status(200).json(row)
    } catch (err: any) {
      return this.handleError(res, 'USER_ROLE_GET_ERROR', err)
    }
  }

  setState = async (req: Request, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const userId = this.parseNumberParam(req.params.userId)
      const roleId = this.parseNumberParam(req.params.roleId)

      if (userId === null || roleId === null) {
        return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid ids' })
      }

      const dto = req.body as UpdateUserRoleDto
      const updated = await this.service.setState(userId, roleId, dto)

      return res.status(200).json(updated)
    } catch (err: any) {
      return this.handleError(res, 'USER_ROLE_SET_STATE_ERROR', err)
    }
  }

  delete = async (req: Request, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const userId = this.parseNumberParam(req.params.userId)
      const roleId = this.parseNumberParam(req.params.roleId)

      if (userId === null || roleId === null) {
        return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid ids' })
      }

      const result = await this.service.delete(userId, roleId)
      return res.status(200).json(result)
    } catch (err: any) {
      return this.handleError(res, 'USER_ROLE_DELETE_ERROR', err)
    }
  }

  private parseNumberParam(value: string): number | null {
    const n = Number(value)
    if (Number.isFinite(n)) return n
    return null
  }

  private parseNumberQuery(value: unknown, _field: string): number | null {
    const raw = Array.isArray(value) ? value[0] : value
    if (typeof raw !== 'string') return null

    const n = Number(raw)
    if (Number.isFinite(n)) return n
    return null
  }

  private handleError(res: Response, logLabel: string, err: any) {
    const msg = String(err?.message ?? 'UNKNOWN_ERROR')

    if (msg.startsWith('VALIDATION_ERROR')) return res.status(400).json({ error: msg })
    if (msg.startsWith('CONFLICT')) return res.status(409).json({ error: msg })
    if (msg.startsWith('NOT_FOUND')) return res.status(404).json({ error: msg })

    console.error(`${logLabel}:`, err)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
}
