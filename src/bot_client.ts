import { Client, Events, GatewayIntentBits, WebhookClient } from "discord.js";
import { adminUserIDs, botPrefix } from "./main.ts";

export function initBot({
    webhookURL,
    channelID,
    stdinWriter,
}: {
    webhookURL: string;
    channelID: string;
    stdinWriter: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>;
}): [Client, WebhookClient] {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
    });

    const webhookURLPath = new URL(webhookURL).pathname.substring(1).split("/");

    const [webhookId, webhookToken] = webhookURLPath.slice(-2);

    const webhookClient = new WebhookClient({
        id: webhookId,
        token: webhookToken,
    });

    client.once(Events.ClientReady, (readyClient) => {
        console.log(`Logged in as ${readyClient.user.tag}!`);
    });

    client.on(Events.MessageCreate, async (message) => {
        if (message.channelId != channelID) return;

        if (message.content == "!ping") {
            webhookClient.send({
                content: `:ping_pong: \`${new Date().getTime() - message.createdAt.getTime()}ms\` :ping_pong:`,
            });
        }

        if (message.content.startsWith(botPrefix)) {
            if (!adminUserIDs.includes(message.author.id)) return;

            const outputStr =
                message.content.slice(botPrefix.length) + "\n";
            const encodedText = new TextEncoder().encode(outputStr);

            await stdinWriter.write(encodedText);
        }
    });

    return [client, webhookClient];
}
