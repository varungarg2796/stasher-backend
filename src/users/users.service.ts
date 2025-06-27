import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Location, Tag } from '@prisma/client';
import { UpdatePreferencesDto } from './dto/update-preference.dto';

// Define a more specific return type for clarity
type UserProfile = Omit<User, 'password'> & {
  locations: Location[];
  tags: Tag[];
  usage: {
    itemCount: number;
    itemLimit: number;
    locationCount: number;
    locationLimit: number;
    tagCount: number;
    tagLimit: number;
  };
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdWithUsage(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        locations: { orderBy: { name: 'asc' } }, // Include related locations
        tags: { orderBy: { name: 'asc' } }, // Include related tags
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const itemCount = await this.prisma.item.count({
      where: { ownerId: userId },
    });

    // Limits
    const itemLimit = 40;
    const locationLimit = 20;
    const tagLimit = 20;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;

    return {
      ...userWithoutPassword,
      usage: {
        itemCount,
        itemLimit,
        locationCount: user.locations.length,
        locationLimit,
        tagCount: user.tags.length,
        tagLimit,
      },
    };
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        locations: true,
        tags: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const transactionOperations = [];

    // --- 1. Handle Core Profile Updates (Username & Currency) ---
    const profileData: { username?: string; currency?: string } = {};
    if (dto.username !== undefined) {
      profileData.username = dto.username;
    }
    if (dto.currency !== undefined) {
      profileData.currency = dto.currency;
    }
    if (Object.keys(profileData).length > 0) {
      transactionOperations.push(
        this.prisma.user.update({
          where: { id: userId },
          data: profileData,
        }),
      );
    }

    // --- 2. Reconcile Locations ---
    if (dto.locations) {
      if (dto.locations.length > 20) {
        throw new ConflictException('You cannot have more than 20 locations.');
      }
      const currentLocations = user.locations.map((loc) => loc.name);
      const newLocations = dto.locations;

      const locationsToAdd = newLocations
        .filter((name) => !currentLocations.includes(name))
        .map((name) => ({ name, userId }));

      const locationsToRemove = user.locations.filter(
        (loc) => !newLocations.includes(loc.name),
      );

      const usedLocations = [];
      for (const loc of locationsToRemove) {
        const itemCount = await this.prisma.item.count({
          where: { locationId: loc.id },
        });
        if (itemCount > 0) {
          usedLocations.push(loc.name);
        }
      }

      if (usedLocations.length > 0) {
        throw new ConflictException(
          `Cannot remove locations in use: ${usedLocations.join(', ')}`,
        );
      }

      if (locationsToRemove.length > 0) {
        transactionOperations.push(
          this.prisma.location.deleteMany({
            where: { id: { in: locationsToRemove.map((loc) => loc.id) } },
          }),
        );
      }
      if (locationsToAdd.length > 0) {
        transactionOperations.push(
          this.prisma.location.createMany({ data: locationsToAdd }),
        );
      }
    }

    // --- 3. Reconcile Tags ---
    if (dto.tags) {
      if (dto.tags.length > 20) {
        throw new ConflictException('You cannot have more than 20 tags.');
      }
      const currentTags = user.tags.map((tag) => tag.name);
      const newTags = dto.tags;

      const tagsToAdd = newTags
        .filter((name) => !currentTags.includes(name))
        .map((name) => ({ name, userId }));

      const tagsToRemove = user.tags.filter(
        (tag) => !newTags.includes(tag.name),
      );

      const usedTags = [];
      for (const tag of tagsToRemove) {
        const itemCount = await this.prisma.itemTag.count({
          where: { tagId: tag.id },
        });
        if (itemCount > 0) {
          usedTags.push(tag.name);
        }
      }

      if (usedTags.length > 0) {
        throw new ConflictException(
          `Cannot remove tags in use: ${usedTags.join(', ')}`,
        );
      }

      if (tagsToRemove.length > 0) {
        transactionOperations.push(
          this.prisma.tag.deleteMany({
            where: { id: { in: tagsToRemove.map((tag) => tag.id) } },
          }),
        );
      }
      if (tagsToAdd.length > 0) {
        transactionOperations.push(
          this.prisma.tag.createMany({ data: tagsToAdd }),
        );
      }
    }

    // --- 4. Execute all changes in a single transaction ---
    if (transactionOperations.length > 0) {
      await this.prisma.$transaction(transactionOperations);
    }

    // --- 5. Return the fully updated user profile ---
    return this.findByIdWithUsage(userId);
  }

  async checkUsernameAvailability(
    username: string,
  ): Promise<{ available: boolean }> {
    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });
    return { available: !existingUser };
  }
}
