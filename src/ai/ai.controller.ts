import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Get,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { Request } from 'express';
import { AnalyzeImageDto } from './dto/analyze-image.dto';

// Define the type for the request object after the JWT guard has run
interface RequestWithUser extends Request {
  user: {
    id: string;
  };
}

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Endpoint for users to ask questions to the AI assistant.
   */
  @Post('ask')
  async askQuestion(
    @Req() req: RequestWithUser,
    @Body() askQuestionDto: AskQuestionDto,
  ) {
    const userId = req.user.id;
    return this.aiService.answerQuestion(userId, askQuestionDto.question);
  }

  @Get('query-status')
  async getQueryStatus(@Req() req: RequestWithUser): Promise<{
    remaining: number;
    total: number;
    resetTime?: Date;
  }> {
    return this.aiService.getQueryStatus(req.user.id);
  }

  @Get('analysis-status')
  async getAnalysisStatus(@Req() req: RequestWithUser): Promise<{
    remaining: number;
    total: number;
    resetTime?: Date;
  }> {
    return this.aiService.getAnalysisStatus(req.user.id);
  }

  @Post('analyze-image')
  async analyzeImage(
    @Req() req: RequestWithUser,
    @Body() analyzeImageDto: AnalyzeImageDto,
  ) {
    const { imageData, mimeType } = analyzeImageDto;
    return this.aiService.analyzeImage(req.user.id, imageData, mimeType);
  }

  @Get('collection-suggestions')
  async getCollectionSuggestions(
    @Req() req: RequestWithUser,
    @Query('limit') limit?: string,
  ) {
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return this.aiService.generateCollectionSuggestions(
      req.user.id,
      limitNumber,
    );
  }
}
