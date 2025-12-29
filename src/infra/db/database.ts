import dotenv from 'dotenv'
import { Pool, PoolClient, QueryResultRow } from 'pg'
import logger from '../../shared/logger'

dotenv.config()

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_MAX_POOL } = process.env

if (!DB_HOST || !DB_USER || !DB_NAME) {
  throw new Error('Database environment variables are missing!')
}

const pool = new Pool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  max: Number(DB_MAX_POOL),
})

pool.on('connect', () => {
  logger.info('Database connected')
})

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err)
  process.exit(-1)
})

export async function query<T extends QueryResultRow>(text: string, params?: any[]): Promise<T[]> {
  const client = await pool.connect()
  try {
    const res = await client.query<T>(text, params)
    return res.rows
  } catch (err) {
    logger.error(`Database query error: ${err}`)
    throw err
  } finally {
    client.release()
  }
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    logger.error(`Transaction error: ${err}`)
    throw err
  } finally {
    client.release()
  }
}

export default {
  pool,
  query,
  transaction,
}
