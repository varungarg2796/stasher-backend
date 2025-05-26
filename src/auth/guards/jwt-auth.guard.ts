// src/auth/guards/jwt-auth.guard.ts
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Observable } from 'rxjs';
import { JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Check if the route has the @Public() decorator
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest(err, user, info: Error) {
    // You can throw an exception based on either "info" or "err" arguments
    console.log('JWT Auth Guard - handleRequest called');
    if (info instanceof TokenExpiredError) {
      console.error('JWT expired:', info.message);
      // Could trigger refresh token logic here in a real app
      throw new UnauthorizedException('Token expired');
    }
    if (info instanceof JsonWebTokenError) {
      console.error('JWT error:', info.message);
      throw new UnauthorizedException('Invalid token');
    }
    if (err || !user) {
      console.error('JWT Auth Error or No User:', err || info?.message);
      throw err || new UnauthorizedException('Authentication required');
    }
    // If validation is successful, Passport attaches the user payload to request.user
    return user; // Return the user payload ({ sub: userId })
  }
}
