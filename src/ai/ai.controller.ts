import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { Request } from 'express';

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
}
