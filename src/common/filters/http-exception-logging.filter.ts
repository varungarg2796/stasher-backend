import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger, // Import NestJS Logger
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class HttpExceptionLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter'); // Create a logger instance with context

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Log the detailed error information
    const user = request.user ? `(User: ${request.user.id})` : '(Guest)';
    const logMessage = `[${request.method} ${request.url}] ${user} - Status: ${httpStatus}`;

    if (httpStatus >= 500) {
      // For server errors, log the full exception object including the stack trace
      this.logger.error(logMessage, exception);
    } else {
      // For client errors (4xx), a shorter message is often sufficient
      const response =
        exception instanceof HttpException ? exception.getResponse() : {};
      this.logger.warn(`${logMessage} - Error: ${JSON.stringify(response)}`);
    }

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
    };

    if (exception instanceof HttpException) {
      Object.assign(responseBody, { message: exception.getResponse() });
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
