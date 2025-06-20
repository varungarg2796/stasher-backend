import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  MaxLength,
  Min,
  Max,
  IsDateString,
  ArrayMaxSize,
} from 'class-validator';

export class CreateItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Item name is required.' })
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  iconType?: string;

  @IsNumber()
  @Min(1, { message: 'Quantity must be at least 1.' })
  @Max(9999)
  quantity: number;

  @IsOptional()
  @IsString()
  location?: string; // Send the name, e.g., "Kitchen"

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'An item can have a maximum of 10 tags.' })
  @IsString({ each: true })
  tags?: string[]; // Send names, e.g., ["Electronics", "Work"]

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  priceless?: boolean;

  @IsOptional()
  @IsDateString()
  acquisitionDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
