import { BaseModel } from '../../../shared/models/BaseModel'

export class User extends BaseModel<number> {
  username!: string
  email!: string
  firstname!: string
  lastname!: string

  password_hash!: Buffer
  password_salt!: Buffer

  last_login_at?: Date
  failed_login_attempts: number = 0
  lockout_end?: Date
  password_changed_at?: Date

  security_stamp!: string
  state!: boolean
  photo?: string
}
