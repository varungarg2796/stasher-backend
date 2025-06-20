import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  MinLength,
  IsEnum,
  ArrayMaxSize,
} from 'class-validator';

enum Currency {
  INR = 'INR',
  USD = 'USD',
  EUR = 'EUR',
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long.' })
  @MaxLength(30)
  username?: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true, message: 'Location name cannot be empty.' })
  @MaxLength(50, {
    each: true,
    message: 'Location name must be 50 characters or less.',
  })
  locations?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true, message: 'Tag name cannot be empty.' })
  @MaxLength(50, {
    each: true,
    message: 'Tag name must be 50 characters or less.',
  })
  tags?: string[];
}
