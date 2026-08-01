import { ApiProperty } from '@nestjs/swagger';
import { AdminRole } from '../../generated/prisma/client';

class AdminUserSummaryDto {
  @ApiProperty({ example: '32b35a8f-287c-4c6e-82d9-e9df259b19e2' })
  id!: string;

  @ApiProperty({ example: 'admin@movingphoenix.com' })
  email!: string;

  @ApiProperty({ enum: AdminRole, example: AdminRole.OWNER })
  role!: AdminRole;
}

export class LoginResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'JWT authentication access token' })
  accessToken!: string;

  @ApiProperty({ type: AdminUserSummaryDto })
  user!: AdminUserSummaryDto;
}
