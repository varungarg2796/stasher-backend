import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty({ message: 'Location name cannot be empty.' })
  @MinLength(1)
  @MaxLength(50)
  name: string;
}
