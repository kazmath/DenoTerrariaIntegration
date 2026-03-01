import "@std/dotenv/load";
import { initBot } from "./bot_client.ts";
import {
    handleChatMessage,
    handleIpOperationServer,
    handleJoinLeave,
    handleOperationServer,
} from "./handleChatMessage.ts";
import { spawnTerraria } from "./terraria_client.ts";

const env = {
    botToken: Deno.env.get("BOT_TOKEN")!,
    terrariaServerPath: Deno.env.get("TERRARIA_SERVER_PATH")!,
    terrariaConfigPath: Deno.env.get("TERRARIA_SERVER_CONFIG_PATH")!,
    channelID: Deno.env.get("CHANNEL_ID")!,
    webhookURL: Deno.env.get("WEBHOOK_URL")!,
};

export const adminUserIDs = [
    "410604925500784657", // @kazuma_weeb
    "382853907031916544", // @qmelz
];
export const botPrefix = "k!";
export let enableIntegration = false;
export let timeOfLastMsg = 0;
export const messageWasSent = () => {
    timeOfLastMsg = new Date().getTime();
};

main();

async function main() {
    const terraria = spawnTerraria(
        env.terrariaServerPath,
        env.terrariaConfigPath,
    );
    const [bot, webhook] = initBot({
        stdinWriter: terraria.stdin,
        channelID: env.channelID,
        webhookURL: env.webhookURL,
    });

    await bot.login(env.botToken);

    for await (const line of terraria.stdout) {
        if (line.includes(": Server started")) enableIntegration = true;

        if (
            handleChatMessage(line, webhook) ||
            handleJoinLeave(line, webhook) ||
            handleIpOperationServer(line, webhook) ||
            handleOperationServer(line, webhook)
        ) {
            continue;
        }
        console.log(`UnknownMessage: ${line}`);
    }

    terraria.process.stdin.close();
    console.log("exit");
}
