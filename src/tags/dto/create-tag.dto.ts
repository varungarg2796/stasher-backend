import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';

export class CreateTagDto {
  @IsString()
  @IsNotEmpty({ message: 'Tag name cannot be empty.' })
  @MinLength(1)
  @MaxLength(50)
  name: string;
}
