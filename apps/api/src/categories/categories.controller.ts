import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { CategoriesService } from './categories.service';

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

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @Meta() meta: ReqMeta) {
    return this.categories.update(user, id, dto, meta);
  }
}
