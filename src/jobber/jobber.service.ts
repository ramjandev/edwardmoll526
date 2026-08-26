import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as crypto from 'crypto';

/** Shape returned to the rest of the app after an invoice is created or read. */
export interface JobberInvoice {
  id: string;
  invoiceNumber: string | null;
  status: string;
  total: number;
  balance: number;
  /** Client Hub URL the customer opens to pay. */
  clientHubUri: string | null;
}

const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';

@Injectable()
export class JobberService {
  private readonly logger = new Logger(JobberService.name);
  private clientId = '';
  private clientSecret = '';
  private redirectUri = '';
  private apiVersion = '2025-04-16';
  private isMock = true;
  private readonly defaultAccountId = 'phoenix_moving_main'; // Map single tenant to account_id unique column

  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.clientId = configService.get<string>('JOBBER_CLIENT_ID') || '';
    this.clientSecret = configService.get<string>('JOBBER_CLIENT_SECRET') || '';
    this.redirectUri = configService.get<string>('JOBBER_REDIRECT_URI') || '';
    this.apiVersion =
      configService.get<string>('JOBBER_API_VERSION') || this.apiVersion;

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

  /** True when no real Jobber credentials are configured. */
  get mockMode(): boolean {
    return this.isMock;
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
   * Single entry point for every Jobber GraphQL call.
   * Jobber returns HTTP 200 on business-rule failures, so both `errors` and
   * `userErrors` have to be inspected explicitly.
   */
  private async graphql<T = any>(
    query: string,
    variables: Record<string, any>,
    operationLabel: string,
  ): Promise<T> {
    const accessToken = await this.getValidAccessToken();

    try {
      const response = await axios.post(
        JOBBER_GRAPHQL_URL,
        { query, variables },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-JOBBER-GRAPHQL-VERSION': this.apiVersion,
            'Content-Type': 'application/json',
          },
        },
      );

      if (response.data?.errors?.length) {
        const message = response.data.errors
          .map((e: any) => e.message)
          .join('; ');
        throw new Error(message);
      }

      return response.data?.data as T;
    } catch (error: any) {
      const details = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      this.logger.error(`Jobber ${operationLabel} failed: ${details}`);
      throw new Error(`Jobber ${operationLabel} failed: ${error.message}`);
    }
  }

  private assertNoUserErrors(payload: any, operationLabel: string) {
    const userErrors = payload?.userErrors;
    if (userErrors?.length) {
      const message = userErrors
        .map((e: any) => `${(e.path || []).join('.')} ${e.message}`.trim())
        .join('; ');
      throw new Error(`Jobber ${operationLabel} rejected: ${message}`);
    }
  }

  /**
   * Verifies the HMAC-SHA256 signature Jobber sends with every webhook.
   * The digest is computed over the raw request body using the app's OAuth
   * client secret.
   */
  verifyWebhookSignature(rawBody: string, signature?: string): boolean {
    if (this.isMock || !this.clientSecret) {
      this.logger.warn('Skipping Jobber webhook signature verification (mock mode).');
      return true;
    }

    if (!signature) {
      return false;
    }

    const expected = crypto
      .createHmac('sha256', this.clientSecret)
      .update(rawBody, 'utf8')
      .digest('base64');

    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(signature);

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  /**
   * Creates a client in Jobber and returns the Jobber client ID.
   */
  async syncCustomer(name: string, email: string, phone: string, address: string | null): Promise<string> {
    this.logger.log(`Syncing customer to Jobber: ${name} (${email})`);

    if (this.isMock) {
      return `jobber_cust_mock_${Math.floor(Math.random() * 10000)}`;
    }

    const splitName = name.split(' ');
    const firstName = splitName[0] || 'Customer';
    const lastName = splitName.slice(1).join(' ') || 'Moving';

    const query = `
      mutation ClientCreate($input: ClientCreateInput!) {
        clientCreate(input: $input) {
          client {
            id
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    const variables = {
      input: {
        firstName,
        lastName,
        emails: [{ description: 'MAIN', primary: true, address: email }],
        phones: [{ description: 'MAIN', primary: true, number: phone }],
        billingAddress: address ? { street1: address } : undefined,
      },
    };

    const data = await this.graphql(query, variables, 'clientCreate');
    this.assertNoUserErrors(data?.clientCreate, 'clientCreate');

    const jobberId = data?.clientCreate?.client?.id;
    if (!jobberId) {
      throw new Error('Client ID not returned from Jobber');
    }

    return jobberId;
  }

  /**
   * Creates a job in Jobber and returns the Jobber job ID.
   */
  async createJob(jobberCustomerId: string, title: string, date: Date, details: string): Promise<string> {
    this.logger.log(`Creating job in Jobber for client ${jobberCustomerId} on ${date.toISOString()}`);

    if (this.isMock) {
      return `jobber_job_mock_${Math.floor(Math.random() * 10000)}`;
    }

    const formattedDate = date.toISOString().split('T')[0];

    const query = `
      mutation JobCreate($input: JobCreateInput!) {
        jobCreate(input: $input) {
          job {
            id
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    const variables = {
      input: {
        clientId: jobberCustomerId,
        title,
        instructions: details,
        startAt: `${formattedDate}T09:00:00Z`,
        endAt: `${formattedDate}T17:00:00Z`,
      },
    };

    const data = await this.graphql(query, variables, 'jobCreate');
    this.assertNoUserErrors(data?.jobCreate, 'jobCreate');

    const jobId = data?.jobCreate?.job?.id;
    if (!jobId) {
      throw new Error('Job ID not returned from Jobber');
    }

    return jobId;
  }

  /**
   * Creates an invoice in Jobber. The returned `clientHubUri` is the link the
   * customer opens to pay by card through Jobber Payments.
   */
  async createInvoice(
    jobberCustomerId: string,
    subject: string,
    lineItemName: string,
    amount: number,
    message: string,
  ): Promise<JobberInvoice> {
    this.logger.log(`Creating Jobber invoice for client ${jobberCustomerId}: $${amount}`);

    if (this.isMock) {
      const mockId = `jobber_inv_mock_${Math.floor(Math.random() * 100000)}`;
      return {
        id: mockId,
        invoiceNumber: `MOCK-${Math.floor(Math.random() * 9000) + 1000}`,
        status: 'AWAITING_PAYMENT',
        total: amount,
        balance: amount,
        clientHubUri: `https://clienthub.getjobber.com/client_hubs/mock/invoices/${mockId}`,
      };
    }

    const issuedDate = new Date().toISOString().split('T')[0];

    const query = `
      mutation InvoiceCreate($input: InvoiceCreateAttributes!) {
        invoiceCreate(input: $input) {
          invoice {
            id
            invoiceNumber
            invoiceStatus
            clientHubUri
            amounts {
              total
              balance
            }
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    const variables = {
      input: {
        clientId: jobberCustomerId,
        subject,
        message,
        issuedDate,
        lineItems: [
          {
            name: lineItemName,
            quantity: 1,
            unitPrice: amount,
          },
        ],
      },
    };

    const data = await this.graphql(query, variables, 'invoiceCreate');
    this.assertNoUserErrors(data?.invoiceCreate, 'invoiceCreate');

    const invoice = data?.invoiceCreate?.invoice;
    if (!invoice?.id) {
      throw new Error('Invoice ID not returned from Jobber');
    }

    return this.mapInvoice(invoice);
  }

  /**
   * Reads the current state of an invoice. Used by the webhook handler to
   * decide whether an invoice has actually been paid.
   */
  async getInvoice(invoiceId: string): Promise<JobberInvoice> {
    if (this.isMock) {
      return {
        id: invoiceId,
        invoiceNumber: 'MOCK-0000',
        status: 'PAID',
        total: 0,
        balance: 0,
        clientHubUri: null,
      };
    }

    const query = `
      query GetInvoice($id: EncodedId!) {
        invoice(id: $id) {
          id
          invoiceNumber
          invoiceStatus
          clientHubUri
          amounts {
            total
            balance
          }
        }
      }
    `;

    const data = await this.graphql(query, { id: invoiceId }, 'invoice');

    if (!data?.invoice) {
      throw new Error(`Invoice ${invoiceId} not found in Jobber`);
    }

    return this.mapInvoice(data.invoice);
  }

  private mapInvoice(invoice: any): JobberInvoice {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber ?? null,
      status: invoice.invoiceStatus ?? 'UNKNOWN',
      total: Number(invoice.amounts?.total ?? 0),
      balance: Number(invoice.amounts?.balance ?? 0),
      clientHubUri: invoice.clientHubUri ?? null,
    };
  }
}
