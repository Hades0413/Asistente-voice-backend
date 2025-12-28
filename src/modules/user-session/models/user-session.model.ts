import { BaseModel } from '../../../shared/models/BaseModel'

export class UserSession extends BaseModel<string> {
  user_id!: number
  token!: string
  expires_at!: Date
  revoked_at?: Date
  ip_address?: string
  user_agent?: string
}
