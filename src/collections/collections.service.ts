import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ReorderCollectionItemsDto } from './dto/reorder-collection-items.dto';
import { UpdateShareSettingsDto } from './dto/update-share-settings.dto';

@Injectable()
export class CollectionsService {
  constructor(private prisma: PrismaService) {}

  // Helper to verify collection ownership
  private async verifyOwnership(collectionId: string, userId: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) {
      throw new NotFoundException('Collection not found.');
    }
    if (collection.ownerId !== userId) {
      throw new ForbiddenException('Access to this resource is denied.');
    }
    return collection;
  }

  async create(createCollectionDto: CreateCollectionDto, userId: string) {
    return this.prisma.collection.create({
      data: {
        ...createCollectionDto,
        ownerId: userId,
        // Create default share settings along with the collection
        shareSettings: {
          create: {
            displaySettings: {
              showDescription: true,
              showQuantity: false,
              showLocation: false,
              showTags: true,
              showPrice: false,
              showAcquisitionDate: false,
            },
          },
        },
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.collection.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            items: {
              where: {
                item: {
                  archived: false,
                },
              },
            },
          },
        },
      }, // Include non-archived item count only
    });
  }

  async findOne(id: string, userId: string, includeArchived = false) {
    await this.verifyOwnership(id, userId);
    const whereClause = includeArchived
      ? {}
      : {
          item: {
            archived: false,
          },
        };

    return this.prisma.collection.findUnique({
      where: { id },
      include: {
        items: {
          where: whereClause,
          orderBy: { order: 'asc' },
          include: { item: true }, // Include the full item details
        },
        shareSettings: true,
      },
    });
  }

  async update(id: string, dto: UpdateCollectionDto, userId: string) {
    await this.verifyOwnership(id, userId);
    return this.prisma.collection.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.verifyOwnership(id, userId);
    return this.prisma.collection.delete({ where: { id } });
  }

  async addItem(collectionId: string, itemId: string, userId: string) {
    await this.verifyOwnership(collectionId, userId);
    const item = await this.prisma.item.findUnique({ where: { id: itemId } });
    if (!item || item.ownerId !== userId) {
      throw new ForbiddenException("Item does not exist or you don't own it.");
    }

    const existingEntry = await this.prisma.collectionItem.findUnique({
      where: { collectionId_itemId: { collectionId, itemId } },
    });
    if (existingEntry) {
      throw new ConflictException('Item is already in this collection.');
    }

    // Add item to the end of the list
    const maxOrder = await this.prisma.collectionItem.aggregate({
      where: { collectionId },
      _max: { order: true },
    });
    const newOrder = (maxOrder._max.order ?? -1) + 1;

    return this.prisma.collectionItem.create({
      data: {
        collectionId,
        itemId,
        order: newOrder,
      },
    });
  }

  async removeItem(collectionId: string, itemId: string, userId: string) {
    await this.verifyOwnership(collectionId, userId);
    return this.prisma.collectionItem.delete({
      where: { collectionId_itemId: { collectionId, itemId } },
    });
  }

  async reorderItems(
    id: string,
    dto: ReorderCollectionItemsDto,
    userId: string,
  ) {
    await this.verifyOwnership(id, userId);
    const updates = dto.items.map((item) =>
      this.prisma.collectionItem.update({
        where: {
          collectionId_itemId: { collectionId: id, itemId: item.itemId },
        },
        data: { order: item.order },
      }),
    );
    // Use a transaction to update all orders at once
    return this.prisma.$transaction(updates);
  }

  async updateShareSettings(
    id: string,
    dto: UpdateShareSettingsDto,
    userId: string,
  ) {
    await this.verifyOwnership(id, userId);
    return this.prisma.shareSettings.update({
      where: { collectionId: id },
      data: {
        isEnabled: dto.isEnabled,
        displaySettings: dto.displaySettings as any, // Cast to any to satisfy Prisma's Json type
      },
    });
  }
}
