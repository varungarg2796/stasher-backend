import { IsString, IsNotEmpty } from 'class-validator';

export class AddItemToCollectionDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;
}
