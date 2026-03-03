import config from "../config.json" with { type: "json" };
import { initBot as initDiscordJs, sendWebhook } from "./bot_client.ts";
import {
    handleChatMessage,
    handleJoinLeave,
    handleServerConnection,
    handleServerOperation,
    handleServerProcess,
    spawnTerraria,
} from "./terraria_client.ts";
import { printLog } from "./utils.ts";

const logSource = "Main";
let exitingGracefully = false;
let timeoutID: number | null = null;

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

    // Deno.addSignalListener("SIGINT", () => {
    //     console.log("interrupted!");
    //     Deno.exit();
    // });
    Deno.addSignalListener(
        "SIGINT",
        async () => await exitGracefully(discordClients, terraria),
    );

    for await (const line of terraria.stdout) {
        const lineTemp = line.replace(/^(: )*/, "");

        if (lineTemp.includes("Server started")) {
            enableIntegration = true;
            printLog({ from: logSource, logLevel: 1 }, "Integration Started.");
            await sendWebhook({
                options: {
                    content: "Integration Started: :white_check_mark: Hello!",
                },
                isManualMsg: true,
            });
            timeoutID = setTimeout(() => {
                terraria.stdin.write(
                    //
                    new TextEncoder().encode("playing\n"),
                );
                timeoutID = null;
            }, 5000);
        }

        if (
            handleChatMessage(
                //
                lineTemp,
                config.forwardTypes.chatMessage,
            )
        ) {
            continue;
        }

        if (
            handleJoinLeave(
                //
                lineTemp,
                config.forwardTypes.joinLeave,
            )
        ) {
            continue;
        }

        if (
            handleServerConnection(
                //
                lineTemp,
                config.forwardTypes.serverConnection,
            )
        ) {
            continue;
        }

        if (
            handleServerProcess(
                //
                lineTemp,
                config.forwardTypes.serverProcess,
            )
        ) {
            continue;
        }

        if (
            handleServerOperation(
                //
                lineTemp,
                config.forwardTypes.serverOperation,
            )
        ) {
            continue;
        }

        printLog({ logLevel: 1, isError: true }, lineTemp);
    }
    await exitGracefully(discordClients, terraria);
}

async function exitGracefully(
    discordClients: {
        destroy: () => Promise<void>;
    },
    terraria: {
        destroy: () => Promise<Deno.CommandOutput>;
    },
) {
    if (exitingGracefully) return;
    exitingGracefully = true;

    printLog(
        { from: logSource, logLevel: 1 },
        "Attempting to shut down gracefully",
    );

    if (timeoutID) clearTimeout(timeoutID);

    await Promise.allSettled([
        //
        discordClients.destroy(),
        terraria.destroy(),
    ]);

    printLog({ from: logSource, logLevel: 1 }, "Integration Stopped.");
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
