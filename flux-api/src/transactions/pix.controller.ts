import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SendPixDto } from './dto/send-pix.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('pix')
@ApiBearerAuth()
@Controller('pix')
export class PixController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Enviar um PIX para outra conta' })
  @ApiResponse({ status: 201, description: 'PIX enviado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos (valor, precisão, limite ou conta)' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta de origem/destino não encontrada' })
  @ApiResponse({ status: 409, description: 'Envio para a própria conta' })
  @ApiResponse({ status: 422, description: 'Saldo insuficiente ou conta bloqueada' })
  send(@CurrentUser() user: { userId: string }, @Body() dto: SendPixDto) {
    return this.transactionsService.sendPix(user.userId, dto);
  }
}