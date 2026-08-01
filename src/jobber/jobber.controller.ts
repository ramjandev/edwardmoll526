import { Controller, Get, Query, Res, Logger, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobberService } from './jobber.service';
import { Response } from 'express';

@ApiTags('Jobber Integration')
@Controller('jobber')
export class JobberController {
  private readonly logger = new Logger(JobberController.name);

  constructor(private readonly jobberService: JobberService) {}

  @Get('authorize')
  @ApiOperation({ summary: 'Redirect to Jobber authorization page (Admin Setup)' })
  @ApiResponse({ status: 302, description: 'Redirecting to Jobber login' })
  authorize(@Res() res: any) {
    const url = this.jobberService.getAuthorizeUrl();
    this.logger.log(`Redirecting to Jobber OAuth: ${url}`);
    return res.redirect(url);
  }

  @Get('callback')
  @ApiOperation({ summary: 'OAuth Callback url for Jobber token exchange' })
  @ApiResponse({ status: 200, description: 'Tokens exchanged and saved successfully' })
  @ApiResponse({ status: 400, description: 'Token exchange failed' })
  async callback(@Query('code') code: string, @Res() res: any) {
    if (!code) {
      return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Code query parameter is missing' });
    }

    try {
      await this.jobberService.handleCallback(code);
      res.setHeader('Content-Type', 'text/html');
      return res.send(`
        <html>
          <head>
            <title>Jobber Connected</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 50px; background-color: #f7fafc; }
              .card { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
              h1 { color: #2b6cb0; }
              p { color: #4a5568; line-height: 1.5; }
              .badge { background-color: #c6f6d5; color: #22543d; padding: 5px 10px; border-radius: 4px; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Jobber Connection Successful!</h1>
              <p>Your backend is now fully authenticated with Jobber OAuth 2.0.</p>
              <p><span class="badge">ACTIVE</span></p>
              <p>You can close this tab now and return to your application.</p>
            </div>
          </body>
        </html>
      `);
    } catch (error: any) {
      return res.status(HttpStatus.BAD_REQUEST).send(`
        <html>
          <body>
            <h1 style="color:red;">Jobber Connection Failed</h1>
            <p>${error.message}</p>
          </body>
        </html>
      `);
    }
  }
}
