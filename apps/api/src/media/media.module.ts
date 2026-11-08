import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaMapper } from './media-mapper.service';
import { MediaService } from './media.service';

@Global()
@Module({ controllers: [MediaController], providers: [MediaService, MediaMapper], exports: [MediaService, MediaMapper] })
export class MediaModule {}
