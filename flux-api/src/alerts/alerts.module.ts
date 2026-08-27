import { Global, Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

/**
 * Módulo GLOBAL: qualquer serviço da aplicação pode injetar
 * AlertsService para respeitar as preferências do usuário
 * antes de criar notificações.
 */
@Global()
@Module({
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
