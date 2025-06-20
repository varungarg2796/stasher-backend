import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  username: string;
}
