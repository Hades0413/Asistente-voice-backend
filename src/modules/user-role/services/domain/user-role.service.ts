import { CreateUserRoleDto } from '../../dtos/create-user-role.dto'
import { UpdateUserRoleDto } from '../../dtos/update-user-role.dto'
import { UserRoleResponseDto } from '../../dtos/user-role-response.dto'
import { UserRoleMapper } from '../../mappers/user-role.mapper'
import { UserRoleRepository } from '../../repositories/user-role.repository'

export class UserRoleService {
  constructor(private readonly repo: UserRoleRepository) {}

  async create(dto: CreateUserRoleDto): Promise<UserRoleResponseDto> {
    this.assertValidId(dto.user_id, 'user_id')
    this.assertValidId(dto.role_id, 'role_id')

    const state = dto.state ?? true

    const existing = await this.repo.findByIds(dto.user_id, dto.role_id)
    if (existing) throw new Error('CONFLICT: UserRole already exists')

    const created = await this.repo.create({
      user_id: dto.user_id,
      role_id: dto.role_id,
      state,
    })

    return UserRoleMapper.toResponse(created)
  }

  async listAll(): Promise<UserRoleResponseDto[]> {
    const rows = await this.repo.findAll()
    return rows.map(UserRoleMapper.toResponse)
  }

  async listByUserId(userId: number): Promise<UserRoleResponseDto[]> {
    this.assertValidId(userId, 'user_id')
    const rows = await this.repo.findByUserId(userId)
    return rows.map(UserRoleMapper.toResponse)
  }

  async listByRoleId(roleId: number): Promise<UserRoleResponseDto[]> {
    this.assertValidId(roleId, 'role_id')
    const rows = await this.repo.findByRoleId(roleId)
    return rows.map(UserRoleMapper.toResponse)
  }

  async getByIds(userId: number, roleId: number): Promise<UserRoleResponseDto> {
    this.assertValidId(userId, 'user_id')
    this.assertValidId(roleId, 'role_id')

    const row = await this.repo.findByIds(userId, roleId)
    if (!row) throw new Error('NOT_FOUND: UserRole not found')

    return UserRoleMapper.toResponse(row)
  }

  async setState(
    userId: number,
    roleId: number,
    dto: UpdateUserRoleDto
  ): Promise<UserRoleResponseDto> {
    this.assertValidId(userId, 'user_id')
    this.assertValidId(roleId, 'role_id')
    if (typeof dto.state !== 'boolean') throw new Error('VALIDATION_ERROR: state must be boolean')

    const updated = await this.repo.updateState(userId, roleId, dto.state)
    return UserRoleMapper.toResponse(updated)
  }

  async delete(userId: number, roleId: number): Promise<{ ok: true }> {
    this.assertValidId(userId, 'user_id')
    this.assertValidId(roleId, 'role_id')

    const ok = await this.repo.delete(userId, roleId)
    if (!ok) throw new Error('NOT_FOUND: UserRole not found')

    return { ok: true }
  }

  private assertValidId(id: number, field: string) {
    if (!Number.isFinite(id) || id <= 0) throw new Error(`VALIDATION_ERROR: Invalid ${field}`)
  }
}
