export interface RoleResponseDto {
  id: number
  name: string
  description?: string
  state: boolean
  created_at: Date
  created_by: string
  updated_at?: Date
  updated_by?: string
  deleted_at?: Date
  deleted_by?: string
  row_version: string
}
