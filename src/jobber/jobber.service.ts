import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class JobberService {
  private readonly logger = new Logger(JobberService.name);
  private clientId = '';
  private clientSecret = '';
  private redirectUri = '';
  private isMock = true;
  private readonly defaultAccountId = 'phoenix_moving_main'; // Map single tenant to account_id unique column

  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.clientId = configService.get<string>('JOBBER_CLIENT_ID') || '';
    this.clientSecret = configService.get<string>('JOBBER_CLIENT_SECRET') || '';
    this.redirectUri = configService.get<string>('JOBBER_REDIRECT_URI') || '';

    if (
      this.clientId &&
      this.clientSecret &&
      !this.clientId.includes('mock') &&
      !this.clientSecret.includes('mock')
    ) {
      this.isMock = false;
      this.logger.log('Jobber OAuth Client configured.');
    } else {
      this.logger.warn('Using Jobber Mock integration (no client credentials provided).');
    }
  }

  getAuthorizeUrl(): string {
    if (this.isMock) {
      return `${this.redirectUri}?code=mock_authorization_code_2026`;
    }
    return `https://api.jobber.com/api/oauth/authorize?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(
      this.redirectUri,
    )}&response_type=code`;
  }

  async handleCallback(code: string): Promise<void> {
    this.logger.log(`Exchanging Jobber auth code: ${code}`);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    if (this.isMock) {
      await this.prisma.jobberTokens.upsert({
        where: { accountId: this.defaultAccountId },
        update: {
          accessToken: 'mock_access_token_12345',
          refreshToken: 'mock_refresh_token_67890',
          expiresAt,
        },
        create: {
          accountId: this.defaultAccountId,
          accessToken: 'mock_access_token_12345',
          refreshToken: 'mock_refresh_token_67890',
          expiresAt,
        },
      });
      this.logger.log('Mock Jobber Token saved successfully.');
      return;
    }

    try {
      const response = await axios.post('https://api.jobber.com/api/oauth/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setSeconds(tokenExpiresAt.getSeconds() + expires_in);

      await this.prisma.jobberTokens.upsert({
        where: { accountId: this.defaultAccountId },
        update: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: tokenExpiresAt,
        },
        create: {
          accountId: this.defaultAccountId,
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: tokenExpiresAt,
        },
      });

      this.logger.log('Jobber OAuth tokens stored successfully.');
    } catch (error: any) {
      this.logger.error('Failed to exchange Jobber code for tokens', error.response?.data || error.message);
      throw new HttpException('Jobber Authentication Failed', HttpStatus.BAD_REQUEST);
    }
  }

  private async getValidAccessToken(): Promise<string> {
    const tokenRecord = await this.prisma.jobberTokens.findFirst();

    if (!tokenRecord) {
      throw new HttpException('Jobber integration not authenticated. Please authorize at /jobber/authorize', HttpStatus.UNAUTHORIZED);
    }

    const now = new Date();
    // Refresh token if it expires in less than 5 minutes
    const bufferTime = new Date(now.getTime() + 5 * 60 * 1000);
    if (tokenRecord.expiresAt > bufferTime) {
      return tokenRecord.accessToken;
    }

    this.logger.log('Jobber Access Token expired or expiring soon. Refreshing...');
    return this.refreshJobberToken(tokenRecord.id, tokenRecord.refreshToken);
  }

  private async refreshJobberToken(tokenId: string, refreshToken: string): Promise<string> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    if (this.isMock) {
      await this.prisma.jobberTokens.update({
        where: { id: tokenId },
        data: {
          accessToken: 'mock_access_token_refreshed_123',
          expiresAt,
        },
      });
      return 'mock_access_token_refreshed_123';
    }

    try {
      const response = await axios.post('https://api.jobber.com/api/oauth/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setSeconds(tokenExpiresAt.getSeconds() + expires_in);

      await this.prisma.jobberTokens.update({
        where: { id: tokenId },
        data: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: tokenExpiresAt,
        },
      });

      return access_token;
    } catch (error: any) {
      this.logger.error('Failed to refresh Jobber Token', error.response?.data || error.message);
      throw new HttpException('Jobber Token Refresh Failed', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Syncs a Customer to Jobber.
   * Returns the Jobber Customer ID.
   */
  async syncCustomer(name: string, email: string, phone: string, address: string | null): Promise<string> {
    this.logger.log(`Syncing customer to Jobber: ${name} (${email})`);

    if (this.isMock) {
      return `jobber_cust_mock_${Math.floor(Math.random() * 10000)}`;
    }

    const accessToken = await this.getValidAccessToken();
    const splitName = name.split(' ');
    const firstName = splitName[0] || 'Customer';
    const lastName = splitName.slice(1).join(' ') || 'Moving';

    const query = `
      mutation CreateCustomer($input: CustomerInput!) {
        createCustomer(input: $input) {
          customer {
            id
          }
        }
      }
    `;

    const variables = {
      input: {
        firstName,
        lastName,
        emailAddresses: [{ address: email }],
        phones: [{ number: phone }],
        billingAddress: address ? { street: address } : undefined,
      },
    };

    try {
      const response = await axios.post(
        'https://api.jobber.com/api/graphql',
        { query, variables },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-API-Version': '2023-08-18',
          },
        },
      );

      const jobberId = response.data?.data?.createCustomer?.customer?.id;
      if (!jobberId) {
        this.logger.error('Jobber customer creation response missing customer ID', JSON.stringify(response.data));
        throw new Error('Customer ID not returned from Jobber');
      }

      return jobberId;
    } catch (error: any) {
      this.logger.error('Failed to sync Customer to Jobber', error.response?.data || error.message);
      throw new Error(`Jobber sync failed: ${error.message}`);
    }
  }

  /**
   * Creates a Job in Jobber.
   * Returns the Jobber Job ID.
   */
  async createJob(jobberCustomerId: string, title: string, date: Date, details: string): Promise<string> {
    this.logger.log(`Creating job in Jobber for customer ${jobberCustomerId} on ${date}`);

    if (this.isMock) {
      return `jobber_job_mock_${Math.floor(Math.random() * 10000)}`;
    }

    const accessToken = await this.getValidAccessToken();
    const formattedDate = date.toISOString().split('T')[0];

    const query = `
      mutation CreateJob($input: JobInput!) {
        createJob(input: $input) {
          job {
            id
          }
        }
      }
    `;

    const variables = {
      input: {
        title,
        customerId: jobberCustomerId,
        description: details,
        booking: {
          startAt: `${formattedDate}T09:00:00`,
          endAt: `${formattedDate}T17:00:00`,
        },
      },
    };

    try {
      const response = await axios.post(
        'https://api.jobber.com/api/graphql',
        { query, variables },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-API-Version': '2023-08-18',
          },
        },
      );

      const jobId = response.data?.data?.createJob?.job?.id;
      if (!jobId) {
        this.logger.error('Jobber job creation response missing job ID', JSON.stringify(response.data));
        throw new Error('Job ID not returned from Jobber');
      }

      return jobId;
    } catch (error: any) {
      this.logger.error('Failed to create Job in Jobber', error.response?.data || error.message);
      throw new Error(`Jobber job creation failed: ${error.message}`);
    }
  }
}
