export interface PublicUser {
  id: number;
  username: string;
  email: string;
  firstname: string;
  lastname: string;
  last_login_at?: Date;
  failed_login_attempts: number;
  lockout_end?: Date;
  password_changed_at?: Date;
  security_stamp: string;
  state: boolean;
  photo?: string;
  created_at: Date;
  created_by: string;
  updated_at?: Date;
  updated_by?: string;
  deleted_at?: Date;
  deleted_by?: string;
  row_version: string;
}
