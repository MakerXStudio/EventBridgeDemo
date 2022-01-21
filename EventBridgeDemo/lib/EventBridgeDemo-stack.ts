import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as events from "aws-cdk-lib/aws-events";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cdk from "aws-cdk-lib/core";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dotenv from "dotenv";

export class EventBridgeDemoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // to read .env file
    dotenv.config();

    // ------------------------------------
    // Lambda
    // ------------------------------------
    const thePullerFn = new lambda.Function(this, "the-puller-lambda-fn", {
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("the-puller-lambda-fn"),
    });

    // ------------------------------------
    // API gateway
    // ------------------------------------
    new apigw.LambdaRestApi(this, "the-puller-api-gateway", {
      handler: thePullerFn,
    });

    // ------------------------------------
    // EventBus
    // ------------------------------------
    const bus = new events.EventBus(this, "google-trends-bus", {
      eventBusName: process.env.EVENTBUS_NAME,
    });

    new iam.PolicyStatement({
      resources: [
        `arn:aws:events:${process.env.CDK_DEFAULT_REGION}:${process.env.CDK_DEFAULT_ACCOUNT}:*/*`,
      ],
      sid: "allow_account_to_put_events",
      principals: [new iam.AnyPrincipal()],
    });

    new events.CfnEventBusPolicy(this, "MyCfnEventBusPolicy", {
      statementId: "allow_account_to_put_events",
      eventBusName: bus.eventBusName,
      action: "events:PutEvents",
      principal: "*",
    });

    // ------------------------------------
    // Events API Connection
    // ------------------------------------
    const cfnConnection = new events.CfnConnection(
      this,
      "apiDestinationConnection",
      {
        authorizationType: "API_KEY",
        authParameters: {
          ApiKeyAuthParameters: {
            ApiKeyName: process.env.EVENTBRIDGE_API_DESTINATION_KEY,
            ApiKeyValue: process.env.EVENTBRIDGE_API_DESTINATION_SECRET,
          },
        },
        description: "EventBridge Api destination connection",
        name: "apiDestinationConnection",
      }
    );

    // ------------------------------------
    // create a role grant permission for eventBridge to invoke Api Destination
    // ------------------------------------
    const invokeApiDestinationPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          resources: [
            `arn:aws:events:${process.env.CDK_DEFAULT_REGION}:${process.env.CDK_DEFAULT_ACCOUNT}:api-destination/*/*`,
          ],
          actions: ["events:InvokeApiDestination"],
        }),
      ],
    });

    const invokeApiDestinationRole = new iam.Role(
      this,
      "eventBridgeTargetRole",
      {
        assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
        description: "eventBridgeTargetRole",
        inlinePolicies: {
          invokeApiDestinationPolicy,
        },
      }
    );

    // ------------------------------------
    // General Trends setup
    // ------------------------------------
    // logGroup
    const generalTrendsLogGroup = new logs.LogGroup(
      this,
      "/aws/events/generalLogGroup",
      {
        logGroupName: "/aws/events/generalLogGroup",
        removalPolicy: RemovalPolicy.DESTROY
      }
    );

    // apiDestination
    const generalApiDestination = new events.CfnApiDestination(
      this,
      "GeneralTrendsSlack",
      {
        connectionArn: cfnConnection.attrArn,
        httpMethod: "POST",
        invocationEndpoint: process.env.SLACK_SEND_MESSAGE_TO_CHANNEL_URI || "",
        description: "API Destination to post general trends to slack channel",
        invocationRateLimitPerSecond: 5,
        name: "GeneralTrendsSlack",
      }
    );

    // There is an inprogress feature to use as Rule L1 : https://github.com/aws/aws-cdk/pull/13729
    // new events.Rule(this, "general-trends-rule", {
    //   ruleName: `general-trends`,
    //   eventPattern: { detailType: [`general`] },
    //   targets: [
    //     generalTrendsLogGroup,
    //     //new targets.ApiDestination(cfnApiDestination)
    //   ],
    // });

    // Create the Rule using escape hatch
    new cdk.CfnResource(this, "general-trends-rule", {
      type: "AWS::Events::Rule",
      properties: {
        Description: "EventRule",
        State: "ENABLED",
        EventBusName: bus.eventBusName,
        EventPattern: { "detail-type": ["general"] },
        Targets: [
          {
            Arn: generalApiDestination.attrArn,
            RoleArn: invokeApiDestinationRole.roleArn,
            Id: "postToSlackChannel",
            InputPath: "$.detail",
          },
          {
            Arn: generalTrendsLogGroup.logGroupArn,
            Id: "generalCloudwatch",
          },
        ],
      },
    });

    // ------------------------------------
    // Interesting Trends setup
    // ------------------------------------
    // logGroup
    const interestingTrendsLogGroup = new logs.LogGroup(
      this,
      "/aws/events/interestingLogGroup",
      {
        logGroupName: "/aws/events/interestingLogGroup",
        removalPolicy: RemovalPolicy.DESTROY
      }
    );

    // apiDestination
    const interestingApiDestination = new events.CfnApiDestination(
      this,
      "interestingTrendsSlack",
      {
        connectionArn: cfnConnection.attrArn,
        httpMethod: "POST",
        invocationEndpoint: process.env.SLACK_SEND_DM_TO_MO_URI || "",
        description: "API Destination to post messages to Mo",
        invocationRateLimitPerSecond: 5,
        name: "InterestingTrendsSlack",
      }
    );

    // There is an inprogress feature to use as Rule L1 : https://github.com/aws/aws-cdk/pull/13729
    // adding eventbridge rules
    // new events.Rule(this, "interesting-trends-rule", {
    //   ruleName: `interesting-trends`,
    //   eventPattern: { detailType: [`interesting`] },
    //   targets: [
    //     interestingTrendsLogGroup,
    //     //new targets.ApiDestination(cfnApiDestination)
    //   ],
    // });

    // Create the Rule using escape hatch
    new cdk.CfnResource(this, "interesting-trends-rule", {
      type: "AWS::Events::Rule",
      properties: {
        Description: "EventRule",
        State: "ENABLED",
        EventBusName: bus.eventBusName,
        EventPattern: { "detail-type": [`interesting`] },
        Targets: [
          {
            Arn: interestingApiDestination.attrArn,
            RoleArn: invokeApiDestinationRole.roleArn,
            Id: "postToSlackChannel",
            InputPath: "$.detail",
          },
          {
            Arn: interestingTrendsLogGroup.logGroupArn,
            Id: "interestingCloudwatch",
          },
        ],
      },
    });
  }
}
