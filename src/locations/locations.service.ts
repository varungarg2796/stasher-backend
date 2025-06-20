import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.location.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async create(name: string, userId: string) {
    const locationCount = await this.prisma.location.count({
      where: { userId },
    });

    if (locationCount >= 20) {
      throw new ConflictException('Location limit of 20 has been reached.');
    }

    return this.prisma.location.create({
      data: { name, userId },
    });
  }

  async remove(id: string, userId: string) {
    const location = await this.prisma.location.findUnique({
      where: { id },
    });

    if (!location) {
      throw new NotFoundException('Location not found.');
    }

    if (location.userId !== userId) {
      throw new ForbiddenException('Access to this resource is denied.');
    }

    const itemsInLocation = await this.prisma.item.count({
      where: { locationId: id },
    });

    if (itemsInLocation > 0) {
      throw new ConflictException(
        `Cannot delete location as it is used by ${itemsInLocation} item(s).`,
      );
    }

    await this.prisma.location.delete({ where: { id } });
  }
}
