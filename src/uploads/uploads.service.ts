import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    const minioEndpoint = this.configService.get<string>('MINIO_ENDPOINT');
    const minioPort = +this.configService.get<number>('MINIO_PORT');
    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME');

    this.publicUrl =
      this.configService.get<string>('MINIO_PUBLIC_URL') ||
      `${useSSL ? 'https' : 'http'}://${minioEndpoint}:${minioPort}`;

    this.minioClient = new Minio.Client({
      endPoint: minioEndpoint,
      port: minioPort,
      useSSL: useSSL,
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY'),
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY'),
    });
  }

  async onModuleInit() {
    await this.ensureBucketExists();
  }

  private async ensureBucketExists(): Promise<void> {
    try {
      const bucketExists = await this.minioClient.bucketExists(this.bucketName);
      if (!bucketExists) {
        console.log(`Bucket "${this.bucketName}" does not exist. Creating...`);
        await this.minioClient.makeBucket(this.bucketName);
        console.log(`Bucket "${this.bucketName}" created.`);
      }

      // Always ensure the public read policy is set correctly on startup
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucketName}/*`],
          },
        ],
      };

      await this.minioClient.setBucketPolicy(
        this.bucketName,
        JSON.stringify(policy),
      );
    } catch (error) {
      console.error('MinIO Error Details:', error);
      throw new InternalServerErrorException(
        'Failed to verify or create MinIO bucket.',
        error.message,
      );
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<{ url: string }> {
    if (!file) {
      throw new InternalServerErrorException('No file provided for upload.');
    }

    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${uuidv4()}.${fileExtension}`;

    try {
      await this.minioClient.putObject(
        this.bucketName,
        fileName,
        file.buffer,
        file.size,
        {
          'Content-Type': file.mimetype,
        },
      );

      const url = `${this.publicUrl}/${this.bucketName}/${fileName}`;

      return { url };
    } catch (error) {
      console.error('File Upload Error Details:', error);
      throw new InternalServerErrorException(
        'Failed to upload file to MinIO.',
        error.message,
      );
    }
  }
}
