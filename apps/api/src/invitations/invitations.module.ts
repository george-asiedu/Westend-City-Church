import { Module } from '@nestjs/common';
import { InvitationsController, JoinLinksController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({ controllers: [InvitationsController, JoinLinksController], providers: [InvitationsService], exports: [InvitationsService] })
export class InvitationsModule {}
