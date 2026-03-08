import {
    Activity,
    ActivityOptions,
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
import { printLog, regices } from "./utils.ts";

const _logSource = "DiscordJS";
let webhook: WebhookClient | null;
let discordBot: Client | null;

let customAvatars: { [key: string]: string } = {};
// let checkPlayingIntervalID: number;

export async function initBot(
    stdinWriter: WritableStreamDefaultWriter<
        Uint8Array<ArrayBufferLike>
    > | null,
) {
    const botCommands: {
        [key: string]: (message: Message) => Promise<unknown> | unknown;
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
                    printLog({ from: _logSource, isError: true }, errorMsg);
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

            if (config.webhook.customAvatarsDb.length != 0) {
                return await Deno.writeTextFile(
                    config.webhook.customAvatarsDb,
                    JSON.stringify(avatars, null, 4),
                )
                    .then(() => {
                        printLog({ from: _logSource }, msg + msgLog);
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
                            { from: _logSource, isError: true },
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
            }
            printLog(
                { from: _logSource, isError: true },
                "Avatars file not set: Could not change custom avatar.",
            );
            return await sendWebhook({
                options: {
                    content:
                        "Avatars file not set: Could not change custom avatar.",
                },
                isManualMsg: true,
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
                    from: _logSource,
                    logLevel: 1,
                },
                "Logged in as",
                readyClient.user.tag,
            );

            if (config.webhook.customAvatarsDb.length != 0) {
                try {
                    Deno.lstatSync(config.webhook.customAvatarsDb);
                } catch (_) {
                    Deno.writeFileSync(
                        config.webhook.customAvatarsDb,
                        new TextEncoder().encode("{}"),
                    );
                }
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
                    printLog({ from: _logSource, isError: true }, error);
                }
            }

            // This is way too annoying and I suspect is the reason the server
            // keeps crashing
            //
            // if (config.bot.enableActivity) {
            //     checkPlayingIntervalID = setInterval(
            //         async () => {
            //             await stdinWriter?.write(
            //                 new TextEncoder().encode("playing\n"),
            //             );
            //         },
            //         2 * 60 * 60 * 1000, // 2hrs
            //     );
            // }
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
            if (command != null) return await command(message);

            await forwardToTerraria(message);
        })
        .on(Events.Error, (error) => {
            printLog(
                { from: _logSource, logLevel: 1, isError: true },
                "An error occured in the botClient:",
                error,
            );
        });

    const botToken = await discordBot //
        .login(config.bot.token)
        .catch((error) => {
            printLog(
                { from: _logSource, logLevel: 1, isError: true },
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
                        { from: _logSource, logLevel: 1, isError: true },
                        "An error occured in the webhookClient:",
                        error,
                    );
                }),
        )
        .catch((error) => {
            printLog(
                { from: _logSource, logLevel: 1, isError: true },
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

    async function forwardToTerraria(message: Message) {
        const reMessage = //
            message.reference
                ? await message.channel.messages.fetch(
                      message.reference.messageId!,
                  )
                : null;

        const attachments = //
            message.attachments.values().toArray().length > 0
                ? message.attachments
                      .values()
                      .toArray()
                      .map((e) => `<${e.name}>`)
                : null;

        let linesIt = 0;
        const lines = message.cleanContent //
            .split("\n");
        const outputStrList = lines.map((msg) => {
            const [startTag, endTag] = ["[color/FFFFFF:", "]"];
            const [startLinkTag, endLinkTag] = ["[color/232AFC:", "]"];

            const thisMsg = msg
                .replace(
                    //
                    regices.linkOnlyMessage,
                    (_, urlStart, urlEnd) => {
                        let output = urlStart;
                        if (urlEnd) output += "/.../" + urlEnd;
                        return output;
                    },
                )
                .replaceAll(
                    regices.chatTagsInForwardedMsg,
                    `${endTag}$&${startTag}`,
                );
            const output =
                `say ${startTag}@${message.author.username}` +
                (reMessage //
                    ? " to " +
                      (reMessage.author.bot || reMessage.author.system
                          ? ""
                          : "@") +
                      reMessage.author.username
                    : "") +
                ": " +
                (lines.length > 1 //
                    ? `{${++linesIt}/${lines.length}} `
                    : "") +
                thisMsg +
                (attachments //
                    ? (thisMsg.length > 0 ? " | " : "") +
                      endTag +
                      startLinkTag +
                      attachments.join(
                          endLinkTag + startTag + ", " + endTag + startLinkTag,
                      ) +
                      endLinkTag +
                      startTag
                    : "") +
                endTag +
                "\n";
            return output.replaceAll(
                //
                regices.emptyChatTags,
                "",
            );
        });
        const encoder = new TextEncoder();
        for (const line of outputStrList) {
            const encodedText = encoder.encode(line);
            await stdinWriter?.write(encodedText);
        }
    }
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
        if (!isServerMsg && customAvatars != null) {
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
    await setBotActivity(null);
    // clearInterval(checkPlayingIntervalID);
    await sendWebhook({
        options: { content: stopMessage + " :wave: Goodbye!" },
        isManualMsg: true,
    });
    await webhook?.delete(stopMessage);

    if (config.bot.destroyAfterStop) await discordBot?.destroy();
    printLog({ from: _logSource, logLevel: 1 }, stopMessage);
}

export async function setBotActivity(input: string | null) {
    if (!config.bot.enableActivity) return;

    let output;

    const user = discordBot?.user;
    if (input == null) {
        output = user?.setActivity("");
        if (!user) {
            printLog({ from: _logSource, isError: true }, "User not found");
            throw new Error("User not found");
        }
        await waitForActivityChange(null);
    } else {
        const activityGoal = {
            name: input,
        };
        output = user?.setActivity(activityGoal);
        if (!user) {
            printLog({ from: _logSource, isError: true }, "User not found");
            throw new Error(`User not found`);
        }
        await waitForActivityChange(activityGoal);
    }
    return output;

    async function waitForActivityChange(goal: ActivityOptions | null) {
        const delay = 500;
        const timeout = 10 * delay + 1;
        const now = new Date().getTime();

        const check = (
            activities: Activity[],
            goal: ActivityOptions | null,
        ) => {
            return goal
                ? activities.some((a) => a.name == goal.name)
                : activities.length == 0;
        };

        return await new Promise<boolean>((resolve, _) => {
            let intervalID: number | null = null;
            intervalID = setInterval(
                async (id: number, activityGoal: ActivityOptions | null) => {
                    const fetchedActivities = await discordBot?.user
                        ?.fetch()
                        .then((u) => u?.client.user.presence.activities);
                    if (
                        fetchedActivities &&
                        check(fetchedActivities, activityGoal)
                    ) {
                        clearInterval(id!);
                        return resolve(true);
                    }
                    if (new Date().getTime() - now > timeout) {
                        clearInterval(id!);
                        return resolve(false);
                    }
                },
                delay,
                intervalID,
                goal,
            );
        });
    }
}

export async function parseMentions(input: string) {
    const matchesArr = input.matchAll(regices.mentionDiscordUser).toArray();
    if (matchesArr.length == 0) return input;

    const guildId = await discordBot?.channels
        .fetch(config.webhook.channelID)
        .then((c) => (c as TextChannel)?.guildId);

    if (guildId == null) {
        printLog({ from: _logSource, isError: true }, "guildId is null.");
        return input;
    }

    const members = await discordBot?.guilds
        .fetch(guildId)
        .then((g) => g.members);

    const mentionLookupDict: { [key: string]: string | undefined } = {
        everyone: "@DO_NOT",
        here: "@DO_NOT",
    };
    for (const match of matchesArr) {
        const username = match.groups!["username"];

        if (username == "everyone" || username == "here") continue;

        mentionLookupDict[username] = await members
            ?.search({
                query: username,
            })
            .then(
                (m) =>
                    m
                        .mapValues((m) => m.user.toString())
                        .values()
                        .toArray()[0],
            );
    }

    const output = input.replaceAll(
        regices.mentionDiscordUser,
        (match, ...m) => {
            const username: string = m.findLast(() => true)?.["username"] ?? "";
            const foundUserMention = mentionLookupDict[username];

            return foundUserMention ?? match;
        },
    );

    return output;
}
