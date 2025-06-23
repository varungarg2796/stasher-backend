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
import { format, isToday, isAfter, isBefore, addDays } from 'date-fns';

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
      return "The user's inventory is empty.";
    }

    // Group items by status for better organization
    const activeItems = items.filter((item) => !item.archived);
    const archivedItems = items.filter((item) => item.archived);
    const today = new Date();

    const formatItem = (item: any) => {
      const details = [];

      // Enhanced category/tags with better formatting
      if (item.tags.length > 0) {
        const categories = item.tags.map((t) => t.tag.name).join(', ');
        details.push(`Categories: [${categories}]`);
      }

      details.push(`Quantity: ${item.quantity}`);

      // Enhanced price information
      if (item.priceless) {
        details.push('Value: Priceless (sentimental)');
      } else if (item.price) {
        details.push(`Value: ${item.price.toFixed(2)}`);
      }

      if (item.description) {
        details.push(`Description: "${item.description}"`);
      }

      // Enhanced location with context
      const location = item.archived
        ? 'ARCHIVED'
        : item.location?.name
          ? `"${item.location.name}"`
          : 'unspecified location';
      details.push(`Location: ${location}`);

      // Enhanced date information with context
      if (item.acquisitionDate) {
        const acquired = format(item.acquisitionDate, 'MMM d, yyyy');
        details.push(`Acquired: ${acquired}`);
      }

      if (item.expiryDate) {
        const expiry = format(item.expiryDate, 'MMM d, yyyy');
        const isExpired = isBefore(item.expiryDate, today);
        const isExpiringSoon =
          isAfter(item.expiryDate, today) &&
          isBefore(item.expiryDate, addDays(today, 7));

        let expiryStatus = `Expires: ${expiry}`;
        if (isExpired) {
          expiryStatus += ' (EXPIRED)';
        } else if (isExpiringSoon) {
          expiryStatus += ' (EXPIRES SOON)';
        }
        details.push(expiryStatus);
      }

      // Enhanced history with more context
      if (item.history && item.history.length > 0) {
        const historyEvents = item.history
          .map(
            (h) =>
              `${h.action} (${format(h.date, 'MMM d')})${h.note ? `: "${h.note}"` : ''}`,
          )
          .join('; ');
        details.push(`Recent activity: [${historyEvents}]`);
      }

      return `• "${item.name}" - ${details.join(' | ')}`;
    };

    let context = '';

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

  async answerQuestion(
    userId: string,
    question: string,
  ): Promise<{ answer: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException('User not found for AI query.');
    }

    let currentQueries = user.aiQueriesToday;
    if (!isToday(user.aiLastQueryAt)) {
      currentQueries = 0;
    }

    if (currentQueries >= this.dailyQueryLimit) {
      throw new ForbiddenException(
        `You have reached your daily limit of ${this.dailyQueryLimit} AI queries. Your limit will reset tomorrow.`,
      );
    }

    try {
      const inventoryContext = await this.generateInventoryContext(userId);
      const queryAnalysis = this.analyzeQueryIntent(question);

      // Enhanced system prompt with better instructions
      const systemPrompt = `You are "Stasher", an intelligent inventory assistant. Your role is to help users understand and manage their personal belongings.

CORE CAPABILITIES:
- Find specific items by name, category, or description
- Provide location information for items
- Count and summarize inventory
- Identify expired or expiring items
- Calculate total values
- Suggest organization improvements
- Answer general questions about the inventory

RESPONSE GUIDELINES:
1. ACCURACY: Base responses ONLY on the provided inventory data
2. CONTEXT AWARENESS: Consider the query type: ${queryAnalysis.type}
3. HELPFUL DETAILS: Include relevant details like location, quantity, expiry status
4. NATURAL LANGUAGE: Respond conversationally, not like a database query
5. ACTIONABLE: When appropriate, suggest next steps or actions

QUERY ANALYSIS:
- Type: ${queryAnalysis.type}
- Key terms: ${queryAnalysis.keywords.join(', ') || 'none detected'}
- Focus areas: ${
        [
          queryAnalysis.isLocationQuery && 'location',
          queryAnalysis.isQuantityQuery && 'quantities',
          queryAnalysis.isValueQuery && 'values',
          queryAnalysis.isExpiryQuery && 'expiry dates',
        ]
          .filter(Boolean)
          .join(', ') || 'general'
      }

RESPONSE PATTERNS:
- For location queries: "Your [item] is in [location]" or "I found [number] items in [location]"
- For counting: "You have [number] [items]. Here's the breakdown..."
- For searches: "I found [number] matching items: [details]"
- For value queries: "The total value is $[amount]" with breakdown
- For expiry: Highlight expired (EXPIRED) and soon-to-expire items (EXPIRES SOON)
- For not found: "I couldn't find any items matching '[query]' in your inventory."

SPECIAL NOTES:
- Items marked as ARCHIVED are stored/not in active use
- Priceless items have sentimental value, not monetary
- Recent activity shows what happened to items recently
- Today's date: ${format(new Date(), 'MMMM d, yyyy')}

Be conversational, helpful, and precise. If the inventory is empty or no matches found, say so clearly.`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      // Enhanced prompt with query analysis
      const fullPrompt = `INVENTORY DATA:
${inventoryContext}

USER QUESTION: "${question}"

Please analyze the inventory and provide a helpful response based on the user's question.`;

      // Adjust token limit based on query type
      const tokenLimit =
        queryAnalysis.type === 'general' ||
        question.toLowerCase().includes('summary') ||
        question.toLowerCase().includes('summarize')
          ? 500 // Higher limit for summaries and general queries
          : 300; // Standard limit for specific queries

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.2, // Slightly higher for more natural responses
          maxOutputTokens: tokenLimit,
          topP: 0.8,
          topK: 40,
        },
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
        ],
      });

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          aiQueriesToday: currentQueries + 1,
          aiLastQueryAt: new Date(),
        },
      });

      const responseText =
        result.response.text() || 'Sorry, I had trouble generating a response.';
      return { answer: responseText };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      console.error('Error contacting Google AI API:', error);
      throw new InternalServerErrorException(
        'Failed to get a response from the AI assistant.',
      );
    }
  }
}
