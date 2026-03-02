import "@std/dotenv/load";
import config from "../config.json" with { type: "json" };
import { initBot as initDiscordJs, sendWebhook } from "./bot_client.ts";
import { spawnTerraria } from "./terraria_client.ts";
import {
    handleChatMessage,
    handleJoinLeave,
    handleServerConnection,
    handleServerOperation,
    printLog,
} from "./utils.ts";

export let enableIntegration = false;

const isNotNull = (e: unknown) =>
    e != null && (typeof e != "object" || Object.values(e).every(isNotNull));
if (!isNotNull(config)) {
    console.error("Invalid config.");
    Deno.exit(1);
}

main();

async function main() {
    const terraria = spawnTerraria();
    // const terraria: any = { stdout: [] };

    passStdInTo(terraria.stdin);

    const discordClients = await initDiscordJs(terraria.stdin);

    for await (const line of terraria.stdout) {
        const lineTemp = line.replace(/^(: )*/, "");

        if (lineTemp.includes("Server started")) {
            enableIntegration = true;
            await sendWebhook({
                options: { content: "Integration Started: :white_check_mark: Hello!" },
                isManualMsg: true,
            });
        }

        if (handleChatMessage(lineTemp, config.logTypes.chatMessage)) {
            continue;
        }

        if (handleJoinLeave(lineTemp, config.logTypes.joinLeave)) {
            continue;
        }

        if (
            await handleServerConnection(
                lineTemp,
                config.logTypes.serverConnection,
            )
        ) {
            continue;
        }

        if (handleServerOperation(lineTemp, config.logTypes.serverOperation)) {
            continue;
        }

        printLog({ logLevel: 1, isError: true }, lineTemp);
    }
    await Promise.allSettled([
        //
        discordClients.destroy(),
        terraria.destroy(),
    ]);

    printLog({ from: "Main", logLevel: 1 }, "Integration stopped");
    Deno.exit(0);
}

async function passStdInTo(
    writer?: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>,
) {
    if (writer == null) return;
    for await (const input of Deno.stdin.readable) {
        writer.write(input);
    }
}
