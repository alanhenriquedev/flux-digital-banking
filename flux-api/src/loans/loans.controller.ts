import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoanResponse } from './dto/loan-response.dto';
import { SimulateLoanDto } from './dto/simulate-loan.dto';
import { LoansService } from './loans.service';

@ApiTags('loans')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post('simulate')
  @ApiOperation({ summary: 'Simular empréstimo com a taxa oficial da Flux (sem persistir, público)' })
  @ApiResponse({
    status: 201,
    description: 'Resultado da simulação (Price, taxa única do backend)',
    schema: {
      example: {
        amount: 5000,
        interestRate: 0.0199,
        installments: 12,
        installmentValue: 471.03,
        totalAmount: 5652.36,
        interestTotal: 652.36,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Dados inválidos (valor fora de 500–20.000 ou parcelas fora de 6–48)' })
  simulate(@Body() dto: SimulateLoanDto) {
    return this.loansService.simulate(dto);
  }

  /**
   * Solicitação de empréstimo.
   * Análise V1: aprovação automática imediata de solicitações válidas
   * (REQUESTED → APPROVED com approvedAt). NÃO libera crédito, NÃO cria
   * parcelas nem transação, NÃO altera saldo.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Solicitar empréstimo (JWT). Não libera crédito nesta fase' })
  @ApiResponse({ status: 201, description: 'Empréstimo solicitado e aprovado pela análise V1', type: LoanResponse })
  @ApiResponse({ status: 400, description: 'Valores inválidos ou solicitação em andamento com os mesmos valores' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  request(@CurrentUser() user: { userId: string }, @Body() dto: CreateLoanDto) {
    return this.loansService.request(user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar empréstimos do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Lista de empréstimos (mais recentes primeiro)', type: [LoanResponse] })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  list(@CurrentUser() user: { userId: string }) {
    return this.loansService.listForUser(user.userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalhe de um empréstimo (apenas do próprio usuário)' })
  @ApiResponse({ status: 200, description: 'Empréstimo', type: LoanResponse })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Empréstimo não encontrado (ou de outro usuário)' })
  detail(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.loansService.detailForUser(user.userId, id);
  }

  /**
   * Contratação do empréstimo aprovado.
   * Crédito na conta + transação LOAN/IN + geração das parcelas em UMA
   * transação atomic; a notificação é pós-commit (safeCreate).
   */
  @Post(':id/contract')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Contratar empréstimo aprovado (JWT) — crédito na conta + parcelas' })
  @ApiResponse({ status: 201, description: 'Empréstimo contratado', schema: { example: { loan: {}, installments: [], disbursement: {} } } })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Empréstimo não encontrado (ou de outro usuário)' })
  @ApiResponse({ status: 409, description: 'Empréstimo não está em APPROVED (ex.: já contratado)' })
  contract(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.loansService.contract(user.userId, id);
  }

  /**
   * Pagamento INTEGRAL de uma parcela (JWT, isolado por userId).
   * Sem body — o valor vem do banco. Aceita PENDING/OVERDUE; PAID → 409.
   * Última parcela paga quita o loan (PAID_OFF).
   */
  @Post(':loanId/installments/:installmentId/pay')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pagar uma parcela do empréstimo (integral, JWT)' })
  @ApiResponse({ status: 201, description: 'Parcela paga', schema: { example: { installment: {}, loan: {}, remaining: 11, paidOff: false } } })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Empréstimo/parcela não encontrado (ou de outro usuário)' })
  @ApiResponse({ status: 409, description: 'Parcela já paga ou empréstimo não está CONTRACTED' })
  @ApiResponse({ status: 422, description: 'Saldo insuficiente ou conta bloqueada' })
  pay(
    @CurrentUser() user: { userId: string },
    @Param('loanId') loanId: string,
    @Param('installmentId') installmentId: string,
  ) {
    return this.loansService.pay(user.userId, loanId, installmentId);
  }
}