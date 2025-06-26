import {
  Injectable,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { format, isToday, isBefore } from 'date-fns';

export interface FoundItem {
  id: string;
  name: string;
  location?: string;
  image?: string;
  tags?: string[];
  quantity?: number;
  description?: string;
}

export interface AiResponse {
  answer: string;
  foundItems?: FoundItem[];
  queryStatus: {
    remaining: number;
    total: number;
    resetTime?: Date;
  };
  responseTime?: number;
}

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly dailyQueryLimit = 10;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new Error(
        'GOOGLE_API_KEY is not set in the environment variables.',
      );
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  // Alternative approach - modify your generateInventoryContext to be smarter about large inventories:

  private async generateInventoryContext(userId: string): Promise<string> {
    const items = await this.prisma.item.findMany({
      where: { ownerId: userId },
      include: {
        location: true,
        tags: { include: { tag: true } },
        history: { orderBy: { date: 'desc' }, take: 3 },
      },
    });

    if (items.length === 0) {
      return `This user (${userId}) has no items in their inventory.`;
    }

    const activeItems = items.filter((item) => !item.archived);
    const archivedItems = items.filter((item) => item.archived);
    const today = new Date();

    // For large inventories, provide summary + sample
    if (activeItems.length > 10) {
      const sampleItems = activeItems.slice(0, 8); // Show first 8 items
      const remainingCount = activeItems.length - 8;

      const formatItem = (item: any) => {
        const details = [];

        if (item.tags.length > 0) {
          const categories = item.tags.map((t) => t.tag.name).join(', ');
          details.push(`Categories: [${categories}]`);
        }

        details.push(`Quantity: ${item.quantity}`);

        if (item.priceless) {
          details.push('Value: Priceless');
        } else if (item.price) {
          details.push(`Value: ${item.price.toFixed(2)}`);
        }

        if (item.description) {
          details.push(`Description: "${item.description}"`);
        }

        const location = item.archived
          ? 'ARCHIVED'
          : item.location?.name || 'unspecified location';
        details.push(`Location: ${location}`);

        if (item.expiryDate) {
          const expiry = format(item.expiryDate, 'MMM d, yyyy');
          const isExpired = isBefore(item.expiryDate, today);
          details.push(
            isExpired ? `EXPIRED (${expiry})` : `Expires: ${expiry}`,
          );
        }

        return `• ID:${item.id} "${item.name}" - ${details.join(' | ')}`;
      };

      let context = `USER ${userId} INVENTORY SUMMARY:
Total: ${activeItems.length} active items, ${archivedItems.length} archived

SAMPLE ACTIVE ITEMS (showing first 8 of ${activeItems.length}):
`;
      context += sampleItems.map(formatItem).join('\n');
      context += `\n\n... and ${remainingCount} more items not shown in this sample.`;

      if (archivedItems.length > 0) {
        context += `\n\nARCHIVED ITEMS (${archivedItems.length}): Available but not shown in detail.`;
      }

      return context;
    }

    // For smaller inventories, show all items
    const formatItem = (item: any) => {
      const details = [];

      if (item.tags.length > 0) {
        const categories = item.tags.map((t) => t.tag.name).join(', ');
        details.push(`Categories: [${categories}]`);
      }

      details.push(`Quantity: ${item.quantity}`);

      if (item.priceless) {
        details.push('Value: Priceless');
      } else if (item.price) {
        details.push(`Value: ${item.price.toFixed(2)}`);
      }

      if (item.description) {
        details.push(`Description: "${item.description}"`);
      }

      const location = item.archived
        ? 'ARCHIVED'
        : item.location?.name || 'unspecified location';
      details.push(`Location: ${location}`);

      if (item.expiryDate) {
        const expiry = format(item.expiryDate, 'MMM d, yyyy');
        const isExpired = isBefore(item.expiryDate, today);
        details.push(isExpired ? `EXPIRED (${expiry})` : `Expires: ${expiry}`);
      }

      return `• ID:${item.id} "${item.name}" - ${details.join(' | ')}`;
    };

    let context = `USER ${userId} INVENTORY:\n\n`;

    if (activeItems.length > 0) {
      context += `ACTIVE ITEMS (${activeItems.length}):\n`;
      context += activeItems.map(formatItem).join('\n') + '\n\n';
    }

    if (archivedItems.length > 0) {
      context += `ARCHIVED ITEMS (${archivedItems.length}):\n`;
      context += archivedItems.map(formatItem).join('\n');
    }

    return context;
  }

  private cleanResponseForUser(response: string): string {
    return (
      response
        // Remove ID references first
        .replace(/\(ID:[a-zA-Z0-9]+\)/g, '')
        .replace(/ID:[a-zA-Z0-9]+\s*/g, '')

        // Remove asterisks and markdown
        .replace(/\*\*\*/g, '')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')

        // Add proper line breaks after key information
        .replace(/(\d+\.\s+[^:]+?)(\s+Location:)/g, '$1\n   Location:')
        .replace(/(Location:\s*[^\n]+?)(\s+Quantity:)/g, '$1\n   Quantity:')
        .replace(/(Quantity:\s*\d+)(\s+Value:)/g, '$1\n   Value:')
        .replace(/(Value:\s*[^\n]+?)(\s+Categories:)/g, '$1\n   Categories:')
        .replace(/(Categories:\s*[^\n]+?)(\s+Acquired:)/g, '$1\n   Acquired:')
        .replace(/(Acquired:\s*[^\n]+?)(\s+Expires:)/g, '$1\n   Expires:')
        .replace(/(Expires:\s*[^\n]+?)(\s+\d+\.)/g, '$1\n\n$2')

        // Fix spacing and clean up
        .replace(/\s+/g, ' ')
        .replace(/\n\s+/g, '\n   ') // Indent details
        .replace(/\n{3,}/g, '\n\n')

        .trim()
    );
  }

  private analyzeQueryIntent(question: string): {
    type:
      | 'search'
      | 'count'
      | 'status'
      | 'location'
      | 'value'
      | 'organization'
      | 'general';
    keywords: string[];
    isLocationQuery: boolean;
    isQuantityQuery: boolean;
    isValueQuery: boolean;
    isExpiryQuery: boolean;
  } {
    const lowerQuestion = question.toLowerCase();

    // Detect query type
    let type:
      | 'search'
      | 'count'
      | 'status'
      | 'location'
      | 'value'
      | 'organization'
      | 'general' = 'general';

    if (lowerQuestion.includes('where') || lowerQuestion.includes('location')) {
      type = 'location';
    } else if (
      lowerQuestion.includes('how many') ||
      lowerQuestion.includes('count') ||
      lowerQuestion.includes('total')
    ) {
      type = 'count';
    } else if (
      lowerQuestion.includes('worth') ||
      lowerQuestion.includes('value') ||
      lowerQuestion.includes('cost') ||
      lowerQuestion.includes('price')
    ) {
      type = 'value';
    } else if (
      lowerQuestion.includes('expired') ||
      lowerQuestion.includes('expiring') ||
      lowerQuestion.includes('expiry')
    ) {
      type = 'status';
    } else if (
      lowerQuestion.includes('organize') ||
      lowerQuestion.includes('suggest') ||
      lowerQuestion.includes('recommend')
    ) {
      type = 'organization';
    } else if (
      lowerQuestion.includes('find') ||
      lowerQuestion.includes('do i have') ||
      lowerQuestion.includes('show me')
    ) {
      type = 'search';
    }

    // Extract keywords (remove common words)
    const commonWords = [
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'up',
      'about',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'among',
      'do',
      'i',
      'have',
      'my',
      'where',
      'are',
      'is',
      'what',
      'how',
      'many',
      'much',
    ];
    const keywords = question
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !commonWords.includes(word));

    return {
      type,
      keywords,
      isLocationQuery: type === 'location',
      isQuantityQuery: type === 'count',
      isValueQuery: type === 'value',
      isExpiryQuery: lowerQuestion.includes('expir'),
    };
  }

  private parseFoundItems(
    aiResponse: string,
    userId: string,
  ): Promise<FoundItem[]> {
    // Extract item IDs from the AI response
    const itemIdMatches = aiResponse.match(/ID:(\w+)/g);
    if (!itemIdMatches) return Promise.resolve([]);

    const itemIds = itemIdMatches.map((match) => match.replace('ID:', ''));

    return this.prisma.item
      .findMany({
        where: {
          id: { in: itemIds },
          ownerId: userId,
        },
        include: {
          location: true,
          tags: { include: { tag: true } },
        },
      })
      .then((items) =>
        items.map((item) => ({
          id: item.id,
          name: item.name,
          location: item.location?.name,
          image: item.imageUrl,
          tags: item.tags.map((t) => t.tag.name),
          quantity: item.quantity,
          description: item.description,
        })),
      );
  }

  private calculateResetTime(user: any): Date | undefined {
    if (!isToday(user.aiLastQueryAt)) {
      return undefined; // Queries reset immediately for new day
    }

    // Calculate next midnight
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  async getQueryStatus(
    userId: string,
  ): Promise<{ remaining: number; total: number; resetTime?: Date }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException(
        'User not found for query status.',
      );
    }

    let currentQueries = user.aiQueriesToday;
    if (!isToday(user.aiLastQueryAt)) {
      currentQueries = 0;
    }

    const remaining = Math.max(0, this.dailyQueryLimit - currentQueries);
    const resetTime =
      remaining === 0 ? this.calculateResetTime(user) : undefined;

    return {
      remaining,
      total: this.dailyQueryLimit,
      resetTime,
    };
  }

  async answerQuestion(userId: string, question: string): Promise<AiResponse> {
    const startTime = Date.now(); // Start timing

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException('User not found for AI query.');
    }

    let currentQueries = user.aiQueriesToday;
    if (!isToday(user.aiLastQueryAt)) {
      currentQueries = 0;
    }

    if (currentQueries >= this.dailyQueryLimit) {
      const resetTime = this.calculateResetTime(user);
      throw new ForbiddenException({
        message: `You have reached your daily limit of ${this.dailyQueryLimit} AI queries. Your limit will reset tomorrow.`,
        queryStatus: {
          remaining: 0,
          total: this.dailyQueryLimit,
          resetTime,
        },
      });
    }

    try {
      const inventoryContext = await this.generateInventoryContext(userId);
      const queryAnalysis = this.analyzeQueryIntent(question);

      // Your existing system prompt (use the improved one from earlier)
      const systemPrompt = `You are "Stasher", a helpful inventory assistant for this specific user only.

CRITICAL SECURITY RULES:
- Only access items belonging to user ${userId}
- Never mention other users' data

FORMATTING RULES:
- Use numbered lists with clear line breaks
- Put each detail on a new line with proper indentation
- Include item IDs as (ID:itemId) when mentioning items
- NEVER add currency symbols - show values as raw numbers

PERFECT FORMATTING EXAMPLE:
"You have 5 active items:

1. Gaming Laptop (ID:abc123)
   Location: Bathroom
   Value: 2000.00
   Quantity: 1
   Categories: Electronics

2. Body Lotion (ID:def456)
   Location: Bathroom
   Value: 500.00
   Expires: August 31, 2025
   Categories: Beauty"

VALUE RULES:
- Show exactly as stored: "Value: 2000.00" (NO $ symbols)
- Priceless items: "Value: Priceless"

Query type: ${queryAnalysis.type}
Write clean, readable responses with proper line breaks.`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      const fullPrompt = `INVENTORY DATA:
${inventoryContext}

USER QUESTION: "${question}"

Please analyze the inventory and provide a helpful, well-formatted response. Remember to include item IDs (ID:itemId) when mentioning specific items.`;

      const tokenLimit =
        queryAnalysis.type === 'general' ||
        question.toLowerCase().includes('summary') ||
        question.toLowerCase().includes('summarize') ||
        question.toLowerCase().includes('all') ||
        question.toLowerCase().includes('list')
          ? 800 // Higher limit for comprehensive queries
          : 400; // Standard limit for specific queries

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.1, // Lower temperature for more consistent formatting
          maxOutputTokens: tokenLimit,
          topP: 0.7,
          topK: 30,
        },
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
        ],
      });

      // Update user query count
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          aiQueriesToday: currentQueries + 1,
          aiLastQueryAt: new Date(),
        },
      });

      const responseText =
        result.response.text() || 'Sorry, I had trouble generating a response.';

      // Parse found items from the response BEFORE cleaning
      const foundItems = await this.parseFoundItems(responseText, userId);

      // Clean the response for user display
      const cleanResponse = this.cleanResponseForUser(responseText);

      // Get updated query status
      const queryStatus = await this.getQueryStatus(userId);

      // Calculate response time
      const responseTime = Date.now() - startTime;

      return {
        answer: cleanResponse,
        foundItems,
        queryStatus,
        responseTime, // Add timing information
      };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      console.error('Error contacting Google AI API:', error);
      throw new InternalServerErrorException(
        'Failed to get a response from the AI assistant.',
      );
    }
  }
}
