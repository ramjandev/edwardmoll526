import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AdminRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async onModuleInit() {
    // Seed default admin if database is empty
    const adminCount = await this.prisma.adminUser.count();
    if (adminCount === 0) {
      const defaultEmail = 'admin@gmail.com';
      const defaultPassword = 'Admin@1234';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      await this.prisma.adminUser.create({
        data: {
          email: defaultEmail,
          passwordHash,
          role: AdminRole.OWNER,
        },
      });

      this.logger.warn('----------------------------------------------------');
      this.logger.warn('NO ADMIN USERS FOUND. SEEDED DEFAULT ADMIN ACCOUNT:');
      this.logger.warn(`Email: ${defaultEmail}`);
      this.logger.warn(`Password: ${defaultPassword}`);
      this.logger.warn(
        'PLEASE CHANGE THIS PASSWORD IMMEDIATELY IN PRODUCTION!',
      );
      this.logger.warn('----------------------------------------------------');
    }
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const admin = await this.prisma.adminUser.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        role: dto.role || AdminRole.STAFF,
      },
    });

    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    };
  }

  async login(dto: LoginDto) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const payload = { sub: admin.id, email: admin.email, role: admin.role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
    };
  }
}
