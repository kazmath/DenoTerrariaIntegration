import {
    Client,
    Events,
    GatewayIntentBits,
    Message,
    TextChannel,
    User,
    WebhookClient,
    WebhookMessageCreateOptions,
} from "discord.js";
import config from "../config.json" with { type: "json" };
import { enableIntegration } from "./main.ts";
import { printLog } from "./utils.ts";

const logSource = "DiscordJS";
export let webhook: WebhookClient | null;
export let discordBot: Client | null;

let customAvatars: { [key: string]: string };
let _checkPlayingIntervalID: number;

export async function initBot(
    stdinWriter: WritableStreamDefaultWriter<
        Uint8Array<ArrayBufferLike>
    > | null,
) {
    const botCommands: {
        [key: string]: (message: Message) => Promise<void> | void;
    } = {
        ping: async (message) => {
            await sendWebhook({
                options: {
                    content: `:ping_pong: \`${new Date().getTime() - message.createdAt.getTime()}ms\` :ping_pong:`,
                },
                isManualMsg: true,
            });
        },
        avatar: async (message) => {
            if (!config.adminUserIDs.includes(message.author.id)) return;

            const args = message.content
                .split("\n")[0]
                .matchAll(/"([^"]*)"|(\S+)/g)
                .map((e) => e[1] ?? e[2])
                .toArray();

            const avatars: { [key: string]: string } = customAvatars;
            const playerName = args[1];
            const urlOrMention = args[2];

            let msg = "";
            let msgLog = "";
            let msgEmbed = "";
            let msgError = "";
            let url: string | null;
            if (urlOrMention == undefined) {
                delete avatars[playerName];

                msg = `Successfully removed custom avatar of user \`${playerName}\``;
                msgError = `Failed to remove custom avatar of user\`${playerName}\``;
            } else {
                message.mentions.parsedUsers.first;

                let user: User | undefined;
                if ((user = message.mentions.parsedUsers.first()) != null) {
                    url = user.avatarURL();
                } else {
                    url = new URL(urlOrMention).toString();
                }

                if (url == null) {
                    const errorMsg = "Invalid URL";
                    printLog({ from: logSource, isError: true }, errorMsg);
                    await sendWebhook({
                        options: {
                            content: errorMsg,
                        },
                        isManualMsg: true,
                    });
                    return;
                }

                avatars[playerName] = url;
                msg = `Successfully set avatar of user \`${playerName}\``;
                msgLog = ` to <${url}>`;
                msgEmbed = " to:";
                msgError = `Failed to set avatar of user \`${playerName}\` to <${url}>`;
            }

            await Deno.writeTextFile(
                config.webhook.customAvatarsDb,
                JSON.stringify(avatars, null, 4),
            )
                .then(() => {
                    printLog({ from: logSource }, msg + msgLog);
                    customAvatars = avatars;

                    return sendWebhook({
                        options: {
                            content: msg + msgEmbed,
                            ...(url != null
                                ? {
                                      embeds: [
                                          {
                                              image: {
                                                  url: url,
                                              },
                                          },
                                      ],
                                  }
                                : {}),
                        },
                        isManualMsg: true,
                    });
                })
                .catch((error) => {
                    const errorMsg = msgError;
                    printLog(
                        { from: logSource, isError: true },
                        errorMsg + ":",
                        error,
                    );
                    return sendWebhook({
                        options: {
                            content: errorMsg,
                        },
                        isManualMsg: true,
                    });
                });
        },
        stop: async (message) => {
            if (!config.adminUserIDs.includes(message.author.id)) return;

            await sendWebhook({
                options: {
                    content: `Not implemented.`,
                },
                isManualMsg: true,
            });
        },
        exec: async (message) => {
            if (!config.adminUserIDs.includes(message.author.id)) return;

            const outputStr =
                message.content
                    .slice((config.bot.prefix + "exec ").length)
                    .split("\n")[0] + "\n";
            const encodedText = new TextEncoder().encode(outputStr);

            await stdinWriter?.write(encodedText);
        },
    };

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

            try {
                customAvatars = JSON.parse(
                    new TextDecoder("utf-8").decode(
                        Deno.readFileSync(
                            //
                            config.webhook.customAvatarsDb,
                        ),
                    ),
                );
            } catch (error) {
                printLog({ from: logSource, isError: true }, error);
            }

            _checkPlayingIntervalID = setInterval(
                async () => {
                    await stdinWriter?.write(
                        new TextEncoder().encode("playing\n"),
                    );
                },
                30 * 60 * 1000, // 30min
            );
        })
        .on(Events.MessageCreate, async (message) => {
            if (message.channelId != config.webhook.channelID) return;
            if (message.author.bot || message.author.system) return;

            const command = Object.entries(botCommands).find((e) => {
                return (
                    message.content //
                        .split("\n")[0]
                        .split(/\s/)[0] ==
                    config.bot.prefix + e[0]
                );
                // return message.content.startsWith(config.bot.prefix + e[0]);
            })?.[1];
            if (command != null) {
                await command(message);
                return;
            }

            const outputStr = message.cleanContent //
                .split("\n")
                .map(
                    (m) =>
                        `say [color/FFFFFF:${message.author.username}:] ${m}\n`,
                );
            const encoder = new TextEncoder();
            for (const line of outputStr) {
                const encodedText = encoder.encode(line);
                await stdinWriter?.write(encodedText);
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
    if (tempOptions.username == "" || tempOptions.username == null) {
        tempOptions.username = config.webhook.username;
    }
    if (tempOptions.avatarURL == "" || tempOptions.avatarURL == null) {
        if (!isServerMsg) {
            tempOptions.avatarURL =
                (customAvatars as { [key: string]: string })[
                    tempOptions.username
                ] ?? config.webhook.avatarURL;
        } else {
            tempOptions.avatarURL = config.webhook.avatarURL;
        }
    }
    tempOptions.content?.trim();
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
    discordBot?.user?.setActivity("");
    await new Promise<void>((resolve, _) => {
        let intervalID: number | null = null;
        intervalID = setInterval(
            async () => {
                const fetchedUser = await discordBot?.user?.fetch();
                if (fetchedUser?.client.user.presence.activities.length == 0) {
                    clearInterval(intervalID!);
                    resolve();
                }
            },
            500,
            intervalID,
        );
    });

    await sendWebhook({
        options: { content: stopMessage + " :wave: Goodbye!" },
        isManualMsg: true,
    });
    await webhook?.delete(stopMessage);

    await discordBot?.destroy();
    printLog({ from: logSource, logLevel: 1 }, stopMessage);
}
