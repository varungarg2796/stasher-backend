import { Controller, Get, Param } from '@nestjs/common';
import { ShareService } from './share.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Public() // This makes the endpoint accessible without a JWT
  @Get('collection/:shareId')
  findSharedCollection(@Param('shareId') shareId: string) {
    return this.shareService.findSharedCollection(shareId);
  }
}
