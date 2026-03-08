import itemIDs from "../assets/item_ids.json" with { type: "json" };
import modifierIDs from "../assets/modifier_ids.json" with { type: "json" };
import config from "../config.json" with { type: "json" };

const _logSource = "Utils";

export const regices = {
    chatMessage: /^<(?<player>.*?)> (?<message>.*)$/,
    joinLeft: /^(?<player>.*) has (?<type>joined|left)\.$/,
    connection:
        /^(?<ipAddr>[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}) (?<verb>is|was) (?<operation>.*?)(?:: (?<details>.*))?$/,
    serverProcess: /^(?<operation>.*?):? (?<progressPerc>[0-9]{1,3})%$/,
    serverOperation: /^(?<operation>.*?[^a-zA-Z0-9]*)$/,
    textTag:
        /\[(?<identifier>[a-z]+)(?:\/(?<options>[a-zA-Z0-9]+))?:(?<text>[^\]]+)\]/g,
    forwardedDiscordMessage:
        /^\[color\/FFFFFF:(?<author>@[a-zA-Z0-9_\.]+)(?: to (?<re_author>@?[a-zA-Z0-9_\.]+))?:(?<message>.*)\]$/,
    emptyChatTags: /\[color\/FFFFFF:\]/g,
    playersConnected: /^(?<amount>[0-9]+|No) players? connected\./,
    mentionDiscordUser: /@(?<username>[a-zA-Z0-9_\.]+)/g,
    chatTagsInForwardedMsg: /\[[a-z](?:\/\w+)?:[^\[\]]+\]/g,
    linkOnlyMessage:
        /^(https?:\/\/[^\/\n]+(?:\/[^\/\n]+)?)(?:.*\/((?:[^\/\n]+){1}))?$/,
};
const connectedIPs: {
    [key: string]: string;
} = {};

export function parseTags(input: string) {
    let output = "";

    const re = new RegExp(regices.textTag);

    let pointer: number = 0;
    let lastTagLastIndex = -1;
    let match: RegExpExecArray | null;
    while ((match = re.exec(input)) != null) {
        if (match.index != lastTagLastIndex && match.index != 0) {
            output += " ";
        }
        output += input.slice(pointer, match.index);
        pointer = match[0].length + match.index;

        const groups: {
            [key: string]: string;
        } = match.groups!;

        let curr: string;
        switch (groups["identifier"]) {
            // Colored text (unsupported in discord)
            case "color":
            case "c": {
                let prefix = "**";
                const suffix = prefix;
                if (output.match(/[^*]?\*\*[^*]*\*\*$/)) {
                    output = output.slice(0, -prefix.length);
                    prefix = "";
                } else if (output.match(/\*+$/)) {
                    prefix = " " + prefix;
                }
                curr = prefix + groups["text"] + suffix;
                break;
            }

            // Item with modifier and amount
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
                                )[opt[2]];
                                return;
                            }
                        });
                }

                if (match.index == lastTagLastIndex) {
                    output += ", ";
                } else if (match.index != 0) {
                    output += " ";
                }
                const itemName = (
                    itemIDs as {
                        [key: string]: { [key: string]: string };
                    }
                )[groups["text"]]["Name"];
                curr =
                    `[${itemName + (quantity > 1 ? ` (×${quantity})` : "")}]` +
                    "(" +
                    `<https://terraria.wiki.gg/wiki/${itemName.replaceAll(/\s/g, "%20")}> "` +
                    (modifier.length > 0 ? modifier + " " : "") +
                    itemName +
                    (quantity > 1 ? ` (×${quantity})` : "") +
                    '")';

                break;
            }

            // Username chat formatting (e.g.: [n:player] -> <player>)
            case "name":
            case "n":
                curr = `<${groups["text"]}>`;
                break;

            // Achievements
            case "a":
            // Icons
            case "glyph":
            case "g": {
                let prefix = "`";
                const suffix = prefix;
                if (output.match(/`$/)) {
                    prefix = " " + prefix;
                }

                curr = prefix + groups["text"] + suffix;
                break;
            }

            default:
                curr = match[0];
                break;
        }
        lastTagLastIndex = re.lastIndex;
        output += curr;
        //
        // re.index++;
    }
    output += input.slice(pointer, input.length);

    return output;
}

export function hideIP(ipAddr: string) {
    let hiddenIP: string | undefined = Object.entries(connectedIPs).find(
        ([k, _]) => k == ipAddr,
    )?.[1];
    if (hiddenIP == null) {
        hiddenIP = connectedIPs[ipAddr] = crypto
            .randomUUID()
            .replaceAll("-", "")
            .slice(-10)
            .toUpperCase();
    }
    return hiddenIP;
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
