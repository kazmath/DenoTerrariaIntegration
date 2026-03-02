import itemIDs from "../assets/item_ids.json" with { type: "json" };
import modifierIDs from "../assets/modifier_ids.json" with { type: "json" };
import config from "../config.json" with { type: "json" };
import { sendWebhook } from "./bot_client.ts";

const logSource = "MsgHandler";
const regices = {
    chatMessageRegex: /^<(?<player>.*?)> (?<message>.*)$/,
    joinLeftRegex: /^(?<player>.*) has (?<type>joined|left)\.$/,
    connectionRegex:
        /^(?<ipAddr>[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}) (?<verb>is|was) (?<operation>.*?)(?:: (?<details>.*))?$/,
    serverProcessRegex: /^(?<operation>.*?):? (?<progressPerc>[0-9]{1,3})%$/,
    serverOperationRegex: /^(?<operation>.*?[^a-zA-Z0-9]*)$/,
    textTagRegex:
        /\[(?<identifier>[a-z]+)(?:\/(?<options>[a-zA-Z0-9]))?:(?<text>[^\]]*)\]/g,
};
const connectedIPs: {
    [key: string]: `${string}-${string}-${string}-${string}-${string}`;
} = {};

export function handleChatMessage(line: string, show: boolean = true) {
    const matches = regices.chatMessageRegex.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const message = matches.groups!["message"];

    printLog({ from: logSource + "(ChatMessage)" }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            username: parseTags(player),
            content: parseTags(message),
        },
    });
    return true;
}

export function handleJoinLeave(line: string, show: boolean = true) {
    const matches = regices.joinLeftRegex.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const type = matches.groups!["type"];

    printLog({ from: logSource + "(JoinLeave)" }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            username: parseTags(player),
            content: `**${player} has ${type}.**`,
        },
    });
    return true;
}

export function handleServerOperation(line: string, show: boolean = true) {
    const matches = regices.serverOperationRegex.exec(line);

    if (matches == null) return false;

    const operation = matches.groups!["operation"];

    printLog({ from: logSource + "(ServerOperation)", logLevel: 2 }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            content: operation,
        },
        isServerMsg: true,
    });
    return true;
}

export function handleServerProcess(line: string, show: boolean = true) {
    const matches = regices.serverProcessRegex.exec(line);

    if (matches == null) return false;

    const operation = matches.groups!["operation"];
    const progressPerc = matches.groups!["progressPerc"];

    printLog({ from: logSource + "(ServerProcess)", logLevel: 3 }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            content: operation + (progressPerc ? `: ${progressPerc}%` : ""),
        },
        isServerMsg: true,
    });
    return true;
}

export function handleServerConnection(line: string, show: boolean = true) {
    const matches = regices.connectionRegex.exec(line);

    if (matches == null) return false;

    const ipAddr = matches.groups!["ipAddr"].replace(/:[0-9]+$/, "");
    const verb = matches.groups!["verb"];
    const operation = matches.groups!["operation"];
    const details = matches.groups!["details"];

    printLog({ from: logSource + "(ServerConnection)", logLevel: 3 }, line);
    if (!show) return true;

    let UUID = Object.entries(connectedIPs).find(([k, _]) => k == ipAddr)?.[1];
    if (UUID == null) {
        UUID = connectedIPs[ipAddr] = crypto.randomUUID();
    }
    sendWebhook({
        options: {
            content:
                `{${UUID}} ${verb} ${operation}` +
                (details ? `: ${details}` : ""),
        },
        isServerMsg: true,
    });
    return true;
}

export function parseTags(input: string) {
    let numberMatches = 0;
    const output = input.replaceAll(regices.textTagRegex, (match, ...args) => {
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

/**
 * Levels of log:
 *
 * 1: Only error;
 *
 * 2: Error+Important;
 *
 * 3: All;
 */
export function printLog(
    {
        from = "Unknown",
        logLevel = 2,
        isError = false,
    }: {
        from?: string;
        logLevel?: number;
        isError?: boolean;
    },
    // deno-lint-ignore no-explicit-any
    ...message: any[]
) {
    if (logLevel > config.logLevel) return;

    const output = [`[${from}]:`, ...message];

    if (isError) {
        console.error(...output);
    } else {
        console.log(...output);
    }
}
