import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListNotificationsQuery } from './dto/list-notifications.query';
import { NotificationResponse } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar notificações do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Lista paginada de notificações', type: NotificationResponse })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  list(
    @CurrentUser() user: { userId: string },
    @Query() query: ListNotificationsQuery,
  ) {
    return this.notificationsService.listForUser(user.userId, query);
  }

  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Quantidade de notificações não lidas do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Contador de não lidas', schema: { example: { unread: 3 } } })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  unreadCount(@CurrentUser() user: { userId: string }) {
    return this.notificationsService.unreadCount(user.userId);
  }

  @Post(':id/read')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Marcar uma notificação como lida (apenas do próprio usuário)' })
  @ApiResponse({ status: 201, description: 'Notificação marcada como lida' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Notificação não encontrada (ou de outro usuário)' })
  markAsRead(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.notificationsService.markAsRead(user.userId, id);
  }

  @Post('read-all')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Marcar todas as notificações do usuário como lidas' })
  @ApiResponse({ status: 201, description: 'Todas as notificações marcadas como lidas' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  markAllRead(@CurrentUser() user: { userId: string }) {
    return this.notificationsService.markAllRead(user.userId);
  }
}