import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListTransactionsQuery } from './dto/list-transactions.query';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar transações da conta autenticada' })
  @ApiResponse({ status: 200, description: 'Lista paginada de transações da conta autenticada' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  list(@CurrentUser() user: { userId: string }, @Query() query: ListTransactionsQuery) {
    return this.transactionsService.listForAccount(user.userId, query);
  }
}