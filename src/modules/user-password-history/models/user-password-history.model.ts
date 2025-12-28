import { BaseModel } from '../../../shared/models/BaseModel'

export class UserPasswordHistory extends BaseModel<number> {
  user_id!: number

  password_hash!: Buffer
  password_salt!: Buffer

  changed_at!: Date
}
