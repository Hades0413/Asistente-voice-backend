import crypto from 'node:crypto';

export class UserSessionManagementService {
  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  static getExpiryDate(hours = 24): Date {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }
}
