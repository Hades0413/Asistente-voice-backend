import { RoleResponseDto } from '../dtos/role-response.dto'
import { Role } from '../models/role.model'

export class RoleMapper {
  static toResponse(role: Role): RoleResponseDto {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      state: role.state,
      created_at: role.created_at,
      created_by: role.created_by,
      updated_at: role.updated_at,
      updated_by: role.updated_by,
      deleted_at: role.deleted_at,
      deleted_by: role.deleted_by,
      row_version: role.row_version,
    }
  }
}
