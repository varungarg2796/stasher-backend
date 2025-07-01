import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShareService {
  constructor(private prisma: PrismaService) {}

  async findSharedCollection(shareId: string) {
    const shareSettings = await this.prisma.shareSettings.findUnique({
      where: { shareId },
      include: {
        collection: {
          include: {
            owner: {
              select: { username: true }, // Select only the public username
            },
            items: {
              where: {
                item: {
                  archived: false,
                },
              },
              orderBy: { order: 'asc' },
              include: {
                item: {
                  // Include full item data to be filtered
                  include: {
                    location: true,
                    tags: { include: { tag: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!shareSettings || !shareSettings.isEnabled) {
      throw new NotFoundException(
        'Shared collection not found or access is disabled.',
      );
    }

    const { collection } = shareSettings;
    const displaySettings = shareSettings.displaySettings as any;

    // Sanitize the items based on display settings
    const sanitizedItems = collection.items.map((collectionItem) => {
      const { item } = collectionItem;
      const sanitizedItem: any = {
        id: item.id,
        name: item.name,
        imageUrl: item.imageUrl,
        iconType: item.iconType,
        collectionNote: collectionItem.collectionNote,
      };

      if (displaySettings.showDescription)
        sanitizedItem.description = item.description;
      if (displaySettings.showQuantity) sanitizedItem.quantity = item.quantity;
      if (displaySettings.showLocation)
        sanitizedItem.location = item.location?.name || null;
      if (displaySettings.showTags)
        sanitizedItem.tags = item.tags.map((t) => t.tag.name);
      if (displaySettings.showPrice) {
        sanitizedItem.price = item.price;
        sanitizedItem.priceless = item.priceless;
      }
      if (displaySettings.showAcquisitionDate)
        sanitizedItem.acquisitionDate = item.acquisitionDate;

      return sanitizedItem;
    });

    return {
      name: collection.name,
      description: collection.description,
      coverImage: collection.coverImage,
      by: collection.owner.username,
      items: sanitizedItems,
    };
  }
}
