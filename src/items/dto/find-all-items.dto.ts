import {
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  IsNumber,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class FindAllItemsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  archived?: boolean = false; // Default to false

  @IsOptional()
  @IsIn(['newest', 'oldest', 'name-asc', 'name-desc'])
  sort?: string = 'newest'; // Default sort

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1; // Default page

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 12; // Default limit
}
