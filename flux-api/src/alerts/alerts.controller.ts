import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertKind } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AlertsService } from './alerts.service';
import { UpdateAlertSettingDto, ALERT_KINDS } from './dto/update-alert-setting.dto';

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Lista as preferências de alertas do usuário autenticado' })
  settings(@CurrentUser() user: { userId: string }) {
    return this.alerts.getSettings(user.userId);
  }

  @Put('settings/:kind')
  @ApiOperation({ summary: 'Atualiza uma preferência (enabled e/ou threshold)' })
  update(
    @CurrentUser() user: { userId: string },
    @Param('kind') kind: string,
    @Body() dto: UpdateAlertSettingDto,
  ) {
    if (!ALERT_KINDS.includes(kind as (typeof ALERT_KINDS)[number])) {
      throw new BadRequestException('Tipo de alerta desconhecido.');
    }
    return this.alerts.updateSetting(user.userId, kind as AlertKind, dto);
  }
}
