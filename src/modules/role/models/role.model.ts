import { BaseModel } from '../../../shared/models/BaseModel'

export class Role extends BaseModel<number> {
  name!: string
  description?: string
  state!: boolean
}
