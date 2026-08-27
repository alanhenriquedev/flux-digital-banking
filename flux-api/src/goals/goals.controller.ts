import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { GoalAmountDto } from './dto/goal-amount.dto';

@ApiTags('goals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as metas do usuário autenticado' })
  list(@CurrentUser() user: { userId: string }) {
    return this.goals.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma meta financeira' })
  create(@CurrentUser() user: { userId: string }, @Body() dto: CreateGoalDto) {
    return this.goals.create(user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita nome/descrição/objetivo/prazo ou pausa-retoma' })
  update(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goals.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Exclui a meta — permitido somente quando não há valor reservado (currentAmount = 0)',
  })
  remove(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.goals.remove(user.userId, id);
  }

  @Post(':id/deposit')
  @ApiOperation({ summary: 'Adiciona dinheiro da conta à meta (débito atômico)' })
  deposit(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GoalAmountDto,
  ) {
    return this.goals.deposit(user.userId, id, dto.amount);
  }

  @Post(':id/withdraw')
  @ApiOperation({ summary: 'Retira dinheiro reservado da meta de volta à conta' })
  withdraw(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GoalAmountDto,
  ) {
    return this.goals.withdraw(user.userId, id, dto.amount);
  }
}
