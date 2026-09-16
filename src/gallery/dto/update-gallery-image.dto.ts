import { PartialType } from '@nestjs/swagger';
import { CreateGalleryImageDto } from './create-gallery-image.dto';

export class UpdateGalleryImageDto extends PartialType(CreateGalleryImageDto) {}
