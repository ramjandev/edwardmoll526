import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AdminRole } from '../../generated/prisma/client';

export class LoginDto {
  @ApiProperty({
    example: 'admin@gmail.com',
    description: 'Administrator email',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'Admin@1234',
    description: 'Administrator password',
  })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'admin@gmail.com', description: 'New admin email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin@1234', description: 'New admin password' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: AdminRole, required: false, default: AdminRole.STAFF })
  @IsEnum(AdminRole)
  @IsOptional()
  role?: AdminRole;
}
