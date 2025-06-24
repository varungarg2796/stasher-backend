import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredTokens() {
    this.logger.log('Starting refresh token cleanup...');

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await this.prisma.refreshToken.deleteMany({
        where: {
          OR: [
            {
              expiresAt: {
                lt: new Date(),
              },
              isRevoked: true,
              updatedAt: {
                lt: thirtyDaysAgo,
              },
            },
            {
              expiresAt: {
                lt: thirtyDaysAgo,
              },
            },
          ],
        },
      });

      this.logger.log(
        `Cleanup completed: ${result.count} expired refresh tokens deleted`,
      );
    } catch (error) {
      this.logger.error('Token cleanup failed:', error);
    }
  }
}
