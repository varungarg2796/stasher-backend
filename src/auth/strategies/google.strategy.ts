import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service'; // Adjust path if needed

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
      scope: ['email', 'profile'], // What information we request from Google
    });
  }

  /**
   * This method is called by Passport after Google successfully authenticates
   * the user and redirects back to our callback URL.
   * It receives the accessToken, refreshToken, and profile info from Google.
   */
  async validate(
    accessToken: string,
    refreshToken: string, // We might not use refreshToken here, but it's provided
    profile: any, // Contains user info from Google
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
        // If user doesn't exist with googleId, check if email exists
        // To prevent creating duplicate accounts if they previously signed up with email/pass
        user = await this.prisma.user.findUnique({ where: { email } });

        if (user) {
          // User exists with email but not linked to Google yet. Link them.
          user = await this.prisma.user.update({
            where: { email },
            data: { googleId: googleId }, // Add googleId
          });
        } else {
          // User absolutely does not exist, create a new one
          const generatedUsername = await this.generateUniqueUsername(
            email.split('@')[0], // Suggest username from email prefix
          );

          user = await this.prisma.user.create({
            data: {
              googleId: googleId,
              email: email,
              username: generatedUsername,
              name: `${firstName || ''} ${lastName || ''}`.trim() || null,
              avatarUrl: picture,
              // No password needed for Google signup
            },
          });
        }
      }

      // User is found or created/updated, return the user object
      // The 'password' field won't be included by default unless explicitly selected
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...userWithoutPassword } = user;
      done(null, userWithoutPassword); // Pass user object (without password) to Passport, which attaches it to request.user
    } catch (err) {
      done(err, false);
    }
  }

  /**
   * Helper to generate a unique username based on a suggestion.
   * If suggestion exists, adds random numbers until unique.
   */
  private async generateUniqueUsername(suggestion: string): Promise<string> {
    let username = suggestion.replace(/[^a-zA-Z0-9]/g, '') || 'user'; // Sanitize
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const existingUser = await this.prisma.user.findUnique({
        where: { username },
      });
      if (!existingUser) {
        return username; // Found unique username
      }
      // If exists, append random numbers
      username = `${suggestion}${Math.floor(100 + Math.random() * 900)}`; // Append 3 random digits
      attempts++;
    }

    // Fallback if max attempts reached (very unlikely)
    return `user${Date.now()}`;
  }
}
