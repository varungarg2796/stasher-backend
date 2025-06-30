// src/auth/strategies/google.strategy.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

// Define the default data here for easy maintenance
const DEFAULT_LOCATIONS = [
  'Kitchen',
  'Bedroom',
  'Shoe Rack',
  'Bathroom',
  'Bedbox',
  'Study Table',
  'Basement',
  'Office Table',
  'Almirah #1',
  'Storage Room',
];

const DEFAULT_TAGS = [
  'Electronics',
  'Clothing',
  'Books & Documents',
  'Kitchenware',
  'Furniture',
  'Tools',
  'Decor',
  'Sports & Fitness',
  'Beauty',
  'Toys',
  'Gift',
];

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails, photos } = profile;
    if (!emails || emails.length === 0) {
      return done(
        new UnauthorizedException('Google profile did not return an email.'),
        false,
      );
    }
    const email = emails[0].value;
    const googleId = id;
    const firstName = name?.givenName;
    const lastName = name?.familyName;
    const picture = photos?.[0]?.value;

    try {
      let user = await this.prisma.user.findUnique({
        where: { googleId },
      });

      if (!user) {
        user = await this.prisma.user.findUnique({ where: { email } });

        if (user) {
          user = await this.prisma.user.update({
            where: { email },
            data: { googleId: googleId },
          });
        } else {
          // New User Creation: Use a transaction to create user, locations, and tags together
          const generatedUsername = await this.generateUniqueUsername(
            email.split('@')[0],
          );

          user = await this.prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
              data: {
                googleId: googleId,
                email: email,
                username: generatedUsername,
                name: `${firstName || ''} ${lastName || ''}`.trim() || null,
                avatarUrl: picture,
              },
            });

            // Create default locations for the new user
            await tx.location.createMany({
              data: DEFAULT_LOCATIONS.map((locName) => ({
                name: locName,
                userId: newUser.id,
              })),
            });

            // Create default tags for the new user
            await tx.tag.createMany({
              data: DEFAULT_TAGS.map((tagName) => ({
                name: tagName,
                userId: newUser.id,
              })),
            });
            return newUser;
          });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...userWithoutPassword } = user;
      done(null, userWithoutPassword);
    } catch (err) {
      done(err, false);
    }
  }

  private async generateUniqueUsername(suggestion: string): Promise<string> {
    let username = suggestion.replace(/[^a-zA-Z0-9]/g, '') || 'user';
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const existingUser = await this.prisma.user.findUnique({
        where: { username },
      });
      if (!existingUser) {
        return username;
      }
      username = `${suggestion}${Math.floor(100 + Math.random() * 900)}`;
      attempts++;
    }

    return `user${Date.now()}`;
  }
}
