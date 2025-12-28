import { query } from '../../../infra/db/database'
import { User } from '../models/user.model'

type CreateUserInput = {
  username: string
  email: string
  firstname: string
  lastname: string
  password_hash: Buffer
  password_salt: Buffer
  photo?: string
  created_by: string
}

type UpdateProfileInput = {
  username?: string
  email?: string
  firstname?: string
  lastname?: string
  photo?: string
}

export class UserRepository {
  async findByUsername(username: string): Promise<User | null> {
    const rows = await query<User>(
      `SELECT * FROM "User" WHERE username = $1 AND deleted_at IS NULL LIMIT 1`,
      [username]
    )
    return rows[0] ?? null
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await query<User>(
      `SELECT * FROM "User" WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email]
    )
    return rows[0] ?? null
  }

  async findById(id: number): Promise<User | null> {
    const rows = await query<User>(
      `SELECT * FROM "User" WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    )
    return rows[0] ?? null
  }

  async findAll(): Promise<User[]> {
    return query<User>(`SELECT * FROM "User" WHERE deleted_at IS NULL ORDER BY id DESC`)
  }

  async create(user: CreateUserInput): Promise<User> {
    const rows = await query<User>(
      `
      INSERT INTO "User"
        (username, email, firstname, lastname, password_hash, password_salt, photo, created_by)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
      `,
      [
        user.username,
        user.email,
        user.firstname,
        user.lastname,
        user.password_hash,
        user.password_salt,
        user.photo ?? null,
        user.created_by,
      ]
    )

    return rows[0]
  }

  /**
   *Editar perfil (NO state)
   */
  async updateProfile(id: number, patch: UpdateProfileInput, updatedBy: string): Promise<User> {
    const sets: string[] = []
    const values: any[] = []
    let idx = 1

    const add = (field: string, value: any) => {
      sets.push(`${field} = $${idx++}`)
      values.push(value)
    }

    if (patch.username !== undefined) add('username', patch.username)
    if (patch.email !== undefined) add('email', patch.email)
    if (patch.firstname !== undefined) add('firstname', patch.firstname)
    if (patch.lastname !== undefined) add('lastname', patch.lastname)
    if (patch.photo !== undefined) add('photo', patch.photo ?? null)

    // siempre
    add('updated_at', new Date())
    add('updated_by', updatedBy)

    values.push(id)

    const rows = await query<User>(
      `
      UPDATE "User"
      SET ${sets.join(', ')}
      WHERE id = $${idx} AND deleted_at IS NULL
      RETURNING *;
      `,
      values
    )

    if (!rows[0]) throw new Error('NOT_FOUND: User not found')
    return rows[0]
  }

  /**
   *Cambiar estado (ACTIVO / INACTIVO)
   */
  async updateState(id: number, state: boolean, updatedBy: string): Promise<User> {
    const rows = await query<User>(
      `
      UPDATE "User"
      SET state = $1,
          updated_at = $2,
          updated_by = $3
      WHERE id = $4 AND deleted_at IS NULL
      RETURNING *;
      `,
      [state, new Date(), updatedBy, id]
    )

    if (!rows[0]) throw new Error('NOT_FOUND: User not found')
    return rows[0]
  }

  /**
   *Soft delete
   */
  async softDelete(id: number, deletedBy: string): Promise<boolean> {
    const rows = await query<User>(
      `
      UPDATE "User"
      SET deleted_at = $1,
          deleted_by = $2,
          updated_at = $1,
          updated_by = $2
      WHERE id = $3 AND deleted_at IS NULL
      RETURNING id;
      `,
      [new Date(), deletedBy, id]
    )

    return !!rows[0]
  }
}
