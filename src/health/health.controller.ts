import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService, HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(@Res() res: Response): Promise<void> {
    try {
      const healthStatus: HealthStatus =
        await this.healthService.getHealthStatus();

      const statusCode =
        healthStatus.status === 'healthy'
          ? HttpStatus.OK
          : HttpStatus.SERVICE_UNAVAILABLE;

      res.status(statusCode).json(healthStatus);
    } catch (error) {
      console.error('Health check failed:', error);

      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        uptime: process.uptime(),
      });
    }
  }

  @Get('ready')
  async getReadiness(@Res() res: Response): Promise<void> {
    try {
      const healthStatus = await this.healthService.getHealthStatus();

      // Readiness check - requires database connection
      const isReady = healthStatus.database.status === 'connected';

      const statusCode = isReady
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE;

      res.status(statusCode).json({
        ready: isReady,
        timestamp: new Date().toISOString(),
        database: healthStatus.database,
      });
    } catch (error) {
      console.error('Readiness check failed:', error);

      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        ready: false,
        timestamp: new Date().toISOString(),
        error: 'Readiness check failed',
      });
    }
  }

  @Get('live')
  async getLiveness(@Res() res: Response): Promise<void> {
    // Liveness check - just verify the application is running
    res.status(HttpStatus.OK).json({
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }
}
