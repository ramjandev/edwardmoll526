import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'super_secret_fallback',
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin user not found');
    }

    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    };
  }
}
