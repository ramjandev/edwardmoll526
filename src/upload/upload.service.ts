import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor(private configService: ConfigService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }

    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (
      cloudName &&
      cloudName !== 'your_cloud_name' &&
      apiKey &&
      apiKey !== 'your_api_key'
    ) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.logger.log('Cloudinary configured for remote image uploads.');
    } else {
      this.logger.warn(
        'Cloudinary credentials not set or using placeholders. Using local disk storage (/uploads) for uploaded images.',
      );
    }
  }

  async uploadImage(file: Express.Multer.File): Promise<string> {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const isCloudinaryActive =
      cloudName &&
      cloudName !== 'your_cloud_name' &&
      this.configService.get<string>('CLOUDINARY_API_KEY') !== 'your_api_key';

    if (isCloudinaryActive) {
      try {
        return await this.uploadToCloudinary(file);
      } catch (error) {
        this.logger.error('Cloudinary upload failed, falling back to local disk storage', error);
      }
    }

    return this.uploadToLocal(file);
  }

  private uploadToCloudinary(file: Express.Multer.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        { folder: 'edwardmoll-website' },
        (error, result) => {
          if (error) return reject(error);
          if (result?.secure_url) resolve(result.secure_url);
          else reject(new Error('No secure_url from Cloudinary'));
        },
      );
      upload.end(file.buffer);
    });
  }

  private async uploadToLocal(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `img-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    const filePath = path.join(this.uploadDir, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const port = this.configService.get<string>('PORT') || '3000';
    const host = process.env.BASE_URL || `http://localhost:${port}`;
    return `${host}/uploads/${filename}`;
  }
}
