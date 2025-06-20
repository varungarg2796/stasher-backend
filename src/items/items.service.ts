import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { FindAllItemsDto } from './dto/find-all-items.dto';
import { BulkCreateItemDto } from './dto/bulk-create-item.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Validates that the provided location and tag names exist for the user.
   * Throws a BadRequestException if any are not found.
   * @returns An object with the validated locationId and an array of tagIds.
   */
  private async getAndValidateRelationIds(
    tx: Prisma.TransactionClient,
    userId: string,
    locationName?: string,
    tagNames?: string[],
  ) {
    let locationId: string | null = null;
    if (locationName) {
      const location = await tx.location.findUnique({
        where: { name_userId: { name: locationName, userId } },
      });
      if (!location) {
        throw new BadRequestException(
          `Location "${locationName}" does not exist. Please add it from your profile settings first.`,
        );
      }
      locationId = location.id;
    }

    const tagIds: string[] = [];
    if (tagNames && tagNames.length > 0) {
      const tags = await tx.tag.findMany({
        where: { userId, name: { in: tagNames } },
      });
      if (tags.length !== tagNames.length) {
        const foundTagNames = tags.map((t) => t.name);
        const missingTag = tagNames.find((t) => !foundTagNames.includes(t));
        throw new BadRequestException(
          `Tag "${missingTag}" does not exist. Please add it from your profile settings first.`,
        );
      }
      tagIds.push(...tags.map((t) => t.id));
    }

    return { locationId, tagIds };
  }

  async create(createItemDto: CreateItemDto, userId: string) {
    const itemCount = await this.prisma.item.count({
      where: { ownerId: userId, archived: false },
    });
    if (itemCount >= 40) {
      throw new ForbiddenException('Item limit of 40 reached.');
    }

    const { location, tags, acquisitionDate, expiryDate, ...itemData } =
      createItemDto;

    return this.prisma.$transaction(async (tx) => {
      // STRICT VALIDATION: Ensure all relations exist before creating.
      const { locationId, tagIds } = await this.getAndValidateRelationIds(
        tx,
        userId,
        location,
        tags,
      );

      return tx.item.create({
        data: {
          ...itemData,
          owner: { connect: { id: userId } },
          // Only use connect, never create.
          location: locationId ? { connect: { id: locationId } } : undefined,
          tags: {
            create: tagIds.map((id) => ({
              tag: { connect: { id } },
            })),
          },
          acquisitionDate: acquisitionDate
            ? new Date(acquisitionDate)
            : undefined,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          history: { create: { action: 'created' } },
        },
      });
    });
  }

  async update(id: string, updateItemDto: UpdateItemDto, userId: string) {
    await this.findOne(id, userId); // Ownership check

    return this.prisma.$transaction(async (tx) => {
      const { location, tags, acquisitionDate, expiryDate, ...itemData } =
        updateItemDto;

      // STRICT VALIDATION: Ensure all relations exist before updating.
      const { locationId, tagIds } = await this.getAndValidateRelationIds(
        tx,
        userId,
        location,
        tags,
      );

      return tx.item.update({
        where: { id },
        data: {
          ...itemData,
          location:
            location !== undefined
              ? locationId
                ? { connect: { id: locationId } }
                : { disconnect: true }
              : undefined,
          tags:
            tags !== undefined
              ? {
                  deleteMany: {}, // Disconnect all existing tags
                  create: tagIds.map((tagId) => ({
                    // Connect the new set
                    tag: { connect: { id: tagId } },
                  })),
                }
              : undefined,
          acquisitionDate: acquisitionDate
            ? new Date(acquisitionDate)
            : undefined,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          history: { create: { action: 'updated' } },
        },
      });
    });
  }

  async bulkCreate(bulkCreateDto: BulkCreateItemDto, userId: string) {
    const itemsToCreate = bulkCreateDto.items;
    const currentItemCount = await this.prisma.item.count({
      where: { ownerId: userId, archived: false },
    });
    if (currentItemCount + itemsToCreate.length > 40) {
      throw new ForbiddenException(`Your plan limit of 40 would be exceeded.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const createdItems = [];
      for (const itemDto of itemsToCreate) {
        // STRICT VALIDATION for each item in the bulk request
        const { locationId, tagIds } = await this.getAndValidateRelationIds(
          tx,
          userId,
          itemDto.location,
          itemDto.tags,
        );

        const { acquisitionDate, expiryDate, ...itemData } = itemDto;

        const newItem = await tx.item.create({
          data: {
            ...itemData,
            owner: { connect: { id: userId } },
            location: locationId ? { connect: { id: locationId } } : undefined,
            tags: {
              create: tagIds.map((id) => ({ tag: { connect: { id } } })),
            },
            acquisitionDate: acquisitionDate
              ? new Date(acquisitionDate)
              : undefined,
            expiryDate: expiryDate ? new Date(expiryDate) : undefined,
            history: { create: { action: 'created' } },
          },
        });
        createdItems.push(newItem);
      }
      return { message: `${createdItems.length} items created successfully.` };
    });
  }

  // FindAll and FindOne methods remain unchanged.
  async findAll(userId: string, queryDto: FindAllItemsDto) {
    const { search, location, tag, archived, sort, page, limit } = queryDto;
    const skip = (page - 1) * limit;
    const where: Prisma.ItemWhereInput = {
      ownerId: userId,
      archived: archived,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (location) {
      where.location = { name: { equals: location, mode: 'insensitive' } };
    }
    if (tag) {
      where.tags = {
        some: { tag: { name: { equals: tag, mode: 'insensitive' } } },
      };
    }

    let orderBy: Prisma.ItemOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'oldest') orderBy = { createdAt: 'asc' };
    if (sort === 'name-asc') orderBy = { name: 'asc' };
    if (sort === 'name-desc') orderBy = { name: 'desc' };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        include: {
          location: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.item.count({ where }),
    ]);

    return {
      data: items.map((item) => ({
        ...item,
        tags: item.tags.map((t) => t.tag.name),
        location: item.location?.name || null,
      })),
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
    };
  }

  async findOne(id: string, userId: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        location: true,
        tags: { include: { tag: true } },
        history: { orderBy: { date: 'desc' } },
      },
    });

    if (!item || item.ownerId !== userId) {
      throw new ForbiddenException('Access to this resource is denied.');
    }
    return {
      ...item,
      tags: item.tags.map((t) => t.tag.name),
      location: item.location?.name || null,
    };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    await this.prisma.item.delete({ where: { id } });
  }
}
