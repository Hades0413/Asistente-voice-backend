import { UserRoleResponseDto } from '../dtos/user-role-response.dto'
import { UserRole } from '../models/user-role.model'

export class UserRoleMapper {
  static toResponse(model: UserRole): UserRoleResponseDto {
    return {
      user_id: model.user_id,
      role_id: model.role_id,
      state: model.state,
      created_at: model.created_at,
      row_version: model.row_version,
    }
  }
}
