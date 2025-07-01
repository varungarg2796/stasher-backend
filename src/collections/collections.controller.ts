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
  Put,
  Query,
} from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { AddItemToCollectionDto } from './dto/add-item-to-collection.dto';
import { ReorderCollectionItemsDto } from './dto/reorder-collection-items.dto';
import { UpdateShareSettingsDto } from './dto/update-share-settings.dto';
import { Request } from 'express';

interface RequestWithUser extends Request {
  user: { id: string };
}

@UseGuards(JwtAuthGuard)
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Post()
  create(
    @Body() createCollectionDto: CreateCollectionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.collectionsService.create(createCollectionDto, req.user.id);
  }

  @Get()
  findAll(@Req() req: RequestWithUser) {
    return this.collectionsService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('includeArchived') includeArchived: string,
    @Req() req: RequestWithUser,
  ) {
    const includeArchivedBool = includeArchived === 'true';
    return this.collectionsService.findOne(
      id,
      req.user.id,
      includeArchivedBool,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCollectionDto: UpdateCollectionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.collectionsService.update(id, updateCollectionDto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.collectionsService.remove(id, req.user.id);
  }

  @Post(':id/items')
  addItem(
    @Param('id') id: string,
    @Body() addItemToCollectionDto: AddItemToCollectionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.collectionsService.addItem(
      id,
      addItemToCollectionDto.itemId,
      req.user.id,
    );
  }

  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.collectionsService.removeItem(id, itemId, req.user.id);
  }

  @Put(':id/items/reorder')
  reorderItems(
    @Param('id') id: string,
    @Body() reorderCollectionItemsDto: ReorderCollectionItemsDto,
    @Req() req: RequestWithUser,
  ) {
    return this.collectionsService.reorderItems(
      id,
      reorderCollectionItemsDto,
      req.user.id,
    );
  }

  @Patch(':id/share')
  updateShareSettings(
    @Param('id') id: string,
    @Body() updateShareSettingsDto: UpdateShareSettingsDto,
    @Req() req: RequestWithUser,
  ) {
    return this.collectionsService.updateShareSettings(
      id,
      updateShareSettingsDto,
      req.user.id,
    );
  }
}
