import { IsNotEmpty, IsJWT, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'Refresh token should not be empty' })
  @IsJWT({ message: 'Invalid refresh token format' })
  refreshToken: string;
}
