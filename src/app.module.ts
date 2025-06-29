import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { CollectionsModule } from './collections/collections.module';
import { LocationsModule } from './locations/locations.module';
import { TagsModule } from './tags/tags.module';
import { UploadsModule } from './uploads/uploads.module';
import { ShareModule } from './share/share.module';
import { AiModule } from './ai/ai.module';
import { StatsModule } from './stats/stats.module';
import { HealthModule } from './health/health.module';
import { TokenCleanupService } from './auth/token-cleanup.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    ItemsModule,
    CollectionsModule,
    LocationsModule,
    TagsModule,
    UploadsModule,
    ShareModule,
    AiModule,
    StatsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, TokenCleanupService],
})
export class AppModule {}
