import { IsBoolean, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class DisplaySettingsDto {
  @IsBoolean()
  showDescription: boolean;
  @IsBoolean()
  showQuantity: boolean;
  @IsBoolean()
  showLocation: boolean;
  @IsBoolean()
  showTags: boolean;
  @IsBoolean()
  showPrice: boolean;
  @IsBoolean()
  showAcquisitionDate: boolean;
}

export class UpdateShareSettingsDto {
  @IsBoolean()
  isEnabled: boolean;

  @IsObject()
  @ValidateNested()
  @Type(() => DisplaySettingsDto)
  displaySettings: DisplaySettingsDto;
}
