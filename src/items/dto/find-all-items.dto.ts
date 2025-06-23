/* eslint-disable prettier/prettier */
import {
  IsOptional,
  IsString,
  IsIn,
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
  @IsString()
  @IsIn(['true', 'false']) // Only allow these two string values
  archived?: string;

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
