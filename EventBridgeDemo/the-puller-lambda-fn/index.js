const https = require("https");
const AWS = require("aws-sdk");

const geo_australia = "AU";
const googleTrendsUrl = "https://trends.google.com";
const googleTrendsApiUrl = `${googleTrendsUrl}/trends/api/dailytrends?geo=${geo_australia}`;
const googleBugText = ")]}',";

AWS.config.region = "ap-southeast-2";
const eventbridge = new AWS.EventBridge();

exports.handler = async (event, context, callback) => {
  let dataString = "";

  const response = await new Promise((resolve, reject) => {
    // Call Google Trends API
    const req = https.get(googleTrendsApiUrl, function (res) {
      res.on("data", (chunk) => {
        dataString += chunk;
      });
      res.on("end", async () => {
        // Oppps Google, there is a bug in Google API: sometime the response start with ")]}',"
        if (dataString.startsWith(googleBugText)) {
          dataString = dataString.replace(googleBugText, "");
        }

        // All trends for today
        const trendsArray =
          JSON.parse(dataString).default.trendingSearchesDays[0]
            .trendingSearches;

        // The trends event list with only 10 trends, limitation in eventbridge.putEvents()
        const eventBridgeTrendsItems = trendsArray.slice(0, 10).map((trend) => {
          return constructEvent(trend);
        });

        // Construct the EventBridge payload
        const eventBridgeTrendsArray = {
          Entries: eventBridgeTrendsItems,
        };

        // push to EventBridge
        const eventbridgeResponse = await eventbridge
          .putEvents(eventBridgeTrendsArray)
          .promise();

        resolve({
          // return 500 if there is a failure to push events
          statusCode: JSON.stringify(eventbridgeResponse).includes("ErrorCode")
            ? 500
            : 200,
          body: JSON.stringify(eventBridgeTrendsArray, null, 4),
        });
      });
    });

    req.on("error", (e) => {
      reject({
        statusCode: 500,
        body: "Something went wrong!",
      });
    });
  });

  return response;
};

function constructEvent(trend) {
  return {
    // Event fields
    Source: "makerx.googleTrends",
    EventBusName: "google-trends",
    DetailType: getTopicFromTitle(trend),
    Time: new Date(),

    // Event details (slack message)
    Detail: constructSlackMessage(trend),
  };
}

// construct the Slack Message based on
// https://api.slack.com/messaging/composing/layouts
function constructSlackMessage(trend) {
  return JSON.stringify({
    text: `Hey, "${trend.title.query}" topic is trending in AU`,
    attachments: [
      {
        title: `${trend.articles[0].title}`,
        title_link: `${trend.articles[0].url}`,
        image_url: trend.articles[0].image
          ? `${trend.articles[0].image.imageUrl}`
          : "",
      },
    ],
  });
}

// get the interesting topics based on keywords covid for now
function getTopicFromTitle(trend) {
  let topic = "general";
  if (
    trend.title.query.toLowerCase().includes("covid") ||
    trend.articles[0].title.toLowerCase().includes("covid")
  ) {
    topic = "interesting";
  }
  return topic;
}
