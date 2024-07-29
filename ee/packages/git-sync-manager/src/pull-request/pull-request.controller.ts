import { AmplicationLogger } from "@amplication/util/nestjs/logging";
import { Controller, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from "@nestjs/microservices";
import { plainToInstance } from "class-transformer";
import { validateOrReject } from "class-validator";
import { Env } from "../env";
import { PullRequestService } from "./pull-request.service";
import {
  KafkaProducerService,
  KafkaPacemaker,
} from "@amplication/util/nestjs/kafka";
import {
  CreatePrFailure,
  CreatePrRequest,
  CreatePrSuccess,
  PullPrivatePluginRequest,
  PullPrivatePluginSuccess,
  PullPrivatePluginFailure,
  KAFKA_TOPICS,
} from "@amplication/schema-registry";
import { LogLevel } from "@amplication/util/logging";
import { NoChangesOnPullRequest } from "@amplication/util/git";

@Controller()
export class PullRequestController {
  constructor(
    private readonly pullRequestService: PullRequestService,
    private readonly configService: ConfigService<Env, true>,
    private readonly producerService: KafkaProducerService,
    @Inject(AmplicationLogger)
    private readonly logger: AmplicationLogger
  ) {}

  private async log(
    buildId: string,
    level: LogLevel,
    message: string
  ): Promise<void> {
    await this.producerService.emitMessage(KAFKA_TOPICS.CREATE_PR_LOG_TOPIC, {
      key: {
        buildId,
      },
      value: {
        buildId,
        level,
        message,
      },
    });
  }

  @EventPattern(KAFKA_TOPICS.CREATE_PR_REQUEST_TOPIC)
  async generatePullRequest(
    @Payload() message: CreatePrRequest.Value,
    @Ctx() context: KafkaContext
  ) {
    const startTime = Date.now();
    const validArgs = plainToInstance(CreatePrRequest.Value, message);
    await validateOrReject(validArgs);

    const offset = context.getMessage().offset;
    const topic = context.getTopic();
    const partition = context.getPartition();
    const eventKey = plainToInstance(
      CreatePrRequest.Key,
      context.getMessage().key.toString()
    );
    const logger = this.logger.child({
      resourceId: validArgs.resourceId,
      buildId: validArgs.newBuildId,
    });

    await this.log(
      validArgs.newBuildId,
      LogLevel.Info,
      "Worker assigned. Starting pull request creation..."
    );
    logger.info(`Got a new generate pull request item from queue.`, {
      topic,
      partition,
      offset: context.getMessage().offset,
      class: this.constructor.name,
    });

    try {
      const { pullRequestUrl, diffStat } =
        await KafkaPacemaker.wrapLongRunningMethod<{
          pullRequestUrl: string;
          diffStat: string;
        }>(context, () => this.pullRequestService.createPullRequest(validArgs));

      logger.info(`Finish process, committing`, {
        topic,
        partition,
        offset,
        class: this.constructor.name,
      });

      const successEvent: CreatePrSuccess.KafkaEvent = {
        key: {
          resourceRepositoryId: eventKey.resourceRepositoryId,
        },
        value: {
          url: pullRequestUrl,
          diffStat,
          gitProvider: validArgs.gitProvider,
          buildId: validArgs.newBuildId,
        },
      };
      await this.producerService.emitMessage(
        KAFKA_TOPICS.CREATE_PR_SUCCESS_TOPIC,
        successEvent
      );
    } catch (error) {
      if (error instanceof NoChangesOnPullRequest) {
        await this.log(
          validArgs.newBuildId,
          LogLevel.Warn,
          "Hey there! Looks like your code hasn't changed since the last build. We skipped creating a new pull request to keep things tidy."
        );
        await this.producerService.emitMessage(
          KAFKA_TOPICS.CREATE_PR_SUCCESS_TOPIC,
          {
            key: eventKey,
            value: {
              url: error.pullRequestUrl,
              gitProvider: validArgs.gitProvider,
              buildId: validArgs.newBuildId,
            },
          }
        );
        return;
      }

      logger.error(error.message, error, {
        class: PullRequestController.name,
        offset,
      });

      const failureEvent: CreatePrFailure.KafkaEvent = {
        key: {
          resourceRepositoryId: eventKey.resourceRepositoryId,
        },
        value: {
          buildId: validArgs.newBuildId,
          gitProvider: validArgs.gitProvider,
          errorMessage: error.message,
        },
      };

      await this.producerService.emitMessage(
        KAFKA_TOPICS.CREATE_PR_FAILURE_TOPIC,
        failureEvent
      );
    }

    logger.info(`Pull request item processed`, {
      timeTaken: Date.now() - startTime,
    });
  }

  @EventPattern(KAFKA_TOPICS.PULL_PRIVATE_PLUGIN_REQUEST_TOPIC)
  async pullPrivatePlugin(
    @Payload() message: PullPrivatePluginRequest.Value,
    @Ctx() context: KafkaContext
  ) {
    const eventKey = plainToInstance(
      PullPrivatePluginRequest.Key,
      context.getMessage().key.toString()
    );

    const validArgs = plainToInstance(PullPrivatePluginRequest.Value, message);
    await validateOrReject(validArgs);

    try {
      const { pluginPath } = await KafkaPacemaker.wrapLongRunningMethod<{
        pluginPath: string;
      }>(context, () => this.pullRequestService.pullPrivatePlugin(validArgs));

      const successEvent: PullPrivatePluginSuccess.KafkaEvent = {
        key: {
          resourceId: eventKey.resourceId,
        },
        value: {
          pluginPath,
        },
      };
      await this.producerService.emitMessage(
        KAFKA_TOPICS.PULL_PRIVATE_PLUGIN_SUCCESS_TOPIC,
        successEvent
      );
    } catch (error) {
      const failureEvent: PullPrivatePluginFailure.KafkaEvent = {
        key: {
          resourceId: eventKey.resourceId,
        },
        value: {
          errorMessage: error.message,
        },
      };
      await this.producerService.emitMessage(
        KAFKA_TOPICS.PULL_PRIVATE_PLUGIN_FAILURE_TOPIC,
        failureEvent
      );
    }
  }
}
