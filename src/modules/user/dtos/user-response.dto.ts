// user-response.dto.ts
export interface UserResponseDto {
  id: number
  username: string
  email: string
  firstname: string
  lastname: string
  photo?: string
  state: boolean

  last_login_at?: Date
  created_at: Date
  updated_at?: Date
}
