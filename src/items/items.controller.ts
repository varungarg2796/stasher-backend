import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';
import { FindAllItemsDto } from './dto/find-all-items.dto';
import { BulkCreateItemDto } from './dto/bulk-create-item.dto';

interface RequestWithUser extends Request {
  user: { id: string };
}

@UseGuards(JwtAuthGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  create(@Body() createItemDto: CreateItemDto, @Req() req: RequestWithUser) {
    return this.itemsService.create(createItemDto, req.user.id);
  }

  @Get()
  findAll(@Req() req: RequestWithUser, @Query() queryDto: FindAllItemsDto) {
    return this.itemsService.findAll(req.user.id, queryDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.itemsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateItemDto: UpdateItemDto,
    @Req() req: RequestWithUser,
  ) {
    return this.itemsService.update(id, updateItemDto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.itemsService.remove(id, req.user.id);
  }

  @Post('bulk')
  bulkCreate(
    @Body() bulkCreateItemDto: BulkCreateItemDto,
    @Req() req: RequestWithUser,
  ) {
    return this.itemsService.bulkCreate(bulkCreateItemDto, req.user.id);
  }
}
