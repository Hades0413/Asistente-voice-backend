export interface CreateUserDto {
  username: string;
  email: string;
  firstname: string;
  lastname: string;
  password: string;
  photo?: string;
}
