import { CreateRoleDto } from '../../dtos/create-role.dto'
import { RoleResponseDto } from '../../dtos/role-response.dto'
import { UpdateRoleDto } from '../../dtos/update-role.dto'
import { RoleMapper } from '../../mappers/role.mapper'
import { RoleRepository } from '../../repositories/role.repository'

export class RoleService {
  constructor(private readonly repo: RoleRepository) {}

  async create(dto: CreateRoleDto, createdBy: string): Promise<RoleResponseDto> {
    const name = String(dto.name ?? '').trim()
    if (!name) throw new Error('VALIDATION_ERROR: name is required')

    const description = dto.description !== undefined ? String(dto.description).trim() : undefined
    const state = dto.state ?? true

    const existing = await this.repo.findByName(name)
    if (existing) throw new Error('CONFLICT: Role name already exists')

    const created = await this.repo.create({
      name,
      description: description?.length ? description : undefined,
      state,
      created_by: createdBy,
    })

    return RoleMapper.toResponse(created)
  }

  async listAll(): Promise<RoleResponseDto[]> {
    const roles = await this.repo.findAll()
    return roles.map(RoleMapper.toResponse)
  }

  async getById(id: number): Promise<RoleResponseDto> {
    this.assertValidId(id)

    const role = await this.repo.findById(id)
    if (!role) throw new Error('NOT_FOUND: Role not found')

    return RoleMapper.toResponse(role)
  }

  async update(id: number, dto: UpdateRoleDto, updatedBy: string): Promise<RoleResponseDto> {
    this.assertValidId(id)

    const patch = await this.buildPatch(id, dto)
    const updated = await this.repo.updateInfo(id, patch, updatedBy)

    return RoleMapper.toResponse(updated)
  }

  async setState(id: number, state: boolean, updatedBy: string): Promise<RoleResponseDto> {
    this.assertValidId(id)
    if (typeof state !== 'boolean') throw new Error('VALIDATION_ERROR: state must be boolean')

    const updated = await this.repo.updateState(id, state, updatedBy)
    return RoleMapper.toResponse(updated)
  }

  async delete(id: number, deletedBy: string): Promise<{ ok: true }> {
    this.assertValidId(id)

    const ok = await this.repo.softDelete(id, deletedBy)
    if (!ok) throw new Error('NOT_FOUND: Role not found')

    return { ok: true }
  }

  // -------------------------
  // Helpers
  // -------------------------

  private assertValidId(id: number) {
    if (!Number.isFinite(id) || id <= 0) throw new Error('VALIDATION_ERROR: Invalid id')
  }

  private async buildPatch(id: number, dto: UpdateRoleDto): Promise<UpdateRoleDto> {
    const patch: UpdateRoleDto = {}

    if (dto.name !== undefined) {
      const name = String(dto.name).trim()
      if (!name) throw new Error('VALIDATION_ERROR: name empty')

      const existing = await this.repo.findByName(name)
      if (existing && existing.id !== id) throw new Error('CONFLICT: Role name already exists')

      patch.name = name
    }

    if (dto.description !== undefined) {
      const description = String(dto.description).trim()
      patch.description = description.length ? description : undefined
    }

    return patch
  }
}
