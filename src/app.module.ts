import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ServicesModule } from './services/services.module';
import { GalleryModule } from './gallery/gallery.module';
import { PostsModule } from './posts/posts.module';
import { ContactModule } from './contact/contact.module';
import { UploadModule } from './upload/upload.module';
import { MailerModule } from './mailer/mailer.module';

@Module({
  imports: [
    // Load environment variables globally
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    AdminModule,
    ServicesModule,
    GalleryModule,
    PostsModule,
    ContactModule,
    UploadModule,
    MailerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
