import { Request, Response } from 'express'
import { CreateUserDto } from '../dtos/create-user.dto'
import { UserRepository } from '../repositories/user.repository'
import { UserService } from '../services/user.service'

export class UserController {
  private readonly service = new UserService(new UserRepository())

  create = async (req: Request, res: Response) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const dto = req.body as CreateUserDto

      const createdBy = String(req.auth.userId)

      const user = await this.service.createUser(dto, createdBy)
      return res.status(201).json(user)
    } catch (err: any) {
      const msg = String(err?.message ?? 'UNKNOWN_ERROR')

      if (msg.startsWith('VALIDATION_ERROR')) return res.status(400).json({ error: msg })
      if (msg.startsWith('CONFLICT')) return res.status(409).json({ error: msg })

      console.error('USER_CREATE_ERROR:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  }
}
