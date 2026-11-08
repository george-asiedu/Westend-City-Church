import { Module } from '@nestjs/common';
import { PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({ controllers: [SharesController, PublicSharesController], providers: [SharesService] })
export class SharesModule {}
