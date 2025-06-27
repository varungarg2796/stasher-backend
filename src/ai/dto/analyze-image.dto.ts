import { IsString, IsNotEmpty, IsBase64 } from 'class-validator';

export class AnalyzeImageDto {
  @IsString()
  @IsNotEmpty()
  @IsBase64() // Ensures the string is a valid Base64 encoding
  imageData: string; // The Base64 encoded image data, without the 'data:image/jpeg;base64,' prefix

  @IsString()
  @IsNotEmpty()
  mimeType: string; // e.g., 'image/jpeg', 'image/png'
}
