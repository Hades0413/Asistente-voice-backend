import { BaseModel } from '../../../shared/models/BaseModel'

export class Client extends BaseModel<number> {
  user_id?: number

  name!: string
  ruc?: string
  email?: string
  phone?: string
  address?: string

  state!: boolean
}
