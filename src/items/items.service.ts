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
   * Private helper to format a Prisma item object into a clean DTO for the frontend.
   */
  private formatItemResponse(item: any) {
    // This function can accept a raw item or one with nested history
    const { tags, location, history, ...rest } = item;
    return {
      ...rest,
      location: location?.name || null,
      tags: tags?.map((itemTag) => itemTag.tag.name) || [],
      history: history || [], // Ensure history is an array
    };
  }

  /**
   * Validates that provided location and tag names exist for the user.
   * Throws a BadRequestException if any are not found.
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

    const createdItem = await this.prisma.$transaction(async (tx) => {
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
          location: locationId ? { connect: { id: locationId } } : undefined,
          tags: { create: tagIds.map((id) => ({ tag: { connect: { id } } })) },
          acquisitionDate: acquisitionDate
            ? new Date(acquisitionDate)
            : undefined,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          history: { create: { action: 'created' } },
        },
        include: { location: true, tags: { include: { tag: true } } },
      });
    });

    return this.formatItemResponse(createdItem);
  }

  async update(id: string, updateItemDto: UpdateItemDto, userId: string) {
    await this.findOne(id, userId, true); // Use findOne for ownership check

    const updatedItem = await this.prisma.$transaction(async (tx) => {
      const { location, tags, acquisitionDate, expiryDate, ...itemData } =
        updateItemDto;

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
        include: { location: true, tags: { include: { tag: true } } },
      });
    });

    return this.formatItemResponse(updatedItem);
  }

  async findAll(userId: string, queryDto: FindAllItemsDto) {
    const { search, location, tag, archived, sort, page, limit } = queryDto;
    const skip = (page - 1) * limit;
    const where: Prisma.ItemWhereInput = {
      ownerId: userId,
    };
    where.archived = archived === 'true';
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
    if (sort === 'quantity-high') orderBy = { quantity: 'desc' };
    if (sort === 'quantity-low') orderBy = { quantity: 'asc' };
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

    // Manually format the response here
    const formattedData = items.map((item) => ({
      ...item,
      tags: item.tags.map((t) => t.tag.name),
      location: item.location?.name || null,
    }));

    return {
      data: formattedData,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
    };
  }

  async findOne(id: string, userId: string, raw = false) {
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

    if (raw) return item;
    return this.formatItemResponse(item);
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId, true);
    await this.prisma.item.delete({ where: { id } });
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
        const { location, tags, acquisitionDate, expiryDate, ...itemData } =
          itemDto;
        const { locationId, tagIds } = await this.getAndValidateRelationIds(
          tx,
          userId,
          location,
          tags,
        );

        const newItem = await tx.item.create({
          data: {
            ...itemData,
            ownerId: userId,
            locationId: locationId,
            tags: { create: tagIds.map((id) => ({ tagId: id })) },
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

  async archive(id: string, userId: string, note?: string) {
    await this.findOne(id, userId); // Ownership check
    return this.prisma.item.update({
      where: { id },
      data: {
        archived: true,
        history: {
          create: { action: 'archived', note: note || 'Item archived' },
        },
      },
    });
  }

  async restore(id: string, userId: string, note?: string) {
    await this.findOne(id, userId); // Ownership check
    return this.prisma.item.update({
      where: { id },
      data: {
        archived: false,
        history: {
          create: { action: 'restored', note: note || 'Item restored' },
        },
      },
    });
  }

  async gift(id: string, userId: string, note?: string) {
    const item = await this.findOne(id, userId, true); // Get raw item

    if (item.quantity > 1) {
      // Decrement quantity and add history
      return this.prisma.item.update({
        where: { id },
        data: {
          quantity: { decrement: 1 },
          history: { create: { action: 'gifted', note } },
        },
      });
    } else {
      // Archive the last item
      return this.archive(id, userId, note || 'Gifted (last one)');
    }
  }

  async use(id: string, userId: string, note?: string) {
    const item = await this.findOne(id, userId, true); // Get raw item

    if (item.quantity > 1) {
      // Decrement quantity
      return this.prisma.item.update({
        where: { id },
        data: {
          quantity: { decrement: 1 },
          history: { create: { action: 'used', note } },
        },
      });
    } else {
      // Archive the last item
      return this.archive(id, userId, note || 'Used (last one)');
    }
  }
}
