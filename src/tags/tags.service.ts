import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async create(name: string, userId: string) {
    const tagCount = await this.prisma.tag.count({
      where: { userId },
    });

    if (tagCount >= 20) {
      throw new ConflictException('Tag limit of 20 has been reached.');
    }

    return this.prisma.tag.create({
      data: { name, userId },
    });
  }

  async remove(id: string, userId: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { id },
    });

    if (!tag) {
      throw new NotFoundException('Tag not found.');
    }

    if (tag.userId !== userId) {
      throw new ForbiddenException('Access to this resource is denied.');
    }

    const itemsWithTag = await this.prisma.itemTag.count({
      where: { tagId: id },
    });

    if (itemsWithTag > 0) {
      throw new ConflictException(
        `Cannot delete tag as it is used by ${itemsWithTag} item(s).`,
      );
    }

    await this.prisma.tag.delete({ where: { id } });
  }
}
