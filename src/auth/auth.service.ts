// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService, TokenExpiredError, JsonWebTokenError } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User, RefreshToken as PrismaRefreshToken } from '@prisma/client'; // Import RefreshToken type from Prisma
import { PrismaService } from '../prisma/prisma.service'; // Adjust path if needed
import * as bcrypt from 'bcrypt';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
export interface JwtPayload {
  sub: string /* username?: string; // Add if useful */;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RefreshTokenPayload extends JwtPayload {} // Keep separate for clarity

@Injectable()
export class AuthService {
  // Consider making salt rounds configurable via ConfigService
  private readonly saltRounds = 10; // bcrypt salt rounds

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService, // Inject PrismaService
  ) {}

  // Helper to calculate expiry date from JWT expiresIn string
  private calculateExpiryDate(expiresIn: string): Date {
    const now = new Date();
    try {
      const unit = expiresIn.slice(-1).toLowerCase();
      const value = parseInt(expiresIn.slice(0, -1), 10);

      if (isNaN(value)) throw new Error('Invalid time value');

      switch (unit) {
        case 's':
          now.setSeconds(now.getSeconds() + value);
          break;
        case 'm':
          now.setMinutes(now.getMinutes() + value);
          break;
        case 'h':
          now.setHours(now.getHours() + value);
          break;
        case 'd':
          now.setDate(now.getDate() + value);
          break;
        default:
          throw new Error('Invalid time unit');
      }
      return now;
    } catch (e) {
      console.error(
        `Failed to parse expiresIn value: ${expiresIn}. Defaulting expiry.`,
        e,
      );
      // Default fallback: expire in 7 days if parsing fails
      now.setDate(now.getDate() + 7);
      return now;
    }
  }

  // Helper function to hash tokens using bcrypt
  private async hashToken(token: string): Promise<string> {
    try {
      return await bcrypt.hash(token, this.saltRounds);
    } catch (error) {
      console.error('Hashing failed:', error);
      throw new InternalServerErrorException('Failed to secure token.'); // Prevent proceeding with unhashed token
    }
  }

