import crypto from 'node:crypto'

export class PasswordService {
  static async hashPassword(password: string): Promise<{ hash: Buffer; salt: Buffer }> {
    const salt = crypto.randomBytes(16)

    const hash = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return reject(err)
        resolve(derivedKey as Buffer)
      })
    })

    return { hash, salt }
  }

  static async verifyPassword(
    password: string,
    salt: Buffer,
    expectedHash: Buffer
  ): Promise<boolean> {
    const computed = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return reject(err)
        resolve(derivedKey as Buffer)
      })
    })

    if (computed.length !== expectedHash.length) return false
    return crypto.timingSafeEqual(computed, expectedHash)
  }
}
