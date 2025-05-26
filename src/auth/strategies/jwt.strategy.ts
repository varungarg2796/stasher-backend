// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
// Import ExtractJwt and Strategy
import { Strategy, ExtractJwt } from 'passport-jwt'; // <-- Make sure ExtractJwt is imported
import { ConfigService } from '@nestjs/config';
// Remove Request import if cookieExtractor is not used
// import { Request } from 'express';
import { JwtPayload } from '../auth.service';

// Remove or comment out cookieExtractor if you won't use it
// const cookieExtractor = (req: Request): string | null => { ... };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false, // Ensure expired tokens are rejected
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<any> {
    // console.log('JWT Strategy validate payload:', payload); // Debugging
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    // For now, just return the essential payload needed by the request handler
    return { id: payload.sub }; // Attach { id: userId } to request.user
  }
}
