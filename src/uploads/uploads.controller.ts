import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadsService } from './uploads.service';

// Define the type for Multer file explicitly
import { Express } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file')) // 'file' must match the key in the form-data
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // 1 MB file size limit
          new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 1 }),
          // Regex for allowed image types
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|webp|gif)' }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.uploadsService.uploadFile(file);
  }
}
