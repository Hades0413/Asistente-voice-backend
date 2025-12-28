import { query } from '../../../infra/db/database'
import { Role } from '../models/role.model'

type CreateRoleInput = {
  name: string
  description?: string
  state: boolean
  created_by: string
}

type UpdateRoleInput = {
  name?: string
  description?: string
}

export class RoleRepository {
  async findById(id: number): Promise<Role | null> {
    const rows = await query<Role>(
      `SELECT * FROM "Role" WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    )
    return rows[0] ?? null
  }

  async findByName(name: string): Promise<Role | null> {
    const rows = await query<Role>(
      `SELECT * FROM "Role" WHERE name = $1 AND deleted_at IS NULL LIMIT 1`,
      [name]
    )
    return rows[0] ?? null
  }

  async findAll(): Promise<Role[]> {
    return query<Role>(`SELECT * FROM "Role" WHERE deleted_at IS NULL ORDER BY id DESC`)
  }

  async create(input: CreateRoleInput): Promise<Role> {
    const rows = await query<Role>(
      `
      INSERT INTO "Role" (name, description, state, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [input.name, input.description ?? null, input.state, input.created_by]
    )

    return rows[0]
  }

  async updateInfo(id: number, patch: UpdateRoleInput, updatedBy: string): Promise<Role> {
    const sets: string[] = []
    const values: any[] = []
    let idx = 1

    const add = (field: string, value: any) => {
      sets.push(`${field} = $${idx++}`)
      values.push(value)
    }

    if (patch.name !== undefined) add('name', patch.name)
    if (patch.description !== undefined) add('description', patch.description ?? null)

    add('updated_at', new Date())
    add('updated_by', updatedBy)

    values.push(id)

    const rows = await query<Role>(
      `
      UPDATE "Role"
      SET ${sets.join(', ')}
      WHERE id = $${idx} AND deleted_at IS NULL
      RETURNING *;
      `,
      values
    )

    if (!rows[0]) throw new Error('NOT_FOUND: Role not found')
    return rows[0]
  }

  async updateState(id: number, state: boolean, updatedBy: string): Promise<Role> {
    const rows = await query<Role>(
      `
      UPDATE "Role"
      SET state = $1,
          updated_at = $2,
          updated_by = $3
      WHERE id = $4 AND deleted_at IS NULL
      RETURNING *;
      `,
      [state, new Date(), updatedBy, id]
    )

    if (!rows[0]) throw new Error('NOT_FOUND: Role not found')
    return rows[0]
  }

  async softDelete(id: number, deletedBy: string): Promise<boolean> {
    const now = new Date()
    const rows = await query<{ id: number }>(
      `
      UPDATE "Role"
      SET deleted_at = $1,
          deleted_by = $2,
          updated_at = $1,
          updated_by = $2
      WHERE id = $3 AND deleted_at IS NULL
      RETURNING id;
      `,
      [now, deletedBy, id]
    )

    return !!rows[0]
  }
}
