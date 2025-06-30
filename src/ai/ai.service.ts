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

export interface FoundCollection {
  id: string;
  name: string;
  description?: string;
  itemCount: number;
  coverImage?: string;
}

export interface AiResponse {
  answer: string;
  foundItems?: FoundItem[];
  foundCollections?: FoundCollection[];
  queryStatus: {
    remaining: number;
    total: number;
    resetTime?: Date;
  };
  responseTime?: number;
}

export interface ImageAnalysisResponse {
  name: string;
  tags: string[];
}

export interface CollectionSuggestion {
  name: string;
  description: string;
  itemIds: string[];
  itemNames: string[];
  suggestedBy: 'location' | 'price' | 'gemini' | 'pattern';
  confidence: number;
  suggestionId: string; // Unique identifier for tracking dismissals
  itemsAlreadyInCollections?: Array<{
    itemId: string;
    itemName: string;
    existingCollections: Array<{ id: string; name: string }>;
  }>;
}

export interface CollectionSuggestionsResponse {
  suggestions: CollectionSuggestion[];
  totalUncollectedItems: number;
}

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly dailyQueryLimit = 10;
  private readonly dailyAnalysisLimit = 5; // The new, separate limit

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

  private generateSuggestionId(
    name: string,
    itemIds: string[],
    suggestedBy: string,
  ): string {
    const content = `${name}-${itemIds.sort().join(',')}-${suggestedBy}`;
    // Simple hash alternative - good enough for suggestion IDs
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 8);
  }

  private shouldSuppressSuggestion(
    suggestion: CollectionSuggestion,
    existingCollections: any[],
  ): boolean {
    // Suppress if >80% of items are already in similar collections
    if (!suggestion.itemsAlreadyInCollections) return false;

    const alreadyCollectedCount = suggestion.itemsAlreadyInCollections.length;
    const totalItems = suggestion.itemIds.length;
    const collectionPercentage = alreadyCollectedCount / totalItems;

    // Check if a very similar collection already exists
    const similarCollectionExists = existingCollections.some((collection) => {
      const similarity = this.calculateCollectionSimilarity(
        suggestion.name,
        collection.name,
      );
      return similarity > 0.7; // 70% similarity threshold
    });

    return collectionPercentage > 0.8 || similarCollectionExists;
  }

  private calculateCollectionSimilarity(name1: string, name2: string): number {
    const words1 = name1.toLowerCase().split(' ');
    const words2 = name2.toLowerCase().split(' ');
    const commonWords = words1.filter((word) => words2.includes(word));
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  private async generateCollectionContext(userId: string): Promise<string> {
    const collections = await this.prisma.collection.findMany({
      where: { ownerId: userId },
      include: {
        items: {
          include: {
            item: {
              include: {
                location: true,
                tags: { include: { tag: true } },
              },
            },
          },
        },
        _count: { select: { items: true } },
      },
    });

    if (collections.length === 0) {
      return `This user has no collections.`;
    }

    let context = `USER ${userId} COLLECTIONS:\n\n`;

    collections.forEach((collection) => {
      const details = [];
      details.push(`Items: ${collection._count.items}`);

      if (collection.description) {
        details.push(`Description: "${collection.description}"`);
      }

      context += `• COLLECTION_ID:${collection.id} "${collection.name}" - ${details.join(' | ')}\n`;

      if (collection.items.length > 0) {
        context += `  Contains: `;
        const itemNames = collection.items
          .slice(0, 3)
          .map((ci) => ci.item.name);
        context += itemNames.join(', ');
        if (collection.items.length > 3) {
          context += ` and ${collection.items.length - 3} more items`;
        }
        context += `\n`;
      }
      context += `\n`;
    });

    return context;
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
        // Remove ID references with parentheses completely
        .replace(/\(ID:[a-zA-Z0-9]+\)/g, '')
        .replace(/\(COLLECTION_ID:[a-zA-Z0-9]+\)/g, '')

        // Remove standalone ID references
        .replace(/ID:[a-zA-Z0-9]+,?\s*/g, '')
        .replace(/COLLECTION_ID:[a-zA-Z0-9]+,?\s*/g, '')

        // Remove asterisks and markdown
        .replace(/\*\*\*/g, '')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')

        // Clean up multiple commas and spaces left from ID removal
        .replace(/,\s*,/g, ',')
        .replace(/,\s*and/g, ' and')
        .replace(/:\s*,/g, ':')

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

  private cleanJsonResponse(response: string): string {
    // Remove markdown code block markers
    let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');

    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();

    // Handle common Gemini response patterns
    // Pattern 1: Array format [{"name": ...}, {"name": ...}]
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return arrayMatch[0];
    }

    // Pattern 2: Multiple objects separated by commas: {"name": ...}, {"name": ...}
    // Convert to proper array format
    if (cleaned.includes('"},') && !cleaned.startsWith('[')) {
      // Split by "},\s*{" to find object boundaries
      const objectParts = cleaned.split(/\},\s*\{/);
      if (objectParts.length > 1) {
        // Reconstruct as proper array
        const fixedObjects = objectParts.map((part, index) => {
          if (index === 0) return part + '}'; // First object
          if (index === objectParts.length - 1) return '{' + part; // Last object
          return '{' + part + '}'; // Middle objects
        });
        return '[' + fixedObjects.join(', ') + ']';
      }
    }

    // Pattern 3: Single object {"name": ...}
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return '[' + objectMatch[0] + ']'; // Wrap single object in array
    }

    // Fallback: return as is
    return cleaned;
  }

  private analyzeQueryIntent(question: string): {
    type:
      | 'search'
      | 'count'
      | 'status'
      | 'location'
      | 'value'
      | 'organization'
      | 'collection'
      | 'general';
    keywords: string[];
    isLocationQuery: boolean;
    isQuantityQuery: boolean;
    isValueQuery: boolean;
    isExpiryQuery: boolean;
    isCollectionQuery: boolean;
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
      | 'collection'
      | 'general' = 'general';

    if (
      lowerQuestion.includes('collection') ||
      lowerQuestion.includes('collections') ||
      lowerQuestion.includes('group') ||
      lowerQuestion.includes('category')
    ) {
      type = 'collection';
    } else if (
      lowerQuestion.includes('where') ||
      lowerQuestion.includes('location')
    ) {
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
      isCollectionQuery: type === 'collection',
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

  private parseFoundCollections(
    aiResponse: string,
    userId: string,
  ): Promise<FoundCollection[]> {
    // Extract collection IDs from the AI response
    const collectionIdMatches = aiResponse.match(/COLLECTION_ID:(\w+)/g);
    if (!collectionIdMatches) return Promise.resolve([]);

    const collectionIds = collectionIdMatches.map((match) =>
      match.replace('COLLECTION_ID:', ''),
    );

    return this.prisma.collection
      .findMany({
        where: {
          id: { in: collectionIds },
          ownerId: userId,
        },
        include: {
          _count: { select: { items: true } },
        },
      })
      .then((collections) =>
        collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          description: collection.description,
          itemCount: collection._count.items,
          coverImage: collection.coverImage,
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

  async getAnalysisStatus(
    userId: string,
  ): Promise<{ remaining: number; total: number; resetTime?: Date }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException(
        'User not found for analysis status.',
      );
    }

    let currentAnalyses = user.aiAnalysesToday;
    if (!isToday(user.aiAnalysisLastAt)) {
      currentAnalyses = 0;
    }

    const remaining = Math.max(0, this.dailyAnalysisLimit - currentAnalyses);
    const resetTime =
      remaining === 0 ? this.calculateResetTime(user) : undefined;

    return {
      remaining,
      total: this.dailyAnalysisLimit,
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
      const collectionContext = await this.generateCollectionContext(userId);
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
- Include collection IDs as (COLLECTION_ID:collectionId) when mentioning collections
- NEVER add currency symbols - show values as raw numbers

PERFECT FORMATTING EXAMPLE:
"You have 5 active items and 2 collections:

Items:
1. Gaming Laptop (ID:abc123)
   Location: Bathroom
   Value: 2000.00
   Quantity: 1
   Categories: Electronics

2. Body Lotion (ID:def456)
   Location: Bathroom
   Value: 500.00
   Expires: August 31, 2025
   Categories: Beauty

Collections:
1. Gaming Setup (COLLECTION_ID:col123) - 3 items
   Description: My complete gaming collection

2. Skincare Items (COLLECTION_ID:col456) - 7 items"

VALUE RULES:
- Show exactly as stored: "Value: 2000.00" (NO $ symbols)
- Priceless items: "Value: Priceless"

COLLECTION RULES:
- Always include COLLECTION_ID when mentioning collections
- Show item count for collections
- Include description if available

Query type: ${queryAnalysis.type}
Write clean, readable responses with proper line breaks.`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      const fullPrompt = `INVENTORY DATA:
${inventoryContext}

${collectionContext}

USER QUESTION: "${question}"

Please analyze the inventory and collections and provide a helpful, well-formatted response. Remember to include item IDs (ID:itemId) when mentioning specific items and collection IDs (COLLECTION_ID:collectionId) when mentioning specific collections.`;

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

      // Parse found items and collections from the response BEFORE cleaning
      const foundItems = await this.parseFoundItems(responseText, userId);
      const foundCollections = await this.parseFoundCollections(
        responseText,
        userId,
      );

      // Clean the response for user display
      const cleanResponse = this.cleanResponseForUser(responseText);

      // Get updated query status
      const queryStatus = await this.getQueryStatus(userId);

      // Calculate response time
      const responseTime = Date.now() - startTime;

      return {
        answer: cleanResponse,
        foundItems,
        foundCollections,
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

  async analyzeImage(
    userId: string,
    imageData: string,
    mimeType: string,
  ): Promise<ImageAnalysisResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException('User not found for AI analysis.');
    }

    let currentAnalyses = user.aiAnalysesToday;
    if (!isToday(user.aiAnalysisLastAt)) {
      currentAnalyses = 0;
    }

    if (currentAnalyses >= this.dailyAnalysisLimit) {
      const resetTime = this.calculateResetTime(user);
      throw new ForbiddenException({
        message: `You have reached your daily limit of ${this.dailyAnalysisLimit} AI image analyses. Your limit will reset tomorrow.`,
        analysisStatus: {
          remaining: 0,
          total: this.dailyAnalysisLimit,
          resetTime,
        },
      });
    }

    try {
      // 1. Fetch the user's available tags to provide as context
      const userTags = await this.prisma.tag.findMany({
        where: { userId },
        select: { name: true },
      });
      const availableTags = userTags.map((t) => t.name).join(', ');

      // 2. Construct the prompt for Gemini
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });
      const prompt = `Analyze the attached image of an object and perform the following tasks:
1.  Suggest a concise and accurate "Item Name" for this object. The name should be 3-5 words at most.
2.  From the following list of available categories, select up to 3 that best describe the item in the image. Available Categories: [${availableTags}].
3.  Return your response ONLY as a valid JSON object with the following structure: { "name": "Suggested Item Name", "tags": ["tag1", "tag2"] }. Do not include any other text or explanations.`;

      // 3. Define the image part for the multimodal prompt
      const imagePart = {
        inlineData: {
          data: imageData,
          mimeType,
        },
      };

      // 4. Send the request to Gemini
      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text();

      // 5. Clean and parse the JSON response from the AI
      const cleanedResponse = this.cleanJsonResponse(responseText);
      const parsedResponse = JSON.parse(cleanedResponse);

      // 6. Basic validation of the AI's response
      if (!parsedResponse.name || !Array.isArray(parsedResponse.tags)) {
        throw new Error('AI returned an invalid JSON structure.');
      }

      // Update user analysis count
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          aiAnalysesToday: currentAnalyses + 1,
          aiAnalysisLastAt: new Date(),
        },
      });

      return parsedResponse;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      console.error('Error analyzing image with Gemini:', error);
      throw new InternalServerErrorException('Failed to analyze the image.');
    }
  }

  private async getAllUserItems(userId: string) {
    return this.prisma.item.findMany({
      where: {
        ownerId: userId,
        archived: false,
      },
      include: {
        location: true,
        tags: { include: { tag: true } },
        collections: {
          include: {
            collection: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private addCollectionAwareness(
    items: any[],
    suggestion: Omit<
      CollectionSuggestion,
      'itemsAlreadyInCollections' | 'suggestionId'
    >,
  ): CollectionSuggestion {
    const itemsAlreadyInCollections = items
      .filter((item) => item.collections && item.collections.length > 0)
      .map((item) => ({
        itemId: item.id,
        itemName: item.name,
        existingCollections: item.collections.map((ci: any) => ({
          id: ci.collection.id,
          name: ci.collection.name,
        })),
      }));

    const suggestionId = this.generateSuggestionId(
      suggestion.name,
      suggestion.itemIds,
      suggestion.suggestedBy,
    );

    return {
      ...suggestion,
      suggestionId,
      itemsAlreadyInCollections:
        itemsAlreadyInCollections.length > 0
          ? itemsAlreadyInCollections
          : undefined,
    };
  }

  private groupByLocation(
    items: any[],
    existingCollections: any[] = [],
  ): CollectionSuggestion[] {
    const locationGroups = new Map<string, any[]>();

    items.forEach((item) => {
      const location = item.location?.name || 'Unknown Location';
      if (!locationGroups.has(location)) {
        locationGroups.set(location, []);
      }
      locationGroups.get(location)!.push(item);
    });

    return Array.from(locationGroups.entries())
      .filter(([location, groupItems]) => {
        // Filter out if less than 3 items
        if (groupItems.length < 3) return false;

        // Filter out if user already has a similar location-based collection
        const locationBasedCollectionExists = existingCollections.some(
          (collection) =>
            collection.name.toLowerCase().includes(location.toLowerCase()) ||
            (collection.name.toLowerCase().includes('items') &&
              this.calculateCollectionSimilarity(
                collection.name,
                `${location} Items`,
              ) > 0.7),
        );

        return !locationBasedCollectionExists;
      })
      .map(([location, groupItems]) => {
        const baseSuggestion = {
          name: `${location} Items`,
          description: `Items located in ${location}`,
          itemIds: groupItems.map((item) => item.id),
          itemNames: groupItems.map((item) => item.name),
          suggestedBy: 'location' as const,
          confidence: 0.9,
        };
        return this.addCollectionAwareness(groupItems, baseSuggestion);
      });
  }

  private groupByPrice(
    items: any[],
    existingCollections: any[] = [],
  ): CollectionSuggestion[] {
    const suggestions: CollectionSuggestion[] = [];
    const pricedItems = items.filter((item) => item.price && !item.priceless);
    const pricelessItems = items.filter((item) => item.priceless);

    // Check if user already has price-based collections
    const hasPriceBasedCollections = existingCollections.some((collection) => {
      const name = collection.name.toLowerCase();
      return (
        name.includes('budget') ||
        name.includes('expensive') ||
        name.includes('cheap') ||
        name.includes('costly') ||
        name.includes('priceless') ||
        name.includes('valuable') ||
        name.includes('affordable') ||
        name.includes('premium')
      );
    });

    // Only suggest price-based collections if user doesn't already organize by price
    if (!hasPriceBasedCollections && pricedItems.length >= 3) {
      const lowPriceItems = pricedItems.filter((item) => item.price < 1000);
      const highPriceItems = pricedItems.filter((item) => item.price >= 5000);

      if (lowPriceItems.length >= 3) {
        const baseSuggestion = {
          name: 'Budget Items (Under ₹1000)',
          description: 'Affordable items under ₹1000',
          itemIds: lowPriceItems.map((item) => item.id),
          itemNames: lowPriceItems.map((item) => item.name),
          suggestedBy: 'price' as const,
          confidence: 0.7,
        };
        suggestions.push(
          this.addCollectionAwareness(lowPriceItems, baseSuggestion),
        );
      }

      if (highPriceItems.length >= 3) {
        const baseSuggestion = {
          name: 'Expensive Items (₹5000+)',
          description: 'High-value items worth ₹5000 or more',
          itemIds: highPriceItems.map((item) => item.id),
          itemNames: highPriceItems.map((item) => item.name),
          suggestedBy: 'price' as const,
          confidence: 0.7,
        };
        suggestions.push(
          this.addCollectionAwareness(highPriceItems, baseSuggestion),
        );
      }
    }

    if (!hasPriceBasedCollections && pricelessItems.length >= 3) {
      const baseSuggestion = {
        name: 'Priceless Items',
        description: 'Items with sentimental or unmeasurable value',
        itemIds: pricelessItems.map((item) => item.id),
        itemNames: pricelessItems.map((item) => item.name),
        suggestedBy: 'price' as const,
        confidence: 0.8,
      };
      suggestions.push(
        this.addCollectionAwareness(pricelessItems, baseSuggestion),
      );
    }

    return suggestions;
  }

  private groupByPattern(
    items: any[],
    existingCollections: any[] = [],
  ): CollectionSuggestion[] {
    const suggestions: CollectionSuggestion[] = [];

    // Only suggest pattern-based collections if user doesn't have too many collections yet
    const hasRecentlyCreatedCollections = existingCollections.some(
      (collection) =>
        collection.name.toLowerCase().includes('recent') ||
        collection.name.toLowerCase().includes('new') ||
        collection.name.toLowerCase().includes('latest'),
    );

    // Recent additions (only if user doesn't have a recent-based collection)
    if (!hasRecentlyCreatedCollections) {
      const recentItems = items.filter((item) => {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return item.createdAt >= weekAgo;
      });

      if (recentItems.length >= 3) {
        const baseSuggestion = {
          name: 'Recent Additions',
          description: 'Items added in the last 7 days',
          itemIds: recentItems.map((item) => item.id),
          itemNames: recentItems.map((item) => item.name),
          suggestedBy: 'pattern' as const,
          confidence: 0.6,
        };
        suggestions.push(
          this.addCollectionAwareness(recentItems, baseSuggestion),
        );
      }
    }

    // Items without photos (only if user has more than 2 collections - suggesting organization improvement)
    if (existingCollections.length > 2) {
      const noPhotoItems = items.filter((item) => !item.imageUrl);
      if (noPhotoItems.length >= 3) {
        const baseSuggestion = {
          name: 'Items Without Photos',
          description:
            'Items that could benefit from photos for better organization',
          itemIds: noPhotoItems.map((item) => item.id),
          itemNames: noPhotoItems.map((item) => item.name),
          suggestedBy: 'pattern' as const,
          confidence: 0.5,
        };
        suggestions.push(
          this.addCollectionAwareness(noPhotoItems, baseSuggestion),
        );
      }
    }

    return suggestions;
  }

  private async getGeminiSuggestions(
    items: any[],
    existingCollections: any[],
  ): Promise<CollectionSuggestion[]> {
    const startTime = Date.now();
    console.log(
      `🤖 [Gemini] Starting collection suggestions analysis for ${items.length} items, ${existingCollections.length} existing collections`,
    );

    try {
      const itemsForGemini = items.slice(0, 15).map((item) => ({
        name: item.name,
        location: item.location?.name || 'Unknown',
        tags: item.tags?.map((t: any) => t.tag.name) || [],
        description: item.description || null,
        hasImage: !!item.imageUrl,
        isCollected: item.collections && item.collections.length > 0,
        existingCollections:
          item.collections?.map((c: any) => c.collection.name) || [],
      }));

      // Separate collected and uncollected items for better context
      const uncollectedItems = itemsForGemini.filter(
        (item) => !item.isCollected,
      );
      const collectedItems = itemsForGemini.filter((item) => item.isCollected);

      console.log(
        `🤖 [Gemini] Context: ${uncollectedItems.length} uncollected, ${collectedItems.length} collected items`,
      );

      const prompt = `CONTEXT: Smart Collection Suggestions for User

EXISTING USER COLLECTIONS (Don't duplicate these patterns):
${
  existingCollections.length > 0
    ? existingCollections
        .map(
          (c) =>
            `- "${c.name}" (${c.itemCount || 'unknown'} items)${c.description ? ` - ${c.description}` : ''}`,
        )
        .join('\n')
    : '- No collections yet'
}

ITEMS ALREADY ORGANIZED:
${
  collectedItems.length > 0
    ? collectedItems
        .map(
          (item, i) =>
            `${i + 1}. ${item.name} (In: ${item.existingCollections.join(', ')})`,
        )
        .join('\n')
    : '- No items organized yet'
}

ITEMS NEEDING ORGANIZATION:
${
  uncollectedItems.length > 0
    ? uncollectedItems
        .map(
          (item, i) =>
            `${i + 1}. ${item.name} (Location: ${item.location}${item.tags.length > 0 ? `, Tags: ${item.tags.join(', ')}` : ''}${item.description ? `, Description: ${item.description}` : ''})`,
        )
        .join('\n')
    : '- All items are organized'
}

TASK: Suggest 2-3 NEW collection ideas that:
1. Are DIFFERENT from existing collections (avoid duplicating organization patterns)
2. Focus primarily on unorganized items, but can include organized items for cross-collection themes
3. Complement the user's current organization style
4. Are practical and genuinely useful
5. Have at least 3 items each

AVOID these patterns already used by the user:
${existingCollections.map((c) => `- Similar to "${c.name}"`).join('\n')}

Focus on fresh organizational angles like:
- Item types not yet organized (electronics, books, clothes, tools)
- Functional purposes (work setup, travel gear, fitness, hobbies)
- Brands or quality levels
- Usage frequency or importance
- Seasonal or occasion-based groupings
- Similar descriptions or item purposes
- Items that serve similar functions based on their descriptions

If remaining items are too few or don't form meaningful new patterns, return fewer suggestions or empty array.

Return JSON: [{"name": "Collection Name", "description": "Brief description of why this collection is useful", "itemNames": ["item1", "item2", "item3"]}]`;

      console.log(
        `🤖 [Gemini] Calling API with prompt length: ${prompt.length} characters`,
      );

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
        },
      });

      const responseText = result.response.text();
      const responseTime = Date.now() - startTime;

      console.log(`🤖 [Gemini] API call completed in ${responseTime}ms`);
      console.log(
        `🤖 [Gemini] Raw response length: ${responseText.length} characters`,
      );

      const cleanedResponse = this.cleanJsonResponse(responseText);
      console.log(`🤖 [Gemini] Cleaned response: ${cleanedResponse}`);

      const geminiSuggestions = JSON.parse(cleanedResponse);
      console.log(
        `🤖 [Gemini] Parsed ${geminiSuggestions.length} suggestions from AI`,
      );

      const finalSuggestions = geminiSuggestions
        .map((suggestion: any) => {
          const matchingItems = items.filter((item) =>
            suggestion.itemNames.includes(item.name),
          );

          const baseSuggestion = {
            name: suggestion.name,
            description: suggestion.description,
            itemIds: matchingItems.map((item) => item.id),
            itemNames: matchingItems.map((item) => item.name),
            suggestedBy: 'gemini' as const,
            confidence: 0.85,
          };

          return this.addCollectionAwareness(matchingItems, baseSuggestion);
        })
        .filter((s: CollectionSuggestion) => s.itemIds.length >= 3);

      const totalTime = Date.now() - startTime;
      console.log(
        `🤖 [Gemini] SUCCESS: Generated ${finalSuggestions.length} valid suggestions in ${totalTime}ms`,
      );

      if (finalSuggestions.length > 0) {
        console.log(
          `🤖 [Gemini] Suggestions: ${finalSuggestions.map((s) => `"${s.name}" (${s.itemIds.length} items)`).join(', ')}`,
        );
      }

      return finalSuggestions;
    } catch (error) {
      const errorTime = Date.now() - startTime;
      console.error(
        `🤖 [Gemini] ERROR: Failed after ${errorTime}ms:`,
        error.message,
      );
      console.error(`🤖 [Gemini] Error details:`, error);
      return [];
    }
  }

  private rankSuggestions(
    suggestions: CollectionSuggestion[],
  ): CollectionSuggestion[] {
    return suggestions
      .sort((a, b) => {
        // Sort by confidence first, then by number of items
        if (b.confidence !== a.confidence) {
          return b.confidence - a.confidence;
        }
        return b.itemIds.length - a.itemIds.length;
      })
      .slice(0, 5); // Return top 5 suggestions
  }

  async generateCollectionSuggestions(
    userId: string,
    limit: number = 5,
  ): Promise<CollectionSuggestionsResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException('User not found for suggestions.');
    }

    // Check daily query limit
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

    // Get all items for analysis (not just uncollected)
    const allItems = await this.getAllUserItems(userId);
    const uncollectedItems = allItems.filter(
      (item) => item.collections.length === 0,
    );

    console.log(
      `📊 [AI Service] Starting suggestion generation for user ${userId}`,
    );
    console.log(
      `📊 [AI Service] Items: ${allItems.length} total, ${uncollectedItems.length} uncollected`,
    );

    if (allItems.length < 3) {
      console.log(
        `⏹️ [AI Service] Insufficient items (${allItems.length} < 3), returning empty suggestions`,
      );
      return {
        suggestions: [],
        totalUncollectedItems: uncollectedItems.length,
      };
    }

    // Get existing collections for smart filtering
    const existingCollections = await this.prisma.collection
      .findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          name: true,
          description: true,
          _count: { select: { items: true } },
        },
      })
      .then((collections) =>
        collections.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          itemCount: c._count.items,
        })),
      );

    console.log(
      `📊 [AI Service] Found ${existingCollections.length} existing collections: ${existingCollections.map((c) => c.name).join(', ')}`,
    );

    // Generate suggestions using ALL items
    console.log(`🔄 [AI Service] Generating rule-based suggestions...`);
    const locationSuggestions = this.groupByLocation(
      allItems,
      existingCollections,
    );
    const priceSuggestions = this.groupByPrice(allItems, existingCollections);
    const patternSuggestions = this.groupByPattern(
      allItems,
      existingCollections,
    );

    console.log(
      `🔄 [AI Service] Rule-based results: ${locationSuggestions.length} location, ${priceSuggestions.length} price, ${patternSuggestions.length} pattern`,
    );

    let allSuggestions = [
      ...locationSuggestions,
      ...priceSuggestions,
      ...patternSuggestions,
    ];

    // Add Gemini suggestions for users with 3+ items
    if (allItems.length >= 3) {
      console.log(
        `✅ [AI Service] Triggering Gemini analysis (${allItems.length} items >= 3 threshold)`,
      );
      const geminiSuggestions = await this.getGeminiSuggestions(
        allItems,
        existingCollections,
      );
      console.log(
        `✅ [AI Service] Gemini returned ${geminiSuggestions.length} suggestions`,
      );
      allSuggestions = [...allSuggestions, ...geminiSuggestions];
    } else {
      console.log(
        `⏭️ [AI Service] Skipping Gemini (${allItems.length} items < 3 threshold)`,
      );
    }

    // Smart filtering: Remove overly similar or redundant suggestions
    const smartFilteredSuggestions = allSuggestions.filter(
      (suggestion) =>
        !this.shouldSuppressSuggestion(suggestion, existingCollections),
    );

    const rankedSuggestions = this.rankSuggestions(smartFilteredSuggestions);

    console.log(
      `🎯 [AI Service] Final results: ${rankedSuggestions.length} suggestions after ranking and filtering`,
    );
    console.log(
      `🎯 [AI Service] Returning ${Math.min(rankedSuggestions.length, limit)} suggestions (limit: ${limit})`,
    );

    // Update user query count
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        aiQueriesToday: currentQueries + 1,
        aiLastQueryAt: new Date(),
      },
    });

    const finalResponse = {
      suggestions: rankedSuggestions.slice(0, limit),
      totalUncollectedItems: uncollectedItems.length,
    };

    console.log(
      `✅ [AI Service] Completed suggestion generation for user ${userId}`,
    );

    return finalResponse;
  }
}
