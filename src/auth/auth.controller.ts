import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Body,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AuthService, Tokens } from './auth.service';
import { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config'; // <-- Import ConfigService
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

// Define the shape of the Request object after Passport attaches the user
interface RequestWithUser extends Request {
  user: Omit<User, 'password'>;
}

@Controller('auth') // Base path /api/auth
export class AuthController {
  // Inject ConfigService along with AuthService
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService, // <-- Inject ConfigService
  ) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Guard handles the redirect
    console.log('Initiating Google Auth flow...');
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: RequestWithUser, @Res() res: Response) {
    console.log('Google Callback received for user:', req.user?.email);

    const frontendBaseUrl = this.configService.get<string>(
      'FRONTEND_BASE_URL',
      'http://localhost:3001',
    );

    if (!req.user) {
      console.error('User not found after Google auth');
      // Redirect to frontend login/error page (e.g., root with error query param)
      return res.redirect(`${frontendBaseUrl}/?error=auth_failed`);
    }

    try {
      const tokens: Tokens = await this.authService.login(req.user);

      // --- SEND TOKENS VIA URL FRAGMENT ---
      // REMOVE Cookie setting logic:
      // res.cookie('accessToken', ...);
      // res.cookie('refreshToken', ...);

      // Construct redirect URL to frontend callback page with tokens in the fragment
      const redirectUrl = `${frontendBaseUrl}/auth/callback#accessToken=${encodeURIComponent(
        tokens.accessToken,
      )}&refreshToken=${encodeURIComponent(tokens.refreshToken)}`;

      console.log(
        `Redirecting user ${req.user.email} to frontend callback with tokens in fragment.`,
      );
      res.redirect(redirectUrl);
      // ------------------------------------
    } catch (error) {
      console.error('Error during token generation or redirect:', error);
      // Redirect to frontend login/error page
      const errorRedirectUrl = `${frontendBaseUrl}/?error=token_error`;
      res.redirect(errorRedirectUrl);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() body: Partial<RefreshTokenDto>,
    @Req() req: RequestWithUser,
  ) {
    console.log(body);
    const userId = (req.user as { id: string })?.id; // Get user ID from access token payload
    console.log(`User ID from request: ${userId}`);
    if (!userId) {
      // Should not happen if JwtAuthGuard passed, but defensive check
      console.warn('Logout attempt without valid user session identification.');
      return; // Or throw an error
    }

    console.log(`Logout request initiated by user ${userId}.`);
    // Call revoke, primarily using userId, pass RT as secondary if needed by service logic
    await this.authService.revokeRefreshToken(body.refreshToken, userId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(
    @Body() body: RefreshTokenDto,
  ): Promise<{ accessToken: string }> {
    // Uses RefreshTokenDto
    return this.authService.refreshTokens(body.refreshToken);
  }
}
