import * as functions from "firebase-functions";
import { Telegraf } from "telegraf";
import * as admin from "firebase-admin";
import fetch from "node-fetch";
import * as pLimit from "p-limit";

admin.initializeApp();

const bot = new Telegraf(functions.config().telegram.token);

bot.command("token", async (ctx) => {
  const payload = ctx.message.text.slice("/token ".length);
  if (!payload) {
    ctx.reply(
      "Use /token <token> to set a new token, you can get it from https://github.com/settings/tokens"
    );
    return;
  }
  await admin.database().ref(`/tokens/${ctx.chat.id}`).set(payload);
  ctx.reply("Token set!");
});

function processUrl(input: string) {
  const pr = input.match(
    /https:\/\/api.github.com\/repos\/(.+)\/(.+)\/pulls\/(\d+)/
  );
  if (pr != null) {
    return `https://github.com/${pr[1]}/${pr[2]}/pull/${pr[3]}`;
  }
  const commit = input.match(
    /https:\/\/api.github.com\/repos\/(.+)\/(.+)\/commits\/(\w+)/
  );
  if (commit != null) {
    return `https://github.com/${commit[1]}/${commit[2]}/commit/${commit[3]}`;
  }
  return "https://github.com/notifications";
}

async function checkUser(chatId: string, token: string) {
  const notifications = await fetch("https://api.github.com/notifications", {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${token}`,
    },
  }).then((r) => r.json());
  for (const notification of notifications) {
    const sentRef = admin.database().ref(`/sent/${chatId}/${notification.id}`);
    if ((await sentRef.get()).exists()) {
      continue;
    }
    await bot.telegram.sendMessage(
      chatId,
      `${notification.subject.type}\n${
        notification.subject.title
      }\n\n${processUrl(notification.subject.url)}`
      // {
      //   reply_markup: {
      //     inline_keyboard: [
      //       [{ text: "View", url: processUrl(notification.subject.url) }],
      //     ],
      //   },
      // }
    );
    await sentRef.set(true);
  }
}

const limit = pLimit(5);

async function checks() {
  const tokens = (await admin.database().ref("/tokens").get()).val() as null | {
    [chatId: string]: string;
  };
  if (!tokens) {
    return;
  }
  await Promise.allSettled(
    Object.keys(tokens).map((chatId) =>
      limit(() => checkUser(chatId, tokens[chatId]))
    )
  );
}

exports.bot = functions.https.onRequest((req, res) => {
  void bot.handleUpdate(req.body, res);
});

exports.checkForUpdates = functions
  .runWith({ timeoutSeconds: 540 })
  .pubsub.schedule("every 1 minutes")
  .onRun(async () => {
    await checks();
  });

exports.manualTrigger = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(async (req, res) => {
    await checks();
    res.send("OK");
  });
