import { PasswordService } from '../../auth/services/domain/password.service'
import { CreateUserDto } from '../dtos/create-user.dto'
import { UpdateUserDto } from '../dtos/update-user.dto'
import { UserResponseDto } from '../dtos/user-response.dto'
import { UserMapper } from '../mappers/user.mapper'
import { UserRepository } from '../repositories/user.repository'

export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  // CREATE
  async createUser(dto: CreateUserDto, createdBy: string): Promise<UserResponseDto> {
    const username = dto.username.trim()
    const email = dto.email.trim().toLowerCase()

    if (!username || !email || !dto.firstname?.trim() || !dto.lastname?.trim() || !dto.password) {
      throw new Error('VALIDATION_ERROR: Missing required fields')
    }
    if (dto.password.length < 8) {
      throw new Error('VALIDATION_ERROR: Password too short')
    }

    const existingByUsername = await this.userRepo.findByUsername(username)
    if (existingByUsername) throw new Error('CONFLICT: Username already exists')

    const existingByEmail = await this.userRepo.findByEmail(email)
    if (existingByEmail) throw new Error('CONFLICT: Email already exists')

    const { hash, salt } = await PasswordService.hashPassword(dto.password)

    const user = await this.userRepo.create({
      username,
      email,
      firstname: dto.firstname.trim(),
      lastname: dto.lastname.trim(),
      password_hash: hash,
      password_salt: salt,
      photo: dto.photo,
      created_by: createdBy,
    })

    return UserMapper.toResponse(user)
  }

  // LIST ALL
  async listUsers(): Promise<UserResponseDto[]> {
    const users = await this.userRepo.findAll()
    return users.map(UserMapper.toResponse)
  }

  // GET BY ID
  async getUserById(id: number): Promise<UserResponseDto> {
    this.assertValidId(id)

    const user = await this.userRepo.findById(id)
    if (!user) throw new Error('NOT_FOUND: User not found')

    return UserMapper.toResponse(user)
  }

  // UPDATE (sin state)
  async updateUser(id: number, dto: UpdateUserDto, updatedBy: string): Promise<UserResponseDto> {
    this.assertValidId(id)
    this.assertStateNotEditable(dto)

    const patch = await this.buildProfilePatch(id, dto)
    const updated = await this.userRepo.updateProfile(id, patch, updatedBy)

    return UserMapper.toResponse(updated)
  }

  // UPDATE STATE (método separado)
  async setUserState(id: number, state: boolean, updatedBy: string): Promise<UserResponseDto> {
    this.assertValidId(id)
    if (typeof state !== 'boolean') throw new Error('VALIDATION_ERROR: state must be boolean')

    const updated = await this.userRepo.updateState(id, state, updatedBy)
    return UserMapper.toResponse(updated)
  }

  // DELETE (soft delete)
  async deleteUser(id: number, deletedBy: string): Promise<{ ok: true }> {
    this.assertValidId(id)

    const ok = await this.userRepo.softDelete(id, deletedBy)
    if (!ok) throw new Error('NOT_FOUND: User not found')

    return { ok: true }
  }

  // -------------------------
  // Helpers
  // -------------------------

  private assertValidId(id: number) {
    if (!Number.isFinite(id)) throw new Error('VALIDATION_ERROR: Invalid id')
  }

  private assertStateNotEditable(dto: UpdateUserDto) {
    if ((dto as any).state !== undefined) {
      throw new Error('VALIDATION_ERROR: state is not editable here')
    }
  }

  private asOptionalTrimmedString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined
    if (value === null) throw new Error(`VALIDATION_ERROR: ${field} must be a string`)
    if (typeof value !== 'string') throw new Error(`VALIDATION_ERROR: ${field} must be a string`)
    return value.trim()
  }

  private async buildProfilePatch(id: number, dto: UpdateUserDto): Promise<UpdateUserDto> {
    const patch: UpdateUserDto = {}

    await this.applyUsernamePatch(patch, id, dto.username)
    await this.applyEmailPatch(patch, id, dto.email)
    this.applyFirstnamePatch(patch, dto.firstname)
    this.applyLastnamePatch(patch, dto.lastname)
    this.applyPhotoPatch(patch, dto.photo)

    return patch
  }

  private async applyUsernamePatch(patch: UpdateUserDto, id: number, value: unknown) {
    const username = this.asOptionalTrimmedString(value, 'username')
    if (username === undefined) return
    if (!username) throw new Error('VALIDATION_ERROR: username empty')

    const existing = await this.userRepo.findByUsername(username)
    if (existing && existing.id !== id) throw new Error('CONFLICT: Username already exists')

    patch.username = username
  }

  private async applyEmailPatch(patch: UpdateUserDto, id: number, value: unknown) {
    const emailRaw = this.asOptionalTrimmedString(value, 'email')
    if (emailRaw === undefined) return

    const email = emailRaw.toLowerCase()
    if (!email) throw new Error('VALIDATION_ERROR: email empty')

    const existing = await this.userRepo.findByEmail(email)
    if (existing && existing.id !== id) throw new Error('CONFLICT: Email already exists')

    patch.email = email
  }

  private applyFirstnamePatch(patch: UpdateUserDto, value: unknown) {
    const firstname = this.asOptionalTrimmedString(value, 'firstname')
    if (firstname === undefined) return
    if (!firstname) throw new Error('VALIDATION_ERROR: firstname empty')

    patch.firstname = firstname
  }

  private applyLastnamePatch(patch: UpdateUserDto, value: unknown) {
    const lastname = this.asOptionalTrimmedString(value, 'lastname')
    if (lastname === undefined) return
    if (!lastname) throw new Error('VALIDATION_ERROR: lastname empty')

    patch.lastname = lastname
  }

  private applyPhotoPatch(patch: UpdateUserDto, value: unknown) {
    const photo = this.asOptionalTrimmedString(value, 'photo')
    if (photo === undefined) return

    patch.photo = photo.length ? photo : undefined
  }
}
