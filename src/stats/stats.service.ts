import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats(userId: string) {
    // --- Step 1: Run simple aggregations in parallel ---
    const [totalItems, totalValue, locationCount, tagCount] =
      await this.prisma.$transaction([
        this.prisma.item.count({ where: { ownerId: userId, archived: false } }),
        this.prisma.item.aggregate({
          _sum: { price: true },
          where: { ownerId: userId, archived: false, priceless: false },
        }),
        this.prisma.location.count({ where: { userId } }),
        this.prisma.tag.count({ where: { userId } }),
      ]);

    // --- Step 2: Run groupBy queries separately to avoid TypeScript issue ---
    const itemsByLocation = await this.prisma.item.groupBy({
      by: ['locationId'],
      where: { ownerId: userId, archived: false, locationId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    const itemsByTag = await this.prisma.itemTag.groupBy({
      by: ['tagId'],
      where: { item: { ownerId: userId, archived: false } },
      _count: { itemId: true },
      orderBy: { _count: { itemId: 'desc' } },
      take: 5,
    });

    // --- Step 3: Process Location Data ---
    const locationIds = itemsByLocation.map((l) => l.locationId);
    let locationChartData = [];
    if (locationIds.length > 0) {
      const locations = await this.prisma.location.findMany({
        where: { id: { in: locationIds } },
      });
      const locationNameMap = new Map(locations.map((l) => [l.id, l.name]));
      locationChartData = itemsByLocation.map((l) => ({
        name: locationNameMap.get(l.locationId) || 'Unknown',
        count: l._count.id,
      }));
    }

    // --- Step 4: Process Tag Data ---
    const tagIds = itemsByTag.map((t) => t.tagId);
    let tagChartData = [];
    if (tagIds.length > 0) {
      const tags = await this.prisma.tag.findMany({
        where: { id: { in: tagIds } },
      });
      const tagNameMap = new Map(tags.map((t) => [t.id, t.name]));
      tagChartData = itemsByTag.map((t) => ({
        name: tagNameMap.get(t.tagId) || 'Unknown',
        count: t._count.itemId,
      }));
    }

    // --- Step 5: Assemble and return the final response ---
    return {
      totalItems,
      totalValue: totalValue._sum.price || 0,
      uniqueLocations: locationCount,
      uniqueTags: tagCount,
      locationDistribution: locationChartData,
      tagDistribution: tagChartData,
    };
  }
}
