import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  statusCode: number;
  success: boolean;
  message: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((res) => {
        // If response is already in the target structure, bypass
        if (
          res &&
          typeof res === 'object' &&
          'success' in res &&
          'statusCode' in res &&
          'data' in res
        ) {
          return res;
        }

        let message = 'Request processed successfully';
        let data = res;

        // If the return object contains a message property, extract it as the top-level message
        if (res && typeof res === 'object') {
          if ('message' in res) {
            message = res.message;
            const { message: _, ...rest } = res;
            const keys = Object.keys(rest);
            if (keys.length === 0) {
              data = null;
            } else if (keys.length === 1) {
              data = rest[keys[0]];
            } else {
              data = rest;
            }
          }
        }

        return {
          statusCode,
          success: true,
          message,
          data: data ?? null,
        };
      }),
    );
  }
}
