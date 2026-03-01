import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { WebhookClient, WebhookMessageCreateOptions } from "discord.js";
import itemIDs from "./item_ids.json" with { type: "json" };
import { enableIntegration, messageWasSent, timeOfLastMsg } from "./main.ts";
import modifierIDs from "./modifier_ids.json" with { type: "json" };

const regexes = {
    chatMessageRegex: /^<(?<player>.*?)> (?<message>.*)$/,
    joinLeftRegex: /^(?<player>.*) has (?<type>joined|left)\.$/,
    ipOperationsRegex:
        /^(?<ipAddr>[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}) (?<verb>is|was) (?<operation>.*?)(?:: (?<details>.*))?$/,
    serverProcessRegex:
        /^(?<operation>.*?)(?:: (?<progressPerc>[0-9]{1,3})%)?$/,
    textTagRegex:
        /\[(?<identifier>[a-z]+)(?:\/(?<options>[a-zA-Z0-9]))?:(?<text>[^\]]*)\]/g,
};

let rateLimitedMessages: Array<string | undefined> = [];
const rateLimit = 500;
let timeoutID: number | null;

export function handleChatMessage(
    line: string,
    webhook: WebhookClient,
    show: boolean = true,
) {
    const matches = regexes.chatMessageRegex.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const message = matches.groups!["message"];

    console.log("ChatMessage:", line);
    if (!show) return true;

    sendWebhook(webhook, {
        avatarURL: undefined,
        username: parseTags(player),
        content: parseTags(message),
    });
    return true;
}

export function handleJoinLeave(
    line: string,
    webhook: WebhookClient,
    show: boolean = true,
) {
    const matches = regexes.joinLeftRegex.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const type = matches.groups!["type"];

    console.log("JoinLeave:", line);
    if (!show) return true;

    sendWebhook(webhook, {
        avatarURL: undefined,
        username: parseTags(player),
        content: `**${player} has ${type}.**`,
    });
    return true;
}

export function handleOperationServer(
    line: string,
    webhook: WebhookClient,
    show: boolean = true,
) {
    const matches = regexes.serverProcessRegex.exec(line);

    if (matches == null) return false;

    const operation = matches.groups!["operation"];
    const progressPerc = matches.groups!["progressPerc"];

    console.log("OperationServer:", line);
    if (!show) return true;

    sendWebhook(
        webhook,
        {
            avatarURL: undefined,
            username: "Server",
            content:
                "`" +
                operation +
                (progressPerc ? `: ${progressPerc}%` : "") +
                "`",
        },
        true,
    );
    return true;
}

export function handleIpOperationServer(
    line: string,
    webhook: WebhookClient,
    show: boolean = true,
) {
    const matches = regexes.ipOperationsRegex.exec(line);

    if (matches == null) return false;

    const ipAddr = matches.groups!["ipAddr"];
    const verb = matches.groups!["verb"];
    const operation = matches.groups!["operation"];
    const details = matches.groups!["details"];

    console.log("IpOperationServer:", line);
    if (!show) return true;

    const hashedIP = encodeHex(
        crypto.subtle.digestSync("MD5", new TextEncoder().encode(ipAddr)),
    );
    sendWebhook(
        webhook,
        {
            avatarURL: undefined,
            username: "Server",
            content:
                "`" +
                `{${hashedIP} ${verb} ${operation}` +
                (details ? `: ${details}` : "") +
                "`",
        },
        true,
    );
    return true;
}

function sendWebhook(
    webhook: WebhookClient,
    options: WebhookMessageCreateOptions,
    isServerMsg: boolean = false,
) {
    const tempOptions = options;
    if (!enableIntegration) return;
    if (tempOptions.content == "") tempOptions.content = " ";

    if (isServerMsg) {
        const currentTime = new Date().getTime();
        console.log(
            currentTime - timeOfLastMsg,
            "\n",
            currentTime,
            "\n",
            timeOfLastMsg,
        );
        if (currentTime - timeOfLastMsg < rateLimit) {
            rateLimitedMessages.push(options.content?.slice(1, -1));
            if (timeoutID == null) {
                timeoutID = setTimeout(
                    () => {
                        if (rateLimitedMessages.length > 0) {
                            webhook.send({
                                avatarURL: undefined,
                                username: "Server",
                                content:
                                    "`" + rateLimitedMessages.join("\n") + "`",
                            });
                            messageWasSent();
                        }
                        timeoutID = null;
                    },
                    rateLimit - (currentTime - timeOfLastMsg) + 500,
                );
            }
            return;
        }
        if (rateLimitedMessages.length > 0) {
            tempOptions.content =
                "`" +
                [
                    ...rateLimitedMessages,
                    tempOptions.content?.slice(1, -1),
                ].join("\n") +
                "`";
            rateLimitedMessages = [];
        }
    }
    webhook.send(options);
    messageWasSent();
}

function parseTags(input: string) {
    let numberMatches = 0;
    const output = input.replaceAll(regexes.textTagRegex, (match, ...args) => {
        numberMatches++;

        const groups: {
            [key: string]: string;
        } = args.slice(-1)[0];

        switch (groups["identifier"]) {
            case "color":
            case "c":
                return `**${groups["text"]}**`;

            case "item":
            case "i": {
                let quantity: number = 1;
                let modifier: string = "";
                if (groups["options"] != null) {
                    groups["options"]
                        .matchAll(/(p|s|x)([0-9]+)/g)
                        .forEach((opt) => {
                            if (["s", "x"].includes(opt[1])) {
                                quantity = +opt[2];
                                return;
                            }
                            if (["p"].includes(opt[1])) {
                                modifier = (
                                    modifierIDs as { [key: string]: string }
                                )[opt[1]];
                                return;
                            }
                        });
                }

                return (
                    "***" +
                    (modifier.length > 0 ? modifier : "") +
                    (
                        itemIDs as {
                            [key: string]: { [key: string]: string };
                        }
                    )[groups["text"]]["Name"] +
                    "***" +
                    (quantity > 1 ? `x${quantity}` : "")
                );
            }
            case "name":
            case "n":
                return `<${groups["text"]}>`;
            case "a":
                return `\`${groups["text"]}\``;
            case "glyph":
            case "g":
                return `\`${groups["text"]}\``;

            default:
                return match[0];
        }
    });
    if (numberMatches == 0) return input;
    return output;
}