  // --- GENERATE TOKENS (called by login) ---
  async generateTokens(payload: JwtPayload): Promise<Tokens> {
    const accessSecret = this.configService.get<string>('JWT_SECRET');
    const refreshSecret = this.configService.get<string>('JWT_SECRET'); // Use same for simplicity unless specified otherwise
    const accessExpiration = this.configService.get<string>(
      'JWT_ACCESS_EXPIRATION',
      '1m',
    );
    const refreshExpiration = this.configService.get<string>(
      'JWT_REFRESH_EXPIRATION',
      '7d',
    );

    // Generate both tokens concurrently
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: accessExpiration,
      }),
      this.jwtService.signAsync(payload as RefreshTokenPayload, {
        secret: refreshSecret,
        expiresIn: refreshExpiration,
      }),
    ]);
    console.log(
      `Generated tokens for user ${payload.sub}: Access Token (expires in ${accessExpiration}), Refresh Token (expires in ${refreshExpiration})`,
    );
    try {
      const refreshTokenHash = await this.hashToken(refreshToken);
      const expiryDate = this.calculateExpiryDate(refreshExpiration);

      await this.prisma.refreshToken.create({
        data: {
          userId: payload.sub,
          tokenHash: refreshTokenHash,
          expiresAt: expiryDate,
          isRevoked: false, // Ensure it starts as not revoked
        },
      });
      console.log(`Stored refresh token hash for user ${payload.sub}`);
    } catch (dbError) {
      console.error(
        `Failed to store refresh token hash for user ${payload.sub}:`,
        dbError,
      );
      // Depending on DB error (e.g., unique constraint), maybe log out user or prevent login
      throw new InternalServerErrorException(
        'Could not establish secure session.',
      );
    }
    // -----------------------------------------

    return { accessToken, refreshToken };
  }

  // --- LOGIN (Calls generateTokens) ---
  async login(user: Omit<User, 'password'>): Promise<Tokens> {
    // Optionally clean up OLD (e.g., expired > 30 days ago) tokens before generating new ones
    // await this.prisma.refreshToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: /* some past date */ } } });

    console.log(`Initiating token generation for user ${user.id}`);
    const payload: JwtPayload = { sub: user.id };
    // generateTokens now handles storing the refresh token hash
    return this.generateTokens(payload);
  }

  // --- REFRESH TOKENS ---
  async refreshTokens(refreshToken: string): Promise<{ accessToken: string }> {
    const refreshSecret = this.configService.get<string>('JWT_SECRET');
    const accessSecret = this.configService.get<string>('JWT_SECRET');
    const accessExpiration = this.configService.get<string>(
      'JWT_ACCESS_EXPIRATION',
      '1m',
    );

    try {
      // 1. Verify JWT signature and basic expiry using the correct secret
      let payload: RefreshTokenPayload;
      try {
        payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
          refreshToken,
          { secret: refreshSecret, ignoreExpiration: false }, // Must use same secret it was signed with
        );
      } catch (jwtError) {
        // Handle JWT specific errors (expired, malformed)
        if (jwtError instanceof TokenExpiredError) {
          throw new UnauthorizedException('Refresh token expired');
        }
        if (jwtError instanceof JsonWebTokenError) {
          throw new UnauthorizedException('Refresh token invalid');
        }
        throw jwtError; // Re-throw other unexpected verify errors
      }

      if (!payload || !payload.sub) {
        throw new UnauthorizedException('Invalid refresh token payload');
      }
      console.log(
        `Refresh Step 1 Passed: JWT verified for user ${payload.sub}`,
      );

      // 2. Validate against Database using bcrypt.compare
      console.log(
        `Refresh Step 2: Finding potential DB tokens for user ${payload.sub}`,
      );
      const potentialDbTokens = await this.prisma.refreshToken.findMany({
        where: {
          userId: payload.sub,
          isRevoked: false,
          expiresAt: { gt: new Date() }, // Server-side expiry check
        },
      });

      if (!potentialDbTokens || potentialDbTokens.length === 0) {
        console.warn(
          `Refresh: No potential valid refresh tokens found in DB for user ${payload.sub}.`,
        );
        // For security, if a potentially valid but unknown token is used, revoke all for user?
        // await this.prisma.refreshToken.updateMany({ where: { userId: payload.sub, isRevoked: false }, data: { isRevoked: true } });
        throw new ForbiddenException('No valid session found.'); // Changed to Forbidden
      }

      console.log(
        `Refresh Step 2: Comparing hash for ${potentialDbTokens.length} token(s).`,
      );
      let validStoredToken: PrismaRefreshToken | null = null;
      for (const storedToken of potentialDbTokens) {
        const isMatch = await bcrypt.compare(
          refreshToken,
          storedToken.tokenHash,
        );
        if (isMatch) {
          validStoredToken = storedToken;
          console.log(
            `Refresh Step 2: Hash match success! DB Token ID: ${validStoredToken.id}`,
          );
          break; // Exit loop once match is found
        }
      }

      if (!validStoredToken) {
        console.warn(
          `Refresh: Hash comparison failed for all potential tokens for user ${payload.sub}. Token provided might be invalid or revoked.`,
        );
        // Aggressive security: Revoke all other tokens for this user if an invalid one is attempted?
        // await this.prisma.refreshToken.updateMany({ where: { userId: payload.sub, isRevoked: false }, data: { isRevoked: true } });
        throw new ForbiddenException('Refresh token invalid.'); // Changed to Forbidden
      }

      // --- 3. Issue New Access Token (No Rotation for MVP) ---
      const newPayload: JwtPayload = { sub: payload.sub };
      const newAccessToken = await this.jwtService.signAsync(newPayload, {
        secret: accessSecret,
        expiresIn: accessExpiration,
      });

      // Update the 'updatedAt' timestamp of the validated refresh token in DB (optional, shows usage)
      await this.prisma.refreshToken
        .update({
          where: { id: validStoredToken.id },
          data: { updatedAt: new Date() },
        })
        .catch((err) =>
          console.error('Failed to update refresh token timestamp:', err),
        ); // Log error but don't fail refresh

      console.log(
        `Token refreshed successfully (no rotation) for user ${payload.sub}`,
      );
      return { accessToken: newAccessToken };
      // --- End No Rotation ---

      // --- Optional: Implement Token Rotation logic here instead ---
    } catch (error) {
      // Handle specific auth errors we throw intentionally
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      ) {
        console.warn(`Refresh failed with auth error: ${error.message}`);
        throw error;
      }
      // Handle unexpected errors during the process
      console.error('Unexpected error during token refresh process:', error);
      throw new InternalServerErrorException(
        'Could not process token refresh.',
      );
    }
  }

  // --- REVOKE REFRESH TOKEN (Primarily by User ID for Logout) ---
  async revokeRefreshToken(
    refreshToken?: string,
    userId?: string,
  ): Promise<void> {
    try {
      // --- Prioritize revoking ALL by User ID ---
      if (userId) {
        console.log(
          `Attempting to revoke all refresh tokens for user ${userId}`,
        );
        const result = await this.prisma.refreshToken.updateMany({
          where: {
            userId: userId,
            isRevoked: false, // Only target active tokens
          },
          data: {
            isRevoked: true,
            updatedAt: new Date(),
          },
        });
        console.log(
          `Revoked ${result.count} refresh token(s) for user ${userId}.`,
        );
        // If count is 0, it means no active tokens were found, which is fine.

        // --- Fallback: Try to revoke by specific token hash IF userId wasn't available AND refreshToken was ---
        // This is less secure if not careful, mainly useful if revoking a specific leaked token.
      } else if (refreshToken) {
        console.warn(
          `Attempting revocation by specific refresh token hash (User ID not provided)`,
        );
        try {
          // Quickly verify token format and maybe get payload info if needed (optional)
          await this.jwtService
            .verifyAsync(refreshToken, {
              secret: this.configService.get('JWT_SECRET'),
            })
            .catch(() => {});

          const tokenHash = await this.hashToken(refreshToken);
          const result = await this.prisma.refreshToken.updateMany({
            where: { tokenHash: tokenHash, isRevoked: false },
            data: { isRevoked: true, updatedAt: new Date() },
          });
          if (result.count > 0) {
            console.log(
              `Revoked ${result.count} token(s) matching hash ...${tokenHash.slice(-6)}`,
            );
          } else {
            console.log(
              `No active token found matching provided refresh token hash for revocation.`,
            );
          }
        } catch (innerError) {
          console.error(
            'Error during specific token revocation attempt:',
            innerError,
          );
        }
      } else {
        console.warn(
          'Cannot revoke tokens: No User ID or Refresh Token provided for context.',
        );
      }
    } catch (dbError) {
      console.error('Database error during refresh token revocation:', dbError);
      // Decide if this should throw an error - probably not critical for logout flow.
    }
  }
  // ---------------------------------------------------------------------
}
