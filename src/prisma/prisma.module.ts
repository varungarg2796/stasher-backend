// src/prisma/prisma.module.ts

import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Makes PrismaService available globally without needing to import PrismaModule everywhere
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // Export PrismaService so other modules can inject it
})
export class PrismaModule {}
