import { BaseModel } from '../../../shared/models/BaseModel'

export class UserLoginHistory extends BaseModel<number> {
  user_id!: number
  login_at!: Date

  ip_address?: string
  user_agent?: string

  success!: boolean
}
