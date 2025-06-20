import { Controller, Get, Req, UseGuards, Patch, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';
import { UpdatePreferencesDto } from './dto/update-preference.dto';

// Define a type for the request object after Passport has attached the user
interface RequestWithUser extends Request {
  user: {
    id: string;
  };
}

@UseGuards(JwtAuthGuard) // Protect all routes in this controller
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Endpoint to get the profile of the currently authenticated user.
   */
  @Get('me')
  async getMe(@Req() req: RequestWithUser) {
    // The user ID is attached to the request by the JwtAuthGuard
    return this.usersService.findByIdWithUsage(req.user.id);
  }

  @Patch('me/preferences')
  async updatePreferences(
    @Req() req: RequestWithUser,
    @Body() updatePreferencesDto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(
      req.user.id,
      updatePreferencesDto,
    );
  }
}
