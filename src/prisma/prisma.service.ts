// src/prisma/prisma.service.ts

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasourceUrl: process.env.DATABASE_URL,
    });
  }

  async onModuleInit() {
    const maxRetries = 10;
    const retryDelay = 5000; // 5 seconds between retries
    let currentTry = 1;

    while (currentTry <= maxRetries) {
      try {
        await this.$connect();
        console.log('Successfully connected to database');
        return;
      } catch (error) {
        console.log(
          `Failed to connect to database (attempt ${currentTry}/${maxRetries}):`,
          error.message,
        );

        if (currentTry === maxRetries) {
          throw new Error(
            'Failed to connect to database after maximum retries',
          );
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        currentTry++;
      }
    }
  }

  async onModuleDestroy() {
    // Gracefully disconnect Prisma Client when the NestJS application shuts down
    await this.$disconnect();
    console.log('Prisma Client Disconnected');
  }

  // Optional: Add custom methods if you need to extend Prisma functionalities
  // Example: async cleanDatabase() { ... } for testing purposes
}
