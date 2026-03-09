import config from "../config.json" with { type: "json" };
import {
    IDiscordBotProcess,
    initBot as initDiscordJs,
    sendWebhook,
} from "./bot_client.ts";
import {
    handleChatMessage,
    handleJoinLeave,
    handleServerConnection,
    handleServerOperation,
    handleServerProcess,
    ITerrariaProcess,
    spawnTerraria,
} from "./terraria_client.ts";
import { printLog } from "./utils.ts";

const _logSource = "Main";
let exitingGracefully = false;
// let timeoutID: number | null = null;

export const processes: {
    terraria?: ITerrariaProcess;
    discordBot?: IDiscordBotProcess;
    enableIntegration: boolean;
} = {
    enableIntegration: false,
};

const isNotNull = (e: unknown) =>
    e != null && (typeof e != "object" || Object.values(e).every(isNotNull));
if (!isNotNull(config)) {
    console.error("Invalid config.");
    Deno.exit(1);
}

main();

async function main() {
    processes.terraria = spawnTerraria(
        config.terraria.binaryPath,
        config.terraria.configPath,
    );
    let thisPID = processes.terraria.process?.pid;
    // const terraria: any = { stdout: [] };

    passStdInTo(processes.terraria.stdin);

    processes.discordBot = await initDiscordJs();

    // Deno.addSignalListener("SIGINT", () => {
    //     console.log("interrupted!");
    //     Deno.exit();
    // });
    Deno.addSignalListener(
        "SIGINT",
        async () =>
            await exitGracefully(
                //
                processes.discordBot,
                processes.terraria,
            ),
    );

    do {
        if (processes.terraria.process?.pid != thisPID) {
            thisPID = processes.terraria.process!.pid;
        }

        for await (const line of processes.terraria.stdout ?? []) {
            const lineTemp = line.replace(/^(: )*/, "");

            if (lineTemp.includes("Server started")) {
                processes.enableIntegration = true;
                printLog(
                    { from: _logSource, logLevel: 1 },
                    "Integration Started.",
                );
                await sendWebhook({
                    options: {
                        content:
                            "Integration Started: :white_check_mark: Hello!",
                    },
                    isServerMsg: true,
                    isManualMsg: true,
                });
            }

            if (
                await handleChatMessage(
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
        await new Promise<void>((r) => setTimeout(() => r(), 500));
    } while (
        ["Restarting", "Starting"].includes(processes.terraria.state) ||
        processes.terraria.process?.pid != thisPID
    );
    await exitGracefully(processes.discordBot, processes.terraria);
}

export async function exitGracefully(
    discordClients?: {
        destroy: IDiscordBotProcess["destroy"];
    },
    terraria?: {
        destroy: ITerrariaProcess["destroy"];
    },
) {
    if (exitingGracefully) return;
    exitingGracefully = true;

    printLog(
        { from: _logSource, logLevel: 1 },
        "Attempting to shut down gracefully",
    );

    await Promise.allSettled([
        //
        discordClients?.destroy(),
        terraria?.destroy(),
    ]);

    printLog({ from: _logSource, logLevel: 1 }, "Integration Stopped.");
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
