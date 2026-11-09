import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { CategoriesService } from './categories.service';

class CreateCategoryDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() allowsMultiDay?: boolean;
}

class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() coverMediaId?: string | null;
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.categories.list(user);
  }

  @Get(':slug')
  get(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.categories.bySlug(user, slug);
  }

  @Get(':slug/timeline')
  timeline(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.categories.timeline(user, slug);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto, @Meta() meta: ReqMeta) {
    return this.categories.create(user, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.categories.remove(user, id, meta);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @Meta() meta: ReqMeta) {
    return this.categories.update(user, id, dto, meta);
  }
}
