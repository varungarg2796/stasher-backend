import { IsString, IsOptional, MaxLength } from 'class-validator';

export class ItemActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
