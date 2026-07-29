import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsUUID, ValidateIf } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * POST /admin/customer-accounts/:id/link
 *
 * `customerId: null` bağı KALDIRIR. Bağlamak ve çözmek TEK uçtur çünkü ikisi
 * aynı alanın iki değeridir; ayrı uçlar (link / unlink) aynı denetim kaydını
 * ve aynı çakışma kontrollerini iki kez yazmayı gerektirirdi.
 */
export class LinkCustomerAccountDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Bağlanacak müşteri kartı. `null` gönderilirse bağ kaldırılır.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4', { message: 'customerId geçerli bir kimlik olmalıdır.' })
  customerId?: string | null;
}

/** GET /admin/customer-accounts filtreleri. */
export class CustomerAccountQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Yalnız bir CRM kartına BAĞLI (`true`) veya BAĞSIZ (`false`) hesaplar. ' +
      'Bağsız hesaplar, yöneticinin eşleştirme yapması gereken listedir.',
  })
  @IsOptional()
  @IsBooleanString({ message: 'linked yalnız true veya false olabilir.' })
  linked?: string;
}
