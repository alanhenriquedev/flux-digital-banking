import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListLoginsQuery } from './dto/list-logins.query';
import { SecurityService } from './security.service';

interface AuthUser {
  userId: string;
  sid: string | null;
}

@ApiTags('security')
@ApiBearerAuth()
@Controller('auth/security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('overview')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Visão geral de segurança da conta autenticada' })
  @ApiResponse({ status: 200, description: 'Dados de segurança da conta' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  overview(@CurrentUser() user: { userId: string }) {
    return this.securityService.getOverview(user.userId);
  }

  @Get('logins')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Histórico de acessos do usuário autenticado (paginado)' })
  @ApiResponse({ status: 200, description: 'Histórico paginado de acessos' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  logins(
    @CurrentUser() user: { userId: string },
    @Query() query: ListLoginsQuery,
  ) {
    return this.securityService.listLogins(user.userId, query);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Sessões ativas do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Lista de sessões ativas' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  sessions(@CurrentUser() user: AuthUser) {
    return this.securityService.listActiveSessions(user.userId, user.sid);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Encerrar o acesso do dispositivo correspondente à sessão informada (todas as sessões daquele navegador/dispositivo)',
  })
  @ApiResponse({ status: 200, description: 'Dispositivo encerrado (ou já encerrado)' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Sessão não encontrada para este usuário' })
  deleteSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.securityService.revokeDevice(id, user.userId);
  }

  @Post('sessions/revoke-others')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Encerrar todas as demais sessões, mantendo a atual' })
  @ApiResponse({ status: 201, description: 'Outras sessões encerradas' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  revokeOthers(@CurrentUser() user: AuthUser) {
    return this.securityService.revokeOthers(user.userId, user.sid);
  }
}