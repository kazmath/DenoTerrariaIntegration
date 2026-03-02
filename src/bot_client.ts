import {
    Client,
    Events,
    GatewayIntentBits,
    TextChannel,
    WebhookClient,
    WebhookMessageCreateOptions,
} from "discord.js";
import config from "../config.json" with { type: "json" };
import { enableIntegration } from "./main.ts";
import { printLog } from "./utils.ts";

const logSource = "DiscordJS";
export let webhook: WebhookClient | null;
export let discordBot: Client | null;

export async function initBot(
    stdinWriter: WritableStreamDefaultWriter<
        Uint8Array<ArrayBufferLike>
    > | null,
) {
    discordBot = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
    })
        .once(Events.ClientReady, (readyClient) => {
            printLog(
                {
                    from: logSource,
                    logLevel: 1,
                },
                "Logged in as",
                readyClient.user.tag,
            );
        })
        .on(Events.MessageCreate, async (message) => {
            if (message.channelId != config.webhook.channelID) return;

            switch (message.content) {
                case config.bot.prefix + "ping":
                    await sendWebhook({
                        options: {
                            content: `:ping_pong: \`${new Date().getTime() - message.createdAt.getTime()}ms\` :ping_pong:`,
                        },
                        isManualMsg: true,
                    });
                    return;

                /**
                 * todo:
                 * add kill command to forcefully stop server but add a warning
                 * with button complements in the webhook to prevent accidents
                 */
                case config.bot.prefix + "kill":
                    if (!config.adminUserIDs.includes(message.author.id))
                        return;
                    await sendWebhook({
                        options: {
                            content: `Not implemented.`,
                        },
                        isManualMsg: true,
                    });
                    return;

                default:
                    break;
            }

            if (message.content.startsWith(config.bot.prefix)) {
                if (!config.adminUserIDs.includes(message.author.id)) return;

                const outputStr =
                    message.content
                        .slice(config.bot.prefix.length)
                        .split("\n")[0] + "\n";
                const encodedText = new TextEncoder().encode(outputStr);

                await stdinWriter?.write(encodedText);
                return;
            }
        })
        .on(Events.Error, (error) => {
            printLog(
                { from: logSource, logLevel: 1, isError: true },
                "An error occured in the botClient:",
                error,
            );
        });

    const botToken = await discordBot //
        .login(config.bot.token)
        .catch((error) => {
            printLog(
                { from: logSource, logLevel: 1, isError: true },
                "An error occured when initializing the botClient:",
                error,
            );
            return null;
        });

    webhook = await discordBot.channels
        .fetch(config.webhook.channelID)
        .then(async (anyChannel) => {
            const channel = anyChannel as TextChannel;
            const found = await channel
                .fetchWebhooks()
                .then((webhookList) =>
                    webhookList.find(
                        (v) => v.owner?.id == discordBot!.user?.id,
                    ),
                );
            if (found) {
                return found;
            }

            return await channel.createWebhook({
                name: config.webhook.username,
                avatar: config.webhook.avatarURL,
            });
        })
        .then((webhook) =>
            new WebhookClient(webhook) //
                .on(Events.Error, (error) => {
                    printLog(
                        { from: logSource, logLevel: 1, isError: true },
                        "An error occured in the webhookClient:",
                        error,
                    );
                }),
        )
        .catch((error) => {
            printLog(
                { from: logSource, logLevel: 1, isError: true },
                "An error occured when initializing the webhookClient:",
                error,
            );
            return null;
        });

    return {
        //
        botClient: discordBot,
        webhookClient: webhook,
        botToken: botToken,
        webhookURL: webhook?.url,
        destroy: stopBot,
    };
}

let timeOfLastMsg = -Infinity;
const queuedMessages: Array<string | undefined> = [];
const rateLimit = 500;
let intervalID: number | null;
export async function sendWebhook({
    options,
    isServerMsg = false,
    isManualMsg = false,
}: {
    options: WebhookMessageCreateOptions;
    isServerMsg?: boolean;
    isManualMsg?: boolean;
}) {
    if (!enableIntegration && !isManualMsg) return;

    const tempOptions = options;
    if (tempOptions.avatarURL == "" || tempOptions.avatarURL == null) {
        tempOptions.avatarURL = config.webhook.avatarURL;
    }
    if (tempOptions.username == "" || tempOptions.username == null) {
        tempOptions.username = config.webhook.username;
    }
    if (tempOptions.content == "" || tempOptions.content == null) {
        return;
    }

    if (isServerMsg && !isManualMsg) {
        const currentTime = new Date().getTime();
        if (currentTime - timeOfLastMsg < rateLimit) {
            queuedMessages.push(tempOptions.content);
            timeOfLastMsg = new Date().getTime();

            if (intervalID == null) {
                intervalID = setInterval(async () => {
                    const currentTime = new Date().getTime();
                    if (currentTime - timeOfLastMsg < rateLimit) return;

                    const messageContent = //
                        "```\n" + //
                        queuedMessages.splice(0).join("\n") + //
                        "\n```";
                    timeOfLastMsg = new Date().getTime();
                    await webhook!.send({
                        avatarURL: undefined,
                        username: "Server",
                        content: messageContent,
                    });

                    if (queuedMessages.length == 0) {
                        clearInterval(intervalID!);
                        intervalID = null;
                    }
                }, rateLimit / 2);
            }

            return null;
        }
        tempOptions.content = "```\n" + tempOptions.content + "\n```";
    }
    timeOfLastMsg = new Date().getTime();
    return await webhook?.send(tempOptions); //
}

async function stopBot() {
    const stopMessage = "Integration Stopped.";
    await sendWebhook({
        options: { content: stopMessage + " :wave: Goodbye!" },
        isManualMsg: true,
    });
    await webhook?.delete(stopMessage);
    printLog({ from: logSource, logLevel: 1 }, stopMessage);
}
