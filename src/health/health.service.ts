import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  database: {
    status: 'connected' | 'disconnected';
    responseTime?: number;
  };
  services: {
    minioStorage: 'available' | 'unavailable';
    googleAI: 'available' | 'unavailable';
  };
  version?: string;
  environment?: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getHealthStatus(): Promise<HealthStatus> {
    // Check database connectivity
    const dbHealth = await this.checkDatabase();

    // Check external services
    const servicesHealth = await this.checkExternalServices();

    const overallStatus =
      dbHealth.status === 'connected' &&
      servicesHealth.minioStorage === 'available'
        ? 'healthy'
        : 'unhealthy';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth,
      services: servicesHealth,
      version: process.env.npm_package_version || '1.0.0',
      environment: this.configService.get('NODE_ENV') || 'development',
    };
  }

  private async checkDatabase(): Promise<{
    status: 'connected' | 'disconnected';
    responseTime?: number;
  }> {
    try {
      const startTime = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;

      return {
        status: 'connected',
        responseTime,
      };
    } catch (error) {
      console.error('Database health check failed:', error);
      return {
        status: 'disconnected',
      };
    }
  }

  private async checkExternalServices(): Promise<{
    minioStorage: 'available' | 'unavailable';
    googleAI: 'available' | 'unavailable';
  }> {
    const [minioStatus, aiStatus] = await Promise.allSettled([
      this.checkMinioStorage(),
      this.checkGoogleAI(),
    ]);

    return {
      minioStorage:
        minioStatus.status === 'fulfilled' ? 'available' : 'unavailable',
      googleAI: aiStatus.status === 'fulfilled' ? 'available' : 'unavailable',
    };
  }

  private async checkMinioStorage(): Promise<void> {
    // Basic check - verify MinIO configuration exists
    const minioEndpoint = this.configService.get('MINIO_ENDPOINT');
    const minioAccessKey = this.configService.get('MINIO_ACCESS_KEY');

    if (!minioEndpoint || !minioAccessKey) {
      throw new Error('MinIO configuration missing');
    }

    // You could add actual MinIO connectivity test here if needed
    // For now, just check if config is present
  }

  private async checkGoogleAI(): Promise<void> {
    // Basic check - verify Google AI API key exists
    const googleApiKey = this.configService.get('GOOGLE_API_KEY');

    if (!googleApiKey) {
      throw new Error('Google AI API key missing');
    }

    // You could add actual API connectivity test here if needed
  }
}
