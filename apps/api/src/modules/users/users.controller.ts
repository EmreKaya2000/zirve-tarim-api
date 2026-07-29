import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ERROR_CODES, type AuthUser, type PaginatedResult } from '@zirve/types';

import {
  ApiErrorResponse,
  ApiPaginatedResponse,
  ApiStandardResponse,
} from '../../common/swagger/api-response.decorators';
import { getRequestContext } from '../../common/utils/request-context';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUserDto } from '../auth/dto/auth.dto';
import {
  ChangePasswordDto,
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
  SetUserStatusDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersService, type ActorContext } from './users.service';

/**
 * Yönetici kullanıcı yönetimi.
 *
 * Kullanıcı oluşturma, güncelleme, pasife alma ve silme YALNIZ SUPER_ADMIN
 * yetkisindedir (docs/ARCHITECTURE.md §8.2). Listeleme ve kendi şifresini
 * değiştirme tüm panel kullanıcılarına açıktır.
 */
@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Yönetici kullanıcılarını listele',
    description: 'Sayfalama, arama (ad/e-posta), rol ve aktiflik filtresi destekler.',
  })
  @ApiPaginatedResponse(AuthUserDto)
  @ApiErrorResponse(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, 'SUPER_ADMIN yetkisi gerekir.')
  async findMany(@Query() query: ListUsersQueryDto): Promise<PaginatedResult<AuthUser>> {
    return this.usersService.findMany(query);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Kullanıcı detayı' })
  @ApiStandardResponse(AuthUserDto)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Kullanıcı bulunamadı.')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AuthUser> {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Yeni yönetici kullanıcı oluştur',
    description: 'Yalnız SUPER_ADMIN yeni kullanıcı oluşturabilir.',
  })
  @ApiStandardResponse(AuthUserDto, { status: 201, description: 'Kullanıcı oluşturuldu.' })
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    ERROR_CODES.EMAIL_ALREADY_EXISTS,
    'Bu e-posta adresi zaten kullanılıyor.',
  )
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<AuthUser> {
    return this.usersService.create(dto, toActor(user, request));
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Kullanıcı bilgilerini güncelle' })
  @ApiStandardResponse(AuthUserDto)
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ERROR_CODES.LAST_SUPER_ADMIN,
    'Son süper yöneticinin rolü düşürülemez.',
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<AuthUser> {
    return this.usersService.update(id, dto, toActor(user, request));
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kullanıcıyı aktifleştir / pasife al',
    description:
      'Pasife alınan kullanıcının tüm oturumları anında düşürülür. Kendi hesabınızı pasife alamazsınız.',
  })
  @ApiStandardResponse(AuthUserDto)
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ERROR_CODES.SELF_ACTION_FORBIDDEN,
    'Kendi hesabınız üzerinde yapılamaz / son süper yönetici.',
  )
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<AuthUser> {
    return this.usersService.setStatus(id, dto.isActive, toActor(user, request));
  }

  @Patch(':id/reset-password')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kullanıcı şifresini sıfırla',
    description: 'Kullanıcının tüm oturumları düşürülür ve hesap kilidi kaldırılır.',
  })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.usersService.resetPassword(id, dto.newPassword, toActor(user, request));
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Kendi şifreni değiştir',
    description:
      'Tüm panel kullanıcılarına açıktır. Başarılı değişiklikten sonra tüm oturumlar düşer; yeniden giriş gerekir.',
  })
  @ApiErrorResponse(
    HttpStatus.UNAUTHORIZED,
    ERROR_CODES.INVALID_CREDENTIALS,
    'Mevcut şifre hatalı.',
  )
  async changeOwnPassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.usersService.changeOwnPassword(user.id, dto, toActor(user, request));
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Kullanıcıyı sil (soft delete)',
    description: 'Kayıt korunur, denetim izleri kırılmaz. Kullanıcı giriş yapamaz hâle gelir.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.usersService.remove(id, toActor(user, request));
  }
}

function toActor(user: RequestUser, request: Request): ActorContext {
  return { id: user.id, ...getRequestContext(request) };
}
