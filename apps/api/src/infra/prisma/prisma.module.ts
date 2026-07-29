import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Prisma istemcisini uygulama genelinde tekil olarak sağlar.
 * Global olduğu için her modülde ayrıca import edilmesine gerek yoktur.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
