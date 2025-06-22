import { IsArray, ValidateNested, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class ReorderItemDto {
  @IsString()
  itemId: string;

  @IsNumber()
  order: number;
}

export class ReorderCollectionItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}
