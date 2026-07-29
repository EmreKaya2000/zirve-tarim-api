import { Global, Module } from '@nestjs/common';

import { AuditLogsService } from './audit-logs.service';

/**
 * Denetim kaydı modülü.
 *
 * Global'dir: her modül kritik işlemlerini kaydedeceği için tekrar tekrar
 * import edilmesi gereksiz gürültü olur.
 */
@Global()
@Module({
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
