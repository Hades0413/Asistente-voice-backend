// user.mapper.ts
import { UserResponseDto } from '../dtos/user-response.dto'
import { User } from '../models/user.model'

export class UserMapper {
  static toResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      photo: user.photo,
      state: user.state,
      last_login_at: user.last_login_at,
      created_at: user.created_at,
      updated_at: user.updated_at,
    }
  }
}
