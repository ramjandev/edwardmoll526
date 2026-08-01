import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { SendNotificationDto, RegisterFcmTokenDto } from './notifications.dto';

@ApiTags('Notifications Gateway')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send and log an Email, SMS, or FCM Push notification' })
  @ApiResponse({ status: 200, description: 'Notification dispatched and logged successfully' })
  async sendNotification(@Body() dto: SendNotificationDto) {
    return this.notificationsService.dispatchNotification(dto);
  }

  @Post('register-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register an FCM Device Token for a Customer or Administrator' })
  @ApiResponse({ status: 200, description: 'FCM device token registered successfully' })
  async registerToken(@Body() dto: RegisterFcmTokenDto) {
    return this.notificationsService.registerFcmToken(dto);
  }
}
