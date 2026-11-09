import { RolePermissionsController } from './role-permissions.controller';
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ controllers: [UsersController, RolePermissionsController], providers: [UsersService] })
export class UsersModule {}
