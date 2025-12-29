import { Request, Response } from 'express'
import { CreateRoleDto } from '../dtos/create-role.dto'
import { UpdateRoleDto } from '../dtos/update-role.dto'
import { RoleRepository } from '../repositories/role.repository'
import { RoleService } from '../services/domain/role.service'

type SetStateBody = { state: boolean }

export class RoleController {
  private readonly service = new RoleService(new RoleRepository())

  create = async (req: Request<any, any, CreateRoleDto>, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const dto = req.body
      const createdBy = String(req.auth.userId)

      const role = await this.service.create(dto, createdBy)
      return res.status(201).json(role)
    } catch (err: any) {
      return this.handleError(res, 'ROLE_CREATE_ERROR', err)
    }
  }

  list = async (req: Request, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const roles = await this.service.listAll()
      return res.status(200).json(roles)
    } catch (err: any) {
      return this.handleError(res, 'ROLE_LIST_ERROR', err)
    }
  }

  getById = async (req: Request<{ id: string }>, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const id = this.parseNumberParam(req.params.id)
      if (id === null) return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid id' })

      const role = await this.service.getById(id)
      return res.status(200).json(role)
    } catch (err: any) {
      return this.handleError(res, 'ROLE_GET_ERROR', err)
    }
  }

  update = async (req: Request<{ id: string }, any, UpdateRoleDto>, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const id = this.parseNumberParam(req.params.id)
      if (id === null) return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid id' })

      const dto = req.body
      const updatedBy = String(req.auth.userId)

      const role = await this.service.update(id, dto, updatedBy)
      return res.status(200).json(role)
    } catch (err: any) {
      return this.handleError(res, 'ROLE_UPDATE_ERROR', err)
    }
  }

  setState = async (req: Request<{ id: string }, any, SetStateBody>, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const id = this.parseNumberParam(req.params.id)
      if (id === null) return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid id' })

      const state = req.body?.state
      if (typeof state !== 'boolean') {
        return res.status(400).json({ error: 'VALIDATION_ERROR: state must be boolean' })
      }

      const updatedBy = String(req.auth.userId)

      const role = await this.service.setState(id, state, updatedBy)
      return res.status(200).json(role)
    } catch (err: any) {
      return this.handleError(res, 'ROLE_SET_STATE_ERROR', err)
    }
  }

  delete = async (req: Request<{ id: string }>, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const id = this.parseNumberParam(req.params.id)
      if (id === null) return res.status(400).json({ error: 'VALIDATION_ERROR: Invalid id' })

      const deletedBy = String(req.auth.userId)

      const result = await this.service.delete(id, deletedBy)
      return res.status(200).json(result)
    } catch (err: any) {
      return this.handleError(res, 'ROLE_DELETE_ERROR', err)
    }
  }

  private parseNumberParam(value: string): number | null {
    const n = Number(value)
    if (Number.isInteger(n) && n > 0) return n
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
