import { Global, Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Global()
@Module({ controllers: [DeliveryController], providers: [DeliveryService], exports: [DeliveryService] })
export class DeliveryModule {}
