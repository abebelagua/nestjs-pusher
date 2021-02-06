import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { Reflector } from '@nestjs/core'
import { PusherService } from './pusher.service'
import {
  PUSHER_CHANNEL,
  PUSHER_EVENT,
  PUSHER_SEND_GUARD,
  PUSHER_SID_FACTORY,
} from './constants'
import { ShouldSendMiddleware } from './decorators/pusher-send-guard'

/**
 * Intercepts the HTTP response and dispatches the pusher-event with the custom decorators
 * Binding this decorator globally will run just fine, PusherInterceptor checks whether the HTTP method supports or not
 * pusher events and skip normally if its not supported
 */
@Injectable()
export class PusherInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly pusherService: PusherService,
    private readonly logger: Logger,
  ) {
    this.logger.setContext('PusherInterceptor')
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const eventName = this.reflector.get(PUSHER_EVENT, context.getHandler())

    const request = context.switchToHttp().getRequest()
    const response = context.switchToHttp().getResponse()

    return next.handle().pipe(
      tap((data) => {
        //If the method is not decorated with PusherEvent, skip
        if (!eventName) {
          return data
        }

        const sendGuard = this.reflector.get<ShouldSendMiddleware>(
          PUSHER_SEND_GUARD,
          context.getHandler(),
        )
        const channelMetadata = this.reflector.get(
          PUSHER_CHANNEL,
          context.getHandler(),
        )
        const socketIdFactory = this.reflector.get(
          PUSHER_SID_FACTORY,
          context.getHandler(),
        )
        //If guard does not allow to proceed, return data normally
        if (sendGuard && !sendGuard(request, response, eventName)) {
          return data
        }

        if (!channelMetadata) {
          this.logger.warn(
            `PusherChannel not found for handler: ${
              context.getHandler().name
            } at event: ` + eventName,
          )
          return data
        }

        let channelName = channelMetadata
        //If its a channel builder then we need to invoke it
        if (channelMetadata['req'] && channelMetadata['event']) {
          channelName = channelMetadata(request, eventName)
        }

        const socketId = socketIdFactory
          ? typeof socketIdFactory === 'string'
            ? request.headers[socketIdFactory]
            : socketIdFactory(request)
          : (request.headers['x-pusher-sid'] as string)

        if (process.env.PUSHER_DEBUG) {
          this.logger.log(
            `${eventName.event.name} has been dispatched to ${channelName} `,
          )
        }
        this.pusherService.trigger(
          channelName,
          eventName.event.name,
          data,
          socketId,
        )
      }),
    )
  }
}
